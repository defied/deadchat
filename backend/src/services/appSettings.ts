import db from '../db/connection';
import { currentBackendUrl, defaultBackendUrl, probeBackendsNow } from './ollamaBackends';

const OLLAMA_URL_KEY = 'ollama_url';

let cachedOverride: string | null = null;
let cacheLoaded = false;

/** Admin override for the primary backend's URL (cached), or null. */
export function getCachedOllamaUrlOverride(): string | null {
  if (!cacheLoaded) {
    cachedOverride = getOllamaUrlOverride();
    cacheLoaded = true;
  }
  return cachedOverride;
}

/**
 * The Ollama URL for the current request: the chat's backend inside
 * runWithBackendUrl(), otherwise the primary while it is available, else the
 * first available backend.
 */
export function getOllamaUrl(): string {
  return currentBackendUrl() ?? defaultBackendUrl();
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
  cachedOverride = null;
  cacheLoaded = false;
  void probeBackendsNow();
}
