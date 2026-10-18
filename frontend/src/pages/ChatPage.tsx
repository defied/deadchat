import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Library, MessageSquare, PanelLeft, Wrench } from 'lucide-react';
import * as chatApi from '../api/chat';
import type { Attachment, ChatModel, ChatSession } from '../api/chat';
import * as agentsApi from '../api/agents';
import type { AgentSelection } from '../api/agents';
import wsManager, { type WSStatus } from '../api/ws';
import { useChatSession } from '../hooks/useChatSession';
import { ChatSidebar } from '../components/chat/ChatSidebar';
import { Composer } from '../components/chat/Composer';
import { MessageView, StreamingMessage } from '../components/chat/Message';
import { CapabilityIcons, ModelSelect, ModelStatusChip } from '../components/chat/ModelControls';
import { AgentPicker } from '../components/AgentPicker';
import { Alert, EmptyState, Loading, errorMessage } from '../components/ui';

const SESSIONS_KEY = ['chat-sessions'];

function useWsStatus(): WSStatus {
  const [status, setStatus] = useState<WSStatus>(wsManager.status);
  useEffect(() => wsManager.onStatus(setStatus), []);
  return status;
}

function visionHintFor(model: ChatModel | undefined, all: ChatModel[]): string | null {
  if (!model || model.capabilities.includes('vision')) return null;
  const alt = all.find((m) => m.capabilities.includes('vision'));
  return `${model.name} can't see images${alt ? ` — switch to ${alt.name} for image questions` : ''}.`;
}

