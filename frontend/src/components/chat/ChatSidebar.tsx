import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Bot, Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { ChatSession } from '../../api/chat';

/** SQLite `datetime('now')` is UTC without a zone marker. */
export function parseDbDate(s: string | null | undefined): Date {
  if (!s) return new Date(0);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
}

function groupLabel(d: Date, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  const day = 86_400_000;
  if (t >= startOfToday) return 'Today';
  if (t >= startOfToday - day) return 'Yesterday';
  if (t >= startOfToday - 7 * day) return 'Previous 7 days';
  if (t >= startOfToday - 30 * day) return 'Previous 30 days';
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export function ChatSidebar({
  sessions,
  loading,
  activeId,
  onNew,
  onRename,
  onDelete,
  className = '',
  onNavigate,
}: {
  sessions: ChatSession[];
  loading: boolean;
  activeId: number | null;
  onNew: () => void;
  onRename: (id: number, title: string) => Promise<void> | void;
  onDelete: (session: ChatSession) => void;
  className?: string;
  onNavigate?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const out: Array<{ label: string; items: ChatSession[] }> = [];
    for (const s of sessions) {
      if (q && !s.title.toLowerCase().includes(q) && !(s.agent_name || '').toLowerCase().includes(q)) continue;
      const label = groupLabel(parseDbDate(s.updated_at || s.created_at), now);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(s);
      else out.push({ label, items: [s] });
    }
    return out;
  }, [sessions, query]);

  const commitRename = async (id: number) => {
    const title = draft.trim();
    setEditing(null);
    if (title) await onRename(id, title);
  };

  return (
    <aside className={`chat-sidebar ${className}`} aria-label="Chats">
      <div className="chat-sidebar-top">
        <button className="btn btn-primary" onClick={onNew} style={{ width: '100%' }}>
          <Plus size={15} /> New chat
        </button>
        <div className="search-box">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        </div>
      </div>

      <div className="session-list">
        {loading && sessions.length === 0 && <div className="session-group-label">Loading…</div>}
        {!loading && sessions.length === 0 && (
          <div className="session-group-label" style={{ fontWeight: 400 }}>
            No chats yet. Start one with <b>New chat</b>.
          </div>
        )}
        {!loading && sessions.length > 0 && groups.length === 0 && (
          <div className="session-group-label" style={{ fontWeight: 400 }}>No chats match “{query}”.</div>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="session-group-label">{g.label}</div>
            {g.items.map((s) =>
              editing === s.id ? (
                <div key={s.id} className="session-item active">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(s.id);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    aria-label="Chat title"
                  />
                  <button className="icon-btn" onClick={() => commitRename(s.id)} aria-label="Save title">
                    <Check size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => setEditing(null)} aria-label="Cancel rename">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <NavLink
                  key={s.id}
                  to={`/chat/${s.id}`}
                  onClick={onNavigate}
                  className={`session-item${s.id === activeId ? ' active' : ''}`}
                  title={s.title}
                >
                  {s.agent_name && <Bot size={13} style={{ flexShrink: 0, opacity: 0.7 }} />}
                  <span className="session-title">{s.title}</span>
                  <span className="session-actions">
                    <button
                      className="icon-btn"
                      title="Rename"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDraft(s.title);
                        setEditing(s.id);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Delete"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete(s);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </NavLink>
              ),
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
