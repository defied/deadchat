import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Copy, Edit2, Library as LibraryIcon, MessageSquare, Plus, Trash2, Wrench } from 'lucide-react';
import { AgentEditor, type AgentSaveData } from '../components/AgentEditor';
import * as agentsApi from '../api/agents';
import type { AgentSelection, LibraryAgent, UserAgent } from '../api/agents';
import { Alert, EmptyState, Loading, PageHeader, Section, errorMessage } from '../components/ui';

export function AgentsPage() {
  const navigate = useNavigate();
  const [mine, setMine] = useState<UserAgent[]>([]);
  const [library, setLibrary] = useState<LibraryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<UserAgent | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([agentsApi.getMine(), agentsApi.getLibrary()]);
      setMine(m);
      setLibrary(l);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load agents'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startChat = (agent: AgentSelection) => navigate('/chat', { state: { agent } });

  const handleSave = async (data: AgentSaveData) => {
    if (editingAgent) await agentsApi.updateMine(editingAgent.id, data);
    else await agentsApi.createMine(data);
    setEditorOpen(false);
    setEditingAgent(null);
    await refresh();
  };

  const handleDelete = async (a: UserAgent) => {
    if (!window.confirm(`Delete agent "${a.name}"? Existing chats with it are kept.`)) return;
    try {
      await agentsApi.deleteMine(a.id);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, 'Delete failed'));
    }
  };

  const handleClone = async (l: LibraryAgent) => {
    try {
      await agentsApi.cloneFromLibrary(l.id);
      setNotice(`“${l.name}” copied to My agents — edit it there.`);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, 'Copy failed'));
    }
  };

  return (
    <div className="page">
      <PageHeader
        icon={<Bot size={20} />}
        title="Agents"
        subtitle="An agent is a saved system prompt (optionally with tools). Pick one when you start a chat."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingAgent(null);
              setEditorOpen(true);
            }}
          >
            <Plus size={14} /> New agent
          </button>
        }
      />

      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {notice && (
        <Alert kind="info" onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {loading ? (
        <Loading label="Loading agents…" />
      ) : (
        <>
          <Section title="My agents" hint="Private to your account.">
            {mine.length === 0 ? (
              <EmptyState title="No personal agents yet">
                Create one with <b>New agent</b>, or copy a starter from the library below.
              </EmptyState>
            ) : (
              <div className="card-grid">
                {mine.map((a) => (
                  <AgentCard
                    key={a.id}
                    agent={a}
                    badge={a.source_library_id ? 'from library' : undefined}
                    onChat={() => startChat({ source: 'user', id: a.id, name: a.name })}
                    actions={
                      <>
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={() => {
                            setEditingAgent(a);
                            setEditorOpen(true);
                          }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button className="icon-btn danger" title="Delete" onClick={() => handleDelete(a)}>
                          <Trash2 size={14} />
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </Section>

          <Section
            title={
              <>
                <LibraryIcon size={14} /> Library
              </>
            }
            hint="Shared starters curated by admins. Chat with one directly, or copy it to customize."
          >
            {library.length === 0 ? (
              <EmptyState title="The library is empty" />
            ) : (
              <div className="card-grid">
                {library.map((a) => (
                  <AgentCard
                    key={a.id}
                    agent={a}
                    onChat={() => startChat({ source: 'library', id: a.id, name: a.name })}
                    actions={
                      <button className="icon-btn" title="Copy to My agents" onClick={() => handleClone(a)}>
                        <Copy size={14} />
                      </button>
                    }
                  />
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      {editorOpen && (
        <AgentEditor
          agent={editingAgent}
          onSave={handleSave}
          onCancel={() => {
            setEditorOpen(false);
            setEditingAgent(null);
          }}
        />
      )}
    </div>
  );
}

function AgentCard({
  agent,
  badge,
  actions,
  onChat,
}: {
  agent: { name: string; description: string; system_prompt: string; agentic: number };
  badge?: string;
  actions: React.ReactNode;
  onChat: () => void;
}) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>{agent.name}</span>
          {!!agent.agentic && (
            <span className="badge" title="Can call tools">
              <Wrench size={10} /> tools
            </span>
          )}
          {badge && <span className="badge badge-accent">{badge}</span>}
        </div>
        <div style={{ display: 'flex', gap: 2 }}>{actions}</div>
      </div>
      {agent.description && <div style={{ fontSize: 12.5, color: 'var(--color-text-dim)' }}>{agent.description}</div>}
      <details>
        <summary style={{ fontSize: 11.5, color: 'var(--color-text-dim)', cursor: 'pointer', userSelect: 'none' }}>
          System prompt
        </summary>
        <pre
          style={{
            marginTop: 6,
            padding: 8,
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius)',
            fontSize: 11.5,
            lineHeight: 1.5,
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 240,
            overflowY: 'auto',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {agent.system_prompt}
        </pre>
      </details>
      <div style={{ marginTop: 'auto', paddingTop: 4 }}>
        <button className="btn btn-sm" onClick={onChat}>
          <MessageSquare size={13} /> Start chat
        </button>
      </div>
    </div>
  );
}
