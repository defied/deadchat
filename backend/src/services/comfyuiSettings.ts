import db from '../db/connection';
import { config } from '../config';

const KEY = 'comfyui_url';

let cachedUrl: string | null = null;
let cacheLoaded = false;

function loadUrl(): string {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(KEY) as { value: string } | undefined;
  return row?.value || config.comfyuiUrl;
}

export function getComfyuiUrl(): string {
  if (!cacheLoaded) {
    cachedUrl = loadUrl();
    cacheLoaded = true;
  }
  return cachedUrl!;
}

export function getComfyuiUrlOverride(): string | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setComfyuiUrl(url: string | null): void {
  if (url === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(KEY);
  } else {
    const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(KEY);
    if (existing) {
      db.prepare(
        "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?"
      ).run(url, KEY);
    } else {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(KEY, url);
    }
  }
  cachedUrl = null;
  cacheLoaded = false;
}
