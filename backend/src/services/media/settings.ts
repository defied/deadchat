// Admin-controlled media settings, stored in the `settings` table.
// The comfy.org API key is encrypted at rest with SECRETS_KEY.

import db from '../../db/connection';
import { encrypt, decrypt } from '../secrets';

const KEY_API = 'media.comfy_org_api_key';
const KEY_DEFAULT_IMAGE = 'media.default_image_model';
const KEY_DEFAULT_VIDEO = 'media.default_video_model';
const KEY_ENHANCE = 'media.enhance_default';

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

export function getComfyApiKey(): string | null {
  const enc = get(KEY_API);
  if (!enc) return process.env.COMFY_ORG_API_KEY || null;
  try {
    return decrypt(enc);
  } catch {
    return null;
  }
}

export function setComfyApiKey(key: string | null): void {
  put(KEY_API, key ? encrypt(key.trim()) : null);
}

export interface MediaSettings {
  apiKeySet: boolean;
  apiKeyHint: string | null;
  defaultImageModel: string;
  defaultVideoModel: string;
  enhanceByDefault: boolean;
}

export function getMediaSettings(): MediaSettings {
  const key = getComfyApiKey();
  return {
    apiKeySet: !!key,
    apiKeyHint: key ? `…${key.slice(-4)}` : null,
    defaultImageModel: get(KEY_DEFAULT_IMAGE) || 'z-image-turbo',
    defaultVideoModel: get(KEY_DEFAULT_VIDEO) || 'wan22-5b',
    enhanceByDefault: get(KEY_ENHANCE) !== '0',
  };
}

export function updateMediaSettings(patch: {
  apiKey?: string | null;
  defaultImageModel?: string;
  defaultVideoModel?: string;
  enhanceByDefault?: boolean;
}): MediaSettings {
  if (patch.apiKey !== undefined) setComfyApiKey(patch.apiKey);
  if (patch.defaultImageModel) put(KEY_DEFAULT_IMAGE, patch.defaultImageModel);
  if (patch.defaultVideoModel) put(KEY_DEFAULT_VIDEO, patch.defaultVideoModel);
  if (patch.enhanceByDefault !== undefined) put(KEY_ENHANCE, patch.enhanceByDefault ? '1' : '0');
  return getMediaSettings();
}
