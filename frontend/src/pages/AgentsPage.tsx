import { useCallback, useEffect, useState } from 'react';
import { Bot, Plus, Edit2, Trash2, Copy, RefreshCw, Library as LibraryIcon } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Sidebar } from '../components/Sidebar';
import { AgentEditor } from '../components/AgentEditor';
import * as agentsApi from '../api/agents';
import type { LibraryAgent, UserAgent } from '../api/agents';

export function AgentsPage() {
  const [mine, setMine] = useState<UserAgent[]>([]);
  const [library, setLibrary] = useState<LibraryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<UserAgent | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [m, l] = await Promise.all([agentsApi.getMine(), agentsApi.getLibrary()]);
      setMine(m);
      setLibrary(l);
    } catch (err: any) {
      setError(err?.message || 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = () => {
    setEditingAgent(null);
    setEditorOpen(true);
  };

  const handleEdit = (a: UserAgent) => {
    setEditingAgent(a);
    setEditorOpen(true);
  };

  const handleSave = async (data: { name: string; description: string; system_prompt: string }) => {
    if (editingAgent) {
      await agentsApi.updateMine(editingAgent.id, data);
    } else {
      await agentsApi.createMine(data);
    }
    setEditorOpen(false);
    setEditingAgent(null);
    await refresh();
  };

  const handleDelete = async (a: UserAgent) => {
    if (!window.confirm(`Delete agent "${a.name}"? This cannot be undone.`)) return;
    try {
      await agentsApi.deleteMine(a.id);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    }
  };

  const handleClone = async (l: LibraryAgent) => {
    try {
      await agentsApi.cloneFromLibrary(l.id);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Clone failed');
    }
  };

  return (
    <Layout sidebar={<Sidebar />}>
      <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 20,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bot size={18} /> Agents
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refresh} title="Refresh" style={secondaryBtn}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button onClick={handleCreate} style={primaryBtn}>
              <Plus size={14} /> New agent
            </button>
          </div>
        </div>

        {error && (
          <div style={{
            marginBottom: 16, padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 'var(--radius)',
            color: 'var(--color-danger)', fontSize: 13,
          }}>{error}</div>
        )}

        <Section title="My agents" hint="Private to your account. Pick one when starting a new chat.">
          {loading ? (
            <Placeholder text="Loading…" />
          ) : mine.length === 0 ? (
            <Placeholder text="You haven't created any agents yet. Try cloning one from the Library below, or use New agent." />
          ) : (
            <CardGrid>
              {mine.map((a) => (
                <Card
                  key={a.id}
                  name={a.name}
                  description={a.description}
                  prompt={a.system_prompt}
                  badge={a.source_library_id ? 'from library' : undefined}
                  actions={
                    <>
                      <IconButton title="Edit" onClick={() => handleEdit(a)}><Edit2 size={13} /></IconButton>
                      <IconButton title="Delete" danger onClick={() => handleDelete(a)}><Trash2 size={13} /></IconButton>
                    </>
                  }
                />
              ))}
            </CardGrid>
          )}
        </Section>

        <Section
          title={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><LibraryIcon size={14} /> Library</span>}
          hint="Curated samples from the admins. Clone one to your account to customize it."
        >
          {loading ? (
            <Placeholder text="Loading…" />
          ) : library.length === 0 ? (
            <Placeholder text="No library agents available." />
          ) : (
            <CardGrid>
              {library.map((a) => (
                <Card
                  key={a.id}
                  name={a.name}
                  description={a.description}
                  prompt={a.system_prompt}
                  actions={
                    <button onClick={() => handleClone(a)} style={smallBtn}>
                      <Copy size={12} /> Clone to mine
                    </button>
                  }
                />
              ))}
            </CardGrid>
          )}
        </Section>

        {editorOpen && (
          <AgentEditor
            agent={editingAgent}
            onSave={handleSave}
            onCancel={() => { setEditorOpen(false); setEditingAgent(null); }}
          />
        )}
      </div>
    </Layout>
  );
}

function Section({ title, hint, children }: { title: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>
          {title}
        </div>
        {hint && <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gap: 10,
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    }}>{children}</div>
  );
}

function Card({ name, description, prompt, badge, actions }: {
  name: string; description: string; prompt: string; badge?: string; actions: React.ReactNode;
}) {
  return (
    <div style={{
      padding: 12,
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{name}</span>
          {badge && (
            <span style={{
              padding: '1px 6px', fontSize: 10,
              background: 'var(--color-accent-dim)', color: 'var(--color-accent-light)',
              borderRadius: 3,
            }}>{badge}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>{actions}</div>
      </div>
      {description && (
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>{description}</div>
      )}
      <details style={{ marginTop: 4 }}>
        <summary style={{
          fontSize: 11, color: 'var(--color-text-dim)', cursor: 'pointer',
          userSelect: 'none',
        }}>system prompt</summary>
        <pre style={{
          marginTop: 6, padding: 8,
          background: 'var(--color-bg, var(--color-surface-light))',
          borderRadius: 'var(--radius)',
          fontSize: 11.5, lineHeight: 1.5,
          color: 'var(--color-text-secondary)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 240, overflowY: 'auto',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        }}>{prompt}</pre>
      </details>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div style={{
      padding: 24, textAlign: 'center',
      color: 'var(--color-text-dim)', fontSize: 13,
      border: '1px dashed var(--color-border)',
      borderRadius: 'var(--radius-lg)',
    }}>{text}</div>
  );
}

function IconButton({ children, onClick, title, danger }: {
  children: React.ReactNode; onClick: () => void; title: string; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick} title={title}
      style={{
        background: 'none',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: '3px 6px',
        color: danger ? 'var(--color-danger)' : 'var(--color-text-dim)',
        cursor: 'pointer', display: 'flex', alignItems: 'center',
      }}
    >{children}</button>
  );
}

const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', background: 'var(--color-accent)',
  border: 'none', color: '#fff', fontSize: 13, fontWeight: 500,
  borderRadius: 'var(--radius)', cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-secondary)', fontSize: 13,
  borderRadius: 'var(--radius)', cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '4px 8px', fontSize: 11,
  background: 'transparent',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
};
