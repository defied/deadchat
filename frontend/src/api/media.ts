import client from './client';

export interface MediaItem {
  id: number;
  user_id: number | null;
  job_id: number | null;
  type: 'image' | 'video';
  filename: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  prompt: string | null;
  provider_id: number | null;
  created_at: string;
}

export async function listMedia(params?: { type?: 'image' | 'video'; limit?: number; offset?: number }): Promise<MediaItem[]> {
  const { data } = await client.get<{ media: MediaItem[] }>('/api/media', { params });
  return data.media;
}

export function getMediaUrl(id: number): string {
  const base = import.meta.env.VITE_API_URL || '';
  return `${base}/api/media/${id}`;
}

/** Fetch media as a blob URL using the axios auth interceptor. Caller must revoke when done. */
export async function fetchMediaBlobUrl(id: number): Promise<string> {
  const resp = await client.get<Blob>(`/api/media/${id}`, { responseType: 'blob' });
  return URL.createObjectURL(resp.data);
}
