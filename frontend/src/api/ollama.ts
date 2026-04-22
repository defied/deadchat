import client from './client';

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface RunningModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  expires_at: string;
  size_vram: number;
}

export interface ModelInfo {
  modelfile: string;
  parameters: string;
  template: string;
  details: Record<string, unknown>;
}

export async function getActiveModel(): Promise<string> {
  const { data } = await client.get('/api/ollama/active-model');
  return data.model;
}

export async function setActiveModel(model: string): Promise<void> {
  await client.put('/api/ollama/active-model', { model });
}

export async function listModels(): Promise<OllamaModel[]> {
  const { data } = await client.get('/api/ollama/models');
  return data.models || [];
}

export async function listRunning(): Promise<RunningModel[]> {
  const { data } = await client.get('/api/ollama/running');
  return data.models || [];
}

export async function pullModel(
  name: string,
  onProgress: (line: string) => void
): Promise<void> {
  const response = await fetch(
    `${import.meta.env.VITE_API_URL || ''}/api/ollama/pull`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
      },
      body: JSON.stringify({ name }),
    }
  );

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || 'Pull failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) onProgress(line.trim());
    }
  }
  if (buffer.trim()) onProgress(buffer.trim());
}

export async function deleteModel(name: string): Promise<void> {
  await client.delete(`/api/ollama/models/${encodeURIComponent(name)}`);
}

export async function getModelInfo(name: string): Promise<ModelInfo> {
  const { data } = await client.get(`/api/ollama/model/${encodeURIComponent(name)}`);
  return data;
}

export async function copyModel(source: string, destination: string): Promise<void> {
  await client.post('/api/ollama/copy', { source, destination });
}

export async function createModel(
  name: string,
  modelfile: string,
  onProgress: (line: string) => void
): Promise<void> {
  const response = await fetch(
    `${import.meta.env.VITE_API_URL || ''}/api/ollama/create`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
      },
      body: JSON.stringify({ name, modelfile }),
    }
  );

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || 'Create failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) onProgress(line.trim());
    }
  }
  if (buffer.trim()) onProgress(buffer.trim());
}