// Social platforms: setup guides, credentials, and publishers.
//
// Bluesky and Mastodon publish through their official APIs with credentials
// the user creates. The others need app review, business accounts or public
// media hosting, so they're "manual": DeadChat prepares the post and the user
// publishes it, then marks it as posted.

import fs from 'fs';
import { getMedia, getMediaPath } from '../mediaStore';
import type { Source } from './types';

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
    aiRule: 'No AI label setting exists, so the bio disclosure and #AIgenerated tag on each post carry it.',
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
    mode: 'manual',
    maxText: 2200,
    media: { image: true, video: true, textOnly: false },
    fields: [{ key: 'handle', label: 'Handle', placeholder: '@maya.trails' }],
    checklist: [
      { id: 'account', label: 'Create a separate Instagram account for this persona', required: true },
      { id: 'ai-profile', label: 'Turn on the "AI-generated profile" label in the account settings', required: true },
      { id: 'ai-label', label: 'Use "Add AI label" on every video or reel', required: true },
      ...COMMON,
    ],
    aiRule: 'Profiles featuring an AI-generated person must carry the "AI-generated profile" label or lose reach.',
  },
  {
    id: 'threads',
    name: 'Threads',
    mode: 'manual',
    maxText: 500,
    media: { image: true, video: true, textOnly: true },
    fields: [{ key: 'handle', label: 'Handle', placeholder: '@maya.trails' }],
    checklist: [
      { id: 'ai-profile', label: 'The linked Instagram profile carries the "AI-generated profile" label', required: true },
      ...COMMON,
    ],
    aiRule: "Meta's AI-disclosure rules apply: label photorealistic AI video and audio.",
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
    mode: 'manual',
    maxText: 5000,
    media: { image: false, video: true, textOnly: false },
    fields: [{ key: 'handle', label: 'Channel handle', placeholder: '@mayatrails' }],
    checklist: [
      { id: 'ai-use', label: 'Set "Altered or synthetic content" to Yes on every upload', required: true },
      ...COMMON,
    ],
    aiRule: 'Realistic AI content must be disclosed with the "altered or synthetic content" setting.',
  },
];

export function getPlatform(id: string): PlatformDef | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

export function checklistDone(platform: PlatformDef, checklist: Record<string, boolean>): boolean {
  return platform.checklist.every((c) => !c.required || checklist[c.id]);
}

// ── text helpers (pure) ────────────────────────────────────────────────────

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function graphemeLength(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

/** Shorten to `max` graphemes on a word boundary, keeping the trailing disclosure line. */
export function fitText(text: string, max: number): string {
  if (graphemeLength(text) <= max) return text;
  const lines = text.trimEnd().split('\n');
  const last = lines[lines.length - 1];
  const keepTag = /#AI-?generated/i.test(last) ? last : '';
  const body = keepTag ? lines.slice(0, -1).join('\n').trimEnd() : text;
  const room = max - (keepTag ? graphemeLength(keepTag) + 2 : 0) - 1;
  const chars = Array.from(segmenter.segment(body), (s) => s.segment);
  let cut = chars.slice(0, Math.max(0, room)).join('');
  const sp = cut.lastIndexOf(' ');
  if (sp > room * 0.6) cut = cut.slice(0, sp);
  return `${cut.trimEnd()}…${keepTag ? `\n\n${keepTag}` : ''}`;
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
    body: JSON.stringify({ status, media_ids: mediaIds, visibility: 'public', language: 'en' }),
  });
  return { url: res.body.url };
}

export async function publish(platform: string, creds: Record<string, unknown>, input: PublishInput): Promise<PublishResult> {
  if (platform === 'bluesky') return publishBluesky(creds, input);
  if (platform === 'mastodon') return publishMastodon(creds, input);
  throw new Error(`${platform} is posted manually`);
}

/** Check credentials without posting. Returns the account handle. */
export async function testConnection(platform: string, creds: Record<string, unknown>): Promise<string> {
  if (platform === 'bluesky') return (await bskyLogin(creds)).session.handle;
  if (platform === 'mastodon') {
    const { instance, token } = mastodonCreds(creds);
    const r = await mastodon<{ acct: string; bot?: boolean }>(instance, token, '/api/v1/accounts/verify_credentials', { method: 'GET' });
    if (r.body.bot === false) throw new Error('Mark the profile as an automated account ("This is an automated account") first');
    return r.body.acct;
  }
  throw new Error(`${platform} has no API connection; it's posted manually`);
}
