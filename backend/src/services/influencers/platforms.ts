// Social platforms: setup guides, credentials, and publishers.
//
// Bluesky, Mastodon, Instagram, Threads and YouTube publish through their
// official APIs, using credentials the user creates for their own accounts.
// Instagram and Threads download media from a signed DeadChat link, so they
// need PUBLIC_URL. TikTok (posts stay private until TikTok audits the app) and
// X (paid per post) are "manual": DeadChat prepares the post, the user
// publishes it and marks it as posted.

import fs from 'fs';
import { getMedia, getMediaPath } from '../mediaStore';
import type { Source } from './types';
import { requirePublicUrl, signedMediaUrl } from './publicMedia';
import { stripDisclosureTag } from './compliance';

export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  hint?: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  link?: string;
}

export interface PlatformDef {
  id: string;
  name: string;
  mode: 'api' | 'manual';
  /** Max characters (graphemes) per post. */
  maxText: number;
  media: { image: boolean; video: boolean; textOnly: boolean };
  fields: CredentialField[];
  checklist: ChecklistItem[];
  /** The platform's own AI-content rule, in one line. */
  aiRule: string;
  /** Connected with an OAuth sign-in rather than a pasted token. */
  connect?: 'google';
  /** Downloads media from DeadChat, so PUBLIC_URL must be set. */
  needsPublicUrl?: boolean;
}

const COMMON: ChecklistItem[] = [
  { id: 'bio-disclosure', label: 'The profile bio says the account is an AI-generated persona', required: true },
  { id: 'terms', label: "I've read the platform's rules on automation and AI-generated content", required: true },
];

