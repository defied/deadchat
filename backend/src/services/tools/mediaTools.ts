import { enqueue, awaitJob } from '../jobQueue';
import { getMedia } from '../mediaStore';
import { MEDIA_MODELS } from '../media/catalog';
import { getMediaSettings } from '../media/settings';
import type { AnthropicTool } from '../../types/anthropic';

export const MEDIA_TOOL_NAMES = ['generate_image', 'generate_video'] as const;

const IMAGE_IDS = MEDIA_MODELS.filter((m) => m.kind === 'image').map((m) => m.id);
const VIDEO_IDS = MEDIA_MODELS.filter((m) => m.kind === 'video').map((m) => m.id);
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

function modelGuide(kind: 'image' | 'video'): string {
  return MEDIA_MODELS.filter((m) => m.kind === kind)
    .map((m) => `${m.id} (${m.backend === 'api' ? 'hosted' : 'local'}${m.needsImage ? ', needs image_media_id' : ''}: ${m.strengths.join(', ')})`)
    .join('; ');
}

export const mediaToolDefs: AnthropicTool[] = [
  {
    name: 'generate_image',
    description:
      'Generate an image and wait for it. The prompt is automatically refined for the chosen model, ' +
      'and with verify=true a vision check compares the result to the request and retries up to twice. ' +
      `Models: ${modelGuide('image')}. Omit model to use the server default. ` +
      'Returns media_id; show it to the user as [media:<id>]. To make a video of it, pass that media_id to generate_video.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to depict. Plain description; it is refined automatically.' },
        model: { type: 'string', enum: IMAGE_IDS, description: 'Model id (optional).' },
        ratio: { type: 'string', enum: RATIOS, description: 'Aspect ratio (default 1:1).' },
        verify: { type: 'boolean', description: 'Vision-check the result and retry on mismatch (slower, more accurate).' },
        draft: { type: 'boolean', description: 'Fast draft quality where the model supports it.' },
        seed: { type: 'number', description: 'Seed for reproducibility.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description:
      'Generate a short video and wait for it (local models take minutes). For the most faithful result, first make ' +
      'a start frame with generate_image and pass its media_id as image_media_id with an image→video model. ' +
      `Models: ${modelGuide('video')}. Omit model for the server default. Returns media_id; show it as [media:<id>].`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The shot: subject, action, camera movement, mood.' },
        model: { type: 'string', enum: VIDEO_IDS, description: 'Model id (optional).' },
        image_media_id: { type: 'number', description: 'media_id of a start image (required for *-i2v models).' },
        duration: { type: 'number', description: 'Seconds (model limits apply; default 5).' },
        ratio: { type: 'string', enum: RATIOS, description: 'Aspect ratio (default 16:9).' },
        draft: { type: 'boolean', description: 'Faster, lower-quality draft where supported.' },
        seed: { type: 'number', description: 'Seed for reproducibility.' },
      },
      required: ['prompt'],
    },
  },
];

interface MediaToolContext {
  userId?: number;
  agentRunId?: number;
}

async function runJob(kind: 'image' | 'video', params: Record<string, unknown>, ctx: MediaToolContext, timeoutMs: number) {
  const jobId = enqueue(kind, params, { userId: ctx.userId, agentRunId: ctx.agentRunId, heavy: true });
  const job = await awaitJob(jobId, timeoutMs);
  if (job.status === 'failed') return { error: job.error ?? `${kind} generation failed`, job_id: jobId };
  if (job.status === 'canceled') return { error: 'Job was canceled', job_id: jobId };
  if (job.status !== 'succeeded') return { error: `Still running after ${Math.round(timeoutMs / 60000)} min`, job_id: jobId };
  const result = job.result ? (JSON.parse(job.result) as Record<string, unknown>) : {};
  const mediaId = (result.media_ids as number[] | undefined)?.[0];
  const media = mediaId ? getMedia(mediaId) : null;
  const meta = (result.meta ?? {}) as Record<string, unknown>;
  return {
    job_id: jobId,
    media_id: mediaId ?? null,
    model: meta.model,
    final_prompt: meta.finalPrompt,
    verdict: meta.verdict ?? undefined,
    url: media ? `/api/media/${media.id}` : null,
  };
}

export async function handleGenerateImage(input: Record<string, unknown>, ctx: MediaToolContext): Promise<Record<string, unknown>> {
  const s = getMediaSettings();
  const model = typeof input.model === 'string' && IMAGE_IDS.includes(input.model) ? input.model : s.defaultImageModel;
  return runJob('image', {
    catalogId: model,
    prompt: input.prompt,
    ratio: input.ratio,
    seed: input.seed,
    fast: !!input.draft,
    enhance: true,
    verifyAttempts: input.verify ? 3 : 1,
  }, ctx, 15 * 60_000);
}

export async function handleGenerateVideo(input: Record<string, unknown>, ctx: MediaToolContext): Promise<Record<string, unknown>> {
  const s = getMediaSettings();
  let model = typeof input.model === 'string' && VIDEO_IDS.includes(input.model) ? input.model : s.defaultVideoModel;
  const imageId = input.image_media_id != null ? Number(input.image_media_id) : undefined;
  const chosen = MEDIA_MODELS.find((m) => m.id === model)!;
  if (chosen.needsImage && !imageId) {
    return { error: `${chosen.label} needs image_media_id. Generate a start image first with generate_image.` };
  }
  // A start image with a text-only model: fall back to the local image-capable default.
  if (imageId && !chosen.needsImage && !chosen.acceptsImage) model = 'wan22-5b';
  return runJob('video', {
    catalogId: model,
    prompt: input.prompt,
    imageMediaId: imageId,
    duration: input.duration,
    ratio: input.ratio ?? '16:9',
    seed: input.seed,
    fast: !!input.draft,
    enhance: true,
  }, ctx, 45 * 60_000);
}
