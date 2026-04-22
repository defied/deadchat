import client from './client';

export interface GenerateResult {
  id: string;
  type: 'image' | 'video';
  url: string;
  prompt: string;
  createdAt: string;
}

export async function generateImage(prompt: string): Promise<GenerateResult> {
  const { data } = await client.post<GenerateResult>('/api/generate/image', {
    prompt,
  });
  return data;
}

export async function generateVideo(prompt: string): Promise<GenerateResult> {
  const { data } = await client.post<GenerateResult>('/api/generate/video', {
    prompt,
  });
  return data;
}