export const PLATFORMS: PlatformDef[] = [
  {
    id: 'bluesky',
    name: 'Bluesky',
    mode: 'api',
    maxText: 300,
    media: { image: true, video: false, textOnly: true },
    fields: [
      { key: 'service', label: 'PDS / service URL', placeholder: 'https://bsky.social', hint: 'Leave as bsky.social unless you self-host.' },
      { key: 'identifier', label: 'Handle', placeholder: 'maya.bsky.social' },
      { key: 'appPassword', label: 'App password', secret: true, hint: 'Settings → Privacy and security → App passwords. Never your main password.' },
    ],
    checklist: [
      { id: 'account', label: 'Create a separate Bluesky account for this persona', required: true, link: 'https://bsky.app' },
      { id: 'app-password', label: 'Create an app password for DeadChat', required: true, link: 'https://bsky.app/settings/app-passwords' },
      ...COMMON,
    ],
    aiRule: 'No AI label setting exists, so the bio disclosure carries it.',
  },
  {
    id: 'mastodon',
    name: 'Mastodon',
    mode: 'api',
    maxText: 500,
    media: { image: true, video: true, textOnly: true },
    fields: [
      { key: 'instance', label: 'Instance URL', placeholder: 'https://mastodon.social' },
      { key: 'accessToken', label: 'Access token', secret: true, hint: 'Preferences → Development → New application, with write:statuses and write:media.' },
    ],
    checklist: [
      { id: 'instance-rules', label: "The instance's rules allow automated / AI accounts", required: true },
      { id: 'bot-flag', label: 'Profile → "This is an automated account" is ticked', required: true },
      { id: 'token', label: 'Create an application and copy its access token', required: true },
      ...COMMON,
    ],
    aiRule: 'Mark the profile as an automated account; many instances also require AI content to be labelled.',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    mode: 'api',
    maxText: 2200,
    media: { image: true, video: true, textOnly: false },
    needsPublicUrl: true,
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        secret: true,
        hint: 'Meta App Dashboard → Instagram → API setup with Instagram login → Generate token for this account. DeadChat renews it automatically.',
      },
    ],
    checklist: [
      { id: 'account', label: 'Create a separate Instagram account for this persona', required: true },
      { id: 'professional', label: 'Switch it to a Professional account (Creator is fine)', required: true, link: 'https://help.instagram.com/502981923235522' },
      { id: 'meta-app', label: 'Create a Meta developer app and add "Instagram API with Instagram login"', required: true, link: 'https://developers.facebook.com/apps' },
      { id: 'tester', label: 'Add the account under App roles → Instagram testers, then accept the invite in Instagram', required: true },
      { id: 'ai-profile', label: 'Turn on the "AI-generated profile" label in the account settings', required: true },
      ...COMMON,
    ],
    aiRule:
      'Profiles featuring an AI-generated person must carry the "AI-generated profile" label. Instagram reads the AI tag DeadChat embeds in each image and adds its "AI info" label.',
  },
  {
    id: 'threads',
    name: 'Threads',
    mode: 'api',
    maxText: 500,
    media: { image: true, video: true, textOnly: true },
    needsPublicUrl: true,
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        secret: true,
        hint: 'Meta App Dashboard → your app\'s Threads API use case → User token generator (threads_basic, threads_content_publish). DeadChat renews it automatically.',
      },
    ],
    checklist: [
      { id: 'meta-app', label: 'Add the "Access the Threads API" use case to your Meta app', required: true, link: 'https://developers.facebook.com/apps' },
      { id: 'tester', label: 'Add the account as a Threads tester and accept the invite (Threads → Settings → Account → Website permissions)', required: true },
      { id: 'ai-profile', label: 'The linked Instagram profile carries the "AI-generated profile" label', required: true },
      ...COMMON,
    ],
    aiRule: "Meta's AI-disclosure rules apply: label photorealistic AI video and audio. Images carry an embedded AI tag that Meta reads to add its label.",
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    mode: 'manual',
    maxText: 2200,
    media: { image: true, video: true, textOnly: false },
    fields: [{ key: 'handle', label: 'Handle', placeholder: '@maya.trails' }],
    checklist: [
      { id: 'account', label: 'Create a separate TikTok account for this persona', required: true },
      { id: 'ai-toggle', label: 'Turn on "AI-generated content" for every post before publishing', required: true },
      ...COMMON,
    ],
    aiRule: 'Realistic AI content must use the "AI-generated content" toggle; it can\'t be removed later.',
  },
  {
    id: 'x',
    name: 'X',
    mode: 'manual',
    maxText: 280,
    media: { image: true, video: true, textOnly: true },
    fields: [{ key: 'handle', label: 'Handle', placeholder: '@maya_trails' }],
    checklist: [
      { id: 'automated-label', label: 'Add the "Automated" account label (Settings → Your account → Account information)', required: true },
      { id: 'no-deception', label: 'The persona is never presented as a real person', required: true },
      ...COMMON,
    ],
    aiRule: 'Deceptive synthetic media and AI identities passing as human are prohibited; label the account as automated.',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    mode: 'api',
    maxText: 5000,
    media: { image: false, video: true, textOnly: false },
    connect: 'google',
    fields: [
      { key: 'clientId', label: 'OAuth client ID', placeholder: '1234-abc.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'OAuth client secret', secret: true },
    ],
    checklist: [
      { id: 'channel', label: 'Create a YouTube channel for this persona', required: true, link: 'https://www.youtube.com/create_channel' },
      { id: 'api', label: 'In Google Cloud, create a project and enable the YouTube Data API v3', required: true, link: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
      { id: 'oauth-client', label: 'Create an OAuth client ID (type: Web application) with the redirect URI shown below', required: true, link: 'https://console.cloud.google.com/apis/credentials' },
      { id: 'production', label: 'Set the OAuth consent screen to "In production" (in Testing, Google cuts access after 7 days)', required: true, link: 'https://console.cloud.google.com/auth/audience' },
      ...COMMON,
    ],
    aiRule: 'Realistic AI content must be disclosed. DeadChat marks every upload as "altered or synthetic content".',
  },
];

export function getPlatform(id: string): PlatformDef | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

export function checklistDone(platform: PlatformDef, checklist: Record<string, boolean>): boolean {
  return platform.checklist.every((c) => !c.required || checklist[c.id]);
}

/** Whether a post with these media types can go to the platform (text-only platforms take anything). */
export function acceptsPost(platform: PlatformDef, mediaTypes: string[]): boolean {
  if (platform.media.textOnly) return true;
  return mediaTypes.some((t) => (t === 'image' && platform.media.image) || (t === 'video' && platform.media.video));
}

// ── text helpers (pure) ────────────────────────────────────────────────────

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function graphemeLength(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

/** Shorten to `max` graphemes on a word boundary. */
export function fitText(text: string, max: number): string {
  if (graphemeLength(text) <= max) return text;
  const room = max - 1;
  const chars = Array.from(segmenter.segment(text.trimEnd()), (s) => s.segment);
  let cut = chars.slice(0, Math.max(0, room)).join('');
  const sp = cut.lastIndexOf(' ');
  if (sp > room * 0.6) cut = cut.slice(0, sp);
  return `${cut.trimEnd()}…`;
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; uri?: string; tag?: string }>;
}

const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;

/** Bluesky rich-text facets for links and hashtags (UTF-8 byte offsets). */
export function buildFacets(text: string, links: Array<{ text: string; uri: string }> = []): Facet[] {
  const facets: Facet[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)\]]+/g)) {
    const start = byteLen(text.slice(0, m.index!));
    facets.push({ index: { byteStart: start, byteEnd: start + byteLen(m[0]) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  }
  for (const m of text.matchAll(/(^|\s)(#[^\d\s#][^\s#]*)/g)) {
    const tagText = m[2].replace(/[.,;:!?)\]]+$/, '');
    const start = byteLen(text.slice(0, m.index! + m[1].length));
    facets.push({
      index: { byteStart: start, byteEnd: start + byteLen(tagText) },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagText.slice(1) }],
    });
  }
  let from = 0;
  for (const l of links) {
    const i = text.indexOf(l.text, from);
    if (i < 0) continue;
    const start = byteLen(text.slice(0, i));
    facets.push({ index: { byteStart: start, byteEnd: start + byteLen(l.text) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: l.uri }] });
    from = i + l.text.length;
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

/** "Sources:" reply text with short labels and the link targets for facets. */
export function sourcesReply(sources: Source[]): { text: string; links: Array<{ text: string; uri: string }> } {
  const links = sources.slice(0, 4).map((s) => ({ text: s.domain, uri: s.url }));
  return { text: `Sources:\n${links.map((l) => `• ${l.text}`).join('\n')}`, links };
}

// ── publishers ─────────────────────────────────────────────────────────────

export interface PublishInput {
  text: string;
  mediaIds: number[];
  sources: Source[];
  alt?: string;
  /** Mark the media as sensitive where the platform supports it (implied nudity). */
  sensitive?: boolean;
}

export interface PublishResult {
  url?: string;
}

/** Bluesky caps image blobs at about 1 MB; re-encode bigger images as JPEG. */
async function shrinkImage(bytes: Buffer, mime: string, maxBytes: number): Promise<{ bytes: Buffer; mime: string }> {
  if (bytes.length <= maxBytes) return { bytes, mime };
  let sharp: typeof import('sharp');
  try {
    sharp = (await import('sharp')).default;
  } catch {
    throw new Error(`Image is ${(bytes.length / 1e6).toFixed(1)} MB; Bluesky allows 1 MB and image resizing isn't available`);
  }
  for (const [width, quality] of [[2048, 85], [1600, 80], [1280, 75], [1024, 70]] as const) {
    const out = await sharp(bytes).resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= maxBytes) return { bytes: out, mime: 'image/jpeg' };
  }
  throw new Error('Could not shrink the image under 1 MB for Bluesky');
}

