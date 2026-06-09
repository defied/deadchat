// ComfyUI HTTP + WebSocket client.
// Submits workflow-template JSON (with %PLACEHOLDER% substitutions), polls
// /history for completion, and fetches output files via /view.

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { getComfyuiUrl } from './comfyuiSettings';

export interface ComfyWorkflowParams {
  prompt: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  model?: string;
  // arbitrary extra replacements
  extra?: Record<string, string>;
}

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string;
  bytes?: Buffer;
  mime: string;
}

export interface ComfyJobResult {
  files: ComfyOutputFile[];
  promptId: string;
}

function getBaseUrl(): string {
  return getComfyuiUrl().replace(/\/$/, '');
}

// Fill %KEY% placeholders in a workflow template.
function fillTemplate(template: string, params: ComfyWorkflowParams): string {
  let out = template;
  out = out.replace(/%PROMPT%/g, params.prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
  out = out.replace(/%SEED%/g, String(params.seed ?? Math.floor(Math.random() * 1e9)));
  out = out.replace(/%WIDTH%/g, String(params.width ?? 1024));
  out = out.replace(/%HEIGHT%/g, String(params.height ?? 1024));
  out = out.replace(/%STEPS%/g, String(params.steps ?? 20));
  out = out.replace(/%CFG%/g, String(params.cfg ?? 7.0));
  if (params.model) out = out.replace(/%MODEL%/g, params.model);
  // Flux separate-loader defaults
  out = out.replace(/%CLIP1%/g, params.extra?.CLIP1 ?? 't5xxl_fp8_e4m3fn.safetensors');
  out = out.replace(/%CLIP2%/g, params.extra?.CLIP2 ?? 'clip_l.safetensors');
  out = out.replace(/%VAE%/g, params.extra?.VAE ?? 'ae.safetensors');
  for (const [k, v] of Object.entries(params.extra ?? {})) {
    out = out.replace(new RegExp(`%${k}%`, 'g'), v);
  }
  return out;
}

function inferMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    gif: 'image/gif',
  };
  return map[ext] ?? 'application/octet-stream';
}

// Submit a workflow and return the prompt_id.
export async function submitWorkflow(
  workflowTemplate: string,
  params: ComfyWorkflowParams,
  clientId?: string
): Promise<string> {
  const filled = fillTemplate(workflowTemplate, params);
  let workflow: Record<string, unknown>;
  try {
    workflow = JSON.parse(filled);
  } catch (e) {
    throw new Error(`Failed to parse filled workflow JSON: ${e}`);
  }

  const body: Record<string, unknown> = { prompt: workflow };
  if (clientId) body.client_id = clientId;

  const res = await fetch(`${getBaseUrl()}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ComfyUI /prompt error (${res.status}): ${text}`);
  }

  const data = await res.json() as { prompt_id: string };
  return data.prompt_id;
}

