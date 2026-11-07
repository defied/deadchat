// /api/influencers — Social Media tab: influencer projects, the creation
// wizard, platform connections and the post review queue.

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import { getJob } from '../services/jobQueue';
import { encryptObject, decryptObject } from '../services/secrets';
import {
  MAX_POSTS_PER_DAY,
  MIN_MINUTES_BETWEEN_POSTS,
  MIN_PERSONA_AGE,
  MIN_PORTFOLIO,
  checkImagePrompt,
  checkLaunchReadiness,
  checkPersona,
  checkPlan,
} from '../services/influencers/compliance';
import { DEFAULT_TRUSTED_DOMAINS } from '../services/influencers/factcheck';
import {
  generateLookCandidates,
  generatePortfolio,
  localModels,
  queueClip,
  refineAppearance,
  syncPending,
} from '../services/influencers/media';
import { generatePost, recheckTextPost, reviewPost, suggestPersona } from '../services/influencers/pipeline';
import { PLATFORMS, checklistDone, getPlatform, testConnection, youtubeAuthUrl, youtubeRedirectUri } from '../services/influencers/platforms';
import { publicUrlConfigured, signState } from '../services/influencers/publicMedia';
import { getResearchSettings, researchConfigured, setResearchSettings } from '../services/influencers/research';
import { nextWindowStart } from '../services/influencers/schedule';
import { publishBlocker, publishPost } from '../services/influencers/automation';
import * as store from '../services/influencers/store';
import { STEPS, type Influencer, type InfluencerKind } from '../services/influencers/types';

const router = Router();
router.use(authenticate);

/** Feeds offered as starting points for news-driven text influencers (editable). */
const SUGGESTED_FEEDS = [
  { label: 'NPR Politics', url: 'https://feeds.npr.org/1014/rss.xml' },
  { label: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },
  { label: 'PBS NewsHour Politics', url: 'https://www.pbs.org/newshour/feeds/rss/politics' },
  { label: 'BBC US & Canada', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml' },
  { label: 'BBC Politics (UK)', url: 'https://feeds.bbci.co.uk/news/politics/rss.xml' },
];

// Background work (generation, re-checks) per influencer, so the UI can show it.
const working = new Map<number, string>();

function runInBackground(id: number, label: string, fn: () => Promise<unknown>): void {
  working.set(id, label);
  fn()
    .catch((e) => console.warn(`[influencers] ${label} failed for ${id}: ${(e as Error).message}`))
    .finally(() => working.delete(id));
}

async function wrap(res: Response, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    const out = await fn();
    if (!res.headersSent) res.json(out);
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ error: (e as Error).message });
  }
}

/** Load the influencer named in :id if the caller owns it. */
function owned(req: Request, res: Response, next: NextFunction): void {
  const inf = store.getInfluencer(Number(req.params.id));
  if (!inf || (inf.userId !== req.user!.id && req.user!.role !== 'admin')) {
    res.status(404).json({ error: 'Influencer not found' });
    return;
  }
  res.locals.inf = inf;
  next();
}
const inf = (res: Response): Influencer => res.locals.inf as Influencer;

function accountView(row: store.AccountRow) {
  const def = getPlatform(row.platform);
  const creds = row.credentials ? decryptObject(row.credentials) : {};
  const checklist = store.parseChecklist(row);
  return {
    platform: row.platform,
    handle: row.handle,
    status: row.status,
    lastError: row.last_error,
    checklist,
    checklistDone: def ? checklistDone(def, checklist) : false,
    // Secret values never leave the server; non-secret fields are shown back.
    fields: Object.fromEntries(
      (def?.fields ?? []).map((f) => [f.key, f.secret ? (creds[f.key] ? '••••••••' : '') : String(creds[f.key] ?? '')]),
    ),
    updatedAt: row.updated_at,
  };
}

