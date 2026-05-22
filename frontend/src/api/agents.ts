import client from './client';

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

export type AgentSource = 'library' | 'user';

export interface AgentSelection {
  source: AgentSource;
  id: number;
  name: string;
}

// ─── Library ──────────────────────────────────────────────────────────────

export async function getLibrary(): Promise<LibraryAgent[]> {
  const { data } = await client.get<{ agents: LibraryAgent[] }>('/api/agents/library');
  return data.agents;
}

export async function createLibraryAgent(input: {
  name: string;
  description: string;
  system_prompt: string;
}): Promise<LibraryAgent> {
  const { data } = await client.post<{ agent: LibraryAgent }>('/api/agents/library', input);
  return data.agent;
}

export async function updateLibraryAgent(id: number, input: {
  name: string;
  description: string;
  system_prompt: string;
}): Promise<LibraryAgent> {
  const { data } = await client.put<{ agent: LibraryAgent }>(`/api/agents/library/${id}`, input);
  return data.agent;
}

export async function deleteLibraryAgent(id: number): Promise<void> {
  await client.delete(`/api/agents/library/${id}`);
}

// ─── User's own ───────────────────────────────────────────────────────────

export async function getMine(): Promise<UserAgent[]> {
  const { data } = await client.get<{ agents: UserAgent[] }>('/api/agents/mine');
  return data.agents;
}

export async function createMine(input: {
  name: string;
  description: string;
  system_prompt: string;
  source_library_id?: number | null;
}): Promise<UserAgent> {
  const { data } = await client.post<{ agent: UserAgent }>('/api/agents/mine', input);
  return data.agent;
}

export async function updateMine(id: number, input: {
  name: string;
  description: string;
  system_prompt: string;
}): Promise<UserAgent> {
  const { data } = await client.put<{ agent: UserAgent }>(`/api/agents/mine/${id}`, input);
  return data.agent;
}

export async function deleteMine(id: number): Promise<void> {
  await client.delete(`/api/agents/mine/${id}`);
}

export async function cloneFromLibrary(libraryId: number): Promise<UserAgent> {
  const { data } = await client.post<{ agent: UserAgent }>(`/api/agents/mine/clone-library/${libraryId}`);
  return data.agent;
}
