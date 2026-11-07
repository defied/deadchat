// Post generation.
//
// Text influencers:  discover a story → research trusted sources → draft from
//   those sources only → extract claims → verify each claim against the
//   sources → (one revision) → rules + policy review → review queue.
// Visual influencers: pick a theme → scene + caption → image (and optional
//   clip) of the locked look → rules + policy review → review queue.
//
// Nothing here publishes. A post that fails the fact-check or any rule is
// stored as `blocked` with the reasons, so the user can see why.

import { checkImagePrompt, checkPostText, domainOf, stripDisclosureTag } from './compliance';
import { aggregateFactCheck, isTrusted, topicKey, type ClaimEvidence, type FeedItem, type SourceVerdict } from './factcheck';
import { asString, asStringArray, llmJson } from './llm';
import { getActiveModel, getModelCapabilities } from '../chatModels';
import { awaitMedia, queueClip, queuePersonaImage, sceneRule } from './media';
import { getPlatform } from './platforms';
import { blueskyConversation, fetchFeed, fetchPage, webSearch, type Page } from './research';
import * as store from './store';
import type { ComplianceResult, FactCheck, Influencer, Persona, Source } from './types';

// ── shared ─────────────────────────────────────────────────────────────────

/** Longest post that fits every chosen platform. */
export function textBudget(inf: Influencer): number {
  const limits = (inf.plan.platforms ?? []).map((p) => getPlatform(p)?.maxText ?? 500);
  const min = limits.length ? Math.min(...limits) : 300;
  return Math.max(120, min);
}

