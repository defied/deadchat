// Instagram, Threads and YouTube publishing, signed media links and the
// public media endpoint. The network is mocked; the DB is a temp SQLite file.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deadchat-pub-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.PUBLIC_URL = 'https://deadchat.example.com/';
process.env.SECRETS_KEY = 'test-secrets-key-0123456789abcdef';
fs.mkdirSync(process.env.MEDIA_DIR, { recursive: true });

/* eslint-disable @typescript-eslint/no-require-imports */
const { runMigrations } = require('../../db/migrate') as typeof import('../../db/migrate');
runMigrations();
const mediaStore = require('../mediaStore') as typeof import('../mediaStore');
const platforms = require('./platforms') as typeof import('./platforms');
const pm = require('./publicMedia') as typeof import('./publicMedia');
const publicMediaRoute = require('../../routes/publicMedia') as typeof import('../../routes/publicMedia');
/* eslint-enable @typescript-eslint/no-require-imports */

// ── fetch mock ─────────────────────────────────────────────────────────────

interface Call { url: string; method: string; headers: Record<string, string>; body: string }
type Handler = { match: (c: Call) => boolean; reply: (c: Call) => Response; once?: boolean };
let handlers: Handler[] = [];
let calls: Call[] = [];
const realFetch = globalThis.fetch;

function on(match: (c: Call) => boolean, reply: (c: Call) => Response, once = false): void {
  handlers.push({ match, reply, once });
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function bodyText(b: unknown): string {
  if (b == null) return '';
  if (typeof b === 'string') return b;
  if (b instanceof URLSearchParams) return b.toString();
  if (b instanceof Uint8Array) return `<${b.length} bytes>`;
  return String(b);
}

beforeEach(() => {
  handlers = [];
  calls = [];
  platforms.timing.sleep = async () => {};
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const c: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: bodyText(init.body),
    };
    calls.push(c);
    const i = handlers.findIndex((h) => h.match(c));
    if (i < 0) throw new Error(`Unexpected request: ${c.method} ${c.url}`);
    const h = handlers[i];
    if (h.once) handlers.splice(i, 1);
    return h.reply(c);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const form = (c: Call) => new URLSearchParams(c.body);

// ── fixtures ───────────────────────────────────────────────────────────────

let tallPng: number;
let clipMp4: number;
before(async () => {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 400, height: 1000, channels: 3, background: '#3366aa' } }).png().toBuffer();
  tallPng = mediaStore.saveMedia({ type: 'image', bytes: png, mime: 'image/png' }).id;
  clipMp4 = mediaStore.saveMedia({ type: 'video', bytes: Buffer.from('fake mp4 bytes'), mime: 'video/mp4' }).id;
});

const SOURCES = [
  { url: 'https://www.noaa.gov/news/a', domain: 'noaa.gov' },
  { url: 'https://www.usgs.gov/b', domain: 'usgs.gov' },
];

// ── signed links ───────────────────────────────────────────────────────────

test('signed media URLs verify and reject tampering or expiry', () => {
  const now = Date.UTC(2026, 10, 7);
  const url = pm.signedMediaUrl(42, 'image/png', 'ig', 'Instagram', 3600, now);
  assert.match(url, /^https:\/\/deadchat\.example\.com\/api\/public\/media\/42\/\d+\/ig\/[\w-]+\.jpg$/);
  const [, , , , , , id, exp, variant, sig] = url.split('/');
  assert.equal(id, '42');
  assert.ok(pm.verifyMediaSignature(42, Number(exp), variant, sig, now));
  assert.ok(!pm.verifyMediaSignature(43, Number(exp), variant, sig, now), 'other media id');
  assert.ok(!pm.verifyMediaSignature(42, Number(exp), 'orig', sig, now), 'other variant');
  assert.ok(!pm.verifyMediaSignature(42, Number(exp) + 1, variant, sig, now), 'other expiry');
  assert.ok(!pm.verifyMediaSignature(42, Number(exp), variant, sig, now + 3601_000), 'expired');
});

