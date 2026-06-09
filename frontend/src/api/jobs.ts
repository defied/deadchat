import client from './client';

export type JobType = 'image' | 'video' | 'agent';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface Job {
  id: number;
  user_id: number | null;
  type: JobType;
  status: JobStatus;
  priority: number;
  heavy: number;
  provider_id: number | null;
  params: string;
  progress: number;
  result: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface GenerateImageParams {
  prompt: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  model?: string;
}

export interface GenerateVideoParams {
  prompt: string;
  width?: number;
  height?: number;
  num_frames?: number;
  fps?: number;
  model?: string;
}

export async function generateImage(params: GenerateImageParams): Promise<{ job_id: number; status: string }> {
  const { data } = await client.post<{ job_id: number; status: string }>('/api/generate/image', params);
  return data;
}

export async function generateVideo(params: GenerateVideoParams): Promise<{ job_id: number; status: string }> {
  const { data } = await client.post<{ job_id: number; status: string }>('/api/generate/video', params);
  return data;
}

export async function getJob(id: number): Promise<Job> {
  const { data } = await client.get<Job>(`/api/jobs/${id}`);
  return data;
}

export async function listJobs(params?: { status?: JobStatus; limit?: number }): Promise<Job[]> {
  const { data } = await client.get<Job[]>('/api/jobs', { params });
  return data;
}

export async function cancelJob(id: number): Promise<void> {
  await client.delete(`/api/jobs/${id}`);
}

/** Poll until the job reaches a terminal state. Returns the final job. */
export async function pollJob(id: number, intervalMs = 1500): Promise<Job> {
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const job = await getJob(id);
        if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
          resolve(job);
        } else {
          setTimeout(check, intervalMs);
        }
      } catch (e) {
        reject(e);
      }
    };
    check();
  });
}
