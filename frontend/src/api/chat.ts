import client from './client';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
    type: string;
  }>;
  createdAt: string;
}

export async function getSessions(): Promise<ChatSession[]> {
  const { data } = await client.get<{ sessions: ChatSession[] }>('/api/chat/sessions');
  return data.sessions;
}

export async function createSession(title?: string): Promise<ChatSession> {
  const { data } = await client.post<{ session: ChatSession }>('/api/chat/sessions', {
    title: title || 'New Chat',
  });
  return data.session;
}

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
  const { data } = await client.get<{ messages: ChatMessage[] }>(
    `/api/chat/sessions/${sessionId}/messages`
  );
  return data.messages.map((msg) => {
    let attachments = msg.attachments;
    if (typeof attachments === 'string') {
      try {
        const parsed = JSON.parse(attachments);
        // DB stores as array of URL strings — normalize to objects
        if (Array.isArray(parsed)) {
          attachments = parsed.filter(Boolean).map((item: any, i: number) =>
            typeof item === 'string'
              ? { id: String(i), filename: item.split('/').pop() || 'file', url: item, type: '' }
              : item
          );
        } else {
          attachments = undefined;
        }
      } catch {
        attachments = undefined;
      }
    }
    return { ...msg, attachments: attachments || undefined };
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await client.delete(`/api/chat/sessions/${sessionId}`);
}
