// Code-of-conduct rules for influencer projects. Everything here is pure and
// deterministic (unit-tested); the LLM review in pipeline.ts runs on top of
// these, never instead of them. A post that fails any blocking check is never
// published, whatever the automation settings say.

import type { Attestation, ComplianceResult, Influencer, Persona, Plan, Research, Source } from './types';

/** Personas are stated adults with a margin, so generated imagery is unambiguous. */
export const MIN_PERSONA_AGE = 21;
export const MAX_PERSONA_AGE = 90;
/** Hard caps that no plan can exceed (spam / platform-manipulation rules). */
export const MAX_POSTS_PER_DAY = 6;
export const MIN_MINUTES_BETWEEN_POSTS = 60;
/** Approved portfolio images needed before a visual influencer can go live. */
export const MIN_PORTFOLIO = 6;
export const DEFAULT_DISCLOSURE = 'AI-generated persona';

export const IMAGE_NEGATIVE =
  'child, children, teen, teenager, minor, young-looking, school uniform, nudity, nsfw, explicit, ' +
  'lingerie, cleavage focus, watermark, text, logo, signature, celebrity, famous person';

// Ages under 18 written out ("16 years old", "16-year-old", "16yo").
const UNDERAGE_AGE = String.raw`\b(?:1[0-7]|[1-9])\s*-?\s*(?:years?|yrs?)\s*-?\s*old\b|\b(?:1[0-7]|[1-9])\s*(?:yo|y/o|y\.o\.)\b`;
// Terms that sexualise minors: blocked everywhere.
const SEXUALISED_MINOR = String.raw`\b(?:loli|lolita|shota|jailbait|barely\s+legal|school\s?girl|school\s?boy)s?\b`;

// Anything that becomes an image (appearance, scene, display name): any hint of a minor blocks it.
const MINOR_IMAGE_RE = new RegExp(
  [
    String.raw`\b(?:teen|teens|teenage[rd]?|adolescent|minor|minors|underage|under-age|child|children|childlike|kid|kids|preteen|pre-teen|tween|tweens|baby-?faced|petite\s+(?:girl|boy))\b`,
    String.raw`\b(?:young|little|small)\s+(?:girl|boy)s?\b`,
    String.raw`\bschool\s+uniforms?\b`,
    String.raw`\b(?:high|middle|elementary|primary|junior\s+high)\s+school(?:er)?\b`,
    SEXUALISED_MINOR,
    UNDERAGE_AGE,
  ].join('|'),
  'i',
);

// Bio / backstory: the persona must not be described as a minor ("a 17-year-old",
// "she's a high schooler"), but ordinary words like "kids" or "child care" are fine.
const MINOR_PERSONA_RE = new RegExp(
  [
    String.raw`\b(?:i'?m|i\s+am|she'?s|he'?s|they'?re|she\s+is|he\s+is|they\s+are|a|an)\s+(?:a\s+)?(?:teen|teenager|minor|tween|preteen|high\s+schooler|high\s+school\s+student|middle\s+schooler)\b`,
    SEXUALISED_MINOR,
    UNDERAGE_AGE,
  ].join('|'),
  'i',
);

// Who the persona is aimed at: never minors.
const MINOR_AUDIENCE_RE = /\b(?:teen|teens|teenagers?|kids|children|minors|tweens|preteens|students\s+under\s+18|under\s*-?\s*18s?)\b/i;

// Real-person likeness / deepfake terms.
const LIKENESS_RE =
  /\b(?:looks?\s+(?:just\s+|exactly\s+)?like|look-?alike|resembl\w*|doppelg[aä]nger|deep\s?fake|face\s?swap|the\s+face\s+of|her\s+real\s+name|based\s+on\s+my\s+(?:ex|girlfriend|boyfriend|coworker|friend|neighbou?r))\b/i;

// Sexual content is kept out entirely: mainstream platforms restrict it.
const EXPLICIT_RE = /\b(?:nude|nudes|naked|nsfw|explicit|topless|bottomless|porn\w*|sex\s?tape|xxx|fetish)\b/i;

const MENTION_RE = /(^|[^\w])@[A-Za-z0-9_.-]{2,}/;
const URL_RE = /\bhttps?:\/\/[^\s)\]}>"']+/gi;
// Election logistics (dates, places, eligibility) must come from official sources.
const ELECTION_LOGISTICS_RE =
  /\b(?:polling\s+(?:place|station|location)s?|register(?:ed|ing)?\s+to\s+vote|voter\s+registration|ballot\s+(?:drop|deadline|return)|mail-?in\s+ballot|early\s+voting|vote\s+by\s+mail|election\s+day|voting\s+(?:hours|deadline|rules|eligibility))\b/i;

/** First term in `text` that suggests a minor, for text that becomes an image. */
export function findMinorTerms(text: string): string | null {
  const m = MINOR_IMAGE_RE.exec(text);
  return m ? m[0] : null;
}

