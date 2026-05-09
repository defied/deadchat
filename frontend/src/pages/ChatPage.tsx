import { useState, useEffect, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { Sidebar } from '../components/Sidebar';
import { ChatWindow } from '../components/ChatWindow';
import { ChatInput } from '../components/ChatInput';
import { useChat } from '../hooks/useChat';
import { useWebSocket } from '../hooks/useWebSocket';
import * as chatApi from '../api/chat';
import { getActiveModel, getModelStatus, type ModelStatus } from '../api/ollama';
import type { ChatSession } from '../api/chat';
import { Cpu } from 'lucide-react';

const MODEL_STATUS_POLL_MS = 5_000;

function ModelStatusChip({ status }: { status: ModelStatus | null }) {
  if (!status || status.status === 'unreachable') return null;
  let label: string, color: string, title: string;
  switch (status.status) {
    case 'gpu':
      label = 'GPU';
      color = 'var(--color-success, #22c55e)';
      title = 'Fully loaded in VRAM';
      break;
    case 'partial': {
      const pct = Math.round((status.vramPct ?? 0) * 100);
      label = `GPU+CPU ${pct}%`;
      color = 'var(--color-warning, #f59e0b)';
      title = `${pct}% of model layers in VRAM, rest spilled to CPU — generations will be slower than full-GPU`;
      break;
    }
    case 'cpu':
      label = 'CPU';
      color = 'var(--color-danger, #ef4444)';
      title = 'Model is running entirely on CPU — generations will be much slower';
      break;
    case 'cold':
      label = 'cold';
      color = 'var(--color-text-dim)';
      title = 'Model is not currently loaded; first request will pay a load cost';
      break;
  }
  return (
    <span title={title} style={{
      color, border: `1px solid ${color}`, borderRadius: 3,
      padding: '0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.02em',
      whiteSpace: 'nowrap', marginLeft: 4,
    }}>{label}</span>
  );
}

export function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);

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

  // Poll the active model's offload state so the chip reflects current GPU/CPU
  // split (Ollama can spill to CPU under VRAM pressure between generations).
  useEffect(() => {
    if (!activeModel) {
      setModelStatus(null);
      return;
    }
    let cancelled = false;
    const tick = () => {
      getModelStatus(activeModel)
        .then((s) => { if (!cancelled) setModelStatus(s); })
        .catch(() => { if (!cancelled) setModelStatus(null); });
    };
    tick();
    const id = setInterval(tick, MODEL_STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeModel]);

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
            <ModelStatusChip status={modelStatus} />
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