async function xrpc<T>(service: string, method: string, init: RequestInit & { token?: string }): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const r = await fetch(`${service}/xrpc/${method}`, { ...init, headers, signal: AbortSignal.timeout(60_000) });
  const body = await r.text();
  if (!r.ok) {
    let msg = body.slice(0, 200);
    try {
      const j = JSON.parse(body) as { error?: string; message?: string };
      msg = [j.error, j.message].filter(Boolean).join(': ') || msg;
    } catch { /* keep raw */ }
    throw new Error(`Bluesky ${method} ${r.status}: ${msg}`);
  }
  return JSON.parse(body) as T;
}

interface BskySession { accessJwt: string; did: string; handle: string }

async function bskyLogin(creds: Record<string, unknown>): Promise<{ service: string; session: BskySession }> {
  const service = String(creds.service || 'https://bsky.social').replace(/\/+$/, '');
  const identifier = String(creds.identifier || '').replace(/^@/, '');
  const password = String(creds.appPassword || '');
  if (!identifier || !password) throw new Error('Bluesky handle and app password are required');
  const session = await xrpc<BskySession>(service, 'com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  return { service, session };
}

async function publishBluesky(creds: Record<string, unknown>, input: PublishInput): Promise<PublishResult> {
  const { service, session } = await bskyLogin(creds);
  const images: Array<{ alt: string; image: unknown }> = [];
  for (const id of input.mediaIds.slice(0, 4)) {
    const m = getMedia(id);
    if (!m || m.type !== 'image') continue;
    const file = await shrinkImage(fs.readFileSync(getMediaPath(m.filename)), m.mime, 950_000);
    const up = await xrpc<{ blob: unknown }>(service, 'com.atproto.repo.uploadBlob', {
      method: 'POST',
      token: session.accessJwt,
      headers: { 'Content-Type': file.mime },
      body: new Uint8Array(file.bytes),
    });
    images.push({ alt: input.alt?.slice(0, 1000) || 'AI-generated image', image: up.blob });
  }
  const text = fitText(input.text, 300);
  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text,
    facets: buildFacets(text),
    createdAt: new Date().toISOString(),
    langs: ['en'],
  };
  if (images.length) record.embed = { $type: 'app.bsky.embed.images', images };
  // "sexual" is Bluesky's self-label for suggestive content; viewers' settings decide whether it shows.
  if (images.length && input.sensitive) record.labels = { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'sexual' }] };
  const post = await xrpc<{ uri: string; cid: string }>(service, 'com.atproto.repo.createRecord', {
    method: 'POST',
    token: session.accessJwt,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
  });
  if (input.sources.length) {
    const reply = sourcesReply(input.sources);
    await xrpc(service, 'com.atproto.repo.createRecord', {
      method: 'POST',
      token: session.accessJwt,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: reply.text,
          facets: buildFacets(reply.text, reply.links),
          createdAt: new Date().toISOString(),
          reply: { root: { uri: post.uri, cid: post.cid }, parent: { uri: post.uri, cid: post.cid } },
        },
      }),
    });
  }
  const rkey = post.uri.split('/').pop();
  return { url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
}