function personaBrief(p: Persona): string {
  return [
    `${p.displayName ?? 'The persona'} is an invented, openly AI-generated social media persona (stated age ${p.age}).`,
    p.niche && `Posts about: ${p.niche}.`,
    p.audience && `Audience: ${p.audience}.`,
    p.tone && `Voice: ${p.tone}.`,
    p.perspective && `Perspective: ${p.perspective}.`,
    p.backstory && `Backstory: ${p.backstory}.`,
    `Writes in ${p.language || 'English'}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

const policySystem = (suggestive: boolean) =>
  'You review social media posts for an openly AI-generated persona before they are published. Return ' +
  '{"passed": boolean, "issues": [..]} with an issue for anything that breaks these rules: harassment, hate or ' +
  'slurs; targeting or naming a private individual; accusations of crimes or misconduct against named people ' +
  'that are not established fact; ' +
  (suggestive
    ? 'explicit sexual content, sex acts or solicitation (flirtatious, teasing captions and tasteful implied nudity are allowed); '
    : 'sexual content; ') +
  'anything involving minors in a sexual or exploitative way; ' +
  'medical, legal or financial advice presented as authoritative; claiming to be human or hiding that the persona ' +
  'is AI; impersonating a real person or organisation; misleading claims about how, when or where to vote; ' +
  'calls to violence; spam or engagement bait ("like and share"). Opinions are fine when they are clearly ' +
  'opinions. Do not flag a post just for being political. Be strict but concrete.';

/** Deterministic rules plus an LLM policy review. */
export async function reviewPost(inf: Influencer, text: string, sources: Source[], imageB64?: string): Promise<ComplianceResult> {
  const suggestive = inf.kind === 'visual' && !!inf.look.suggestive;
  const rules = checkPostText(text, { kind: inf.kind, research: inf.research, sources, suggestive });
  const issues = [...rules.issues];
  const warnings = [...rules.warnings];
  if (imageB64) {
    const caps = await getModelCapabilities(getActiveModel());
    if (!caps.includes('vision')) {
      warnings.push("The image wasn't reviewed: the default chat model can't see images.");
      imageB64 = undefined;
    }
  }
  try {
    const review = await llmJson<{ passed?: boolean; issues?: unknown }>(
      policySystem(suggestive),
      `Persona: ${personaBrief(inf.persona)}\n\nPost:\n${text}` +
        (imageB64
          ? suggestive
            ? '\n\nThe attached image goes with the post: also flag it if it shows anyone who could be a minor, ' +
              'exposed nipples or areolae, genitals or pubic hair, exposed buttocks, a sexual act, a real identifiable ' +
              'person or a logo. Implied nudity with those areas covered is allowed.'
            : '\n\nThe attached image goes with the post: also flag it if it shows a minor, nudity, a real identifiable person or a logo.'
          : ''),
      { temperature: 0, images: imageB64 ? [imageB64] : undefined },
    );
    if (review.passed === false) issues.push(...asStringArray(review.issues, 8).map((i) => `Policy review: ${i}`));
  } catch (e) {
    // If the reviewer can't run, the post can't be cleared for publishing.
    issues.push(`The policy review could not run (${(e as Error).message}).`);
  }
  return { passed: issues.length === 0, issues, warnings };
}

// ── persona suggestions (wizard) ───────────────────────────────────────────

export interface PersonaSuggestion {
  persona: Persona;
  appearance?: string;
  themes?: string[];
  topics?: string[];
}

export async function suggestPersona(inf: Influencer, brief: string): Promise<PersonaSuggestion> {
  const visual = inf.kind === 'visual';
  const out = await llmJson<Record<string, unknown>>(
    'You design invented, adult (21+) social media personas that are openly AI-generated. Never base one on a real ' +
      'person, never make one a minor or aimed at minors, and keep everything safe for work. Return JSON with: ' +
      'displayName, age (21-60), gender, niche, audience, tone, bio (max 150 chars, ending with "AI-generated persona"), ' +
      'backstory (2-3 sentences), ' +
      (visual
        ? 'appearance (one paragraph of concrete physical traits and signature style for an image model), themes (6 recurring photo themes).'
        : 'perspective (how the persona approaches topics, e.g. "neutral explainer"), topics (4-6 topics to cover).'),
    `Kind: ${visual ? 'photo/video influencer' : 'text commentary account'}.\nCurrent draft: ${JSON.stringify(inf.persona)}\n` +
      `What the user wants: ${brief || '(surprise me, but keep it grounded and specific)'}`,
    { temperature: 0.9 },
  );
  const age = Math.round(Number(out.age));
  return {
    persona: {
      ...inf.persona,
      displayName: asString(out.displayName, 60) || inf.persona.displayName,
      age: Number.isFinite(age) ? Math.max(21, Math.min(60, age)) : inf.persona.age,
      gender: asString(out.gender, 40) || inf.persona.gender,
      niche: asString(out.niche, 200) || inf.persona.niche,
      audience: asString(out.audience, 200) || inf.persona.audience,
      tone: asString(out.tone, 200) || inf.persona.tone,
      bio: asString(out.bio, 300) || inf.persona.bio,
      backstory: asString(out.backstory, 800) || inf.persona.backstory,
      perspective: asString(out.perspective, 300) || inf.persona.perspective,
    },
    appearance: visual ? asString(out.appearance, 1200) || undefined : undefined,
    themes: visual ? asStringArray(out.themes, 8, 120) : undefined,
    topics: visual ? undefined : asStringArray(out.topics, 8, 120),
  };
}

// ── text influencers: research + fact-check ────────────────────────────────

interface Candidate extends FeedItem {
  topic: string;
  domain: string;
}

async function discoverStories(inf: Influencer): Promise<Candidate[]> {
  const topics = inf.research.topics ?? [];
  const seen = store.recentTopicKeys(inf.id);
  const out: Candidate[] = [];
  const push = (topic: string, item: FeedItem) => {
    const domain = domainOf(item.url);
    if (!domain || seen.has(topicKey(item.title))) return;
    if (out.some((c) => c.url === item.url)) return;
    out.push({ ...item, topic, domain });
  };

  for (const feed of inf.research.feeds ?? []) {
    try {
      const items = await fetchFeed(feed);
      for (const item of items) {
        const hay = `${item.title} ${item.summary ?? ''}`.toLowerCase();
        const topic = topics.find((t) => t.toLowerCase().split(/\s+/).some((w) => w.length > 3 && hay.includes(w)));
        if (topic || topics.length === 0) push(topic ?? 'news', item);
      }
    } catch (e) {
      console.warn(`[influencers] feed ${feed} failed: ${(e as Error).message}`);
    }
  }
  for (const topic of topics) {
    try {
      for (const r of await webSearch(`${topic} news`, 8)) push(topic, { title: r.title, url: r.url, publishedAt: r.publishedAt, summary: r.snippet });
    } catch (e) {
      console.warn(`[influencers] search for "${topic}" failed: ${(e as Error).message}`);
    }
  }
  // Trusted sources first.
  return out.sort((a, b) => Number(isTrusted(b.domain, inf.research)) - Number(isTrusted(a.domain, inf.research))).slice(0, 25);
}

async function gatherSources(inf: Influencer, queries: string[], seedUrl?: string): Promise<Page[]> {
  const urls: string[] = seedUrl ? [seedUrl] : [];
  for (const q of queries.slice(0, 3)) {
    try {
      for (const r of await webSearch(q, 10)) {
        if (isTrusted(r.domain, inf.research) && !urls.includes(r.url)) urls.push(r.url);
      }
    } catch (e) {
      console.warn(`[influencers] search "${q}" failed: ${(e as Error).message}`);
    }
  }
  const pages: Page[] = [];
  for (const url of urls) {
    if (pages.length >= 6) break;
    try {
      const page = await fetchPage(url);
      if (!isTrusted(page.domain, inf.research) || page.text.length < 400) continue;
      // Prefer breadth: at most two pages per domain.
      if (pages.filter((p) => p.domain === page.domain).length >= 2) continue;
      pages.push(page);
    } catch {
      /* skip unreachable pages */
    }
  }
  return pages;
}

function excerpts(pages: Page[], perPage = 2500): string {
  return pages.map((p, i) => `[${i + 1}] ${p.title ?? p.url} (${p.domain}${p.publishedAt ? `, ${p.publishedAt}` : ''})\n${p.text.slice(0, perPage)}`).join('\n\n');
}

async function draftFromSources(inf: Influencer, story: string, pages: Page[], avoid: string[] = []): Promise<{ text: string; claims: string[] }> {
  const budget = textBudget(inf);
  const out = await llmJson<{ text?: string; claims?: unknown }>(
    `You write one social media post as this persona. ${personaBrief(inf.persona)}\n` +
      'Use ONLY facts stated in the numbered sources. Do not add numbers, quotes, dates or names that are not in them. ' +
      'Keep opinions clearly marked as opinion. Never @-mention anyone, never include links, never claim to be human. ' +
      `At most ${budget} characters. Return {"text": "...", "claims": [..]} where claims lists every factual ` +
      'statement in the post as a short standalone sentence (not opinions).' +
      (avoid.length ? ` Do not repeat these unverified claims: ${avoid.join(' | ')}` : ''),
    `Story: ${story}\n\nSources:\n${excerpts(pages)}`,
    { temperature: 0.5 },
  );
  return { text: asString(out.text, budget + 40), claims: asStringArray(out.claims, 8, 300) };
}

async function verifyClaims(inf: Influencer, claims: string[], pages: Page[]): Promise<FactCheck> {
  const items: ClaimEvidence[] = [];
  for (const claim of claims) {
    const out = await llmJson<{ verdicts?: Array<{ source?: number; verdict?: string; quote?: string }> }>(
      'You are a strict fact-checker. For the claim, judge each numbered source: "supports" only if the source ' +
        'explicitly states it (same numbers, names and meaning), "contradicts" if the source states otherwise, ' +
        'else "irrelevant". Return {"verdicts": [{"source": n, "verdict": "...", "quote": "exact supporting words"}]}.',
      `Claim: ${claim}\n\nSources:\n${excerpts(pages, 3500)}`,
      { temperature: 0 },
    );
    const evidence = (out.verdicts ?? [])
      .map((v) => {
        const page = pages[(Number(v.source) || 0) - 1];
        const verdict = (['supports', 'contradicts', 'irrelevant'] as SourceVerdict[]).includes(v.verdict as SourceVerdict)
          ? (v.verdict as SourceVerdict)
          : 'irrelevant';
        // A "supports" without a quote that actually appears in the page doesn't count.
        const quote = asString(v.quote, 400);
        const quoted = !!quote && page?.text.toLowerCase().includes(quote.toLowerCase().slice(0, 60));
        return page ? { domain: page.domain, verdict: verdict === 'supports' && !quoted ? 'irrelevant' : verdict, quote } : null;
      })
      .filter((e): e is NonNullable<typeof e> => !!e);
    items.push({ claim, evidence });
  }
  return aggregateFactCheck(items, inf.research);
}

function sourcesFor(fact: FactCheck, pages: Page[]): Source[] {
  const used = new Set(fact.claims.flatMap((c) => c.supportingDomains));
  const out: Source[] = [];
  for (const p of pages) {
    if (out.length >= 3) break;
    if (used.has(p.domain.replace(/^www\./, '')) || [...used].some((d) => p.domain.endsWith(d))) {
      if (!out.some((s) => s.domain === p.domain)) out.push({ url: p.url, title: p.title, domain: p.domain, publishedAt: p.publishedAt });
    }
  }
  return out;
}

export interface GenerateOptions {
  origin: 'auto' | 'manual';
  /** Write about this instead of discovering a story. */
  topicHint?: string;
}

export async function generateTextPost(inf: Influencer, opts: GenerateOptions): Promise<store.Post> {
  // 1. Pick a story.
  let story: string;
  let seedUrl: string | undefined;
  let topic: string;
  if (opts.topicHint) {
    story = opts.topicHint;
    topic = opts.topicHint;
  } else {
    const candidates = await discoverStories(inf);
    if (!candidates.length) throw new Error('No new stories found for the configured topics and feeds');
    const chatter = inf.research.useBlueskyTrends
      ? (await Promise.all((inf.research.topics ?? []).slice(0, 3).map((t) => blueskyConversation(t, 5)))).flat().slice(0, 12)
      : [];
    const pick = await llmJson<{ index?: number; angle?: string }>(
      `You pick the single most newsworthy, substantive story for this persona to comment on. ${personaBrief(inf.persona)} ` +
        'Prefer stories from established outlets and avoid gossip about private individuals. Return {"index": n, "angle": "..."}.',
      `Stories:\n${candidates.map((c, i) => `${i + 1}. ${c.title} (${c.domain}) — ${c.summary ?? ''}`).join('\n')}` +
        (chatter.length ? `\n\nWhat people are saying (for context only, do not respond to individuals):\n${chatter.map((t) => `- ${t}`).join('\n')}` : ''),
      { temperature: 0.3 },
    );
    const c = candidates[Math.max(0, Math.min(candidates.length - 1, (Number(pick.index) || 1) - 1))];
    story = `${c.title}. ${pick.angle ? `Angle: ${asString(pick.angle, 300)}` : ''}`;
    seedUrl = c.url;
    topic = c.title;
  }

  // 2. Research.
  const q = await llmJson<{ queries?: unknown }>(
    'Write 3 web search queries that would find authoritative reporting and primary sources to verify facts about ' +
      'this story (official bodies, wire services, fact-checkers). Return {"queries": [..]}.',
    story,
    { temperature: 0.2 },
  );
  const pages = await gatherSources(inf, asStringArray(q.queries, 3, 200), seedUrl);
  const minSources = inf.research.minSources ?? 2;
  if (new Set(pages.map((p) => p.domain)).size < minSources) {
    return store.createPost(inf.id, {
      status: 'blocked',
      origin: opts.origin,
      topic,
      topicKey: topicKey(topic),
      text: '',
      mediaIds: [],
      sources: pages.map((p) => ({ url: p.url, title: p.title, domain: p.domain })),
      factCheck: null,
      compliance: null,
      checkedText: null,
      scheduledFor: null,
      error: `Found ${pages.length} trusted source pages; at least ${minSources} independent sources are required.`,
    });
  }

  // 3. Draft, verify, and revise once.
  let draft = await draftFromSources(inf, story, pages);
  let fact = draft.claims.length ? await verifyClaims(inf, draft.claims, pages) : aggregateFactCheck([], inf.research);
  if (!fact.passed) {
    const unverified = fact.claims.filter((c) => c.verdict !== 'supported').map((c) => c.claim);
    draft = await draftFromSources(inf, story, pages, unverified);
    fact = draft.claims.length ? await verifyClaims(inf, draft.claims, pages) : aggregateFactCheck([], inf.research);
  }

  const text = stripDisclosureTag(draft.text);
  const sources = sourcesFor(fact, pages);
  const compliance = fact.passed ? await reviewPost(inf, text, sources) : null;
  const ok = fact.passed && !!compliance?.passed;
  return store.createPost(inf.id, {
    status: ok ? (inf.plan.autoPublish ? 'approved' : 'review') : 'blocked',
    origin: opts.origin,
    topic,
    topicKey: topicKey(topic),
    text,
    mediaIds: [],
    sources,
    factCheck: fact,
    compliance,
    checkedText: text,
    scheduledFor: null,
    error: ok ? null : fact.passed ? 'Failed the rules or policy review' : fact.reason ?? 'Failed the fact-check',
  });
}

/** Re-run the fact-check on an edited text post. */
export async function recheckTextPost(inf: Influencer, post: store.Post): Promise<store.Post> {
  const urls = post.sources.map((s) => s.url);
  const pages: Page[] = [];
  for (const url of urls) {
    try {
      pages.push(await fetchPage(url));
    } catch { /* skip */ }
  }
  const out = await llmJson<{ claims?: unknown }>(
    'List every factual statement in this post as short standalone sentences. Return {"claims": [..]}.',
    post.text,
    { temperature: 0 },
  );
  const claims = asStringArray(out.claims, 8, 300);
  const fact = claims.length ? await verifyClaims(inf, claims, pages) : aggregateFactCheck([], inf.research);
  const text = stripDisclosureTag(post.text);
  const compliance = fact.passed ? await reviewPost(inf, text, post.sources) : null;
  const ok = fact.passed && !!compliance?.passed;
  return store.updatePost(post.id, {
    text,
    factCheck: fact,
    compliance,
    checkedText: text,
    status: ok ? 'review' : 'blocked',
    error: ok ? null : fact.passed ? 'Failed the rules or policy review' : fact.reason ?? 'Failed the fact-check',
  });
}

// ── visual influencers ─────────────────────────────────────────────────────

export async function generateVisualPost(inf: Influencer, opts: GenerateOptions): Promise<store.Post> {
  const themes = inf.plan.themes?.length ? inf.plan.themes : [inf.persona.niche ?? 'everyday life'];
  const used = store.recentTopicKeys(inf.id, themes.length * 2);
  const theme = opts.topicHint || themes.find((t) => !used.has(topicKey(t))) || themes[Math.floor(Math.random() * themes.length)];

  const out = await llmJson<{ scene?: string; caption?: string; alt?: string }>(
    `You plan one social media photo post for this persona. ${personaBrief(inf.persona)}\n` +
      'Return {"scene": "concrete photo scene: setting, activity, outfit, framing, light", "caption": "...", "alt": "image description"}. ' +
      `The caption is in the persona's voice, at most ${textBudget(inf)} characters, with at most 3 hashtags, ` +
      'never claims to be human, never @-mentions anyone, no links. No other identifiable people. The scene ' +
      `${sceneRule(inf)}` +
      (inf.look.suggestive ? ' The caption may be flirtatious and teasing, never explicit.' : ''),
    `Theme: ${theme}`,
    { temperature: 0.8 },
  );
  const scene = asString(out.scene, 400);
  if (!scene) throw new Error('The model did not return a scene');
  const sceneCheck = checkImagePrompt('The scene', scene, !!inf.look.suggestive);
  const caption = stripDisclosureTag(asString(out.caption, textBudget(inf) + 40));
  if (!sceneCheck.passed) {
    return store.createPost(inf.id, {
      status: 'blocked',
      origin: opts.origin,
      topic: theme,
      topicKey: topicKey(theme),
      text: caption,
      mediaIds: [],
      sources: [],
      factCheck: null,
      compliance: sceneCheck,
      checkedText: caption,
      scheduledFor: null,
      error: 'The scene broke the content rules',
    });
  }

  const imageRow = queuePersonaImage(inf, scene, 'post', inf.look.seed);
  const imageId = await awaitMedia(imageRow);
  const mediaIds = [imageId];
  const wantsClip = Math.random() < (inf.plan.videoShare ?? 0);
  if (wantsClip) {
    try {
      const clip = queueClip(inf, imageId, `${scene}; gentle natural motion`, 'post');
      mediaIds.unshift(await awaitMedia(clip));
    } catch (e) {
      console.warn(`[influencers] clip for post skipped: ${(e as Error).message}`);
    }
  }

  let imageB64: string | undefined;
  try {
    const { getMedia, getMediaPath } = await import('../mediaStore');
    const fs = await import('fs');
    const m = getMedia(imageId);
    if (m) imageB64 = fs.readFileSync(getMediaPath(m.filename)).toString('base64');
  } catch { /* review without the image */ }
  const compliance = await reviewPost(inf, caption, [], imageB64);
  return store.createPost(inf.id, {
    status: compliance.passed ? (inf.plan.autoPublish ? 'approved' : 'review') : 'blocked',
    origin: opts.origin,
    topic: theme,
    topicKey: topicKey(theme),
    text: caption,
    mediaIds,
    sources: [],
    factCheck: null,
    compliance,
    checkedText: caption,
    scheduledFor: null,
    error: compliance.passed ? null : 'Failed the rules or policy review',
  });
}

export function generatePost(inf: Influencer, opts: GenerateOptions): Promise<store.Post> {
  return inf.kind === 'text' ? generateTextPost(inf, opts) : generateVisualPost(inf, opts);
}