function readiness(i: Influencer) {
  const accounts = store.listAccounts(i.id).map((a) => {
    const def = getPlatform(a.platform);
    const done = def ? checklistDone(def, store.parseChecklist(a)) : false;
    const connected = def?.mode === 'manual' ? a.status === 'manual' || a.status === 'connected' : a.status === 'connected';
    return { platform: a.platform, ready: done && connected };
  });
  return checkLaunchReadiness({
    influencer: i,
    approvedLook: i.kind === 'visual' && !!i.look.approvedMediaId,
    approvedPortfolio: store.countMedia(i.id, 'portfolio', 'approved'),
    accounts,
    researchConfigured: researchConfigured(),
  });
}

function detail(i: Influencer) {
  syncPending(i.id);
  const fresh = store.getInfluencer(i.id)!;
  return {
    influencer: fresh,
    steps: STEPS[fresh.kind],
    media: store.listMediaRows(fresh.id).filter((m) => m.role !== 'post'),
    accounts: store.listAccounts(fresh.id).map(accountView),
    posts: store.listPosts(fresh.id, 50),
    checks: {
      persona: checkPersona(fresh.kind, fresh.persona, fresh.attestation),
      plan: checkPlan(fresh.plan),
      launch: readiness(fresh),
    },
    working: working.get(fresh.id) ?? null,
    nextWindow: nextWindowStart(fresh.plan, new Date())?.toISOString() ?? null,
  };
}

// ── meta & settings ────────────────────────────────────────────────────────

router.get('/meta', (_req, res) => {
  res.json({
    steps: STEPS,
    platforms: PLATFORMS,
    publishing: {
      publicUrlConfigured: publicUrlConfigured(),
      youtubeRedirectUri: publicUrlConfigured() ? youtubeRedirectUri() : null,
    },
    models: {
      image: localModels('image').map((m) => ({ id: m.id, label: m.label, summary: m.summary, speed: m.speed })),
      video: localModels('video').filter((m) => m.needsImage).map((m) => ({ id: m.id, label: m.label, summary: m.summary, speed: m.speed })),
    },
    rules: { minAge: MIN_PERSONA_AGE, maxPostsPerDay: MAX_POSTS_PER_DAY, minMinutesBetween: MIN_MINUTES_BETWEEN_POSTS, minPortfolio: MIN_PORTFOLIO },
    research: { ...getResearchSettings(), configured: researchConfigured() },
    defaultTrustedDomains: DEFAULT_TRUSTED_DOMAINS,
    suggestedFeeds: SUGGESTED_FEEDS,
  });
});

router.put('/research-settings', adminOnly, (req, res) =>
  wrap(res, () => {
    const b = req.body ?? {};
    return setResearchSettings({
      searxngUrl: b.searxngUrl === undefined ? undefined : (b.searxngUrl as string | null),
      braveKey: b.braveKey === undefined ? undefined : (b.braveKey as string | null),
    });
  }),
);

// ── projects ───────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const list = store.listInfluencers(req.user!.id).map((i) => ({
    ...i,
    approvedPortfolio: store.countMedia(i.id, 'portfolio', 'approved'),
    pendingReview: store.listPosts(i.id, 50).filter((p) => p.status === 'review').length,
    published: store.listPosts(i.id, 100).filter((p) => p.status === 'published').length,
  }));
  res.json({ influencers: list });
});

router.post('/', (req, res) =>
  wrap(res, () => {
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    const kind = req.body?.kind as InfluencerKind;
    if (!name) throw new Error('Give the project a name');
    if (kind !== 'visual' && kind !== 'text') throw new Error('Pick a kind of influencer');
    return detail(store.createInfluencer(req.user!.id, name, kind));
  }),
);

router.get('/:id', owned, (_req, res) => res.json(detail(inf(res))));

