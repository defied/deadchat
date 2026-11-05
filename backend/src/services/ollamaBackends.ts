/**
 * Multiple Ollama backends, chosen per chat.
 *
 * Backends come from OLLAMA_BACKENDS ("gpu-box=http://192.168.0.106:11434,
 * mac=http://192.168.0.29:11434"); without it there is one backend from
 * OLLAMA_URL. The first backend is the primary, and the admin URL override
 * (Admin → backend URL) replaces its URL.
 *
 * A background loop probes every backend's /api/tags, which also caches the
 * models each one has. A backend is unavailable after OLLAMA_FAIL_THRESHOLD
 * failed probes in a row and available again after OLLAMA_RECOVER_THRESHOLD
 * good ones.
 *
 * Code that talks to Ollama keeps calling getOllamaUrl(). Inside
 * runWithBackendUrl() that returns the chosen backend; elsewhere it returns
 * the primary while it is available, otherwise the first available backend.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import db from '../db/connection';
import { config } from '../config';

import {
  applyProbe,
  initialHealth,
  parseBackends,
  pickBackend,
  pickBackendForModel,
  routeModelRequest,
  type BackendCandidate,
  type ModelRoute,
  type BackendDef,
  type BackendHealth,
  type Thresholds,
} from './ollamaBackendsCore';

export * from './ollamaBackendsCore';

// ── Runtime state ───────────────────────────────────────────────────────────

const intervalMs = Math.max(1000, parseInt(process.env.OLLAMA_HEALTH_INTERVAL_MS || '10000'));
const probeTimeoutMs = Math.max(500, parseInt(process.env.OLLAMA_HEALTH_TIMEOUT_MS || '3000'));
const thresholds: Thresholds = {
  failThreshold: Math.max(1, parseInt(process.env.OLLAMA_FAIL_THRESHOLD || '2')),
  recoverThreshold: Math.max(1, parseInt(process.env.OLLAMA_RECOVER_THRESHOLD || '2')),
};

const defs: BackendDef[] = parseBackends(process.env.OLLAMA_BACKENDS, config.ollamaUrl);
const health = new Map<string, BackendHealth>(defs.map((d) => [d.id, initialHealth()]));
const als = new AsyncLocalStorage<string>();
let primaryUrlOverride: () => string | null = () => null;
let timer: NodeJS.Timeout | null = null;

const DEFAULT_MODEL_KEY = (id: string) => `backend_default_model:${id}`;

function urlOf(d: BackendDef, index: number): string {
  return (index === 0 && primaryUrlOverride()) || d.url;
}

function settingValue(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || null;
}

/** Admin-set default model for a backend. The primary falls back to the global active model. */
export function getBackendDefaultModel(id: string): string | null {
  const own = settingValue(DEFAULT_MODEL_KEY(id));
  if (own) return own;
  if (defs[0]?.id === id) return settingValue('active_model') || config.ollamaModel;
  return null;
}

export function setBackendDefaultModel(id: string, model: string | null): void {
  const key = DEFAULT_MODEL_KEY(id);
  if (!model) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return;
  }
  const exists = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (exists) {
    db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(model, key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, model);
  }
}

export function getBackend(id: string | null | undefined): (BackendDef & { primary: boolean }) | null {
  const i = defs.findIndex((d) => d.id === id);
  if (i < 0) return null;
  return { id: defs[i].id, url: urlOf(defs[i], i), primary: i === 0 };
}

export function primaryBackendId(): string {
  return defs[0].id;
}

/** The primary backend's configured URL, before any admin override. */
export function primaryDefaultUrl(): string {
  return defs[0].url;
}

function candidates(): BackendCandidate[] {
  return defs.map((d) => {
    const h = health.get(d.id)!;
    return {
      id: d.id,
      available: h.healthy !== false,
      models: h.models,
      defaultModel: getBackendDefaultModel(d.id),
    };
  });
}

