import { enqueue, awaitJob } from '../jobQueue';
import { getMedia } from '../mediaStore';
import type { AnthropicTool } from '../../types/anthropic';

export const MEDIA_TOOL_NAMES = ['generate_image', 'generate_video'] as const;

export const mediaToolDefs: AnthropicTool[] = [
  {
    name: 'generate_image',
    description:
      'Generate an image from a text prompt using ComfyUI. ' +
      'Enqueues a job and waits for completion. Returns the media_id of the saved image.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The image generation prompt.' },
        width: { type: 'number', description: 'Image width in pixels (default 1024).' },
        height: { type: 'number', description: 'Image height in pixels (default 1024).' },
        steps: { type: 'number', description: 'Sampling steps (default 20).' },
        seed: { type: 'number', description: 'Random seed for reproducibility.' },
        model: { type: 'string', description: 'ComfyUI checkpoint name to use.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description:
      'Generate a short video from a text prompt using ComfyUI. ' +
      'Enqueues a job and waits for completion (may take several minutes). ' +
      'Returns the media_id of the saved video.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The video generation prompt.' },
        width: { type: 'number', description: 'Video width in pixels (default 512).' },
        height: { type: 'number', description: 'Video height in pixels (default 512).' },
        steps: { type: 'number', description: 'Sampling steps (default 20).' },
        seed: { type: 'number', description: 'Random seed for reproducibility.' },
        model: { type: 'string', description: 'ComfyUI video checkpoint name to use.' },
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
    steps: input.steps,
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