router.patch('/:id', owned, (req, res) =>
  wrap(res, () => {
    const cur = inf(res);
    const b = req.body ?? {};
    if (cur.status === 'active' && (b.persona || b.look)) {
      throw new Error('Pause the influencer before changing its persona or look');
    }
    const patch: store.InfluencerPatch = {};
    if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
    if (typeof b.step === 'string' && STEPS[cur.kind].includes(b.step)) patch.step = b.step;
    if (b.persona) patch.persona = { ...cur.persona, ...b.persona };
    if (b.look) {
      const look = { ...cur.look, ...b.look };
      if ('suggestive' in b.look) look.suggestive = b.look.suggestive === true;
      if (b.look.appearance && b.look.appearance !== cur.look.appearance) {
        const check = checkImagePrompt('The look', b.look.appearance);
        if (!check.passed) throw new Error(check.issues.join(' '));
        // A new appearance needs a new approved look.
        look.approvedMediaId = undefined;
        look.seed = undefined;
      }
      patch.look = look;
    }
    if (b.research) patch.research = { ...cur.research, ...b.research };
    if (b.plan) patch.plan = { ...cur.plan, ...b.plan };
    if (b.attestation) {
      patch.attestation = { ...cur.attestation, ...b.attestation, acceptedAt: new Date().toISOString() };
    }
    return detail(store.updateInfluencer(cur.id, patch));
  }),
);

router.delete('/:id', owned, (_req, res) => {
  store.deleteInfluencer(inf(res).id);
  res.json({ ok: true });
});

// ── wizard: persona & look ─────────────────────────────────────────────────

router.post('/:id/suggest', owned, (req, res) => wrap(res, () => suggestPersona(inf(res), String(req.body?.brief ?? '').slice(0, 1000))));

router.post('/:id/look/refine', owned, (req, res) =>
  wrap(res, async () => {
    const feedback = String(req.body?.feedback ?? '').trim();
    if (!feedback) throw new Error('Say what to change');
    return { appearance: await refineAppearance(inf(res), feedback.slice(0, 1000)) };
  }),
);

function requirePersona(i: Influencer): void {
  const check = checkPersona(i.kind, i.persona, i.attestation);
  if (!check.passed) throw new Error(`Finish the persona first: ${check.issues.join(' ')}`);
}

router.post('/:id/look/generate', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    requirePersona(i);
    generateLookCandidates(i, Number(req.body?.count) || 4);
    return detail(i);
  }),
);

router.post('/:id/portfolio/generate', owned, (req, res) =>
  wrap(res, async () => {
    const i = inf(res);
    requirePersona(i);
    if (!i.look.approvedMediaId) throw new Error('Approve a look first');
    await generatePortfolio(i, Number(req.body?.count) || 6);
    return detail(i);
  }),
);

function ownedMedia(i: Influencer, mid: number) {
  const row = store.getMediaRow(mid);
  if (!row || row.influencer_id !== i.id) throw new Error('Image not found');
  return row;
}

router.post('/:id/media/:mid/approve', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    const row = ownedMedia(i, Number(req.params.mid));
    if (row.status !== 'ready' && row.status !== 'approved' && row.status !== 'rejected') throw new Error('It is not finished yet');
    if (!row.media_id) throw new Error('No image to approve');
    if (row.role === 'look') {
      // One approved look; previously approved ones go back to "ready".
      for (const other of store.listMediaRows(i.id, 'look')) {
        if (other.id !== row.id && other.status === 'approved') store.updateMediaRow(other.id, { status: 'ready' });
      }
      let seed: number | undefined;
      try {
        seed = Number((JSON.parse(getJob(row.job_id ?? -1)?.params ?? '{}') as { seed?: number }).seed) || undefined;
      } catch { /* no seed */ }
      store.updateInfluencer(i.id, { look: { ...i.look, approvedMediaId: row.media_id, seed } });
    }
    store.updateMediaRow(row.id, { status: 'approved' });
    return detail(store.getInfluencer(i.id)!);
  }),
);

router.post('/:id/media/:mid/reject', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    const row = ownedMedia(i, Number(req.params.mid));
    store.updateMediaRow(row.id, { status: 'rejected' });
    if (row.role === 'look' && i.look.approvedMediaId === row.media_id) {
      store.updateInfluencer(i.id, { look: { ...i.look, approvedMediaId: undefined, seed: undefined } });
    }
    return detail(store.getInfluencer(i.id)!);
  }),
);