// Poll /history until the job is complete. Returns output file list.
export async function pollHistory(
  promptId: string,
  onProgress?: (p: number) => void,
  maxWaitMs = 300_000,
  intervalMs = 2_000
): Promise<ComfyOutputFile[]> {
  const deadline = Date.now() + maxWaitMs;
  let lastProgress = 0;

  while (Date.now() < deadline) {
    const res = await fetch(`${getBaseUrl()}/history/${promptId}`);
    if (!res.ok) {
      await sleep(intervalMs);
      continue;
    }

    const data = await res.json() as Record<string, unknown>;
    const entry = data[promptId] as Record<string, unknown> | undefined;

    if (entry?.status) {
      const status = entry.status as Record<string, unknown>;
      const messages = status.messages as Array<[string, Record<string, unknown>]> | undefined;

      // Fail fast: execution_error in messages → don't wait for timeout
      if (messages) {
        for (const [msgType, msgData] of messages) {
          if (msgType === 'execution_error') {
            const detail = (msgData?.exception_message as string) || JSON.stringify(msgData);
            throw new Error(`ComfyUI execution error: ${detail}`);
          }
        }
      }

      // Fail fast on error status_str
      if (status.status_str === 'error') {
        throw new Error('ComfyUI job failed (status_str=error)');
      }

      // ComfyUI sets status.completed = true when done (success or error already handled above)
      if (status.completed === true || status.status_str === 'success') {
        const outputs = entry.outputs as Record<string, Record<string, unknown>> | undefined;
        const files: ComfyOutputFile[] = [];
        if (outputs) {
          for (const nodeOutput of Object.values(outputs)) {
            for (const [key, val] of Object.entries(nodeOutput)) {
              if (!Array.isArray(val)) continue;
              for (const item of val) {
                if (typeof item === 'object' && item !== null && 'filename' in item) {
                  const f = item as { filename: string; subfolder?: string; type?: string };
                  files.push({
                    filename: f.filename,
                    subfolder: f.subfolder ?? '',
                    type: f.type ?? 'output',
                    mime: inferMime(f.filename),
                  });
                }
              }
              void key;
            }
          }
        }
        onProgress?.(1);
        return files;
      }

      // Extract progress from messages
      if (messages) {
        for (const [type, data] of messages) {
          if (type === 'progress' && typeof data?.value === 'number' && typeof data?.max === 'number') {
            const p = data.max > 0 ? data.value / data.max : 0;
            if (p > lastProgress) {
              lastProgress = p;
              onProgress?.(p * 0.95);
            }
          }
        }
      }
    }

    await sleep(intervalMs);
  }

  throw new Error(`ComfyUI job ${promptId} timed out after ${maxWaitMs / 1000}s`);
}

// Fetch the binary content of an output file.
export async function fetchOutputFile(file: ComfyOutputFile): Promise<Buffer> {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder,
    type: file.type,
  });
  const res = await fetch(`${getBaseUrl()}/view?${params}`);
  if (!res.ok) {
    throw new Error(`ComfyUI /view error (${res.status}) for ${file.filename}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// Listen to ComfyUI's WebSocket for real-time progress updates.
// Returns a cleanup function. Useful for long video jobs.
export function watchProgress(
  clientId: string,
  promptId: string,
  onProgress: (p: number) => void,
  onDone: () => void
): () => void {
  const wsUrl = `${getBaseUrl().replace(/^http/, 'ws')}/ws?clientId=${clientId}`;
  const ws = new WebSocket(wsUrl);
  let maxStep = 0;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === 'progress') {
        const d = msg.data as Record<string, number>;
        if (d.max > maxStep) maxStep = d.max;
        if (maxStep > 0) onProgress(d.value / maxStep);
      } else if (msg.type === 'executed') {
        const d = msg.data as Record<string, unknown>;
        if (d.prompt_id === promptId) {
          onDone();
          ws.close();
        }
      }
    } catch {
      // ignore parse errors
    }
  });

  ws.on('error', () => { /* best-effort */ });

  return () => { try { ws.close(); } catch { /* noop */ } };
}

// Probe: returns true if ComfyUI is reachable.
export async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrl()}/system_stats`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Returns installed model names from /object_info.
// Checks UNETLoader (Flux.1 models) first, falls back to CheckpointLoaderSimple.
export async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${getBaseUrl()}/object_info`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;

    function getNames(nodeName: string, inputKey: string): string[] {
      const loader = data[nodeName] as Record<string, unknown> | undefined;
      const req = ((loader?.input as Record<string, unknown>)?.required as Record<string, unknown> | undefined);
      const field = req?.[inputKey] as [string[]] | undefined;
      return field?.[0] ?? [];
    }

    const unets = getNames('UNETLoader', 'unet_name');
    const ckpts = getNames('CheckpointLoaderSimple', 'ckpt_name');
    return [...unets, ...ckpts];
  } catch {
    return [];
  }
}

// Release GPU memory between jobs.
export async function freeMemory(): Promise<void> {
  try {
    await fetch(`${getBaseUrl()}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
  } catch {
    // best-effort
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