type MinorMode = 'image' | 'persona' | 'audience' | 'post';

function clean(result: { issues: string[]; warnings: string[] }): ComplianceResult {
  return { passed: result.issues.length === 0, issues: result.issues, warnings: result.warnings };
}

function textChecks(label: string, text: string | undefined, issues: string[], opts: { explicit: boolean; minor: MinorMode }): void {
  if (!text) return;
  const re =
    opts.minor === 'image'
      ? MINOR_IMAGE_RE
      : opts.minor === 'persona'
        ? MINOR_PERSONA_RE
        : opts.minor === 'audience'
          ? MINOR_AUDIENCE_RE
          : new RegExp(SEXUALISED_MINOR, 'i');
  const minor = re.exec(text);
  if (minor) {
    issues.push(
      opts.minor === 'audience'
        ? `${label} targets minors ("${minor[0]}"). Personas may only be aimed at adults.`
        : `${label} mentions "${minor[0]}". Personas and their imagery must be clearly adult.`,
    );
  }
  const likeness = LIKENESS_RE.exec(text);
  if (likeness) issues.push(`${label} refers to a real person's likeness ("${likeness[0]}"). Personas must be invented.`);
  if (opts.explicit) {
    const explicit = EXPLICIT_RE.exec(text);
    if (explicit) issues.push(`${label} includes sexual content ("${explicit[0]}"), which mainstream platforms prohibit.`);
  }
}

export function attestationComplete(a: Attestation): boolean {
  return !!(a.invented && a.adult && a.disclose && a.platformRules && a.noDeception);
}

/** Persona-level rules, checked on every save and again before launch. */
export function checkPersona(kind: Influencer['kind'], persona: Persona, attestation: Attestation): ComplianceResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  if (!attestationComplete(attestation)) issues.push('Accept every ground rule on the first step.');

  if (persona.age == null) {
    issues.push(`Set the persona's age (${MIN_PERSONA_AGE} or older).`);
  } else if (!Number.isInteger(persona.age) || persona.age < MIN_PERSONA_AGE || persona.age > MAX_PERSONA_AGE) {
    issues.push(`The persona's age must be a whole number from ${MIN_PERSONA_AGE} to ${MAX_PERSONA_AGE}.`);
  }
  if (!persona.displayName?.trim()) issues.push('Give the persona a display name.');
  if (!persona.niche?.trim()) issues.push('Describe what the persona posts about (niche).');

  const disclosure = persona.disclosure?.trim() ?? '';
  if (!/\bAI\b/i.test(disclosure)) {
    issues.push('The bio disclosure must say the persona is AI (for example "AI-generated persona").');
  }

  textChecks('Display name', persona.displayName, issues, { explicit: true, minor: 'image' });
  textChecks('Bio', persona.bio, issues, { explicit: true, minor: 'persona' });
  textChecks('Backstory', persona.backstory, issues, { explicit: true, minor: 'persona' });
  textChecks('Niche', persona.niche, issues, { explicit: true, minor: 'persona' });
  textChecks('Audience', persona.audience, issues, { explicit: true, minor: 'audience' });
  if (kind === 'text' && !persona.perspective?.trim()) {
    warnings.push('No perspective set; posts will default to a neutral, explanatory voice.');
  }
  return clean({ issues, warnings });
}

/** Appearance text and scene prompts that go to the image model. */
export function checkImagePrompt(label: string, text: string): ComplianceResult {
  const issues: string[] = [];
  textChecks(label, text, issues, { explicit: true, minor: 'image' });
  return clean({ issues, warnings: [] });
}

/**
 * Prompt for one image of the persona. The locked appearance and stated adult
 * age go into every prompt so the model can't drift younger or into a
 * different person.
 */
export function buildImagePrompt(persona: Persona, appearance: string, scene: string, style?: string): string {
  const gender = persona.gender?.trim();
  const who = gender ? `a grown ${gender}` : 'a grown adult';
  const parts = [
    style?.trim() || 'Natural, candid social media photo, realistic lighting',
    `${appearance.trim()}, ${who} aged ${persona.age ?? MIN_PERSONA_AGE}`,
    scene.trim(),
    'tasteful, fully clothed, safe for work',
  ];
  return parts.filter(Boolean).join('. ').replace(/\s+/g, ' ');
}

/**
 * Remove the #AIgenerated hashtag that older posts carried. Platforms now
 * detect and label AI media themselves, and the bio carries the disclosure.
 */