router.post('/:id/media/:mid/animate', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    const row = ownedMedia(i, Number(req.params.mid));
    if (!row.media_id) throw new Error('No image to animate');
    queueClip(i, row.media_id, String(req.body?.motion ?? 'subtle natural movement, gentle smile, slight head turn').slice(0, 400));
    return detail(i);
  }),
);

// ── accounts ───────────────────────────────────────────────────────────────

router.put('/:id/accounts/:platform', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    const def = getPlatform(String(req.params.platform));
    if (!def) throw new Error('Unknown platform');
    const existing = store.getAccount(i.id, def.id);
    const prev = existing?.credentials ? decryptObject(existing.credentials) : {};
    const incoming = (req.body?.fields ?? {}) as Record<string, unknown>;
    const creds: Record<string, unknown> = { ...prev };
    for (const f of def.fields) {
      const v = incoming[f.key];
      if (typeof v !== 'string') continue;
      // Masked or blank secret = keep the stored one.
      if (f.secret && (v === '' || v === '••••••••')) continue;
      creds[f.key] = v.trim();
    }
    // A new token or OAuth client invalidates what was derived from the old one.
    if (creds.accessToken !== prev.accessToken) {
      for (const k of ['tokenRefreshedAt', 'tokenExpiresAt', 'userId', 'username']) delete creds[k];
    }
    if (creds.clientId !== prev.clientId || creds.clientSecret !== prev.clientSecret) delete creds.refreshToken;
    const checklist = { ...store.parseChecklist(existing), ...((req.body?.checklist ?? {}) as Record<string, boolean>) };
    const credsChanged = JSON.stringify(creds) !== JSON.stringify(prev);
    store.upsertAccount(i.id, def.id, {
      handle: String(creds.identifier ?? creds.handle ?? existing?.handle ?? '') || null,
      credentials: Object.keys(creds).length ? encryptObject(creds) : null,
      checklist,
      status: def.mode === 'manual' ? 'manual' : credsChanged || !existing ? 'pending' : existing.status,
      lastError: credsChanged ? null : undefined,
    });
    return detail(i);
  }),
);

router.post('/:id/accounts/:platform/test', owned, (req, res) =>
  wrap(res, async () => {
    const i = inf(res);
    const row = store.getAccount(i.id, String(req.params.platform));
    if (!row?.credentials) throw new Error('Save the credentials first');
    try {
      const handle = await testConnection(row.platform, decryptObject(row.credentials), {
        saveCredentials: (c) => store.upsertAccount(i.id, row.platform, { credentials: encryptObject(c) }),
      });
      store.upsertAccount(i.id, row.platform, { status: 'connected', handle, lastError: null });
    } catch (e) {
      store.upsertAccount(i.id, row.platform, { status: 'error', lastError: (e as Error).message });
    }
    return detail(i);
  }),
);

// YouTube: send the user to Google to authorise uploads; Google redirects back
// to /api/oauth/youtube/callback (routes/socialOAuth.ts).
router.post('/:id/accounts/youtube/connect', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    const row = store.getAccount(i.id, 'youtube');
    if (!row?.credentials) throw new Error('Save the Google OAuth client ID and secret first');
    const state = signState({ influencerId: i.id, userId: req.user!.id, platform: 'youtube' });
    return { url: youtubeAuthUrl(decryptObject(row.credentials), state) };
  }),
);

router.delete('/:id/accounts/:platform', owned, (req, res) =>
  wrap(res, () => {
    store.deleteAccount(inf(res).id, String(req.params.platform));
    return detail(inf(res));
  }),
);

// ── launch ─────────────────────────────────────────────────────────────────

router.post('/:id/activate', owned, (_req, res) =>
  wrap(res, () => {
    const i = inf(res);
    const r = readiness(i);
    if (!r.passed) throw new Error(`Not ready to launch: ${r.issues.join(' ')}`);
    return detail(store.updateInfluencer(i.id, { status: 'active', step: 'launch' }));
  }),
);

router.post('/:id/pause', owned, (_req, res) => wrap(res, () => detail(store.updateInfluencer(inf(res).id, { status: 'paused' }))));

// ── posts ──────────────────────────────────────────────────────────────────

