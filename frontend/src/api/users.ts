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
  totalTokens: number;
  totalRequests: number;
  dailyUsage: Array<{
    date: string;
    tokens: number;
    requests: number;
  }>;
  perUser: Array<{
    userId: string;
    username: string;
    tokens: number;
    requests: number;
  }>;
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

export async function getUsageSummary(): Promise<UsageSummary> {
  const { data } = await client.get<UsageSummary>('/api/usage/summary');
  return data;
}

export async function resetPassword(id: string, newPassword: string): Promise<void> {
  await client.post(`/api/users/${id}/reset-password`, { password: newPassword });
}