async function mastodon<T>(instance: string, token: string, path: string, init: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(`${instance}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Mastodon ${path} ${r.status}: ${text.slice(0, 200)}`);
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as T };
}

function mastodonCreds(creds: Record<string, unknown>): { instance: string; token: string } {
  const instance = String(creds.instance || '').replace(/\/+$/, '');
  const token = String(creds.accessToken || '');
  if (!/^https?:\/\//.test(instance) || !token) throw new Error('Mastodon instance URL and access token are required');
  return { instance, token };
}

async function publishMastodon(creds: Record<string, unknown>, input: PublishInput): Promise<PublishResult> {
  const { instance, token } = mastodonCreds(creds);
  const mediaIds: string[] = [];
  for (const id of input.mediaIds.slice(0, 4)) {
    const m = getMedia(id);
    if (!m) continue;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(fs.readFileSync(getMediaPath(m.filename)))], { type: m.mime }), m.filename);
    form.append('description', input.alt?.slice(0, 1500) || 'AI-generated media');
    const up = await mastodon<{ id: string; url: string | null }>(instance, token, '/api/v2/media', { method: 'POST', body: form });
    // 202 = still processing (videos); wait until it has a URL.
    for (let i = 0; up.status === 202 && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await mastodon<{ url: string | null }>(instance, token, `/api/v1/media/${up.body.id}`, { method: 'GET' });
      if (s.body.url) break;
    }
    mediaIds.push(up.body.id);
  }
  const sourcesLine = input.sources.length ? `\n\nSources: ${input.sources.slice(0, 3).map((s) => s.url).join(' ')}` : '';
  const status = fitText(input.text, 500 - sourcesLine.length) + sourcesLine;
  const res = await mastodon<{ url: string }>(instance, token, '/api/v1/statuses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `deadchat-${Date.now()}` },
    body: JSON.stringify({ status, media_ids: mediaIds, visibility: 'public', language: 'en', sensitive: !!input.sensitive && mediaIds.length > 0 }),
  });
  return { url: res.body.url };
}

// ── shared: credential persistence and polling ────────────────────────────

/** Lets a publisher store renewed tokens (Meta) or discovered IDs. */
export interface PublishContext {
  saveCredentials?: (creds: Record<string, unknown>) => void;
}