export function ChatPage() {
  const params = useParams();
  const sessionId = params.sessionId ? Number(params.sessionId) : null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const wsStatus = useWsStatus();

  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem('dc.chatListCollapsed') === '1');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('dc.chatListCollapsed', listCollapsed ? '1' : '0');
  }, [listCollapsed]);

  const sessionsQ = useQuery({ queryKey: SESSIONS_KEY, queryFn: chatApi.getSessions });
  const modelsQ = useQuery({ queryKey: ['chat-models'], queryFn: chatApi.getChatModels, staleTime: 60_000 });
  const sessions = sessionsQ.data ?? [];
  const models = modelsQ.data?.models ?? [];
  const defaultModel = modelsQ.data?.defaultModel ?? '';
  const session = sessions.find((s) => s.id === sessionId) ?? null;

  const patchSession = (id: number, patch: Partial<ChatSession>) =>
    qc.setQueryData<ChatSession[]>(SESSIONS_KEY, (old) => old?.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const chat = useChatSession(sessionId, {
    onTitle: (id, title) => patchSession(id, { title, updated_at: new Date().toISOString() }),
    onActivity: () => qc.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });

  // First message of a brand-new chat: sent once that chat's (empty) history has loaded.
  const pendingFirst = useRef<{ id: number; content: string; attachments: Attachment[] } | null>(null);
  useEffect(() => {
    const p = pendingFirst.current;
    if (p && p.id === sessionId && chat.readyFor === sessionId) {
      pendingFirst.current = null;
      chat.send(p.content, p.attachments, p.id);
    }
  }, [sessionId, chat.readyFor, chat.send]);

  // Auto-scroll while content grows, unless the user scrolled up to read.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    stickToBottom.current = true;
  }, [sessionId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.stream]);

  const effectiveModelName = session?.model || chat.stream.model || defaultModel;
  const effectiveModel = models.find((m) => m.name === effectiveModelName);

  // ── New-chat state ───────────────────────────────────────────────────────
  const location = useLocation();
  const [newAgent, setNewAgent] = useState<AgentSelection | null>(
    () => (location.state as { agent?: AgentSelection } | null)?.agent ?? null,
  );
  // 'Start chat' on the Agents page navigates here with the agent preselected.
  useEffect(() => {
    const agent = (location.state as { agent?: AgentSelection } | null)?.agent;
    if (agent && sessionId == null) setNewAgent(agent);
  }, [location.state, sessionId]);
  const [newModel, setNewModel] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const agentsQ = useQuery({
    queryKey: ['agents-for-picker'],
    queryFn: async () => {
      const [mine, library] = await Promise.all([agentsApi.getMine(), agentsApi.getLibrary()]);
      return { mine, library };
    },
    enabled: sessionId == null,
    staleTime: 30_000,
  });

  const quickAgents = useMemo(() => {
    const d = agentsQ.data;
    if (!d) return [];
    return [
      ...d.mine.map((a) => ({ sel: { source: 'user' as const, id: a.id, name: a.name }, agentic: !!a.agentic, desc: a.description })),
      ...d.library.map((a) => ({ sel: { source: 'library' as const, id: a.id, name: a.name }, agentic: !!a.agentic, desc: a.description })),
    ].slice(0, 9);
  }, [agentsQ.data]);

  const startNewChat = () => {
    setNewAgent(null);
    setNewModel(null);
    setMobileListOpen(false);
    navigate('/chat');
  };

  const handleFirstSend = async (content: string, attachments: Attachment[]) => {
    setActionError(null);
    try {
      const created = await chatApi.createSession({
        agent: newAgent ? { source: newAgent.source, id: newAgent.id } : null,
        model: newModel,
      });
      qc.setQueryData<ChatSession[]>(SESSIONS_KEY, (old) => [created, ...(old ?? [])]);
      pendingFirst.current = { id: created.id, content, attachments };
      navigate(`/chat/${created.id}`);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not start a chat'));
    }
  };

  const handleRename = async (id: number, title: string) => {
    try {
      const updated = await chatApi.updateSession(id, { title });
      patchSession(id, updated);
    } catch (err) {
      setActionError(errorMessage(err, 'Rename failed'));
    }
  };

  const handleDelete = async (s: ChatSession) => {
    if (!window.confirm(`Delete “${s.title}”? This can't be undone.`)) return;
    try {
      await chatApi.deleteSession(s.id);
      qc.setQueryData<ChatSession[]>(SESSIONS_KEY, (old) => old?.filter((x) => x.id !== s.id));
      if (s.id === sessionId) navigate('/chat');
    } catch (err) {
      setActionError(errorMessage(err, 'Delete failed'));
    }
  };

  const handleModelChange = async (model: string | null) => {
    if (!session) return;
    try {
      const updated = await chatApi.updateSession(session.id, { model });
      patchSession(session.id, updated);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not switch model'));
    }
  };

  const notFound = sessionId != null && (chat.loadError === 'not-found' || (sessionsQ.isSuccess && !session && !pendingFirst.current));

  return (
    <div className="chat-layout">
      <ChatSidebar
        sessions={sessions}
        loading={sessionsQ.isLoading}
        activeId={sessionId}
        onNew={startNewChat}
        onRename={handleRename}
        onDelete={handleDelete}
        onNavigate={() => setMobileListOpen(false)}
        className={`${mobileListOpen ? 'mobile-open' : ''} ${listCollapsed ? 'collapsed' : ''}`}
      />
      <div className={`scrim${mobileListOpen ? ' show' : ''}`} onClick={() => setMobileListOpen(false)} />

      <section className="conversation">
        {wsStatus === 'closed' && <div className="ws-banner">Connection lost — reconnecting…</div>}

        <header className="chat-header">
          <button
            className="icon-btn"
            title={listCollapsed ? 'Show chat list' : 'Hide chat list'}
            onClick={() => {
              if (window.matchMedia('(max-width: 820px)').matches) setMobileListOpen((v) => !v);
              else setListCollapsed((v) => !v);
            }}
          >
            <PanelLeft size={18} />
          </button>
          <div className="chat-title">{session ? session.title : 'New chat'}</div>
          <div className="chat-header-meta">
            {session?.agent_name && (
              <span className="badge badge-accent" title="Agent used in this chat">
                <Bot size={11} /> {session.agent_name}
              </span>
            )}
            {!!session?.agent_agentic && (
              <span className="badge" title="This agent can call tools (generate media, inspect backends)">
                <Wrench size={11} /> tools
              </span>
            )}
            {models.length > 0 && (
              <ModelSelect
                models={models}
                value={session ? session.model : newModel}
                defaultModel={defaultModel}
                onChange={session ? handleModelChange : setNewModel}
                disabled={chat.busy}
              />
            )}
            <CapabilityIcons model={session ? effectiveModel : models.find((m) => m.name === (newModel || defaultModel))} />
            {(session ? effectiveModelName : newModel || defaultModel) && (
              <ModelStatusChip model={session ? effectiveModelName : newModel || defaultModel} />
            )}
          </div>
        </header>

        {actionError && (
          <div style={{ padding: '10px 20px 0' }}>
            <Alert onClose={() => setActionError(null)}>{actionError}</Alert>
          </div>
        )}
        {modelsQ.data && !modelsQ.data.reachable && (
          <div style={{ padding: '10px 20px 0' }}>
            <Alert kind="warn">The Ollama server is unreachable, so replies will fail until it is back.</Alert>
          </div>
        )}

        {sessionId == null ? (
          <div className="chat-hero">
            <div>
              <h1>What are we working on?</h1>
              <div className="chat-hero-sub">
                Pick an agent (optional), then type. The chat is saved as soon as you send.
              </div>
            </div>
            <div className="agent-chips">
              <button className={`agent-chip${newAgent === null ? ' selected' : ''}`} onClick={() => setNewAgent(null)}>
                <MessageSquare size={13} /> No agent
              </button>
              {quickAgents.map((a) => (
                <button
                  key={`${a.sel.source}-${a.sel.id}`}
                  className={`agent-chip${newAgent?.source === a.sel.source && newAgent.id === a.sel.id ? ' selected' : ''}`}
                  onClick={() => setNewAgent(a.sel)}
                  title={a.desc}
                >
                  {a.sel.source === 'library' ? <Library size={13} /> : <Bot size={13} />}
                  {a.sel.name}
                  {a.agentic && <Wrench size={11} />}
                </button>
              ))}
              <button className="agent-chip" onClick={() => setPickerOpen(true)}>
                Browse all…
              </button>
            </div>
            <div className="hero-composer">
              <Composer
                onSend={handleFirstSend}
                autoFocus
                placeholder={newAgent ? `Message ${newAgent.name}…` : 'Message DeadChat…'}
                visionHint={visionHintFor(models.find((m) => m.name === (newModel || defaultModel)), models)}
              />
            </div>
            <div className="composer-hint">
              Manage agents on the <Link to="/agents">Agents</Link> page.
            </div>
          </div>
        ) : notFound ? (
          <div className="chat-hero">
            <EmptyState
              title="Chat not found"
              action={
                <button className="btn btn-primary" onClick={startNewChat}>
                  Start a new chat
                </button>
              }
            >
              It may have been deleted.
            </EmptyState>
          </div>
        ) : (
          <>
            <div
              className="messages"
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              <div className="messages-inner">
                {chat.loading && chat.messages.length === 0 && <Loading label="Loading chat…" />}
                {chat.loadError && chat.loadError !== 'not-found' && <Alert>{chat.loadError}</Alert>}
                {!chat.loading && chat.messages.length === 0 && !chat.stream.active && !pendingFirst.current && (
                  <EmptyState title="No messages yet">Say hello below.</EmptyState>
                )}
                {chat.messages.map((m) => (
                  <MessageView key={m.id} message={m} />
                ))}
                {chat.stream.active && <StreamingMessage stream={chat.stream} />}
                {!chat.stream.active && chat.busy && (
                  <div className="composer-hint" style={{ textAlign: 'center' }}>
                    A reply is still being generated…
                  </div>
                )}
              </div>
            </div>
            <Composer
              key={sessionId}
              onSend={(c, a) => chat.send(c, a)}
              onStop={chat.stop}
              busy={chat.busy}
              autoFocus
              placeholder={session?.agent_name ? `Message ${session.agent_name}…` : 'Message DeadChat…'}
              visionHint={visionHintFor(effectiveModel, models)}
            />
          </>
        )}
      </section>

      {pickerOpen && (
        <AgentPicker
          onPick={(sel) => {
            setNewAgent(sel);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
