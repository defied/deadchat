import { useEffect, useState } from 'react';
import { X, User as UserIcon, Library, MessageSquare } from 'lucide-react';
import * as agentsApi from '../api/agents';
import type { LibraryAgent, UserAgent, AgentSelection } from '../api/agents';

interface AgentPickerProps {
  onPick: (selection: AgentSelection | null) => void;
  onCancel: () => void;
}

type Tab = 'mine' | 'library' | 'none';

export function AgentPicker({ onPick, onCancel }: AgentPickerProps) {
  const [tab, setTab] = useState<Tab>('mine');
  const [mine, setMine] = useState<UserAgent[]>([]);
  const [library, setLibrary] = useState<LibraryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [m, l] = await Promise.all([agentsApi.getMine(), agentsApi.getLibrary()]);
        if (cancelled) return;
        setMine(m);
        setLibrary(l);
        // Default the tab to whichever side has content; prefer "mine" if both.
        if (m.length === 0 && l.length > 0) setTab('library');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const filteredMine = mine.filter((a) =>
    !filter || a.name.toLowerCase().includes(filter.toLowerCase())
      || a.description.toLowerCase().includes(filter.toLowerCase())
  );
  const filteredLibrary = library.filter((a) =>
    !filter || a.name.toLowerCase().includes(filter.toLowerCase())
      || a.description.toLowerCase().includes(filter.toLowerCase())
  );

  const pickNone = () => onPick(null);

  const handleCloneAndPick = async (lib: LibraryAgent) => {
    // Picking from library starts the chat against the library agent directly
    // (no clone needed — the session snapshots the prompt at creation time).
    onPick({ source: 'library', id: lib.id, name: lib.name });
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxHeight: '85vh',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
            Start a new chat
          </div>
          <button onClick={onCancel} style={iconBtn} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '12px 18px 0' }}>
          <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')}
            icon={<UserIcon size={13} />} label={`My agents${mine.length ? ` · ${mine.length}` : ''}`} />
          <TabBtn active={tab === 'library'} onClick={() => setTab('library')}
            icon={<Library size={13} />} label={`Library${library.length ? ` · ${library.length}` : ''}`} />
          <TabBtn active={tab === 'none'} onClick={() => setTab('none')}
            icon={<MessageSquare size={13} />} label="No agent" />
        </div>

        {tab !== 'none' && (
          <div style={{ padding: '10px 18px 6px' }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 10px', fontSize: 13,
                background: 'var(--color-surface-light)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                outline: 'none',
              }}
            />
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 18px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: 40, fontSize: 13 }}>
              Loading agents…
            </div>
          ) : tab === 'none' ? (
            <div style={{ padding: '24px 8px' }}>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                Start a plain chat without any system prompt. Useful for one-off questions
                or when you want the model to behave with no persona.
              </div>
              <button onClick={pickNone} style={primaryBtn}>
                Start plain chat
              </button>
            </div>
          ) : tab === 'mine' ? (
            filteredMine.length === 0 ? (
              <EmptyState
                title={mine.length === 0 ? 'No personal agents yet' : 'No matches'}
                hint={mine.length === 0
                  ? 'Browse the Library tab to clone a starter, or go to the Agents page to create one.'
                  : 'Try a different filter.'}
              />
            ) : (
              <AgentList
                items={filteredMine.map((a) => ({
                  key: `u${a.id}`,
                  name: a.name,
                  description: a.description,
                  badge: a.source_library_id ? 'from library' : undefined,
                  onPick: () => onPick({ source: 'user', id: a.id, name: a.name }),
                }))}
              />
            )
          ) : (
            filteredLibrary.length === 0 ? (
              <EmptyState title="No matches" hint="Try a different filter." />
            ) : (
              <AgentList
                items={filteredLibrary.map((a) => ({
                  key: `l${a.id}`,
                  name: a.name,
                  description: a.description,
                  onPick: () => handleCloneAndPick(a),
                }))}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function AgentList({ items }: {
  items: Array<{ key: string; name: string; description: string; badge?: string; onPick: () => void }>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((it) => (
        <button
          key={it.key}
          onClick={it.onPick}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            textAlign: 'left',
            padding: '10px 12px',
            background: 'var(--color-surface-light)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            color: 'var(--color-text)',
            transition: 'background 0.1s, border-color 0.1s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--color-surface-hover)';
            e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--color-surface-light)';
            e.currentTarget.style.borderColor = 'var(--color-border)';
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            marginBottom: it.description ? 4 : 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{it.name}</span>
            {it.badge && (
              <span style={{
                padding: '1px 6px', fontSize: 10,
                background: 'var(--color-accent-dim)', color: 'var(--color-accent-light)',
                borderRadius: 3,
              }}>{it.badge}</span>
            )}
          </div>
          {it.description && (
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>{it.description}</div>
          )}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-dim)' }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12 }}>{hint}</div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', fontSize: 12, fontWeight: active ? 500 : 400,
        background: active ? 'var(--color-accent-dim)' : 'transparent',
        color: active ? 'var(--color-accent-light)' : 'var(--color-text-dim)',
        border: active ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid var(--color-border)',
        borderRadius: 'var(--radius)', cursor: 'pointer',
      }}
    >
      {icon}{label}
    </button>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--color-text-dim)',
  cursor: 'pointer', padding: 4, display: 'flex',
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-accent)',
  border: 'none', color: '#fff', fontSize: 13, fontWeight: 500,
  borderRadius: 'var(--radius)', cursor: 'pointer',
};