/** Overridable in tests. */
export const timing = {
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

function updateCreds(creds: Record<string, unknown>, patch: Record<string, unknown>, ctx?: PublishContext): void {
  Object.assign(creds, patch);
  ctx?.saveCredentials?.({ ...creds });
}

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

interface MediaItem { id: number; type: string; mime: string; filename: string }

function postMedia(ids: number[], types: string[], max: number): MediaItem[] {
  const out: MediaItem[] = [];
  for (const id of ids) {
    const m = getMedia(id);
    if (m && types.includes(m.type)) out.push({ id: m.id, type: m.type, mime: m.mime, filename: m.filename });
    if (out.length >= max) break;
  }
  return out;
}

// ── Meta: Instagram (Instagram Login) and Threads ──────────────────────────

const IG_API = 'https://graph.instagram.com/v27.0';
const THREADS_API = 'https://graph.threads.net/v1.0';
/** Long-lived Meta tokens last 60 days; renew weekly. */
const META_REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

type MetaKind = 'instagram' | 'threads';
type MetaParams = Record<string, string | number | boolean>;
const META_NAME: Record<MetaKind, string> = { instagram: 'Instagram', threads: 'Threads' };

class MetaError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

async function meta<T = Record<string, unknown>>(
  kind: MetaKind,
  path: string,
  token: string,
  opts: { method?: 'GET' | 'POST'; params?: MetaParams } = {},
): Promise<T> {
  const base = kind === 'instagram' ? IG_API : THREADS_API;
  const params = new URLSearchParams(Object.entries(opts.params ?? {}).map(([k, v]) => [k, String(v)]));
  let url = `${base}${path}`;
  const init: RequestInit = { method: opts.method ?? 'GET', signal: AbortSignal.timeout(120_000) };
  if (kind === 'instagram') {
    init.headers = { Authorization: `Bearer ${token}` };
  } else {
    params.set('access_token', token);
  }
  if (init.method === 'POST') {
    init.body = params;
  } else if ([...params.keys()].length) {
    url += `?${params}`;
  }
  const r = await fetch(url, init);
  const body = await readJson(r);
  const err = body.error as { message?: string; code?: number; error_user_msg?: string } | undefined;
  if (!r.ok || err) {
    if (err?.code === 190) {
      throw new MetaError(`${META_NAME[kind]} access token has expired or was revoked. Generate a new one and save it here.`, 190);
    }
    const msg = err?.error_user_msg || err?.message || String(body.raw ?? r.statusText);
    throw new MetaError(`${META_NAME[kind]} ${path.replace(/\/\d+/g, '/…')} ${r.status}: ${msg}`, err?.code);
  }
  return body as T;
}

/** Return a working token, renewing it about weekly (Meta tokens expire after 60 days unused). */
async function metaToken(kind: MetaKind, creds: Record<string, unknown>, ctx?: PublishContext): Promise<string> {
  const token = String(creds.accessToken || '').trim();
  if (!token) throw new Error(`${META_NAME[kind]} access token is required`);
  const last = Date.parse(String(creds.tokenRefreshedAt || ''));
  if (Number.isFinite(last) && timing.now() - last < META_REFRESH_EVERY_MS) return token;
  const url =
    kind === 'instagram'
      ? `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
      : `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = await readJson(r);
  if (r.ok && typeof body.access_token === 'string') {
    const now = timing.now();
    updateCreds(
      creds,
      {
        accessToken: body.access_token,
        tokenRefreshedAt: new Date(now).toISOString(),
        tokenExpiresAt: new Date(now + Number(body.expires_in || 0) * 1000).toISOString(),
      },
      ctx,
    );
    return body.access_token;
  }
  // Renewal can fail for a token under 24 hours old; keep using it. If it has
  // really expired, the next API call reports that (code 190) clearly.
  return token;
}

async function metaUser(kind: MetaKind, creds: Record<string, unknown>, token: string, ctx?: PublishContext): Promise<{ id: string; username: string }> {
  if (creds.userId && creds.username) return { id: String(creds.userId), username: String(creds.username) };
  const me =
    kind === 'instagram'
      ? await meta<{ user_id?: string; id?: string; username?: string }>(kind, '/me', token, { params: { fields: 'user_id,username' } })
      : await meta<{ id?: string; username?: string }>(kind, '/me', token, { params: { fields: 'id,username' } });
  const id = String((me as { user_id?: string }).user_id || me.id || '');
  if (!id) throw new Error(`${META_NAME[kind]} didn't return an account ID for this token`);
  const username = String(me.username || '');
  updateCreds(creds, { userId: id, username }, ctx);
  return { id, username };
}

/** Poll a media container until Meta has downloaded and processed it. */
async function waitForContainer(kind: MetaKind, containerId: string, token: string, timeoutMs = 5 * 60_000): Promise<void> {
  const field = kind === 'instagram' ? 'status_code,status' : 'status,error_message';
  const deadline = timing.now() + timeoutMs;
  for (;;) {
    const s = await meta<{ status_code?: string; status?: string; error_message?: string }>(kind, `/${containerId}`, token, {
      params: { fields: field },
    });
    const state = (kind === 'instagram' ? s.status_code : s.status) ?? '';
    if (state === 'FINISHED' || state === 'PUBLISHED') return;
    if (state === 'ERROR' || state === 'EXPIRED') {
      const why = kind === 'instagram' ? s.status : s.error_message;
      throw new Error(`${META_NAME[kind]} couldn't process the media${why ? `: ${why}` : ''}`);
    }
    if (timing.now() > deadline) throw new Error(`${META_NAME[kind]} is still processing the media after ${timeoutMs / 60_000} minutes`);
    await timing.sleep(5000);
  }
}

function sourcesLine(sources: Source[], max: number, asUrls: boolean): string {
  const list = sources.slice(0, max).map((s) => (asUrls ? s.url : s.domain));
  return list.length ? `\n\nSources: ${list.join(asUrls ? ' ' : ', ')}` : '';
}

async function publishInstagram(creds: Record<string, unknown>, input: PublishInput, ctx?: PublishContext): Promise<PublishResult> {
  requirePublicUrl('Instagram');
  const token = await metaToken('instagram', creds, ctx);
  const { id: igId } = await metaUser('instagram', creds, token, ctx);
  const items = postMedia(input.mediaIds, ['image', 'video'], 10);
  if (!items.length) throw new Error('Instagram posts need an image or a video');
  // Links in captions aren't clickable on Instagram, so sources are named by domain.
  const extra = sourcesLine(input.sources, 3, false);
  const caption = fitText(input.text, 2200 - extra.length) + extra;
  const url = (m: MediaItem) => signedMediaUrl(m.id, m.mime, m.type === 'image' ? 'ig' : 'orig', 'Instagram');

  let creationId: string;
  if (items.length === 1) {
    const m = items[0];
    const params: MetaParams = m.type === 'image' ? { image_url: url(m), caption } : { media_type: 'REELS', video_url: url(m), caption, share_to_feed: true };
    creationId = (await meta<{ id: string }>('instagram', `/${igId}/media`, token, { method: 'POST', params })).id;
  } else {
    const children: string[] = [];
    for (const m of items) {
      const params: MetaParams =
        m.type === 'image'
          ? { is_carousel_item: true, image_url: url(m) }
          : { is_carousel_item: true, media_type: 'VIDEO', video_url: url(m) };
      const child = (await meta<{ id: string }>('instagram', `/${igId}/media`, token, { method: 'POST', params })).id;
      await waitForContainer('instagram', child, token);
      children.push(child);
    }
    creationId = (
      await meta<{ id: string }>('instagram', `/${igId}/media`, token, {
        method: 'POST',
        params: { media_type: 'CAROUSEL', children: children.join(','), caption },
      })
    ).id;
  }
  await waitForContainer('instagram', creationId, token);
  const post = await meta<{ id: string }>('instagram', `/${igId}/media_publish`, token, { method: 'POST', params: { creation_id: creationId } });
  const info = await meta<{ permalink?: string }>('instagram', `/${post.id}`, token, { params: { fields: 'permalink' } }).catch(() => ({ permalink: undefined }));
  return { url: info.permalink };
}

/** Threads counts each emoji as its UTF-8 byte length toward the 500 limit. */
export function threadsLength(text: string): number {
  let n = 0;
  for (const { segment } of segmenter.segment(text)) n += /\p{Extended_Pictographic}/u.test(segment) ? byteLen(segment) : 1;
  return n;
}

export function fitThreads(text: string, max = 500): string {
  let out = fitText(text, max);
  for (let room = max; threadsLength(out) > max && room > 20; ) {
    room -= threadsLength(out) - max;
    out = fitText(text, room);
  }
  return out;
}

async function publishThreads(creds: Record<string, unknown>, input: PublishInput, ctx?: PublishContext): Promise<PublishResult> {
  const items = postMedia(input.mediaIds, ['image', 'video'], 20);
  if (items.length) requirePublicUrl('Threads');
  const token = await metaToken('threads', creds, ctx);
  const { id: uid } = await metaUser('threads', creds, token, ctx);
  const extra = sourcesLine(input.sources, 2, true);
  const text = threadsLength(extra) < 200 ? fitThreads(input.text, 500 - threadsLength(extra)) + extra : fitThreads(input.text);
  // Threads accepts JPEG and PNG; anything else is converted.
  const url = (m: MediaItem) =>
    signedMediaUrl(m.id, m.mime, m.type === 'image' ? 'jpeg' : 'orig', 'Threads');
  const single = (m: MediaItem, carousel: boolean): MetaParams => ({
    ...(m.type === 'image' ? { media_type: 'IMAGE', image_url: url(m) } : { media_type: 'VIDEO', video_url: url(m) }),
    ...(carousel ? { is_carousel_item: true } : { text }),
  });

  let creationId: string;
  if (items.length === 0) {
    creationId = (await meta<{ id: string }>('threads', `/${uid}/threads`, token, { method: 'POST', params: { media_type: 'TEXT', text } })).id;
  } else if (items.length === 1) {
    creationId = (await meta<{ id: string }>('threads', `/${uid}/threads`, token, { method: 'POST', params: single(items[0], false) })).id;
  } else {
    const children: string[] = [];
    for (const m of items) {
      const child = (await meta<{ id: string }>('threads', `/${uid}/threads`, token, { method: 'POST', params: single(m, true) })).id;
      await waitForContainer('threads', child, token);
      children.push(child);
    }
    creationId = (
      await meta<{ id: string }>('threads', `/${uid}/threads`, token, {
        method: 'POST',
        params: { media_type: 'CAROUSEL', children: children.join(','), text },
      })
    ).id;
  }
  await waitForContainer('threads', creationId, token);
  const post = await meta<{ id: string }>('threads', `/${uid}/threads_publish`, token, { method: 'POST', params: { creation_id: creationId } });
  const info = await meta<{ permalink?: string }>('threads', `/${post.id}`, token, { params: { fields: 'permalink' } }).catch(() => ({ permalink: undefined }));
  return { url: info.permalink };
}

// ── YouTube ────────────────────────────────────────────────────────────────

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];

