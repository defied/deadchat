// Single-instance job worker. Claims one heavy job at a time, ensuring the
// shared 24 GB GPU is never double-booked between ComfyUI and Ollama.

import fs from 'fs';
import { claimNext, updateProgress, setExternalRef, complete, fail, resetStaleRunningJobs } from './jobQueue';
import { saveMedia, getMedia, getMediaPath } from './mediaStore';
import { selectProvider } from './providers/registry';
import { evictAllModels } from './ollama';
import { freeMemory } from './comfyui';
import * as assetPipeline from './assetPipeline';
import { config } from '../config';
import type { Job, JobType, MediaType } from '../types/models';

const POLL_INTERVAL_MS = 1_000;
let running = false;

export function startWorker(): void {
  if (running) return;
  running = true;
  resetStaleRunningJobs();
  console.log('[worker] Started.');
  loop();
}

async function loop(): Promise<void> {
  while (running) {
    try {
      const job = claimNext();
      if (job) {
        if (job.asset_id != null) assetPipeline.onJobStarted(job);
        await processJob(job);
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (e) {
      console.error('[worker] Unexpected error in loop:', e);
      await sleep(POLL_INTERVAL_MS * 5);
    }
  }
}

async function processJob(job: Job): Promise<void> {
  console.log(`[worker] Processing job ${job.id} type=${job.type}`);
  const params = JSON.parse(job.params) as Record<string, unknown>;

  try {
    if (job.type === 'image' || job.type === 'video' || job.type === 'tts') {
      await processMediaJob(job, params);
    } else if (job.type === 'agent') {
      await processAgentJob(job, params);
    } else {
      fail(job.id, `Unknown job type: ${job.type}`);
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[worker] Job ${job.id} failed: ${errMsg}`);
    fail(job.id, errMsg);
    if (job.asset_id != null) assetPipeline.onJobFinished(job.id);
  }
}

// Which capabilities need the Ollama LLM evicted from VRAM before they run.
// Generalized from a video-only hardcoded check now that TTS is a third
// consumer sharing the same GPU.
const EVICT_OLLAMA_BEFORE: JobType[] = ['video', 'tts'];

const MEDIA_TYPE_FOR_CAPABILITY: Record<'image' | 'video' | 'tts', MediaType> = {
  image: 'image',
  video: 'video',
  tts: 'audio',
};

async function processMediaJob(
  job: Job,
  params: Record<string, unknown>
): Promise<void> {
  const capability = job.type as 'image' | 'video' | 'tts';

  if (EVICT_OLLAMA_BEFORE.includes(job.type)) {
    console.log(`[worker] Evicting Ollama model before ${capability} job ${job.id}`);
    await evictAllModels();
  }
  // Free any lingering ComfyUI VRAM before every media job, not just video -
  // previously image jobs left Flux resident indefinitely, which tightens
  // the margin now that TTS also needs headroom on the same card.
  await freeMemory();

  const provider = await selectProvider(capability);
  console.log(`[worker] Using provider ${provider.id} for job ${job.id}`);

  const extra: Record<string, string> = {};
  if (params.frames) extra.FRAMES = String(params.frames);
  if (params.fps) extra.FPS = String(params.fps);
  if (params.language) extra.LANGUAGE = String(params.language);

  let inputFiles: Array<{ field: string; bytes: Buffer; mime: string; filename?: string }> | undefined;
  if (capability === 'tts') {
    const referenceMediaId = params.referenceMediaId as number | undefined;
    if (!referenceMediaId) throw new Error('tts job is missing referenceMediaId');
    const referenceMedia = getMedia(referenceMediaId);
    if (!referenceMedia) throw new Error(`Reference media ${referenceMediaId} not found`);
    const bytes = fs.readFileSync(getMediaPath(referenceMedia.filename));
    inputFiles = [{ field: 'reference_audio', bytes, mime: referenceMedia.mime, filename: referenceMedia.filename }];
  }

  const result = await provider.generate(
    {
      prompt: (params.prompt as string) ?? '',
      seed: params.seed as number | undefined,
      width: params.width as number | undefined,
      height: params.height as number | undefined,
      steps: params.steps as number | undefined,
      cfg: params.cfg as number | undefined,
      model: params.model as string | undefined,
      extra: Object.keys(extra).length ? extra : undefined,
      inputFiles,
    },
    (p) => updateProgress(job.id, p)
  );

  // Save all output files as media records
  const mediaIds: number[] = [];
  for (const file of result.files) {
    const media = saveMedia({
      userId: job.user_id ?? undefined,
      jobId: job.id,
      type: MEDIA_TYPE_FOR_CAPABILITY[capability],
      bytes: file.bytes,
      mime: file.mime,
      originalFilename: file.filename,
      prompt: (params.prompt as string) ?? undefined,
      meta: result.meta,
    });
    mediaIds.push(media.id);
  }

  complete(job.id, { media_ids: mediaIds, meta: result.meta });
  console.log(`[worker] Job ${job.id} succeeded, media_ids=${mediaIds.join(',')}`);
  if (job.asset_id != null) assetPipeline.onJobFinished(job.id);

  // Free VRAM after generation too, so the LLM can reload on next use.
  await freeMemory();
}

async function processAgentJob(
  job: Job,
  params: Record<string, unknown>
): Promise<void> {
  // Dynamically import to avoid circular dependency at module load time
  const { runAgentLoop } = await import('./agentLoop');
  const { getActiveModel } = await import('./chatModels');
  const { default: db } = await import('../db/connection');

  // Scheduled agents act with the permissions of the user who owns the job.
  const owner = job.user_id != null
    ? (db.prepare('SELECT role FROM users WHERE id = ?').get(job.user_id) as { role: string } | undefined)
    : undefined;

  const result = await runAgentLoop({
    model: (params.model as string | undefined) ?? getActiveModel(),
    systemPrompt: (params.systemPrompt as string | undefined) ?? '',
    userGoal: (params.goal as string) ?? '',
    ctx: {
      userId: job.user_id ?? undefined,
      role: owner?.role ?? (job.user_id != null ? 'user' : undefined),
      agentRunId: job.id,
    },
  });

  complete(job.id, {
    finalText: result.finalText,
    steps: result.steps,
    stopReason: result.stopReason,
  });
}

export function stopWorker(): void {
  running = false;
}

// Suppress unused-variable warning for setExternalRef (used by comfyui provider externally)
void setExternalRef;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
