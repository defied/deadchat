import client from './client';

export interface ChatSession {
  id: number;
  title: string;
  created_at: string;
  updated_at: string | null;
  /** Per-chat model override; null = server default. */
  model: string | null;
  message_count?: number;
  // Agent snapshot — present only when the session was created with one.
  agent_source?: 'library' | 'user' | null;
  agent_id?: number | null;
  agent_name?: string | null;
  agent_agentic?: number;
}

export interface Attachment {
  id: string;
  filename: string;
  url: string;
  type: string;
  size?: number;
}

export interface ChatMessage {
  id: number | string;
  session_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string | null;
  attachments?: Attachment[];
  created_at: string;
  /** Client-only: message failed / is an error notice, not persisted. */
  local?: 'error' | 'pending';
}

export interface ChatModel {
  name: string;
  parameterSize: string | null;
  family: string | null;
  sizeBytes: number;
  modifiedAt: string | null;
  capabilities: string[];
  contextLength: number | null;
}

export interface ChatModelsResponse {
  models: ChatModel[];
  defaultModel: string;
  reachable: boolean;
}

export async function getChatModels(): Promise<ChatModelsResponse> {
  const { data } = await client.get<ChatModelsResponse>('/api/chat/models');
  return data;
}

export async function getSessions(): Promise<ChatSession[]> {
  const { data } = await client.get<{ sessions: ChatSession[] }>('/api/chat/sessions');
  return data.sessions;
}

export async function createSession(input: {
  title?: string;
  agent?: { source: 'library' | 'user'; id: number } | null;
  model?: string | null;
} = {}): Promise<ChatSession> {
  const body: Record<string, unknown> = {};
  if (input.title) body.title = input.title;
  if (input.agent) {
    body.agentSource = input.agent.source;
    body.agentId = input.agent.id;
  }
  if (input.model) body.model = input.model;
  const { data } = await client.post<{ session: ChatSession }>('/api/chat/sessions', body);
  return data.session;
}

export async function updateSession(
  id: number,
  patch: { title?: string; model?: string | null },
): Promise<ChatSession> {
  const { data } = await client.patch<{ session: ChatSession }>(`/api/chat/sessions/${id}`, patch);
  return data.session;
}

export async function getMessages(sessionId: number): Promise<{ messages: ChatMessage[]; generating: boolean }> {
  const { data } = await client.get<{ messages: ChatMessage[]; generating?: boolean }>(
    `/api/chat/sessions/${sessionId}/messages`
  );
  return { messages: data.messages, generating: !!data.generating };
}

export async function deleteSession(sessionId: number): Promise<void> {
  await client.delete(`/api/chat/sessions/${sessionId}`);
}

export async function uploadAttachment(file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await client.post<{ attachment: Attachment }>('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.attachment;
}

export function isImageAttachment(a: Attachment): boolean {
  return a.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(a.id);
}
