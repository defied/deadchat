import { enqueue, awaitJob } from '../jobQueue';
import { getMedia } from '../mediaStore';
import type { AnthropicTool } from '../../types/anthropic';

export const MEDIA_TOOL_NAMES = ['generate_image', 'generate_video'] as const;

export const mediaToolDefs: AnthropicTool[] = [
  {
    name: 'generate_image',
    description:
      'Generate an image from a text prompt using ComfyUI. ' +
      'Enqueues a job and waits for completion. Returns the media_id of the saved image. ' +
      'Ask the user for clarification on style, dimensions, or quality if the request is ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed image generation prompt.' },
        width: { type: 'number', description: 'Width in pixels, divisible by 64 (default 1024).' },
        height: { type: 'number', description: 'Height in pixels, divisible by 64 (default 1024).' },
        steps: { type: 'number', description: 'Sampling steps (default 20; 4 = fast draft, 30+ = high quality).' },
        cfg: { type: 'number', description: 'Guidance scale — prompt adherence (default 7.0; range 1–15).' },
        seed: { type: 'number', description: 'Random seed for reproducibility. Omit for random.' },
        model: { type: 'string', description: 'UNETLoader checkpoint filename. Use list_models to see options.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description:
      'Generate a short video clip from a text prompt using ComfyUI (Wan 2.2 14B, full quality). ' +
      'Slow: roughly 9-15 minutes on a 4090 (two 14B expert models, 20 sampling steps). ' +
      'Returns the media_id of the saved video. ' +
      'Ask the user for clarification on content, length, or style if the request is ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed video generation prompt.' },
        width: { type: 'number', description: 'Width in pixels, divisible by 32 (default 512; 640 is the benchmarked/recommended size).' },
        height: { type: 'number', description: 'Height in pixels, divisible by 32 (default 512; 640 is the benchmarked/recommended size).' },
        frames: { type: 'number', description: 'Frame count (default 81). Must satisfy (n-1)%4==0.' },
        fps: { type: 'number', description: 'Playback frame rate (default 16 — Wan 2.2 is natively 16fps).' },
        steps: { type: 'number', description: 'Total sampling steps, split evenly across the high-noise and low-noise expert passes (default 20). Do not go below ~16 without also lowering cfg — this is a full-quality (non-distilled) model.' },
        cfg: { type: 'number', description: 'Guidance scale (default 3.5; keep 3–5).' },
        seed: { type: 'number', description: 'Random seed for reproducibility. Omit for random.' },
        model: { type: 'string', description: 'Low-noise expert UNETLoader checkpoint filename (the matching high-noise expert is derived automatically). Use list_models to see options.' },
      },
      required: ['prompt'],
    },
  },
];

interface MediaToolContext {
  userId?: number;
  agentRunId?: number;
}

export async function handleGenerateImage(
  input: Record<string, unknown>,
  ctx: MediaToolContext
): Promise<Record<string, unknown>> {
  const jobId = enqueue('image', {
    prompt: input.prompt,
    width: input.width,
    height: input.height,
    steps: input.steps,
    cfg: input.cfg,
    seed: input.seed,
    model: input.model,
  }, {
    userId: ctx.userId,
    agentRunId: ctx.agentRunId,
    heavy: true,
  });

  const job = await awaitJob(jobId, 300_000);

  if (job.status === 'failed') {
    return { error: job.error ?? 'Image generation failed', job_id: jobId };
  }
  if (job.status === 'canceled') {
    return { error: 'Job was canceled', job_id: jobId };
  }

  const result = job.result ? JSON.parse(job.result) as Record<string, unknown> : {};
  const mediaId = (result.media_ids as number[] | undefined)?.[0];
  const media = mediaId ? getMedia(mediaId) : null;

  return {
    job_id: jobId,
    media_id: mediaId ?? null,
    filename: media?.filename ?? null,
    url: media ? `/api/media/${media.id}` : null,
    width: media?.width,
    height: media?.height,
  };
}

export async function handleGenerateVideo(
  input: Record<string, unknown>,
  ctx: MediaToolContext
): Promise<Record<string, unknown>> {
  const jobId = enqueue('video', {
    prompt: input.prompt,
    width: input.width ?? 512,
    height: input.height ?? 512,
    frames: input.frames,
    fps: input.fps,
    steps: input.steps,
    cfg: input.cfg,
    seed: input.seed,
    model: input.model,
  }, {
    userId: ctx.userId,
    agentRunId: ctx.agentRunId,
    heavy: true,
  });

  // Full-quality Wan 2.2 14B video generation runs long (~530s+ on an RTX 4090);
  // match localComfyui.ts's ComfyUI-poll timeout so this doesn't cut it off first.
  const job = await awaitJob(jobId, 1_200_000);

  if (job.status === 'failed') {
    return { error: job.error ?? 'Video generation failed', job_id: jobId };
  }
  if (job.status === 'canceled') {
    return { error: 'Job was canceled', job_id: jobId };
  }

  const result = job.result ? JSON.parse(job.result) as Record<string, unknown> : {};
  const mediaId = (result.media_ids as number[] | undefined)?.[0];
  const media = mediaId ? getMedia(mediaId) : null;

  return {
    job_id: jobId,
    media_id: mediaId ?? null,
    filename: media?.filename ?? null,
    url: media ? `/api/media/${media.id}` : null,
    duration_s: media?.duration_s,
  };
}