export function listBackends() {
  return defs.map((d, i) => {
    const h = health.get(d.id)!;
    return {
      id: d.id,
      url: urlOf(d, i),
      primary: i === 0,
      available: h.healthy !== false,
      healthy: h.healthy,
      defaultModel: getBackendDefaultModel(d.id),
      models: h.models,
      lastCheckAt: h.lastCheckAt,
      error: h.error,
    };
  });
}

export interface ResolvedBackend {
  id: string;
  url: string;
  model: string;
  switched: boolean;
  requestedId: string;
}

export function resolveChatBackend(requestedId: string | null, requestedModel: string | null): ResolvedBackend {
  const pick = pickBackend(candidates(), getBackend(requestedId) ? requestedId : null, requestedModel);
  const b = getBackend(pick.id)!;
  return {
    id: b.id,
    url: b.url,
    model: pick.model || config.ollamaModel,
    switched: pick.switched,
    requestedId: getBackend(requestedId)?.id ?? defs[0].id,
  };
}

/** URL for a request that names only a model, e.g. the public API. */
export function backendUrlForModel(model: string | null): string {
  return getBackend(pickBackendForModel(candidates(), model))!.url;
}

/**
 * Route a public API request by model. With `allowFallback`, a model no
 * online backend has is replaced by the first online backend's default.
 */
export function routeApiRequest(model: string | null, allowFallback: boolean): ModelRoute & { url: string } {
  const route = routeModelRequest(candidates(), model, allowFallback);
  return { ...route, url: getBackend(route.id)!.url };
}

/** URL used outside a chat: the primary while available, else the first available backend. */
export function defaultBackendUrl(): string {
  // Same rule as pickBackend(…, null, null) without reading default models:
  // backends are in priority order, so the first available one wins.
  const i = defs.findIndex((d) => health.get(d.id)!.healthy !== false);
  const idx = i < 0 ? 0 : i;
  return urlOf(defs[idx], idx);
}

export function runWithBackendUrl<T>(url: string, fn: () => T): T {
  return als.run(url, fn);
}

export function currentBackendUrl(): string | undefined {
  return als.getStore();
}

async function probe(url: string): Promise<{ ok: boolean; models: string[] | null; error: string | null }> {
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(probeTimeoutMs) });
    if (!r.ok) return { ok: false, models: null, error: `HTTP ${r.status}` };
    const data = (await r.json()) as { models?: Array<{ name: string }> };
    return { ok: true, models: (data.models ?? []).map((m) => m.name), error: null };
  } catch (err: any) {
    return { ok: false, models: null, error: err?.name === 'TimeoutError' ? 'timed out' : err?.message || 'unreachable' };
  }
}

async function tick(): Promise<void> {
  await Promise.all(
    defs.map(async (d, i) => {
      const res = await probe(urlOf(d, i));
      const prev = health.get(d.id)!;
      const next = applyProbe(prev, res.ok, res.models, res.error, thresholds, new Date().toISOString());
      health.set(d.id, next);
      if (prev.healthy !== next.healthy) {
        console.warn(
          `[ollama-backends] ${d.id} is now ${next.healthy ? 'available' : `unavailable (${next.error})`}`,
        );
      }
    }),
  );
}

/** Start health probes. `getPrimaryOverride` returns the admin URL override for the first backend, or null. */
export function startBackendMonitor(getPrimaryOverride: () => string | null): void {
  primaryUrlOverride = getPrimaryOverride;
  if (timer) return;
  console.log(
    `[ollama-backends] ${defs.map((d, i) => `${d.id}=${urlOf(d, i)}`).join(', ')}; ` +
      `probe every ${intervalMs}ms, down after ${thresholds.failThreshold}, up after ${thresholds.recoverThreshold}`,
  );
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
}

/** Re-probe now (e.g. after the admin changes the primary URL). */
export function probeBackendsNow(): Promise<void> {
  return tick();
}