export function stripDisclosureTag(text: string): string {
  return text
    .replace(/[ \t]*#AI-?generated\b/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(URL_RE), (m) => m[0].replace(/[.,;:!?]+$/, ''));
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Deterministic post checks. `sources` are the URLs the fact-check verified. */
export function checkPostText(
  text: string,
  opts: { kind: Influencer['kind']; research?: Research; sources?: Source[] },
): ComplianceResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const political = !!opts.research?.political;

  if (!text.trim()) issues.push('The post is empty.');
  textChecks('The post', text, issues, { explicit: true, minor: 'post' });

  if (MENTION_RE.test(text)) {
    const msg = 'The post @-mentions an account. Automated posts respond to topics, not to individual people.';
    if (political) issues.push(msg);
    else warnings.push(msg);
  }

  const allowed = new Set((opts.sources ?? []).map((s) => s.url));
  for (const url of extractUrls(text)) {
    if (!allowed.has(url)) issues.push(`The post links to ${url}, which wasn't one of the verified sources.`);
  }

  if (opts.kind === 'text' && political && ELECTION_LOGISTICS_RE.test(text)) {
    const official = (opts.sources ?? []).some((s) => s.domain.endsWith('.gov') || s.domain.endsWith('.gov.uk'));
    if (!official) {
      issues.push('Election logistics (dates, places, eligibility) must be backed by an official government source.');
    }
  }
  return clean({ issues, warnings });
}

/** Posting caps. `recent` is publish times (ISO) of the last 24 hours or more. */
export function checkRate(recent: string[], now: Date): { allowed: boolean; reason?: string } {
  const times = recent.map((t) => new Date(t).getTime()).filter((t) => Number.isFinite(t) && t <= now.getTime());
  const dayAgo = now.getTime() - 24 * 3600_000;
  const last24 = times.filter((t) => t > dayAgo).length;
  if (last24 >= MAX_POSTS_PER_DAY) return { allowed: false, reason: `Daily cap of ${MAX_POSTS_PER_DAY} posts reached.` };
  const latest = times.length ? Math.max(...times) : null;
  if (latest != null && now.getTime() - latest < MIN_MINUTES_BETWEEN_POSTS * 60_000) {
    return { allowed: false, reason: `Posts must be at least ${MIN_MINUTES_BETWEEN_POSTS} minutes apart.` };
  }
  return { allowed: true };
}

export function validTimezone(tz: string | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function checkPlan(plan: Plan): ComplianceResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const perWeek = plan.postsPerWeek ?? 0;
  if (!Number.isFinite(perWeek) || perWeek < 1) issues.push('Set how many posts per week (at least 1).');
  if (perWeek > MAX_POSTS_PER_DAY * 7) issues.push(`At most ${MAX_POSTS_PER_DAY * 7} posts per week.`);
  const days = plan.days ?? [];
  if (days.length === 0) issues.push('Pick at least one posting day.');
  const s = plan.windowStart ?? -1;
  const e = plan.windowEnd ?? -1;
  if (!(Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e <= 24 && s < e)) {
    issues.push('Set a posting window (start hour before end hour).');
  } else if (days.length > 0 && perWeek > days.length * (e - s)) {
    issues.push('More posts per week than posting hours: widen the window or add days.');
  }
  if (!validTimezone(plan.timezone)) issues.push('Pick a valid time zone.');
  if (!(plan.platforms ?? []).length) issues.push('Choose at least one platform to post to.');
  if (plan.autoPublish) {
    warnings.push('Auto-publish is on: posts that pass every check go out without review. Failed checks still block.');
  }
  return clean({ issues, warnings });
}

export interface ReadinessInput {
  influencer: Influencer;
  approvedLook: boolean;
  approvedPortfolio: number;
  /** Accounts for the plan's platforms, with whether each one's checklist is done. */
  accounts: Array<{ platform: string; ready: boolean }>;
  researchConfigured: boolean;
}

/** Everything that must be true before an influencer can go live. */
export function checkLaunchReadiness(input: ReadinessInput): ComplianceResult {
  const { influencer: inf } = input;
  const persona = checkPersona(inf.kind, inf.persona, inf.attestation);
  const plan = checkPlan(inf.plan);
  const issues = [...persona.issues, ...plan.issues];
  const warnings = [...persona.warnings, ...plan.warnings];

  if (inf.kind === 'visual') {
    if (!input.approvedLook || !inf.look.appearance?.trim()) issues.push('Approve a look for the persona.');
    if (input.approvedPortfolio < MIN_PORTFOLIO) {
      issues.push(`Approve at least ${MIN_PORTFOLIO} portfolio images (${input.approvedPortfolio} so far).`);
    }
    if (inf.look.appearance) issues.push(...checkImagePrompt('The look', inf.look.appearance).issues);
  } else {
    if (!(inf.research.topics ?? []).length) issues.push('Add at least one topic to cover.');
    if (!input.researchConfigured) issues.push('Configure a web search provider so posts can be fact-checked.');
  }

  for (const platform of inf.plan.platforms ?? []) {
    const acct = input.accounts.find((a) => a.platform === platform);
    if (!acct) issues.push(`Connect ${platform} or set it to manual posting.`);
    else if (!acct.ready) issues.push(`Finish the ${platform} setup checklist.`);
  }
  return clean({ issues, warnings });
}
