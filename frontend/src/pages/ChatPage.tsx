import { useState, useEffect, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { Sidebar } from '../components/Sidebar';
import { ChatWindow } from '../components/ChatWindow';
import { ChatInput } from '../components/ChatInput';
import { useChat } from '../hooks/useChat';
import { useWebSocket } from '../hooks/useWebSocket';
import * as chatApi from '../api/chat';
import { getActiveModel } from '../api/ollama';
import type { ChatSession } from '../api/chat';
import { Cpu } from 'lucide-react';

export function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');

  const {
    messages,
    isStreaming,
    streamingText,
    sendMessage,
    setInitialMessages,
    handleWSMessage,
  } = useChat(activeSessionId);

  const token = localStorage.getItem('accessToken');

  useWebSocket(token, handleWSMessage);

  const loadSessions = useCallback(async () => {
    try {
      const data = await chatApi.getSessions();
      setSessions(data);
      if (data.length > 0 && !activeSessionId) {
        setActiveSessionId(data[0].id);
      }
    } catch {
      // Sessions may not exist yet
    }
  }, [activeSessionId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    getActiveModel().then(setActiveModel).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      chatApi.getMessages(activeSessionId).then(setInitialMessages).catch(() => {});
    } else {
      setInitialMessages([]);
    }
  }, [activeSessionId, setInitialMessages]);

  const handleNewSession = async () => {
    try {
      const session = await chatApi.createSession();
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setInitialMessages([]);
    } catch {
      // Handle error silently
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await chatApi.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch {
      // Handle error silently
    }
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
  };

  const handleSend = (content: string, attachments?: Array<{ id: string; filename: string; url: string; type: string }>) => {
    if (!activeSessionId) {
      chatApi.createSession(content.slice(0, 50)).then((session) => {
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(session.id);
        setTimeout(() => {
          sendMessage(content, attachments);
        }, 100);
      }).catch(() => {});
      return;
    }
    sendMessage(content, attachments);
  };

  return (
    <Layout
      sidebar={
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {activeModel && (
          <div style={{
            padding: '6px 24px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--color-text-dim)',
            background: 'var(--color-surface)',
          }}>
            <Cpu size={12} />
            Model: <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{activeModel}</span>
          </div>
        )}
        <ChatWindow
          messages={messages}
          isStreaming={isStreaming}
          streamingText={streamingText}
        />
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </Layout>
  );
}