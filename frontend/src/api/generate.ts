import client from './client';
import type { MediaItem } from './media';

export type MediaKind = 'image' | 'video';
export type Ratio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9';

export interface CatalogModel {
  id: string;
  label: string;
  vendor: string;
  kind: MediaKind;
  backend: 'local' | 'api' | 'cloudflare';
  needsImage?: boolean;
  acceptsImage?: boolean;
  summary: string;
  strengths: string[];
  ratios: Ratio[];
  resolutions?: string[];
  durations?: { min: number; max: number; default: number };
  hasFastMode?: boolean;
  hasAudio?: boolean;
  speed: string;
  cost?: string;
  defaults: { ratio: Ratio; resolution?: string };
  available: boolean;
  reason?: string;
  missingFiles?: string[];
}

export interface CatalogResponse {
  models: CatalogModel[];
  defaults: { image: string; video: string };
  enhanceByDefault: boolean;
  hostedEnabled: boolean;
  /** null = Cloudflare not connected */
  cloudflare: { remainingNeurons: number; freeNeurons: number } | null;
}

export interface GenerateRequest {
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
  verifyAttempts?: number;
  imageMediaId?: number;
}

export async function getCatalog(): Promise<CatalogResponse> {
  const { data } = await client.get<CatalogResponse>('/api/generate/models');
  return data;
}

export async function startGeneration(req: GenerateRequest): Promise<number> {
  const { data } = await client.post<{ job_id: number }>('/api/generate/jobs', req);
  return data.job_id;
}

export async function uploadStartImage(file: File): Promise<MediaItem> {
  return uploadMedia(file);
}

/** Add an image or video to the gallery (start frames, or results imported from other sites). */
export async function uploadMedia(file: File, opts: { prompt?: string; source?: string } = {}): Promise<MediaItem> {
  const form = new FormData();
  form.append('file', file);
  if (opts.prompt) form.append('prompt', opts.prompt);
  if (opts.source) form.append('source', opts.source);
  const { data } = await client.post<MediaItem>('/api/media/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export interface MediaSettings {
  apiKeySet: boolean;
  apiKeyHint: string | null;
  defaultImageModel: string;
  defaultVideoModel: string;
  enhanceByDefault: boolean;
  cloudflareSet: boolean;
  cloudflareAccountId: string | null;
  cloudflareUsage: { day: string; neurons: number; remaining: number };
}

export async function getMediaSettings(): Promise<MediaSettings> {
  const { data } = await client.get<MediaSettings>('/api/generate/settings');
  return data;
}

export async function updateMediaSettings(
  patch: Partial<Pick<MediaSettings, 'defaultImageModel' | 'defaultVideoModel' | 'enhanceByDefault'>> & {
    apiKey?: string | null;
    cloudflareAccountId?: string | null;
    cloudflareToken?: string | null;
  },
): Promise<MediaSettings> {
  const { data } = await client.put<MediaSettings>('/api/generate/settings', patch);
  return data;
}

/** Metadata the worker stores on generated media (see backend media/process.ts). */
export interface GenerationMeta {
  model?: string;
  modelLabel?: string;
  backend?: 'local' | 'api';
  userPrompt?: string;
  finalPrompt?: string;
  enhanced?: boolean;
  seed?: number;
  verdict?: { score: number; pass: boolean; issues: string[] } | null;
  attempts?: Array<{ prompt: string; seed: number; verdict?: { score: number; issues: string[] } }>;
}

export function parseMeta(raw: unknown): GenerationMeta {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as GenerationMeta;
  try {
    return JSON.parse(String(raw)) as GenerationMeta;
  } catch {
    return {};
  }
}

/** Refine a prompt for a model/site outside DeadChat (free-sites launcher). */
export async function refinePrompt(prompt: string, kind: MediaKind, target: string): Promise<string> {
  const { data } = await client.post<{ prompt: string }>('/api/generate/refine', { prompt, kind, target });
  return data.prompt;
}
