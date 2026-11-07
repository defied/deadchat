import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_POSTS_PER_DAY,
  MIN_PORTFOLIO,
  buildImagePrompt,
  checkImagePrompt,
  checkLaunchReadiness,
  checkPersona,
  checkPlan,
  checkPostText,
  checkRate,
  stripDisclosureTag,
} from './compliance';
import { activeHoursBetween, inWindow, intervalHours, isPostDue, nextWindowStart } from './schedule';
import type { Attestation, Influencer, Persona, Plan } from './types';

const allRules: Attestation = { invented: true, adult: true, disclose: true, platformRules: true, noDeception: true };
const persona: Persona = {
  displayName: 'Maya Rivera',
  age: 27,
  gender: 'woman',
  niche: 'trail running and camp cooking',
  audience: 'outdoorsy adults in the Pacific Northwest',
  bio: 'Runner, cook, five years of guiding experience.',
  disclosure: 'AI-generated persona',
};
const plan: Plan = {
  postsPerWeek: 5,
  days: [1, 2, 3, 4, 5],
  windowStart: 9,
  windowEnd: 17,
  timezone: 'America/Los_Angeles',
  platforms: ['bluesky'],
};

function influencer(over: Partial<Influencer> = {}): Influencer {
  return {
    id: 1,
    userId: 1,
    name: 'Maya',
    kind: 'visual',
    status: 'draft',
    step: 'launch',
    persona,
    look: { appearance: 'woman with shoulder-length dark curly hair and freckles', approvedMediaId: 3 },
    research: {},
    plan,
    attestation: allRules,
    lastPostAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

// ── persona rules ──────────────────────────────────────────────────────────

test('a complete adult, invented, disclosed persona passes', () => {
  assert.deepEqual(checkPersona('visual', persona, allRules).issues, []);
});

test('ground rules must all be accepted', () => {
  assert.ok(checkPersona('visual', persona, { ...allRules, noDeception: false }).issues.some((i) => /ground rule/.test(i)));
});

test('persona age must be a stated adult of 21+', () => {
  for (const age of [undefined, 17, 20, 18.5, 120]) {
    assert.equal(checkPersona('visual', { ...persona, age }, allRules).passed, false, `age ${age}`);
  }
  assert.equal(checkPersona('visual', { ...persona, age: 21 }, allRules).passed, true);
});

test('bio describing the persona as a minor is blocked, ordinary words are not', () => {
  assert.equal(checkPersona('visual', { ...persona, bio: "She's a high schooler who loves art" }, allRules).passed, false);
  assert.equal(checkPersona('visual', { ...persona, bio: 'A 17-year-old dancer' }, allRules).passed, false);
  assert.equal(checkPersona('visual', { ...persona, bio: 'Loves kids, coaches a youth soccer team' }, allRules).passed, true);
});

test('personas may not be aimed at minors', () => {
  assert.equal(checkPersona('visual', { ...persona, audience: 'teens who like makeup' }, allRules).passed, false);
});

test('real-person likeness is blocked', () => {
  const r = checkPersona('visual', { ...persona, backstory: 'She looks just like my coworker' }, allRules);
  assert.equal(r.passed, false);
});

test('disclosure must mention AI', () => {
  assert.equal(checkPersona('visual', { ...persona, disclosure: 'Just vibes' }, allRules).passed, false);
});

// ── image prompts ──────────────────────────────────────────────────────────

test('image prompts block any hint of a minor or explicit content', () => {
  for (const t of ['teen girl at the beach', 'petite girl in a school uniform', 'woman, nude', '16yo model']) {
    assert.equal(checkImagePrompt('Scene', t).passed, false, t);
  }
  assert.equal(checkImagePrompt('Scene', 'woman with freckles hiking at golden hour').passed, true);
});

test('buildImagePrompt pins the adult age and the locked appearance', () => {
  const p = buildImagePrompt(persona, 'woman with dark curly hair', 'drinking coffee at a trailhead');
  assert.match(p, /woman with dark curly hair, a grown woman aged 27/);
  assert.match(p, /safe for work/);
});

// ── post text ──────────────────────────────────────────────────────────────

test('stripDisclosureTag removes the old hashtag and tidies spacing', () => {
  assert.equal(stripDisclosureTag('Sunrise run done.\n\n#AIgenerated'), 'Sunrise run done.');
  assert.equal(stripDisclosureTag('Glow #AI-generated #nightdive\n\nMore'), 'Glow #nightdive\n\nMore');
  assert.equal(stripDisclosureTag('No tag here, AI-generated persona'), 'No tag here, AI-generated persona');
});

test('posts need no hashtag and may only link verified sources', () => {
  const src = [{ url: 'https://apnews.com/a', domain: 'apnews.com' }];
  assert.equal(checkPostText('Hello', { kind: 'visual' }).passed, true);
  assert.equal(checkPostText('', { kind: 'visual' }).passed, false);
  assert.equal(checkPostText('See https://apnews.com/a', { kind: 'text', sources: src }).passed, true);
  assert.equal(checkPostText('See https://randomblog.example/x', { kind: 'text', sources: src }).passed, false);
});

test('political posts may not @-mention people; others only warn', () => {
  const t = 'Thoughts on @someone today';
  assert.equal(checkPostText(t, { kind: 'text', research: { political: true } }).passed, false);
  const visual = checkPostText(t, { kind: 'visual' });
  assert.equal(visual.passed, true);
  assert.equal(visual.warnings.length, 1);
});

test('political posts about election logistics need an official source', () => {
  const t = 'Early voting starts Monday.';
  const news = [{ url: 'https://apnews.com/a', domain: 'apnews.com' }];
  const gov = [{ url: 'https://www.sos.wa.gov/x', domain: 'sos.wa.gov' }];
  assert.equal(checkPostText(t, { kind: 'text', research: { political: true }, sources: news }).passed, false);
  assert.equal(checkPostText(t, { kind: 'text', research: { political: true }, sources: gov }).passed, true);
});

test('policy topics mentioning children are not blocked in post text', () => {
  assert.equal(checkPostText('The child tax credit vote passed.', { kind: 'text' }).passed, true);
});

// ── rate caps ──────────────────────────────────────────────────────────────

test('rate caps enforce a daily maximum and minimum spacing', () => {
  const now = new Date('2026-11-04T20:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  assert.equal(checkRate([], now).allowed, true);
  assert.equal(checkRate([hoursAgo(0.5)], now).allowed, false);
  assert.equal(checkRate([hoursAgo(2)], now).allowed, true);
  const full = Array.from({ length: MAX_POSTS_PER_DAY }, (_, i) => hoursAgo(2 + i * 3));
  assert.equal(checkRate(full, now).allowed, false);
});

// ── plan & readiness ───────────────────────────────────────────────────────

test('plan validation', () => {
  assert.equal(checkPlan(plan).passed, true);
  assert.equal(checkPlan({ ...plan, postsPerWeek: 100 }).passed, false);
  assert.equal(checkPlan({ ...plan, timezone: 'Mars/Olympus' }).passed, false);
  assert.equal(checkPlan({ ...plan, windowStart: 17, windowEnd: 9 }).passed, false);
  assert.equal(checkPlan({ ...plan, platforms: [] }).passed, false);
});

test('a visual influencer needs an approved look, a portfolio and ready accounts', () => {
  const ok = checkLaunchReadiness({
    influencer: influencer(),
    approvedLook: true,
    approvedPortfolio: MIN_PORTFOLIO,
    accounts: [{ platform: 'bluesky', ready: true }],
    researchConfigured: false,
  });
  assert.deepEqual(ok.issues, []);
  const missing = checkLaunchReadiness({
    influencer: influencer(),
    approvedLook: false,
    approvedPortfolio: 2,
    accounts: [],
    researchConfigured: false,
  });
  assert.equal(missing.issues.length, 3);
});

test('a text influencer needs topics and a search provider', () => {
  const r = checkLaunchReadiness({
    influencer: influencer({ kind: 'text', research: {} }),
    approvedLook: false,
    approvedPortfolio: 0,
    accounts: [{ platform: 'bluesky', ready: true }],
    researchConfigured: false,
  });
  assert.ok(r.issues.some((i) => /topic/.test(i)));
  assert.ok(r.issues.some((i) => /search provider/.test(i)));
});

// ── cadence ────────────────────────────────────────────────────────────────

// 2026-11-04 is a Wednesday. 18:00Z = 10:00 in Los Angeles (PST).
const wedTenAm = new Date('2026-11-04T18:00:00Z');

test('posting window follows the plan time zone and days', () => {
  assert.equal(inWindow(plan, wedTenAm), true);
  assert.equal(inWindow(plan, new Date('2026-11-04T16:00:00Z')), false); // 08:00 local
  assert.equal(inWindow(plan, new Date('2026-11-08T18:00:00Z')), false); // Sunday
});

test('posts are spread across active hours', () => {
  assert.equal(intervalHours(plan), 8); // 5 days × 8 h / 5 posts
  assert.equal(isPostDue(plan, null, wedTenAm), true);
  // Last post yesterday 10:00 local → 8 active hours have passed (Tue 10–17 + Wed 9–10).
  assert.equal(isPostDue(plan, '2026-11-03T18:00:00Z', wedTenAm), true);
  // Last post today 09:00 local → only 1 active hour.
  assert.equal(isPostDue(plan, '2026-11-04T17:00:00Z', wedTenAm), false);
  assert.equal(activeHoursBetween(plan, new Date('2026-11-04T17:00:00Z'), wedTenAm), 1);
});

test('nothing is due outside the window', () => {
  assert.equal(isPostDue(plan, null, new Date('2026-11-05T03:00:00Z')), false); // 19:00 local
});

test('nextWindowStart finds the next opening', () => {
  const next = nextWindowStart(plan, new Date('2026-11-07T18:00:00Z')); // Saturday
  assert.equal(next?.toISOString(), '2026-11-09T17:00:00.000Z'); // Monday 09:00 PST
});