test('OAuth state round-trips and rejects tampering or expiry', () => {
  const now = Date.UTC(2026, 10, 7);
  const s = pm.signState({ influencerId: 7, userId: 3, platform: 'youtube' }, 900, now);
  assert.deepEqual(pm.verifyState(s, now), { influencerId: 7, userId: 3, platform: 'youtube' });
  const [body, sig] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ influencerId: 8, userId: 3, platform: 'youtube', exp: 9e9 })).toString('base64url');
  assert.equal(pm.verifyState(`${forged}.${sig}`, now), null);
  assert.equal(pm.verifyState(`${body}.${sig}`, now + 901_000), null);
});

test('Instagram crop keeps feed images between 4:5 and 1.91:1', () => {
  assert.deepEqual(publicMediaRoute.instagramCrop(1080, 1920), { width: 1080, height: 1350 });
  assert.deepEqual(publicMediaRoute.instagramCrop(2000, 500), { width: 955, height: 500 });
  assert.equal(publicMediaRoute.instagramCrop(1080, 1080), null);
});

test('acceptsPost: YouTube needs video, text-only platforms take anything', () => {
  const yt = platforms.getPlatform('youtube')!;
  const ig = platforms.getPlatform('instagram')!;
  const bsky = platforms.getPlatform('bluesky')!;
  assert.ok(!platforms.acceptsPost(yt, ['image']));
  assert.ok(platforms.acceptsPost(yt, ['image', 'video']));
  assert.ok(!platforms.acceptsPost(ig, []));
  assert.ok(platforms.acceptsPost(bsky, ['video']));
  assert.deepEqual(
    platforms.PLATFORMS.filter((p) => p.mode === 'manual').map((p) => p.id).sort(),
    ['tiktok', 'x'],
  );
});

// ── Instagram ──────────────────────────────────────────────────────────────

test('Instagram: renews the token, posts one image, returns the permalink', async () => {
  const creds: Record<string, unknown> = { accessToken: 'OLD' };
  const saved: Array<Record<string, unknown>> = [];
  on((c) => c.url.includes('/refresh_access_token'), () => json({ access_token: 'NEW', token_type: 'bearer', expires_in: 5184000 }));
  on((c) => c.url.includes('/v27.0/me?'), () => json({ user_id: '1784', username: 'maya.trails' }));
  on((c) => c.method === 'POST' && c.url.endsWith('/1784/media'), () => json({ id: 'C1' }));
  on((c) => c.url.includes('/C1?'), () => json({ status_code: 'FINISHED' }));
  on((c) => c.url.endsWith('/1784/media_publish'), () => json({ id: 'P1' }));
  on((c) => c.url.includes('/P1?fields=permalink'), () => json({ permalink: 'https://www.instagram.com/p/abc/' }));

  const out = await platforms.publish(
    'instagram',
    creds,
    { text: 'Tide pools at dawn.\n\n#AIgenerated', mediaIds: [tallPng], sources: SOURCES },
    { saveCredentials: (c) => saved.push(c) },
  );
  assert.equal(out.url, 'https://www.instagram.com/p/abc/');
  const create = calls.find((c) => c.url.endsWith('/1784/media'))!;
  assert.equal(create.headers.authorization, 'Bearer NEW', 'uses the renewed token');
  const params = form(create);
  assert.match(params.get('image_url')!, /^https:\/\/deadchat\.example\.com\/api\/public\/media\/\d+\/\d+\/ig\/.+\.jpg$/);
  assert.match(params.get('caption')!, /^Tide pools at dawn\.\n\nSources: noaa\.gov, usgs\.gov$/);
  assert.equal(saved.at(-1)!.accessToken, 'NEW');
  assert.equal(saved.at(-1)!.userId, '1784');
  assert.ok(saved.at(-1)!.tokenRefreshedAt);
});

