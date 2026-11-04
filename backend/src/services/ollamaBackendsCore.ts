/**
 * Pure backend-selection logic for ollamaBackends.ts (no I/O, unit-tested).
 */

export interface BackendDef {
  id: string;
  url: string;
}

export interface BackendHealth {
  /** null until the first probe completes */
  healthy: boolean | null;
  failures: number;
  successes: number;
  models: string[] | null;
  lastCheckAt: string | null;
  error: string | null;
}

export interface Thresholds {
  failThreshold: number;
  recoverThreshold: number;
}

/** What the picker logic needs to know about each backend. */
export interface BackendCandidate {
  id: string;
  available: boolean;
  /** null = unknown (not probed yet / unreachable) */
  models: string[] | null;
  defaultModel: string | null;
}

export interface Pick {
  id: string;
  model: string | null;
  /** true when the requested backend was down and another one was used */
  switched: boolean;
}

export function normaliseUrl(raw: string): string | null {
  const v = raw.trim().replace(/\/+$/, '');
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Parse "id=url,id=url". Entries without an id get backend-N; bad URLs are skipped. */
export function parseBackends(spec: string | undefined, fallbackUrl: string): BackendDef[] {
  const out: BackendDef[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of (spec || '').split(',').entries()) {
    const entry = raw.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    const rawId = eq > 0 ? entry.slice(0, eq).trim() : `backend-${i + 1}`;
    const url = normaliseUrl(eq > 0 ? entry.slice(eq + 1) : entry);
    const id = rawId.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    if (!url || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, url });
  }
  if (out.length === 0) out.push({ id: 'default', url: normaliseUrl(fallbackUrl) || fallbackUrl });
  return out;
}

export function initialHealth(): BackendHealth {
  return { healthy: null, failures: 0, successes: 0, models: null, lastCheckAt: null, error: null };
}

export function applyProbe(
  h: BackendHealth,
  ok: boolean,
  models: string[] | null,
  error: string | null,
  t: Thresholds,
  now: string,
): BackendHealth {
  const n: BackendHealth = {
    ...h,
    lastCheckAt: now,
    failures: ok ? 0 : h.failures + 1,
    successes: ok ? h.successes + 1 : 0,
    error: ok ? null : error,
    models: ok ? models : h.models,
  };
  if (h.healthy === null) {
    // First result decides immediately so a dead backend isn't offered at boot.
    n.healthy = ok;
  } else if (h.healthy && n.failures >= t.failThreshold) {
    n.healthy = false;
  } else if (!h.healthy && n.successes >= t.recoverThreshold) {
    n.healthy = true;
  }
  return n;
}

function hasModel(models: string[] | null, model: string): boolean {
  if (!models) return false;
  return models.includes(model) || models.includes(`${model}:latest`) || models.includes(model.replace(/:latest$/, ''));
}

/** Model to use on a backend: the requested one if it has it, else its default, else its first model. */
export function modelFor(b: BackendCandidate, requestedModel: string | null): string | null {
  if (requestedModel && (b.models === null || hasModel(b.models, requestedModel))) return requestedModel;
  if (b.defaultModel) return b.defaultModel;
  return b.models?.[0] ?? requestedModel;
}

/**
 * Choose a backend for a chat. `requestedId` null (or unknown) means the
 * primary (first) backend. If the requested backend is unavailable and
 * another one is up, the first available one is used instead.
 */
export function pickBackend(
  backends: BackendCandidate[],
  requestedId: string | null,
  requestedModel: string | null,
): Pick {
  const requested = backends.find((b) => b.id === requestedId) ?? backends[0];
  if (requested.available) {
    return { id: requested.id, model: modelFor(requested, requestedModel), switched: false };
  }
  const alt = backends.find((b) => b.available && b.id !== requested.id);
  if (alt) {
    return { id: alt.id, model: modelFor(alt, requestedModel), switched: true };
  }
  // Nothing is up: keep the request where it was so the error names it.
  return { id: requested.id, model: modelFor(requested, requestedModel), switched: false };
}

/** Backend for a request that names only a model (public API): prefer one that has it. */
export function pickBackendForModel(backends: BackendCandidate[], model: string | null): string {
  const up = backends.filter((b) => b.available);
  if (model) {
    const withModel = up.find((b) => hasModel(b.models, model));
    if (withModel) return withModel.id;
  }
  return (up[0] ?? backends[0]).id;
}
