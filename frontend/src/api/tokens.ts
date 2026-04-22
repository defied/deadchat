import client from './client';

export interface ApiToken {
  id: number;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedToken extends ApiToken {
  token: string;
}

export async function listTokens(): Promise<ApiToken[]> {
  const { data } = await client.get<{ tokens: ApiToken[] }>('/api/tokens');
  return data.tokens;
}

export async function createToken(name: string): Promise<CreatedToken> {
  const { data } = await client.post<CreatedToken>('/api/tokens', { name });
  return data;
}

export async function revokeToken(id: number): Promise<void> {
  await client.delete(`/api/tokens/${id}`);
}
