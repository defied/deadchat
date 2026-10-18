// Chat model catalog: which Ollama models users may chat with, what each one
// can do (vision / tools / thinking), and which one is the default.

import db from '../db/connection';
import { config } from '../config';
import { getOllamaUrl } from './appSettings';
import { getEnabledModels } from './modelSettings';

export interface ChatModelInfo {
  name: string;
  parameterSize: string | null;
  family: string | null;
  sizeBytes: number;
  modifiedAt: string | null;
  capabilities: string[];
  contextLength: number | null;
}

interface OllamaTag {
  name: string;
  size: number;
  digest: string;
  modified_at?: string;
  details?: { family?: string; parameter_size?: string };
}

interface ShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

// digest -> {capabilities, contextLength}. Digest changes when a model is re-pulled.
const showCache = new Map<string, { capabilities: string[]; contextLength: number | null }>();

export function getActiveModel(): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_model') as
    | { value: string }
    | undefined;
  return row?.value || config.ollamaModel;
}

async function showModel(tag: OllamaTag): Promise<{ capabilities: string[]; contextLength: number | null }> {
  const cached = showCache.get(tag.digest);
  if (cached) return cached;
  try {
    const r = await fetch(`${getOllamaUrl()}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: tag.name }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { capabilities: [], contextLength: null };
    const data = (await r.json()) as ShowResponse;
    let contextLength: number | null = null;
    for (const [k, v] of Object.entries(data.model_info ?? {})) {
      if (k.endsWith('.context_length') && typeof v === 'number') contextLength = v;
    }
    const entry = { capabilities: data.capabilities ?? [], contextLength };
    showCache.set(tag.digest, entry);
    return entry;
  } catch {
    return { capabilities: [], contextLength: null };
  }
}

/**
 * Models offered in the chat model picker. If an admin has enabled specific
 * models in Admin → Models → settings, only those are offered (plus the active
 * default); otherwise every locally installed completion model is offered.
 * Embedding-only models are excluded.
 */
export async function listChatModels(): Promise<{ models: ChatModelInfo[]; defaultModel: string; reachable: boolean }> {
  const defaultModel = getActiveModel();
  let tags: OllamaTag[] = [];
  let reachable = true;
  try {
    const r = await fetch(`${getOllamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { models?: OllamaTag[] };
    tags = data.models ?? [];
  } catch {
    reachable = false;
  }

  const enabled = getEnabledModels();
  if (enabled.length > 0) {
    const allow = new Set([...enabled, defaultModel]);
    tags = tags.filter((t) => allow.has(t.name));
  }

  const infos = await Promise.all(
    tags.map(async (t): Promise<ChatModelInfo> => {
      const show = await showModel(t);
      return {
        name: t.name,
        parameterSize: t.details?.parameter_size ?? null,
        family: t.details?.family ?? null,
        sizeBytes: t.size,
        modifiedAt: t.modified_at ?? null,
        capabilities: show.capabilities,
        contextLength: show.contextLength,
      };
    }),
  );

  const models = infos
    .filter((m) => m.capabilities.length === 0 || m.capabilities.includes('completion'))
    .sort((a, b) => {
      if (a.name === defaultModel) return -1;
      if (b.name === defaultModel) return 1;
      return (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '');
    });

  return { models, defaultModel, reachable };
}

/** Capabilities for one model (cached). Empty array if unknown/unreachable. */
export async function getModelCapabilities(model: string): Promise<string[]> {
  try {
    const r = await fetch(`${getOllamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const data = (await r.json()) as { models?: OllamaTag[] };
    const tag = (data.models ?? []).find((t) => t.name === model || t.name === `${model}:latest`);
    if (!tag) return [];
    return (await showModel(tag)).capabilities;
  } catch {
    return [];
  }
}

/** Is `model` something a user may pick for a chat session? */
export async function isAllowedChatModel(model: string): Promise<boolean> {
  const { models } = await listChatModels();
  return models.some((m) => m.name === model);
}
