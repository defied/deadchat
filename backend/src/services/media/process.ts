// Executes catalog image/video jobs:
//   enhance prompt (LLM) → upload start image → generate on ComfyUI
//   → (images) vision-check the result and retry with a corrected prompt.

import fs from 'fs';
import { updateProgress, setStage, complete } from '../jobQueue';
import { saveMedia, getMedia, getMediaPath } from '../mediaStore';
import { evictAllModels } from '../ollama';
import { freeMemory } from '../comfyui';
import * as assetPipeline from '../assetPipeline';
import { getMediaModel, buildGraph, resolveParams, ratioFromSize, type MediaModel, type Ratio } from './catalog';
import { runCloudflare } from './cloudflare';
import { runGraph, uploadInputImage, type RunOutput } from './runner';
import { enhancePrompt, verifyImage, correctPrompt, type Verdict } from './enhance';
import { getMediaSettings } from './settings';
import type { Job } from '../../types/models';

export interface CatalogJobParams {
  catalogId: string;
  prompt: string;
  negative?: string;
  ratio?: Ratio;
  resolution?: string;
  duration?: number;
  seed?: number;
  fast?: boolean;
  audio?: boolean;
  enhance?: boolean;
  /** total attempts including the first (1 = no verification). Images only. */
  verifyAttempts?: number;
  imageMediaId?: number;
}

/** Map legacy {model,width,height,steps,frames,fps} job params onto the catalog. */
export function normalizeParams(kind: 'image' | 'video', raw: Record<string, unknown>): CatalogJobParams {
  if (typeof raw.catalogId === 'string') return raw as unknown as CatalogJobParams;
  const settings = getMediaSettings();
  const requested = typeof raw.model === 'string' ? getMediaModel(raw.model) : undefined;
  const model = requested && requested.kind === kind
    ? requested
    : getMediaModel(kind === 'image' ? settings.defaultImageModel : settings.defaultVideoModel)!;
  const fps = Number(raw.fps) || 16;
  return {
    catalogId: model.id,
    prompt: String(raw.prompt ?? ''),
    ratio: ratioFromSize(Number(raw.width), Number(raw.height)),
    seed: raw.seed as number | undefined,
    fast: Number(raw.steps) > 0 && Number(raw.steps) <= 8,
    duration: raw.frames ? Number(raw.frames) / fps : undefined,
    enhance: settings.enhanceByDefault,
  };
}

