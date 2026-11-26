// Admin-controlled media settings, stored in the `settings` table.
// API keys/tokens are encrypted at rest with SECRETS_KEY.

import db from '../../db/connection';
import { encrypt, decrypt } from '../secrets';

const KEY_API = 'media.comfy_org_api_key';
const KEY_CF_ACCOUNT = 'media.cloudflare_account_id';
const KEY_CF_TOKEN = 'media.cloudflare_api_token';
const KEY_CF_USAGE = 'media.cloudflare_usage'; // {"day":"YYYY-MM-DD","neurons":n}
const KEY_DEFAULT_IMAGE = 'media.default_image_model';
const KEY_DEFAULT_VIDEO = 'media.default_video_model';
const KEY_ENHANCE = 'media.enhance_default';
const KEY_PEXELS = 'media.pexels_api_key';
const KEY_UNSPLASH = 'media.unsplash_access_key';
const KEY_SHOT_MODEL = 'media.shot_check_model';
const KEY_SCREENPLAY_MODEL = 'media.screenplay_model';

/** Cloudflare's free Workers AI allocation, reset 00:00 UTC. */
export const CLOUDFLARE_FREE_NEURONS = 10_000;

function get(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function put(key: string, value: string | null): void {
  if (value === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return;
  }
  const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
  if (exists) db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(value, key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getSecret(key: string, envFallback?: string): string | null {
  const enc = get(key);
  if (!enc) return (envFallback && process.env[envFallback]) || null;
  try {
    return decrypt(enc);
  } catch {
    return null;
  }
}

function putSecret(key: string, value: string | null): void {
  put(key, value ? encrypt(value.trim()) : null);
}

export function getComfyApiKey(): string | null {
  return getSecret(KEY_API, 'COMFY_ORG_API_KEY');
}

export function setComfyApiKey(key: string | null): void {
  putSecret(KEY_API, key);
}

/** Free photo-library keys for the shot finder (Openverse needs none). */
export function getPhotoKeys(): { pexels: string | null; unsplash: string | null } {
  return { pexels: getSecret(KEY_PEXELS, 'PEXELS_API_KEY'), unsplash: getSecret(KEY_UNSPLASH, 'UNSPLASH_ACCESS_KEY') };
}

/** The cinematography model for the shot finder's framing check, if one is set. */
export function getScreenplayModel(): string | null {
  return get(KEY_SCREENPLAY_MODEL) || process.env.SCREENPLAY_MODEL || null;
}

export function getShotCheckModel(): string | null {
  return get(KEY_SHOT_MODEL) || process.env.SHOT_CHECK_MODEL || null;
}

export function getCloudflareCredentials(): { accountId: string; token: string } | null {
  const accountId = get(KEY_CF_ACCOUNT) || process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const token = getSecret(KEY_CF_TOKEN, 'CLOUDFLARE_API_TOKEN');
  return accountId && token ? { accountId, token } : null;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Estimated Cloudflare neurons used today (UTC). Our own tally — Cloudflare is the source of truth. */
export function getCloudflareUsage(): { day: string; neurons: number; remaining: number } {
  const day = utcDay();
  let neurons = 0;
  try {
    const u = JSON.parse(get(KEY_CF_USAGE) || '{}') as { day?: string; neurons?: number };
    if (u.day === day) neurons = u.neurons ?? 0;
  } catch {
    /* reset */
  }
  return { day, neurons, remaining: Math.max(0, CLOUDFLARE_FREE_NEURONS - neurons) };
}

export function addCloudflareUsage(neurons: number): void {
  const u = getCloudflareUsage();
  put(KEY_CF_USAGE, JSON.stringify({ day: u.day, neurons: Math.round(u.neurons + neurons) }));
}

export interface MediaSettings {
  apiKeySet: boolean;
  apiKeyHint: string | null;
  cloudflareSet: boolean;
  cloudflareAccountId: string | null;
  cloudflareUsage: { day: string; neurons: number; remaining: number };
  defaultImageModel: string;
  defaultVideoModel: string;
  enhanceByDefault: boolean;
  pexelsSet: boolean;
  unsplashSet: boolean;
  /** Ollama model that judges cinematography (shot size, framing, angle), e.g. ShotVL. Empty = off. */
  shotCheckModel: string | null;
  /** Ollama model for the screenplay tools (summaries, searches, photo checks, mentor). Empty = the active chat model. */
  screenplayModel: string | null;
}

export function getMediaSettings(): MediaSettings {
  const key = getComfyApiKey();
  const cf = getCloudflareCredentials();
  return {
    apiKeySet: !!key,
    apiKeyHint: key ? `…${key.slice(-4)}` : null,
    cloudflareSet: !!cf,
    cloudflareAccountId: cf?.accountId ?? (get(KEY_CF_ACCOUNT) || null),
    cloudflareUsage: getCloudflareUsage(),
    defaultImageModel: get(KEY_DEFAULT_IMAGE) || 'z-image-turbo',
    defaultVideoModel: get(KEY_DEFAULT_VIDEO) || 'wan22-5b',
    enhanceByDefault: get(KEY_ENHANCE) !== '0',
    pexelsSet: !!getPhotoKeys().pexels,
    unsplashSet: !!getPhotoKeys().unsplash,
    shotCheckModel: getShotCheckModel(),
    screenplayModel: getScreenplayModel(),
  };
}

export function updateMediaSettings(patch: {
  apiKey?: string | null;
  cloudflareAccountId?: string | null;
  cloudflareToken?: string | null;
  defaultImageModel?: string;
  defaultVideoModel?: string;
  enhanceByDefault?: boolean;
  pexelsKey?: string | null;
  unsplashKey?: string | null;
  shotCheckModel?: string | null;
  screenplayModel?: string | null;
}): MediaSettings {
  if (patch.screenplayModel !== undefined) put(KEY_SCREENPLAY_MODEL, patch.screenplayModel?.trim() || null);
  if (patch.shotCheckModel !== undefined) put(KEY_SHOT_MODEL, patch.shotCheckModel?.trim() || null);
  if (patch.pexelsKey !== undefined) putSecret(KEY_PEXELS, patch.pexelsKey);
  if (patch.unsplashKey !== undefined) putSecret(KEY_UNSPLASH, patch.unsplashKey);
  if (patch.apiKey !== undefined) setComfyApiKey(patch.apiKey);
  if (patch.cloudflareAccountId !== undefined) put(KEY_CF_ACCOUNT, patch.cloudflareAccountId?.trim() || null);
  if (patch.cloudflareToken !== undefined) putSecret(KEY_CF_TOKEN, patch.cloudflareToken);
  if (patch.defaultImageModel) put(KEY_DEFAULT_IMAGE, patch.defaultImageModel);
  if (patch.defaultVideoModel) put(KEY_DEFAULT_VIDEO, patch.defaultVideoModel);
  if (patch.enhanceByDefault !== undefined) put(KEY_ENHANCE, patch.enhanceByDefault ? '1' : '0');
  return getMediaSettings();
}