test('Instagram: carousel of image + video waits for the video, then publishes', async () => {
  const creds: Record<string, unknown> = { accessToken: 'T', tokenRefreshedAt: new Date().toISOString(), userId: '9', username: 'm' };
  let n = 0;
  on((c) => c.method === 'POST' && c.url.endsWith('/9/media') && !form(c).get('media_type')?.startsWith('CAROUSEL'), () => json({ id: `K${++n}` }));
  on((c) => c.method === 'POST' && form(c).get('media_type') === 'CAROUSEL', () => json({ id: 'CAR' }));
  on((c) => c.url.includes('/K2?'), () => json({ status_code: 'IN_PROGRESS' }), true);
  on((c) => /\/(K1|K2|CAR)\?/.test(c.url), () => json({ status_code: 'FINISHED' }));
  on((c) => c.url.endsWith('/9/media_publish'), () => json({ id: 'P2' }));
  on((c) => c.url.includes('/P2?'), () => json({ permalink: 'https://www.instagram.com/p/car/' }));

  const out = await platforms.publish('instagram', creds, { text: 'Two views', mediaIds: [tallPng, clipMp4], sources: [] });
  assert.equal(out.url, 'https://www.instagram.com/p/car/');
  assert.ok(!calls.some((c) => c.url.includes('refresh_access_token')), 'token renewed under a week ago is reused');
  const kids = calls.filter((c) => c.url.endsWith('/9/media') && form(c).get('is_carousel_item') === 'true');
  assert.equal(kids.length, 2);
  assert.equal(form(kids[1]).get('media_type'), 'VIDEO');
  assert.match(form(kids[1]).get('video_url')!, /\/orig\/.+\.mp4$/);
  assert.equal(form(calls.find((c) => form(c).get('media_type') === 'CAROUSEL')!).get('children'), 'K1,K2');
  assert.equal(calls.filter((c) => c.url.includes('/K2?')).length, 2, 'polled the video until FINISHED');
});

test('Instagram: an expired token gives a clear error', async () => {
  // A failed renewal alone isn't fatal (new tokens can't be renewed for 24 h);
  // the error comes from the first real API call.
  on((c) => c.url.includes('/refresh_access_token'), () => json({ error: { message: 'Session has expired', code: 190 } }, 400));
  on((c) => c.url.includes('/v27.0/me?'), () => json({ error: { message: 'Error validating access token', code: 190 } }, 400));
  await assert.rejects(
    platforms.publish('instagram', { accessToken: 'X' }, { text: 'hi', mediaIds: [tallPng], sources: [] }),
    /expired or was revoked/,
  );
});

test('Instagram: text-only posts are refused', async () => {
  await assert.rejects(
    platforms.publish('instagram', { accessToken: 'X', tokenRefreshedAt: new Date().toISOString(), userId: '1', username: 'u' }, { text: 'hi', mediaIds: [], sources: [] }),
    /need an image or a video/,
  );
});

// ── Threads ────────────────────────────────────────────────────────────────

test('Threads: text post with inline sources, token sent as access_token', async () => {
  const creds: Record<string, unknown> = { accessToken: 'TH', tokenRefreshedAt: new Date().toISOString() };
  on((c) => c.url.includes('graph.threads.net/v1.0/me?'), () => json({ id: '55', username: 'maya' }));
  on((c) => c.method === 'POST' && c.url.endsWith('/55/threads'), () => json({ id: 'TC' }));
  on((c) => c.url.includes('/TC?'), () => json({ status: 'FINISHED' }));
  on((c) => c.url.endsWith('/55/threads_publish'), () => json({ id: 'TP' }));
  on((c) => c.url.includes('/TP?'), () => json({ permalink: 'https://www.threads.net/@maya/post/x' }));

  const out = await platforms.publish('threads', creds, { text: 'Storm surge update.\n\n#AIgenerated', mediaIds: [], sources: SOURCES });
  assert.equal(out.url, 'https://www.threads.net/@maya/post/x');
  const create = calls.find((c) => c.url.endsWith('/55/threads'))!;
  assert.equal(form(create).get('access_token'), 'TH');
  assert.equal(create.headers.authorization, undefined);
  assert.equal(form(create).get('media_type'), 'TEXT');
  assert.match(form(create).get('text')!, /^Storm surge update\.\n\nSources: https:\/\/www\.noaa\.gov\/news\/a https:\/\/www\.usgs\.gov\/b$/);
});

