export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: 'user' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: number;
  user_id: number;
  title: string;
  agent_source: 'library' | 'user' | null;
  agent_id: number | null;
  agent_name: string | null;
  system_prompt: string | null;
  created_at: string;
}

export interface LibraryAgent {
  id: number;
  name: string;
  description: string;
  system_prompt: string;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface UserAgent {
  id: number;
  user_id: number;
  name: string;
  description: string;
  system_prompt: string;
  source_library_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  session_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments: string | null;
  created_at: string;
}

export interface UsageRecord {
  id: number;
  user_id: number;
  session_id: number | null;
  endpoint: string;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  created_at: string;
}

export interface ModelPricing {
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  currency: string;
  notes: string | null;
  updated_at: string;
}

export interface RefreshToken {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

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
  agent_run_id: number | null;
  external_ref: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export type ProviderKind = 'local_comfyui' | 'generic_http';
export type MediaCapability = 'image' | 'video';

export interface Provider {
  id: number;
  name: string;
  kind: ProviderKind;
  capability: MediaCapability;
  enabled: number;
  is_default: number;
  priority: number;
  base_url: string | null;
  config: string;
  secrets: string | null;
  created_at: string;
  updated_at: string;
}

export type MediaType = 'image' | 'video';

export interface Media {
  id: number;
  user_id: number | null;
  job_id: number | null;
  type: MediaType;
  filename: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  prompt: string | null;
  provider_id: number | null;
  meta: string | null;
  created_at: string;
}

export interface Schedule {
  id: number;
  user_id: number;
  name: string;
  cron: string;
  agent_source: string | null;
  agent_id: number | null;
  goal: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}
