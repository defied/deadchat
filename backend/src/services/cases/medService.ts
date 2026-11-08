// Client for the medical inference service on the GPU box (deploy/gpu-box/med-service).
//
// Contract:
//   GET  /v1/health                 -> { ok, gpu?, models: [{ id, label, ready, error?, license?, modalities? }] }
//   POST /v1/analyze/<model>        multipart: meta (JSON) + frames (JPEG files, in order)
//                                   -> { model, version?, durationS, findings: Finding[], warnings?: string[] }

import fs from 'fs';
import db from '../../db/connection';
import { config } from '../../config';

const KEY = 'med_service_url';

export function medServiceUrl(): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (row?.value) return row.value.replace(/\/$/, '');
  if (process.env.MED_SERVICE_URL) return process.env.MED_SERVICE_URL.replace(/\/$/, '');
  // Default: same host as ComfyUI, port 8790.
  try {
    const u = new URL(config.comfyuiUrl);
    return `${u.protocol}//${u.hostname}:8790`;
  } catch {
    return 'http://127.0.0.1:8790';
  }
}

export function setMedServiceUrl(url: string | null): void {
  if (!url) db.prepare('DELETE FROM settings WHERE key = ?').run(KEY);
  else db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").run(KEY, url);
}

export interface SpecialistModel {
  id: string;
  label: string;
  ready: boolean;
  error?: string;
  license?: string;
  modalities?: string[];
}

export interface Health {
  reachable: boolean;
  url: string;
  gpu?: string;
  models: SpecialistModel[];
  error?: string;
}

export async function health(): Promise<Health> {
  const url = medServiceUrl();
  try {
    const r = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = (await r.json()) as { gpu?: string; models?: SpecialistModel[] };
    return { reachable: true, url, gpu: d.gpu, models: d.models ?? [] };
  } catch (e) {
    return { reachable: false, url, models: [], error: (e as Error).message };
  }
}

export interface Finding {
  label: string;
  value?: string | number | boolean | null;
  unit?: string;
  probability?: number;
  /** Frame range this finding refers to, if the model says. */
  frames?: [number, number];
  note?: string;
}

export interface SpecialistResult {
  model: string;
  version?: string;
  durationS: number;
  findings: Finding[];
  warnings?: string[];
}

export async function analyze(
  model: string,
  meta: Record<string, unknown>,
  framePaths: string[],
  signal?: AbortSignal,
): Promise<SpecialistResult> {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  framePaths.forEach((p, i) => form.append('frames', new Blob([fs.readFileSync(p)], { type: 'image/jpeg' }), `${String(i).padStart(5, '0')}.jpg`));
  const r = await fetch(`${medServiceUrl()}/v1/analyze/${encodeURIComponent(model)}`, {
    method: 'POST',
    body: form,
    signal: signal ?? AbortSignal.timeout(30 * 60_000),
  });
  if (!r.ok) throw new Error(`${model}: ${r.status} ${(await r.text()).slice(0, 400)}`);
  const d = (await r.json()) as SpecialistResult;
  return { model: d.model ?? model, version: d.version, durationS: Number(d.durationS) || 0, findings: Array.isArray(d.findings) ? d.findings : [], warnings: d.warnings };
}