export async function processCatalogJob(job: Job, raw: Record<string, unknown>): Promise<void> {
  const kind = job.type as 'image' | 'video';
  const p = normalizeParams(kind, raw);
  const model = getMediaModel(p.catalogId);
  if (!model) throw new Error(`Unknown model "${p.catalogId}"`);
  if (model.kind !== kind) throw new Error(`${model.label} makes ${model.kind}s, not ${kind}s`);
  if (!p.prompt.trim()) throw new Error('prompt is required');

  const stage = (s: string) => setStage(job.id, s);
  updateProgress(job.id, 0.02);

  // 1. Prompt enhancement (LLM on the GPU box — runs before ComfyUI claims VRAM).
  let prompt = p.prompt.trim();
  let enhanced = false;
  if (p.enhance) {
    stage('Refining the prompt');
    try {
      prompt = await enhancePrompt(p.prompt, model);
      enhanced = prompt !== p.prompt.trim();
    } catch (e) {
      console.warn(`[media] prompt enhancement skipped: ${(e as Error).message}`);
    }
  }

  // 2. Start image.
  let imageName: string | undefined;
  if (p.imageMediaId) {
    const media = getMedia(p.imageMediaId);
    if (!media || media.type !== 'image') throw new Error('Start image not found');
    if (job.user_id != null && media.user_id != null && media.user_id !== job.user_id) throw new Error('Start image not found');
    stage('Uploading start image');
    imageName = await uploadInputImage(fs.readFileSync(getMediaPath(media.filename)), media.mime);
  } else if (model.needsImage) {
    throw new Error(`${model.label} needs a start image`);
  }

  // 3. Generate (+ verify loop for images).
  const attempts = kind === 'image' ? Math.min(3, Math.max(1, p.verifyAttempts ?? 1)) : 1;
  const history: Array<{ prompt: string; seed: number; verdict?: Verdict }> = [];
  let best: { outputs: RunOutput[]; verdict?: Verdict; prompt: string; seed: number } | null = null;

  for (let i = 0; i < attempts; i++) {
    const seed = i === 0 && Number.isFinite(p.seed) ? Number(p.seed) : Math.floor(Math.random() * 2_147_483_647);
    if (model.backend === 'local') {
      // Local models need the whole 24 GB card.
      await evictAllModels();
      await freeMemory();
    }
    stage(
      attempts > 1
        ? `Generating (attempt ${i + 1}/${attempts})`
        : model.backend === 'api'
          ? `Waiting for ${model.vendor}`
          : model.backend === 'cloudflare'
            ? 'Generating on Cloudflare'
            : 'Generating',
    );
    const span = 0.85 / attempts;
    const req = {
      prompt,
      negative: p.negative,
      seed,
      ratio: p.ratio,
      resolution: p.resolution,
      duration: p.duration,
      fast: p.fast,
      audio: p.audio,
      image: imageName,
    };
    const outputs =
      model.backend === 'cloudflare'
        ? await runCloudflare(model, resolveParams(model, req))
        : await runGraph(model, buildGraph(model, req), (x) => updateProgress(job.id, 0.05 + span * i + span * x));
    updateProgress(job.id, 0.05 + span * (i + 1));

    let verdict: Verdict | undefined;
    if (attempts > 1) {
      stage(`Checking the result (${i + 1}/${attempts})`);
      if (model.backend === 'local') await freeMemory(); // let the vision LLM load
      try {
        verdict = await verifyImage(p.prompt, outputs[0].bytes.toString('base64'));
      } catch (e) {
        console.warn(`[media] verification skipped: ${(e as Error).message}`);
      }
    }
    history.push({ prompt, seed, verdict });
    if (!best || (verdict && (!best.verdict || verdict.score > best.verdict.score))) best = { outputs, verdict, prompt, seed };
    if (!verdict || verdict.pass || i === attempts - 1) break;

    stage('Fixing the prompt');
    try {
      prompt = await correctPrompt(p.prompt, prompt, verdict.issues, model);
    } catch {
      /* retry with the same prompt and a new seed */
    }
  }

  // 4. Save.
  stage('Saving');
  const meta = {
    model: model.id,
    modelLabel: model.label,
    backend: model.backend,
    userPrompt: p.prompt,
    finalPrompt: best!.prompt,
    enhanced,
    seed: best!.seed,
    ratio: p.ratio,
    resolution: p.resolution,
    duration: p.duration,
    fast: !!p.fast,
    startImageMediaId: p.imageMediaId ?? null,
    verdict: best!.verdict ?? null,
    attempts: history,
  };
  const mediaIds: number[] = [];
  for (const file of best!.outputs) {
    const media = saveMedia({
      userId: job.user_id ?? undefined,
      jobId: job.id,
      type: file.mime.startsWith('video/') ? 'video' : 'image',
      bytes: file.bytes,
      mime: file.mime,
      originalFilename: file.filename,
      prompt: p.prompt,
      meta,
    });
    mediaIds.push(media.id);
  }
  setStage(job.id, null);
  complete(job.id, { media_ids: mediaIds, meta });
  console.log(`[media] job ${job.id} ${model.id} → media ${mediaIds.join(',')}`);
  if (job.asset_id != null) assetPipeline.onJobFinished(job.id);
}

export function describeModel(m: MediaModel) {
  const { apply: _apply, cloudflare, ...rest } = m;
  void _apply;
  return { ...rest, ...(cloudflare ? { cloudflareModel: cloudflare.model } : {}) };
}
