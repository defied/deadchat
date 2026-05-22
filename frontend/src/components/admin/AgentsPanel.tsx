import { useCallback, useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, RefreshCw } from 'lucide-react';
import { AgentEditor } from '../AgentEditor';
import * as agentsApi from '../../api/agents';
import type { LibraryAgent } from '../../api/agents';

// Admin panel for managing the shared agent library. Mirrors the user-facing
// AgentsPage but acts on agent_library rather than user_agents.
export function AgentsPanel() {
  const [library, setLibrary] = useState<LibraryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryAgent | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setLibrary(await agentsApi.getLibrary());
    } catch (err: any) {
      setError(err?.message || 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = () => { setEditing(null); setEditorOpen(true); };
  const handleEdit = (a: LibraryAgent) => { setEditing(a); setEditorOpen(true); };

  const handleSave = async (data: { name: string; description: string; system_prompt: string }) => {
    if (editing) {
      await agentsApi.updateLibraryAgent(editing.id, data);
    } else {
      await agentsApi.createLibraryAgent(data);
    }
    setEditorOpen(false);
    setEditing(null);
    await refresh();
  };

  const handleDelete = async (a: LibraryAgent) => {
    if (!window.confirm(`Delete library agent "${a.name}"? Users who already cloned it keep their copy.`)) return;
    try {
      await agentsApi.deleteLibraryAgent(a.id);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    }
  };

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>
          {library.length} agent{library.length === 1 ? '' : 's'} in library
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={refresh} style={secondaryBtn}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={handleCreate} style={primaryBtn}>
            <Plus size={14} /> New library agent
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          marginBottom: 12, padding: '8px 12px',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 'var(--radius)',
          color: 'var(--color-danger)', fontSize: 13,
        }}>{error}</div>
      )}

      <div style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: 'var(--color-surface)',
      }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-dim)', fontSize: 13 }}>
            Loading…
          </div>
        ) : library.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-dim)', fontSize: 13 }}>
            No library agents. Click "New library agent" to add one.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Name', 'Description', 'Updated', 'Actions'].map((h) => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 14px',
                    borderBottom: '1px solid var(--color-border)',
                    color: 'var(--color-text-dim)', fontSize: 11, fontWeight: 500,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {library.map((a) => (
                <tr key={a.id}>
                  <td style={td}>
                    <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{a.name}</span>
                  </td>
                  <td style={{ ...td, color: 'var(--color-text-secondary)' }}>
                    {a.description || <span style={{ color: 'var(--color-text-dim)', fontStyle: 'italic' }}>—</span>}
                  </td>
                  <td style={{ ...td, color: 'var(--color-text-dim)', fontSize: 12 }}>
                    {new Date(a.updated_at).toLocaleDateString()}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => handleEdit(a)} title="Edit" style={iconBtn}>
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(a)} title="Delete" style={{ ...iconBtn, borderColor: 'rgba(239, 68, 68, 0.3)', color: 'var(--color-danger)' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editorOpen && (
        <AgentEditor
          agent={editing}
          title={editing ? `Edit library agent: ${editing.name}` : 'New library agent'}
          onSave={handleSave}
          onCancel={() => { setEditorOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

const td: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--color-border)',
};

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

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: '4px 8px',
  color: 'var(--color-text-dim)',
  cursor: 'pointer',
  display: 'flex', alignItems: 'center',
};
