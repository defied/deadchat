// Runs catalog models on ComfyUI: uploads input images, queues the graph
// (with the comfy.org key for hosted API nodes), waits, downloads outputs.

import { randomUUID } from 'crypto';
import { getComfyuiUrl } from '../comfyuiSettings';
import { pollHistory, fetchOutputFile } from '../comfyui';
import { getComfyApiKey, getCloudflareCredentials, getCloudflareUsage } from './settings';
import { cloudflareCost } from './cloudflare';
import { MEDIA_MODELS, type Graph, type MediaModel } from './catalog';

function base(): string {
  return getComfyuiUrl().replace(/\/$/, '');
}

export interface RunOutput {
  bytes: Buffer;
  mime: string;
  filename: string;
}

/** Upload image bytes to ComfyUI's input folder; returns the name LoadImage expects. */
export async function uploadInputImage(bytes: Buffer, mime: string, name = 'deadchat_input.png'): Promise<string> {
  const form = new FormData();
  const ext = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1] || 'png';
  const filename = `deadchat_${randomUUID().slice(0, 8)}.${ext}`;
  form.append('image', new Blob([new Uint8Array(bytes)], { type: mime }), filename || name);
  form.append('overwrite', 'true');
  const r = await fetch(`${base()}/upload/image`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`ComfyUI upload failed (${r.status}): ${await r.text()}`);
  const data = (await r.json()) as { name: string; subfolder?: string };
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

export async function runGraph(
  model: MediaModel,
  graph: Graph,
  onProgress?: (p: number) => void,
): Promise<RunOutput[]> {
  const body: Record<string, unknown> = { prompt: graph, client_id: randomUUID() };
  if (model.backend === 'api') {
    const key = getComfyApiKey();
    if (!key) throw new Error(`${model.label} is a hosted model: add a comfy.org API key in Admin → Media first.`);
    body.extra_data = { api_key_comfy_org: key };
  }
  const r = await fetch(`${base()}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`ComfyUI rejected the ${model.label} workflow (${r.status}): ${summarizeComfyError(text)}`);
  }
  const { prompt_id } = (await r.json()) as { prompt_id: string };
  const timeout = model.kind === 'video' ? 45 * 60_000 : 15 * 60_000;
  const files = await pollHistory(prompt_id, onProgress, timeout);
  const wanted = files.filter((f) => f.type === 'output');
  if (wanted.length === 0) throw new Error(`${model.label} finished without producing a file`);
  return Promise.all(
    wanted.map(async (f) => ({ bytes: await fetchOutputFile(f), mime: f.mime, filename: f.filename })),
  );
}

/** ComfyUI validation errors are verbose JSON; pull out the human part. */
function summarizeComfyError(text: string): string {
  try {
    const d = JSON.parse(text) as {
      error?: { message?: string; details?: string };
      node_errors?: Record<string, { errors?: Array<{ message?: string; details?: string }>; class_type?: string }>;
    };
    const parts: string[] = [];
    if (d.error?.message) parts.push(d.error.message);
    for (const ne of Object.values(d.node_errors ?? {})) {
      for (const e of ne.errors ?? []) parts.push(`${ne.class_type}: ${e.message}${e.details ? ` (${e.details})` : ''}`);
    }
    return parts.join('; ') || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

// ── Availability ─────────────────────────────────────────────────────────────

let cache: { at: number; files: Set<string>; reachable: boolean; apiNodes: boolean } | null = null;
const FOLDERS = ['diffusion_models', 'text_encoders', 'vae', 'loras', 'checkpoints'];

async function snapshot() {
  if (cache && Date.now() - cache.at < 30_000) return cache;
  const files = new Set<string>();
  let reachable = false;
  let apiNodes = false;
  try {
    const results = await Promise.all(
      FOLDERS.map(async (folder) => {
        const res = await fetch(`${base()}/models/${folder}`, { signal: AbortSignal.timeout(5000) });
        return { folder, list: res.ok ? ((await res.json()) as string[]) : [] };
      }),
    );
    reachable = true;
    for (const { folder, list } of results) for (const f of list) files.add(`${folder}/${f.replace(/\\/g, '/')}`);
    const oi = await fetch(`${base()}/object_info/ByteDance2TextToVideoNode`, { signal: AbortSignal.timeout(5000) });
    apiNodes = oi.ok && Object.keys((await oi.json()) as object).length > 0;
  } catch {
    reachable = false;
  }
  cache = { at: Date.now(), files, reachable, apiNodes };
  return cache;
}

export function invalidateAvailability(): void {
  cache = null;
}

export interface ModelAvailability {
  available: boolean;
  reason?: string;
  missingFiles?: string[];
}

export async function availabilityFor(models = MEDIA_MODELS): Promise<Record<string, ModelAvailability>> {
  const snap = await snapshot();
  const hasKey = !!getComfyApiKey();
  const out: Record<string, ModelAvailability> = {};
  for (const m of models) {
    if (m.backend === 'cloudflare') {
      const usage = getCloudflareUsage();
      const need = cloudflareCost(m, { ratio: m.defaults.ratio, fast: m.hasFastMode });
      out[m.id] = !getCloudflareCredentials()
        ? { available: false, reason: 'Needs a free Cloudflare account (Admin → Media)' }
        : usage.remaining < need
          ? { available: false, reason: 'Free Cloudflare allowance used up for today (resets 00:00 UTC)' }
          : { available: true };
      continue;
    }
    if (!snap.reachable) {
      out[m.id] = { available: false, reason: 'ComfyUI is offline' };
    } else if (m.backend === 'api') {
      out[m.id] = !snap.apiNodes
        ? { available: false, reason: 'ComfyUI is too old for this hosted model' }
        : hasKey
          ? { available: true }
          : { available: false, reason: 'Needs a comfy.org API key (Admin → Media)' };
    } else {
      const missing = (m.files ?? []).filter((f) => {
        // text_encoders also resolve from the legacy models/clip folder
        if (snap.files.has(f)) return false;
        if (f.startsWith('text_encoders/') && snap.files.has(f.replace('text_encoders/', 'clip/'))) return false;
        return true;
      });
      out[m.id] = missing.length ? { available: false, reason: 'Model files not installed', missingFiles: missing } : { available: true };
    }
  }
  return out;
}
