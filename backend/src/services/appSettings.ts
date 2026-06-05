import db from '../db/connection';
import { config } from '../config';

const OLLAMA_URL_KEY = 'ollama_url';

let cachedUrl: string | null = null;
let cacheLoaded = false;

function loadOllamaUrl(): string {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(OLLAMA_URL_KEY) as { value: string } | undefined;
  return row?.value || config.ollamaUrl;
}

export function getOllamaUrl(): string {
  if (!cacheLoaded) {
    cachedUrl = loadOllamaUrl();
    cacheLoaded = true;
  }
  return cachedUrl!;
}

export function getOllamaUrlOverride(): string | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(OLLAMA_URL_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setOllamaUrl(url: string | null): void {
  if (url === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(OLLAMA_URL_KEY);
  } else {
    const existing = db
      .prepare('SELECT key FROM settings WHERE key = ?')
      .get(OLLAMA_URL_KEY);
    if (existing) {
      db.prepare(
        "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?"
      ).run(url, OLLAMA_URL_KEY);
    } else {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
        OLLAMA_URL_KEY,
        url
      );
    }
  }
  cachedUrl = null;
  cacheLoaded = false;
}
