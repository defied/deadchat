import client from './client';

export interface ComfyDevice {
  name: string;
  type: string;
  index?: number;
  vram_total?: number;
  vram_free?: number;
  torch_vram_total?: number;
  torch_vram_free?: number;
}

export interface ComfySystem {
  os: string;
  python_version: string;
  embedded_python: boolean;
}

export interface ComfyQueueItem {
  promptId: string;
  number: number;
}

export interface ComfyHistoryEntry {
  promptId: string;
  status: string;
  completed: boolean;
  outputCount: number;
  error?: string;
}

export interface ComfyLiveStats {
  reachable: boolean;
  error?: string;
  system: ComfySystem | null;
  devices: ComfyDevice[];
  queue: {
    running: number;
    pending: number;
    runningItems: ComfyQueueItem[];
    pendingItems: ComfyQueueItem[];
  };
  history: ComfyHistoryEntry[];
}

export interface ComfyModels {
  checkpoints: string[];
  loras: string[];
  vae: string[];
  controlnets: string[];
  upscalers: string[];
  clip: string[];
  unets: string[];
}

export interface BackendUrlInfo {
  url: string;
  default: string;
  isOverride: boolean;
}

export async function getLiveStats(): Promise<ComfyLiveStats> {
  const { data } = await client.get('/api/comfyui/live-stats');
  return data;
}

export async function getModels(): Promise<ComfyModels> {
  const { data } = await client.get('/api/comfyui/models');
  return data;
}

export async function getBackendUrl(): Promise<BackendUrlInfo> {
  const { data } = await client.get('/api/comfyui/backend-url');
  return data;
}

export async function setBackendUrl(url: string | null): Promise<BackendUrlInfo> {
  const { data } = await client.put('/api/comfyui/backend-url', { url });
  return data;
}

export async function freeMemory(unloadModels = true, freeMemory = true): Promise<void> {
  await client.post('/api/comfyui/free', { unload_models: unloadModels, free_memory: freeMemory });
}

export async function interrupt(): Promise<void> {
  await client.post('/api/comfyui/interrupt');
}

export async function clearQueue(promptIds?: string[]): Promise<void> {
  await client.delete('/api/comfyui/queue', promptIds ? { data: { delete: promptIds } } : undefined);
}
