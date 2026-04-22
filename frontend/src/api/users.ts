import client from './client';
import type { User } from './auth';

export interface CreateUserPayload {
  username: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
}

export interface UpdateUserPayload {
  username?: string;
  email?: string;
  role?: 'user' | 'admin';
}

export interface UserUsage {
  userId: string;
  username: string;
  tokensUsed: number;
  requestCount: number;
  date: string;
}

export interface UsageSummary {
  days: number;
  totalTokens: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalRequests: number;
  totalDurationMs: number;
  estimatedCost: number;
  currency: string;
  dailyUsage: Array<{
    date: string;
    tokens: number;
    tokensIn: number;
    tokensOut: number;
    requests: number;
    estimatedCost: number;
  }>;
  perUser: Array<{
    userId: number;
    username: string;
    tokens: number;
    tokensIn: number;
    tokensOut: number;
    requests: number;
    durationMs: number;
    estimatedCost: number;
  }>;
  perModel: Array<{
    model: string;
    tokens: number;
    tokensIn: number;
    tokensOut: number;
    requests: number;
    durationMs: number;
    estimatedCost: number;
  }>;
}

export interface ModelPricing {
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  currency: string;
  notes: string | null;
  updated_at: string;
}

export async function getUsers(): Promise<User[]> {
  const { data } = await client.get<{ users: User[] }>('/api/users');
  return data.users;
}

export async function createUser(payload: CreateUserPayload): Promise<User> {
  const { data } = await client.post<{ user: User }>('/api/users', payload);
  return data.user;
}

export async function updateUser(id: string, payload: UpdateUserPayload): Promise<User> {
  const { data } = await client.put<{ user: User }>(`/api/users/${id}`, payload);
  return data.user;
}

export async function deleteUser(id: string): Promise<void> {
  await client.delete(`/api/users/${id}`);
}

export async function getUserUsage(id: string): Promise<UserUsage[]> {
  const { data } = await client.get<UserUsage[]>(`/api/users/${id}/usage`);
  return data;
}

export async function getUsageSummary(days: number = 30): Promise<UsageSummary> {
  const { data } = await client.get<UsageSummary>('/api/users/usage/summary', {
    params: { days },
  });
  return data;
}

export async function getModelPricing(): Promise<ModelPricing[]> {
  const { data } = await client.get<{ pricing: ModelPricing[] }>('/api/users/usage/pricing');
  return data.pricing;
}

export async function upsertModelPricing(
  model: string,
  inputPerMtok: number,
  outputPerMtok: number,
  notes: string | null = null,
): Promise<ModelPricing> {
  const { data } = await client.put<{ pricing: ModelPricing }>(
    `/api/users/usage/pricing/${encodeURIComponent(model)}`,
    { inputPerMtok, outputPerMtok, notes },
  );
  return data.pricing;
}

export async function deleteModelPricing(model: string): Promise<void> {
  await client.delete(`/api/users/usage/pricing/${encodeURIComponent(model)}`);
}

export async function resetPassword(id: string, newPassword: string): Promise<void> {
  await client.post(`/api/users/${id}/reset-password`, { password: newPassword });
}
