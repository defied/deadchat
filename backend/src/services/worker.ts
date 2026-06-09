// Single-instance job worker. Claims one heavy job at a time, ensuring the
// shared 24 GB GPU is never double-booked between ComfyUI and Ollama.

import { claimNext, updateProgress, setExternalRef, complete, fail, resetStaleRunningJobs } from './jobQueue';
import { saveMedia } from './mediaStore';
import { selectProvider } from './providers/registry';
import { evictModel } from './ollama';
import { freeMemory } from './comfyui';
import { config } from '../config';
import type { Job } from '../types/models';

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
    if (job.type === 'image' || job.type === 'video') {
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
  }
}

async function processMediaJob(
  job: Job,
  params: Record<string, unknown>
): Promise<void> {
  const capability = job.type as 'image' | 'video';

  // Evict the LLM before video jobs to free VRAM for the diffusion model.
  if (capability === 'video') {
    console.log(`[worker] Evicting Ollama model before video job ${job.id}`);
    await evictModel(config.ollamaModel);
    // Also free any lingering ComfyUI memory from prior image jobs
    await freeMemory();
  }

  const provider = await selectProvider(capability);
  console.log(`[worker] Using provider ${provider.id} for job ${job.id}`);

  const extra: Record<string, string> = {};
  if (params.frames) extra.FRAMES = String(params.frames);
  if (params.fps) extra.FPS = String(params.fps);

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
    },
    (p) => updateProgress(job.id, p)
  );

  // Save all output files as media records
  const mediaIds: number[] = [];
  for (const file of result.files) {
    const media = saveMedia({
      userId: job.user_id ?? undefined,
      jobId: job.id,
      type: capability,
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

  // After video, free VRAM so the LLM can reload on next use
  if (capability === 'video') {
    await freeMemory();
  }
}

async function processAgentJob(
  job: Job,
  params: Record<string, unknown>
): Promise<void> {
  // Dynamically import to avoid circular dependency at module load time
  const { runAgentLoop } = await import('./agentLoop');

  const result = await runAgentLoop({
    model: (params.model as string | undefined) ?? config.ollamaModel,
    systemPrompt: (params.systemPrompt as string | undefined) ?? '',
    userGoal: (params.goal as string) ?? '',
    ctx: {
      userId: job.user_id ?? undefined,
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