test('Threads: images go out as tagged JPEG, emoji count as bytes toward 500', async () => {
  assert.equal(platforms.threadsLength('ab🌊'), 2 + Buffer.byteLength('🌊'));
  const long = `${'🌊'.repeat(150)} end`;
  assert.ok(platforms.threadsLength(platforms.fitThreads(long)) <= 500);

  const creds: Record<string, unknown> = { accessToken: 'TH', tokenRefreshedAt: new Date().toISOString(), userId: '55', username: 'maya' };
  on((c) => c.method === 'POST' && c.url.endsWith('/55/threads'), () => json({ id: 'TC2' }));
  on((c) => c.url.includes('/TC2?'), () => json({ status: 'FINISHED' }));
  on((c) => c.url.endsWith('/55/threads_publish'), () => json({ id: 'TP2' }));
  on((c) => c.url.includes('/TP2?'), () => json({}));
  await platforms.publish('threads', creds, { text: 'Look', mediaIds: [tallPng], sources: [] });
  const p = form(calls.find((c) => c.url.endsWith('/55/threads'))!);
  assert.equal(p.get('media_type'), 'IMAGE');
  assert.match(p.get('image_url')!, /\/jpeg\/.+\.jpg$/);
});

// ── YouTube ────────────────────────────────────────────────────────────────

test('YouTube: builds the consent URL with offline access', () => {
  const url = new URL(platforms.youtubeAuthUrl({ clientId: 'cid', clientSecret: 's' }, 'STATE'));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://deadchat.example.com/api/oauth/youtube/callback');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.match(url.searchParams.get('scope')!, /youtube\.upload/);
});

