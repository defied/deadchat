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
  created_at: string;
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
