// Short-lived signed links to post media, plus signed OAuth state.
//
// Instagram and Threads don't accept uploads: they download each image or
// video from a public URL while creating the post. These links let them do
// that for a few hours without opening the media library to the internet.

import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config';

/**
 * How the file is served:
 * - orig: the file as stored
 * - jpeg: re-encoded as JPEG (Threads accepts JPEG/PNG only)
 * - ig:   JPEG, cropped into Instagram's feed aspect range (4:5 to 1.91:1)
 */
export type MediaVariant = 'orig' | 'jpeg' | 'ig';
export const MEDIA_VARIANTS: MediaVariant[] = ['orig', 'jpeg', 'ig'];

const DEFAULT_TTL_S = 6 * 60 * 60;

function key(): Buffer {
  const k = config.secretsKey || config.jwtSecret;
  return createHmac('sha256', k).update('deadchat-public-media-v1').digest();
}

function mac(payload: string): string {
  return createHmac('sha256', key()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function publicUrlConfigured(): boolean {
  return /^https:\/\//.test(config.publicUrl);
}

export function requirePublicUrl(platform: string): string {
  if (!publicUrlConfigured()) {
    throw new Error(`${platform} downloads media from DeadChat, so PUBLIC_URL must be set to its public https address`);
  }
  return config.publicUrl;
}

function extFor(mime: string, variant: MediaVariant): string {
  if (variant !== 'orig') return '.jpg';
  const sub = mime.split('/')[1]?.split(';')[0] ?? 'bin';
  return `.${sub === 'jpeg' ? 'jpg' : sub === 'quicktime' ? 'mov' : sub}`;
}

/** Absolute, signed, expiring URL for one media item. */
export function signedMediaUrl(
  mediaId: number,
  mime: string,
  variant: MediaVariant,
  platform: string,
  ttlSeconds = DEFAULT_TTL_S,
  now = Date.now(),
): string {
  const base = requirePublicUrl(platform);
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = mac(`${mediaId}.${exp}.${variant}`);
  return `${base}/api/public/media/${mediaId}/${exp}/${variant}/${sig}${extFor(mime, variant)}`;
}

export function verifyMediaSignature(mediaId: number, exp: number, variant: string, sig: string, now = Date.now()): boolean {
  if (!Number.isFinite(mediaId) || !Number.isFinite(exp) || exp * 1000 < now) return false;
  if (!MEDIA_VARIANTS.includes(variant as MediaVariant)) return false;
  return safeEqual(mac(`${mediaId}.${exp}.${variant}`), sig.replace(/\.[a-z0-9]+$/i, ''));
}

// ── OAuth state ────────────────────────────────────────────────────────────

export interface OAuthState {
  influencerId: number;
  userId: number;
  platform: string;
}

export function signState(s: OAuthState, ttlSeconds = 15 * 60, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${mac(`state.${body}`)}`;
}

export function verifyState(token: string, now = Date.now()): OAuthState | null {
  const [body, sig] = String(token).split('.');
  if (!body || !sig || !safeEqual(mac(`state.${body}`), sig)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as OAuthState & { exp: number };
    if (!s.exp || s.exp * 1000 < now) return null;
    return { influencerId: s.influencerId, userId: s.userId, platform: s.platform };
  } catch {
    return null;
  }
}