router.post('/:id/posts/generate', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    if (working.has(i.id)) throw new Error(`Already working: ${working.get(i.id)}`);
    requirePersona(i);
    if (i.kind === 'visual' && !i.look.approvedMediaId) throw new Error('Approve a look first');
    if (i.kind === 'text' && !researchConfigured()) throw new Error('Configure a web search provider first');
    const topic = typeof req.body?.topic === 'string' && req.body.topic.trim() ? req.body.topic.trim().slice(0, 300) : undefined;
    runInBackground(i.id, i.kind === 'text' ? 'Researching and fact-checking a post' : 'Creating a post', () =>
      generatePost(i, { origin: 'manual', topicHint: topic }),
    );
    return detail(i);
  }),
);

function ownedPost(i: Influencer, pid: number): store.Post {
  const p = store.getPost(pid);
  if (!p || p.influencerId !== i.id) throw new Error('Post not found');
  return p;
}

router.patch('/:id/posts/:pid', owned, (req, res) =>
  wrap(res, async () => {
    const i = inf(res);
    const post = ownedPost(i, Number(req.params.pid));
    if (post.status === 'published' || post.status === 'publishing') throw new Error('Published posts can\'t be edited');
    const text = String(req.body?.text ?? '').slice(0, 5000).trim();
    if (i.kind === 'text') {
      // Edited text needs a fresh fact-check before it can be approved.
      store.updatePost(post.id, { text, status: 'review', error: text === post.checkedText ? null : 'Edited: re-check before approving' });
    } else {
      const compliance = await reviewPost(i, text, post.sources);
      store.updatePost(post.id, { text, compliance, checkedText: text, status: compliance.passed ? 'review' : 'blocked', error: compliance.passed ? null : 'Failed the rules or policy review' });
    }
    return detail(i);
  }),
);

router.post('/:id/posts/:pid/recheck', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    const post = ownedPost(i, Number(req.params.pid));
    if (i.kind !== 'text') throw new Error('Only text posts are fact-checked');
    if (working.has(i.id)) throw new Error(`Already working: ${working.get(i.id)}`);
    runInBackground(i.id, 'Re-checking a post', () => recheckTextPost(i, post));
    return detail(i);
  }),
);

router.post('/:id/posts/:pid/approve', owned, (req, res) =>
  wrap(res, async () => {
    const i = inf(res);
    const post = ownedPost(i, Number(req.params.pid));
    if (!['review', 'failed', 'approved'].includes(post.status)) throw new Error(`A ${post.status} post can't be approved`);
    const blocker = publishBlocker(i, post);
    if (blocker) throw new Error(blocker);
    const now = !!req.body?.now;
    store.updatePost(post.id, {
      status: 'approved',
      error: null,
      scheduledFor: now ? new Date().toISOString() : nextWindowStart(i.plan, new Date())?.toISOString() ?? null,
    });
    if (now) await publishPost(post.id);
    return detail(i);
  }),
);

router.post('/:id/posts/:pid/reject', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    const post = ownedPost(i, Number(req.params.pid));
    store.updatePost(post.id, { status: 'rejected' });
    return detail(i);
  }),
);

/** Manual platforms: the user posted it themselves. */
router.post('/:id/posts/:pid/mark-posted', owned, (req, res) =>
  wrap(res, () => {
    const i = inf(res);
    const post = ownedPost(i, Number(req.params.pid));
    if (post.status !== 'approved' && post.status !== 'published') throw new Error('Approve the post first');
    const platform = String(req.body?.platform ?? '');
    if (!getPlatform(platform)) throw new Error('Unknown platform');
    const url = typeof req.body?.url === 'string' && /^https?:\/\//.test(req.body.url) ? req.body.url : undefined;
    const results = { ...post.results, [platform]: { ok: true, url, manual: true, at: new Date().toISOString() } };
    const planned = i.plan.platforms ?? [];
    const allDone = planned.every((p) => results[p]?.ok);
    store.updatePost(post.id, { results, status: allDone ? 'published' : post.status });
    return detail(i);
  }),
);

export default router;