export function youtubeRedirectUri(): string {
  return `${requirePublicUrl('YouTube sign-in')}/api/oauth/youtube/callback`;
}

function googleClient(creds: Record<string, unknown>): { clientId: string; clientSecret: string } {
  const clientId = String(creds.clientId || '').trim();
  const clientSecret = String(creds.clientSecret || '').trim();
  if (!clientId || !clientSecret) throw new Error('Save the Google OAuth client ID and secret first');
  return { clientId, clientSecret };
}

export function youtubeAuthUrl(creds: Record<string, unknown>, state: string): string {
  const { clientId } = googleClient(creds);
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: youtubeRedirectUri(),
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH}?${q}`;
}

async function googleToken(params: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(GOOGLE_TOKEN, { method: 'POST', body: new URLSearchParams(params), signal: AbortSignal.timeout(30_000) });
  const body = await readJson(r);
  if (!r.ok) {
    if (body.error === 'invalid_grant') {
      throw new Error(
        'Google access expired or was revoked. Click "Connect with Google" again. If the OAuth consent screen is in Testing, set it to In production so access lasts.',
      );
    }
    throw new Error(`Google sign-in ${r.status}: ${String(body.error_description || body.error || body.raw || r.statusText)}`);
  }
  return body;
}

/** Exchange the code from Google's redirect for a refresh token. */
export async function youtubeExchangeCode(creds: Record<string, unknown>, code: string): Promise<string> {
  const { clientId, clientSecret } = googleClient(creds);
  const body = await googleToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: youtubeRedirectUri(),
    grant_type: 'authorization_code',
  });
  const refresh = String(body.refresh_token || '');
  if (!refresh) throw new Error("Google didn't return a refresh token. Remove DeadChat's access in your Google account settings and connect again.");
  return refresh;
}

async function youtubeAccess(creds: Record<string, unknown>): Promise<string> {
  const { clientId, clientSecret } = googleClient(creds);
  const refresh = String(creds.refreshToken || '');
  if (!refresh) throw new Error('Click "Connect with Google" to authorise uploads to the channel');
  const body = await googleToken({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' });
  return String(body.access_token);
}

async function youtubeChannel(token: string): Promise<string> {
  const r = await fetch(`${YT_API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const body = await readJson(r);
  if (!r.ok) throw new Error(`YouTube channels ${r.status}: ${String((body.error as { message?: string })?.message ?? r.statusText)}`);
  const ch = (body.items as Array<{ snippet: { title: string; customUrl?: string } }> | undefined)?.[0];
  if (!ch) throw new Error('This Google account has no YouTube channel. Create one, then connect again.');
  return ch.snippet.customUrl || ch.snippet.title;
}

