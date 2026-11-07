import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADULT_RULES,
  COVERAGE_RULES,
  contentLevel,
  imageNegative,
  IMAGE_NEGATIVE,
  IMAGE_NEGATIVE_SUGGESTIVE,
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

test('suggestive projects allow implied nudity but never exposure, sex or minors', () => {
  for (const t of [
    'naked woman relaxing in a bubble bath, thick foam up to her collarbones',
    'man stepping out of the shower with a towel around his waist',
    'topless under the bedsheets, morning light, flirtatious smile',
  ]) {
    assert.equal(checkImagePrompt('Scene', t, true).passed, true, t);
    assert.equal(checkImagePrompt('Scene', t).passed, t.startsWith('man'), `sfw: ${t}`);
  }
  for (const t of [
    'nude woman in the bath, exposed nipples',
    'full frontal shower shot',
    'towel slipping, genitals visible',
    'couple having sex in the shower',
    'pornographic bath scene',
    'teen girl in a bubble bath',
    '17yo in a towel',
    'naked schoolgirl',
  ]) {
    assert.equal(checkImagePrompt('Scene', t, true).passed, false, t);
  }
});

test('suggestive prompts require coverage and keep the minor safeguards', () => {
  const p = buildImagePrompt(persona, 'woman with dark curly hair', 'in a bubble bath', undefined, true);
  assert.match(p, /aged 27/);
  assert.match(p, /chest is out of frame or turned away/);
  assert.doesNotMatch(p, /nipple|breast|genital|buttock/i, 'the prompt must not name what stays hidden');
  assert.doesNotMatch(p, /fully clothed/);
  for (const n of [IMAGE_NEGATIVE, IMAGE_NEGATIVE_SUGGESTIVE]) assert.match(n, /child, children, teen/);
  assert.match(IMAGE_NEGATIVE_SUGGESTIVE, /exposed nipples, areola/);
  assert.doesNotMatch(IMAGE_NEGATIVE_SUGGESTIVE, /\bnudity\b/);
  const named = checkImagePrompt('Scene', 'bubble bath, foam just above the nipples', true);
  assert.equal(named.passed, false);
  assert.match(named.issues[0], /describe what covers the body/);
  assert.equal(checkImagePrompt('Scene', 'bubble bath, foam over her breasts', true).passed, false);
  assert.match(COVERAGE_RULES, /No nipple or areola may be visible/);
  assert.equal(checkPostText('Bath night 🛁 come closer', { kind: 'visual', level: 'implied' }).passed, true);
  assert.equal(checkPostText('Bath night, nudes in my DMs', { kind: 'visual', level: 'implied' }).passed, false);
});

test('explicit projects allow adult sexual content but keep every minor, consent and likeness block', () => {
  for (const t of ['nude woman lying on bedsheets, morning light', 'grown woman, fully naked in the shower, explicit']) {
    assert.equal(checkImagePrompt('Scene', t, 'explicit').passed, true, t);
    assert.equal(checkImagePrompt('Scene', t).passed, false, `sfw: ${t}`);
  }
  for (const t of [
    'teen girl, nude',
    'naked schoolgirl',
    '17yo in the shower',
    'petite young woman, nude',
    'nude cheerleader',
    'California girl vibe, naked',
    'unconscious woman, nude',
    'stepsister in the shower',
    'nude, looks just like a famous actress',
  ]) {
    assert.equal(checkImagePrompt('Scene', t, 'explicit').passed, false, t);
  }
  assert.equal(checkImagePrompt('Scene', 'grown woman, fully naked, explicit', 'implied').passed, false);
  const p = buildImagePrompt(persona, 'woman with dark curly hair', 'on the bed', undefined, 'explicit');
  assert.match(p, /a grown woman aged 27/);
  assert.match(p, /unmistakably mature adult/);
  assert.match(imageNegative('explicit'), /child, children, teen/);
  assert.doesNotMatch(imageNegative('explicit'), /nudity/);
  assert.match(ADULT_RULES, /clearly look 21 or older/);
});

test('explicit projects never publish and need a persona aged 25+', () => {
  const look = { appearance: 'grown woman with dark curly hair', contentLevel: 'explicit' as const };
  const base = influencer();
  const young = { ...base, persona: { ...base.persona, age: 23 }, look };
  const readiness = checkLaunchReadiness({ influencer: young, approvedLook: true, approvedPortfolio: MIN_PORTFOLIO, accounts: [], researchConfigured: true });
  assert.ok(readiness.issues.some((i) => /aged 25 or older/.test(i)));
  assert.equal(contentLevel({ suggestive: true }), 'implied');
  assert.equal(contentLevel({ suggestive: true, contentLevel: 'explicit' }), 'explicit');
  assert.equal(contentLevel({}), 'sfw');
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