test('YouTube: uploads the video as public, marked synthetic', async () => {
  const creds = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'RT' };
  on((c) => c.url === 'https://oauth2.googleapis.com/token', () => json({ access_token: 'AT', expires_in: 3599 }));
  on(
    (c) => c.url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable'),
    () => new Response(null, { status: 200, headers: { Location: 'https://upload.example/session/1' } }),
  );
  on((c) => c.url === 'https://upload.example/session/1', () => json({ id: 'VID123', status: { uploadStatus: 'uploaded' } }));

  const out = await platforms.publish('youtube', creds, {
    text: 'Night dive at the <reef>\n\nBioluminescence everywhere. #nightdive',
    mediaIds: [tallPng, clipMp4],
    sources: SOURCES,
  });
  assert.equal(out.url, 'https://www.youtube.com/watch?v=VID123');
  assert.equal(form(calls[0]).get('refresh_token'), 'RT');
  const initCall = calls[1];
  assert.equal(initCall.headers.authorization, 'Bearer AT');
  assert.equal(initCall.headers['x-upload-content-type'], 'video/mp4');
  const meta = JSON.parse(initCall.body);
  assert.equal(meta.snippet.title, 'Night dive at the reef');
  assert.deepEqual(meta.snippet.tags, ['nightdive']);
  assert.match(meta.snippet.description, /Sources:\nhttps:\/\/www\.noaa\.gov\/news\/a/);
  assert.deepEqual(meta.status, { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  assert.equal(calls[2].method, 'PUT');
});

test('YouTube: needs a video, and a revoked grant explains how to fix it', async () => {
  await assert.rejects(
    platforms.publish('youtube', { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, { text: 'x', mediaIds: [tallPng], sources: [] }),
    /needs a video/,
  );
  on((c) => c.url === 'https://oauth2.googleapis.com/token', () => json({ error: 'invalid_grant' }, 400));
  await assert.rejects(
    platforms.publish('youtube', { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, { text: 'x', mediaIds: [clipMp4], sources: [] }),
    /Connect with Google" again/,
  );
  await assert.rejects(platforms.testConnection('youtube', { clientId: 'c', clientSecret: 's' }), /Connect with Google/);
});

// ── public media endpoint ──────────────────────────────────────────────────

test('public media endpoint serves signed links only, converting for Instagram', async () => {
  globalThis.fetch = realFetch;
  const express = (await import('express')).default;
  const app = express();
  app.use('/api/public/media', publicMediaRoute.default);
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const local = (u: string) => u.replace('https://deadchat.example.com', `http://127.0.0.1:${port}`);

    const ig = await realFetch(local(pm.signedMediaUrl(tallPng, 'image/png', 'ig', 'Instagram')));
    assert.equal(ig.status, 200);
    assert.equal(ig.headers.get('content-type'), 'image/jpeg');
    const sharp = (await import('sharp')).default;
    const meta = await sharp(Buffer.from(await ig.arrayBuffer())).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width! / meta.height!, 0.8, 'cropped to 4:5');
    assert.match(meta.xmp?.toString('utf-8') ?? '', /DigitalSourceType="http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/trainedAlgorithmicMedia"/);

    const th = await realFetch(local(pm.signedMediaUrl(tallPng, 'image/png', 'jpeg', 'Threads')));
    const thMeta = await sharp(Buffer.from(await th.arrayBuffer())).metadata();
    assert.equal(thMeta.format, 'jpeg');
    assert.match(thMeta.xmp?.toString('utf-8') ?? '', /trainedAlgorithmicMedia/);

    const orig = await realFetch(local(pm.signedMediaUrl(clipMp4, 'video/mp4', 'orig', 'Instagram')), { headers: { Range: 'bytes=0-3' } });
    assert.equal(orig.status, 206);
    assert.equal(await orig.text(), 'fake');

    const bad = local(pm.signedMediaUrl(tallPng, 'image/png', 'orig', 'Threads')).replace(/\/[\w-]+\.png$/, '/AAAA.png');
    assert.equal((await realFetch(bad)).status, 403);
  } finally {
    server.close();
  }
});

// ── sensitive media ────────────────────────────────────────────────────────

test('Mastodon: implied-nudity posts mark their media sensitive', async () => {
  on((c) => c.url.endsWith('/api/v2/media'), () => json({ id: 'M1', url: 'https://m.test/1.png' }));
  on((c) => c.url.endsWith('/api/v1/statuses'), () => json({ url: 'https://m.test/@maya/1' }));
  const creds = { instance: 'https://m.test', accessToken: 'T' };
  await platforms.publish('mastodon', creds, { text: 'Bath night', mediaIds: [tallPng], sources: [], sensitive: true });
  assert.equal(JSON.parse(calls.find((c) => c.url.endsWith('/statuses'))!.body).sensitive, true);
  calls = [];
  await platforms.publish('mastodon', creds, { text: 'Just words', mediaIds: [], sources: [], sensitive: true });
  assert.equal(JSON.parse(calls.find((c) => c.url.endsWith('/statuses'))!.body).sensitive, false);
});

// ── coverage check ─────────────────────────────────────────────────────────

test('verifyImage fails any image that breaks a hard rule, and unclear answers', async () => {
  const enhance = require('../media/enhance') as typeof import('../media/enhance'); // eslint-disable-line @typescript-eslint/no-require-imports
  const { getActiveModel } = require('../chatModels') as typeof import('../chatModels'); // eslint-disable-line @typescript-eslint/no-require-imports
  const model = getActiveModel();
  let reply = '';
  let system = '';
  on((c) => c.url.endsWith('/api/tags'), () => json({ models: [{ name: model, digest: 'd1' }] }));
  on((c) => c.url.endsWith('/api/show'), () => json({ capabilities: ['completion', 'vision'], model_info: {} }));
  on((c) => c.url.endsWith('/api/chat'), (c) => {
    system = JSON.parse(c.body).messages[0].content;
    return json({ message: { content: reply } });
  });

  reply = JSON.stringify({ rulesBroken: true, score: 9, issues: ['nipple outline visible through the foam'] });
  const broken = await enhance.verifyImage('bath scene', 'AAAA', 'No nipple may be visible.');
  assert.deepEqual([broken.pass, broken.rulesBroken, broken.score], [false, true, 1]);
  assert.match(system, /Hard rules .*No nipple may be visible/);
  assert.match(system, /rulesBroken is ONLY for the hard rules/);

  reply = JSON.stringify({ rulesBroken: false, score: 9, issues: [] });
  assert.equal((await enhance.verifyImage('bath scene', 'AAAA', 'No nipple may be visible.')).pass, true);

  // Missing rulesBroken or unparseable output fails closed when rules apply...
  reply = JSON.stringify({ score: 9, issues: [] });
  assert.equal((await enhance.verifyImage('bath scene', 'AAAA', 'No nipple may be visible.')).pass, false);
  reply = 'not json';
  assert.equal((await enhance.verifyImage('bath scene', 'AAAA', 'No nipple may be visible.')).pass, false);
  // ...but not for ordinary images.
  assert.equal((await enhance.verifyImage('a cat', 'AAAA')).pass, true);
});
