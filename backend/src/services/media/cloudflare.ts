// Cloudflare Workers AI image models — 10,000 free "neurons" per day (00:00 UTC reset).
// https://developers.cloudflare.com/workers-ai/platform/pricing/

import { addCloudflareUsage, getCloudflareCredentials, getCloudflareUsage } from './settings';
import type { MediaModel, MediaParams } from './catalog';
import type { RunOutput } from './runner';

export interface CloudflareSpec {
  /** Workers AI model id, e.g. @cf/black-forest-labs/flux-1-schnell */
  model: string;
  /** FLUX.1 schnell takes JSON; FLUX.2 models take multipart form data. */
  format: 'json' | 'multipart';
  steps: { draft: number; final: number };
  /** Neuron cost estimate (from Cloudflare's published per-tile / per-step rates). */
  neurons(width: number, height: number, steps: number): number;
}

const TILE = 512 * 512;

export const CF_NEURONS = {
  // 4.80 per 512² tile + 9.60 per step (pricing page)
  schnell: (w: number, h: number, steps: number) => Math.ceil((w * h) / TILE) * 4.8 + steps * 9.6,
  // 37.50 per output 512² tile, per step
  flux2dev: (w: number, h: number, steps: number) => Math.ceil((w * h) / TILE) * 37.5 * steps,
  // 1363.64 first MP + 181.82 per extra MP
  klein: (w: number, h: number) => 1363.64 + Math.max(0, (w * h) / 1_048_576 - 1) * 181.82,
};

const SIZE: Record<string, [number, number]> = {
  '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1152, 896], '3:4': [896, 1152], '21:9': [1536, 640],
};

export function cloudflareCost(model: MediaModel, p: Pick<MediaParams, 'ratio' | 'fast'>): number {
  const spec = model.cloudflare!;
  const [w, h] = SIZE[p.ratio] ?? SIZE['1:1'];
  return Math.round(spec.neurons(w, h, p.fast ? spec.steps.draft : spec.steps.final));
}

export async function runCloudflare(model: MediaModel, p: MediaParams): Promise<RunOutput[]> {
  const creds = getCloudflareCredentials();
  if (!creds) throw new Error('Cloudflare is not connected: add your account ID and API token in Admin → Media.');
  const spec = model.cloudflare!;
  const [width, height] = SIZE[p.ratio] ?? SIZE['1:1'];
  const steps = p.fast ? spec.steps.draft : spec.steps.final;
  const cost = cloudflareCost(model, p);
  const left = getCloudflareUsage().remaining;
  if (cost > left) {
    throw new Error(`Not enough free Cloudflare credit left today (~${left} of 10,000 neurons; this image needs ~${cost}). It resets at 00:00 UTC.`);
  }

  const base = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
  const url = `${base}/accounts/${creds.accountId}/ai/run/${spec.model}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${creds.token}` };
  let body: BodyInit;
  if (spec.format === 'json') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ prompt: p.prompt.slice(0, 2048), steps, seed: p.seed });
  } else {
    const form = new FormData();
    form.append('prompt', p.prompt);
    form.append('width', String(width));
    form.append('height', String(height));
    form.append('steps', String(steps));
    form.append('seed', String(p.seed));
    body = form;
  }

  const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(180_000) });
  const type = r.headers.get('content-type') || '';
  if (!r.ok) {
    const text = await r.text();
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { errors?: Array<{ message: string; code?: number }> };
      if (j.errors?.length) msg = j.errors.map((e) => e.message).join('; ');
    } catch {
      /* raw text */
    }
    if (r.status === 429 || /neuron|quota|limit/i.test(msg)) {
      addCloudflareUsage(10_000); // mark today as used up so we stop trying
      throw new Error(`Cloudflare's free daily allowance is used up (${msg}). It resets at 00:00 UTC.`);
    }
    throw new Error(`Cloudflare ${r.status}: ${msg}`);
  }

  let bytes: Buffer;
  let mime = 'image/jpeg';
  if (type.startsWith('image/')) {
    bytes = Buffer.from(await r.arrayBuffer());
    mime = type.split(';')[0];
  } else {
    const j = (await r.json()) as { result?: { image?: string }; image?: string };
    const b64 = j.result?.image ?? j.image;
    if (!b64) throw new Error('Cloudflare returned no image');
    bytes = Buffer.from(b64, 'base64');
    if (bytes.subarray(0, 4).toString('hex') === '89504e47') mime = 'image/png';
  }
  addCloudflareUsage(cost);
  return [{ bytes, mime, filename: `cloudflare.${mime === 'image/png' ? 'png' : 'jpg'}` }];
}
