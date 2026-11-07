// Background automation for active influencers.
//
// Every minute: publish approved posts that are due, then, if an active
// influencer is due a new post and has nothing waiting for review, generate
// one. Generation runs one at a time; its image/video work goes through the
// normal job queue. Publishing re-checks the rules and rate caps first.

import { decryptObject, encryptObject } from '../secrets';
import { getMedia } from '../mediaStore';
import { checkPostText, checkRate, contentLevel } from './compliance';
import { generatePost } from './pipeline';
import { acceptsPost, getPlatform, publish } from './platforms';
import { isPostDue, nextWindowStart } from './schedule';
import * as store from './store';
import type { Influencer } from './types';

const TICK_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let busy = false;

export function startInfluencerAutomation(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  console.log('[influencers] Automation started.');
}

export function stopInfluencerAutomation(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await publishDue();
    await generateDue();
  } catch (e) {
    console.error('[influencers] automation tick failed:', e);
  } finally {
    busy = false;
  }
}

/** Why a post can't be published right now, or null if it can. */
export function publishBlocker(inf: Influencer, post: store.Post): string | null {
  if (inf.kind === 'visual' && contentLevel(inf.look) === 'explicit') {
    return 'Explicit projects never publish to social platforms. Download the image to use it yourself.';
  }
  if (inf.kind === 'text') {
    if (!post.factCheck?.passed) return 'The post has not passed the fact-check';
    if (post.checkedText !== post.text) return 'The post was edited after its fact-check; re-check it first';
  }
  const rules = checkPostText(post.text, {
    kind: inf.kind,
    research: inf.research,
    sources: post.sources,
    level: inf.kind === 'visual' ? contentLevel(inf.look) : 'sfw',
  });
  if (!rules.passed) return rules.issues.join(' ');
  if (post.compliance && !post.compliance.passed) return 'The post failed the policy review';
  return null;
}

/** Publish one post to every planned platform with an API connection. */
export async function publishPost(postId: number): Promise<store.Post> {
  const post = store.getPost(postId);
  if (!post) throw new Error('Post not found');
  const inf = store.getInfluencer(post.influencerId);
  if (!inf) throw new Error('Influencer not found');
  const blocker = publishBlocker(inf, post);
  if (blocker) return store.updatePost(post.id, { status: 'review', error: blocker });
  const rate = checkRate(store.recentPublishTimes(inf.id), new Date());
  if (!rate.allowed) {
    return store.updatePost(post.id, { scheduledFor: new Date(Date.now() + 60 * 60_000).toISOString(), error: rate.reason ?? null });
  }

  store.updatePost(post.id, { status: 'publishing', error: null });
  const results = { ...post.results };
  const mediaTypes = post.mediaIds.map((id) => getMedia(id)?.type).filter((t): t is NonNullable<typeof t> => !!t);
  let anyApi = false;
  for (const platform of inf.plan.platforms ?? []) {
    const def = getPlatform(platform);
    const acct = store.getAccount(inf.id, platform);
    if (!def || def.mode !== 'api' || !acct || acct.status !== 'connected' || !acct.credentials) continue;
    if (results[platform]?.ok) continue;
    // e.g. YouTube only takes video; text-only platforms take anything.
    if (!acceptsPost(def, mediaTypes)) continue;
    anyApi = true;
    try {
      const out = await publish(
        platform,
        decryptObject(acct.credentials),
        {
          text: post.text,
          // Publishers skip media types their platform doesn't take (Bluesky: images only).
          mediaIds: post.mediaIds,
          sources: post.sources,
          alt: post.topic ?? undefined,
          sensitive: inf.kind === 'visual' && contentLevel(inf.look) !== 'sfw',
        },
        // Renewed tokens (Meta) are stored straight away.
        { saveCredentials: (c) => store.upsertAccount(inf.id, platform, { credentials: encryptObject(c) }) },
      );
      results[platform] = { ok: true, url: out.url, at: new Date().toISOString() };
    } catch (e) {
      results[platform] = { ok: false, error: (e as Error).message, at: new Date().toISOString() };
      store.upsertAccount(inf.id, platform, { lastError: (e as Error).message });
    }
  }
  const failures = Object.entries(results).filter(([, r]) => !r.ok);
  const successes = Object.values(results).filter((r) => r.ok);
  // Manual-only plans: the post stays approved until the user marks it posted.
  if (!anyApi && successes.length === 0) return store.updatePost(post.id, { status: 'approved', results });
  return store.updatePost(post.id, {
    status: failures.length && !successes.length ? 'failed' : 'published',
    results,
    error: failures.length ? failures.map(([p, r]) => `${p}: ${r.error}`).join('; ') : null,
  });
}

async function publishDue(): Promise<void> {
  for (const post of store.duePosts(new Date().toISOString())) {
    const inf = store.getInfluencer(post.influencerId);
    if (!inf || inf.status !== 'active') continue;
    // Only API platforms are published automatically.
    const hasApi = (inf.plan.platforms ?? []).some((p) => getPlatform(p)?.mode === 'api' && store.getAccount(inf.id, p)?.status === 'connected');
    if (!hasApi) continue;
    try {
      await publishPost(post.id);
    } catch (e) {
      store.updatePost(post.id, { status: 'failed', error: (e as Error).message });
    }
  }
}

async function generateDue(): Promise<void> {
  const now = new Date();
  for (const inf of store.listActiveInfluencers()) {
    if (store.hasOpenPost(inf.id)) continue;
    if (!isPostDue(inf.plan, inf.lastPostAt, now)) continue;
    store.updateInfluencer(inf.id, { lastPostAt: now.toISOString() });
    try {
      const post = await generatePost(inf, { origin: 'auto' });
      if (post.status === 'approved') store.updatePost(post.id, { scheduledFor: nextWindowStart(inf.plan, new Date())?.toISOString() ?? null });
      console.log(`[influencers] ${inf.name}: generated post ${post.id} (${post.status})`);
    } catch (e) {
      console.warn(`[influencers] ${inf.name}: post generation failed: ${(e as Error).message}`);
      store.createPost(inf.id, {
        status: 'failed',
        origin: 'auto',
        topic: null,
        topicKey: null,
        text: '',
        mediaIds: [],
        sources: [],
        factCheck: null,
        compliance: null,
        checkedText: null,
        scheduledFor: null,
        error: (e as Error).message,
      });
    }
    return; // one generation per tick
  }
}