/** YouTube titles: max 100 characters, no angle brackets. */
export function youtubeTitle(input: Pick<PublishInput, 'text' | 'alt'>): string {
  const firstLine = input.text
    .split('\n')
    .map((l) => l.replace(/https?:\/\/\S+/g, '').replace(/(^|\s)#\S+/g, ' ').trim())
    .find((l) => l.length > 0);
  const raw = (input.alt?.trim() || firstLine || 'AI-generated video').replace(/[<>]/g, '').replace(/\s+/g, ' ');
  return graphemeLength(raw) <= 100 ? raw : fitText(raw, 100);
}

async function publishYouTube(creds: Record<string, unknown>, input: PublishInput): Promise<PublishResult> {
  const [video] = postMedia(input.mediaIds, ['video'], 1);
  if (!video) throw new Error('YouTube needs a video');
  const token = await youtubeAccess(creds);
  const file = fs.readFileSync(getMediaPath(video.filename));
  const sources = input.sources.length ? `\n\nSources:\n${input.sources.slice(0, 5).map((s) => s.url).join('\n')}` : '';
  const description = (fitText(input.text, 5000 - sources.length) + sources).replace(/[<>]/g, '');
  const tags = [...new Set(Array.from(input.text.matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu), (m) => m[1]))].slice(0, 15);
  const init = await fetch(`${YT_UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(file.length),
      'X-Upload-Content-Type': video.mime,
    },
    body: JSON.stringify({
      snippet: { title: youtubeTitle(input), description, tags, categoryId: '22' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const location = init.headers.get('location');
  if (!init.ok || !location) {
    const body = await readJson(init);
    throw new Error(`YouTube upload ${init.status}: ${String((body.error as { message?: string })?.message ?? body.raw ?? init.statusText)}`);
  }
  const up = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': video.mime, 'Content-Length': String(file.length) },
    body: new Uint8Array(file),
    signal: AbortSignal.timeout(30 * 60_000),
  });
  const body = await readJson(up);
  if (!up.ok) throw new Error(`YouTube upload ${up.status}: ${String((body.error as { message?: string })?.message ?? body.raw ?? up.statusText)}`);
  const status = body.status as { uploadStatus?: string; rejectionReason?: string; failureReason?: string } | undefined;
  if (status?.uploadStatus === 'rejected' || status?.uploadStatus === 'failed') {
    throw new Error(`YouTube ${status.uploadStatus} the video: ${status.rejectionReason || status.failureReason || 'no reason given'}`);
  }
  return { url: `https://www.youtube.com/watch?v=${String(body.id)}` };
}

// ── dispatch ───────────────────────────────────────────────────────────────

export async function publish(
  platform: string,
  creds: Record<string, unknown>,
  input: PublishInput,
  ctx?: PublishContext,
): Promise<PublishResult> {
  // Posts drafted before the hashtag was dropped still carry it.
  input = { ...input, text: stripDisclosureTag(input.text) };
  if (platform === 'bluesky') return publishBluesky(creds, input);
  if (platform === 'mastodon') return publishMastodon(creds, input);
  if (platform === 'instagram') return publishInstagram(creds, input, ctx);
  if (platform === 'threads') return publishThreads(creds, input, ctx);
  if (platform === 'youtube') return publishYouTube(creds, input);
  throw new Error(`${platform} is posted manually`);
}

/** Check credentials without posting. Returns the account handle. */
export async function testConnection(platform: string, creds: Record<string, unknown>, ctx?: PublishContext): Promise<string> {
  if (platform === 'bluesky') return (await bskyLogin(creds)).session.handle;
  if (platform === 'mastodon') {
    const { instance, token } = mastodonCreds(creds);
    const r = await mastodon<{ acct: string; bot?: boolean }>(instance, token, '/api/v1/accounts/verify_credentials', { method: 'GET' });
    if (r.body.bot === false) throw new Error('Mark the profile as an automated account ("This is an automated account") first');
    return r.body.acct;
  }
  if (platform === 'instagram' || platform === 'threads') {
    if (platform === 'instagram') requirePublicUrl('Instagram');
    // Re-read the account on every test, in case the token now belongs to another one.
    delete creds.userId;
    delete creds.username;
    const token = await metaToken(platform, creds, ctx);
    const user = await metaUser(platform, creds, token, ctx);
    return `@${user.username || user.id}`;
  }
  if (platform === 'youtube') return youtubeChannel(await youtubeAccess(creds));
  throw new Error(`${platform} has no API connection; it's posted manually`);
}
