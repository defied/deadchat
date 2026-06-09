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
      'Generate a short video clip from a text prompt using ComfyUI (LTX-Video distilled). ' +
      'Takes several minutes on a 4090. Returns the media_id of the saved video. ' +
      'Ask the user for clarification on content, length, or style if the request is ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed video generation prompt.' },
        width: { type: 'number', description: 'Width in pixels, divisible by 32 (default 512).' },
        height: { type: 'number', description: 'Height in pixels, divisible by 32 (default 512).' },
        frames: { type: 'number', description: 'Frame count. For LTX-Video default 65, (n-1)%8==0. For Wan 2.1 default 81, (n-1)%4==0.' },
        fps: { type: 'number', description: 'Playback frame rate (default 24).' },
        steps: { type: 'number', description: 'Sampling steps (default 8; 4 = fast, 12 = higher quality).' },
        cfg: { type: 'number', description: 'Guidance scale. LTX-Video distilled: default 1.0, keep 1–3. Wan 2.1: default 5.0, keep 4–7.' },
        seed: { type: 'number', description: 'Random seed for reproducibility. Omit for random.' },
        model: { type: 'string', description: 'UNETLoader checkpoint filename. Use list_models to see options.' },
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

  const job = await awaitJob(jobId, 600_000);

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
