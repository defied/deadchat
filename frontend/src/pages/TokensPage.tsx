import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Copy, Check, X, Key, Loader2, AlertTriangle } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Sidebar } from '../components/Sidebar';
import * as tokensApi from '../api/tokens';
import type { ApiToken } from '../api/tokens';

export function TokensPage() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTokens(await tokensApi.listTokens());
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const result = await tokensApi.createToken(newName.trim());
      setCreatedToken(result.token);
      setNewName('');
      setShowCreate(false);
      refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: number, name: string) => {
    if (!window.confirm(`Revoke token "${name}"? Any clients using it will immediately lose access.`)) return;
    try {
      await tokensApi.revokeToken(id);
      refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to revoke token');
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const apiBase = window.location.origin;

  return (
    <Layout sidebar={<Sidebar />}>
      <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)' }}>
            API Tokens
          </h2>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              border: 'none', color: '#fff', background: 'var(--color-accent)',
              fontSize: 13, fontWeight: 500, cursor: 'pointer', borderRadius: 'var(--radius)',
            }}
          >
            <Plus size={14} /> New token
          </button>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', marginBottom: 16,
            background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 'var(--radius)', color: 'var(--color-danger)', fontSize: 13,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            {error}
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: 2, display: 'flex' }}>
              <X size={14} />
            </button>
          </div>
        )}

        <div style={{
          padding: 16, marginBottom: 20,
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)', fontSize: 13, color: 'var(--color-text-secondary)',
        }}>
          <div style={{ fontWeight: 500, marginBottom: 8, color: 'var(--color-text)' }}>Using your token</div>
          <div style={{ marginBottom: 10 }}>
            Send requests with an <code style={codeStyle}>Authorization: Bearer &lt;token&gt;</code> header. Two API styles are exposed:
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>Ollama-compatible</strong> &mdash; base URL: <code style={codeStyle}>{apiBase}</code>
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 2 }}>
              Endpoints: <code style={codeStyle}>/api/tags</code>, <code style={codeStyle}>/api/chat</code>, <code style={codeStyle}>/api/generate</code>, <code style={codeStyle}>/api/show</code>, <code style={codeStyle}>/api/embed</code>, <code style={codeStyle}>/api/ps</code>, <code style={codeStyle}>/api/version</code>
            </div>
          </div>
          <div>
            <strong>OpenAI-compatible</strong> &mdash; base URL: <code style={codeStyle}>{apiBase}/v1</code>
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 2 }}>
              Endpoints: <code style={codeStyle}>/v1/models</code>, <code style={codeStyle}>/v1/chat/completions</code>, <code style={codeStyle}>/v1/completions</code>, <code style={codeStyle}>/v1/embeddings</code>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-dim)' }}>
            Drop-in with tools like Continue.dev (VS Code/JetBrains) and opencode. Point the "ollama" or "openai" provider at this base URL and paste the token.
          </div>
        </div>

        {showCreate && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }} onClick={() => !creating && setShowCreate(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{
              width: 420, padding: 24, background: 'var(--color-surface)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Create API token</div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Token name (e.g. Continue.dev, laptop)"
                disabled={creating}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  onClick={() => setShowCreate(false)}
                  disabled={creating}
                  style={{
                    padding: '8px 16px', background: 'transparent', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)', borderRadius: 'var(--radius)', cursor: 'pointer',
                  }}
                >Cancel</button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !newName.trim()}
                  style={{
                    padding: '8px 16px', background: 'var(--color-accent)', border: 'none',
                    color: '#fff', fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
                  }}
                >{creating ? 'Creating…' : 'Create'}</button>
              </div>
            </div>
          </div>
        )}

        {createdToken && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}>
            <div style={{
              width: 560, padding: 24, background: 'var(--color-surface)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <AlertTriangle size={18} style={{ color: 'var(--color-accent-light)' }} />
                <div style={{ fontSize: 14, fontWeight: 500 }}>Copy your token now</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
                This is the only time the full token will be displayed. Store it somewhere safe &mdash; if you lose it, revoke and create a new one.
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: 12,
                background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 12,
                wordBreak: 'break-all', color: 'var(--color-text)',
              }}>
                <span style={{ flex: 1 }}>{createdToken}</span>
                <button onClick={handleCopy} style={{
                  padding: '6px 10px', border: '1px solid var(--color-border-light)',
                  background: 'var(--color-surface-light)', color: 'var(--color-text)',
                  borderRadius: 'var(--radius)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                }}>
                  {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                <button
                  onClick={() => { setCreatedToken(null); setCopied(false); }}
                  style={{
                    padding: '8px 16px', background: 'var(--color-accent)', border: 'none',
                    color: '#fff', fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
                  }}
                >Done</button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--color-text-dim)' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
            Loading tokens...
          </div>
        ) : tokens.length === 0 ? (
          <div style={{
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
            background: 'var(--color-surface)', padding: 48, textAlign: 'center',
            color: 'var(--color-text-dim)', fontSize: 13,
          }}>
            <Key size={28} style={{ marginBottom: 10, color: 'var(--color-text-dim)' }} />
            <div>No tokens yet. Create one to connect an external client.</div>
          </div>
        ) : (
          <div style={{
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
            overflow: 'hidden', background: 'var(--color-surface)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Name', 'Prefix', 'Last used', 'Created', ''].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid var(--color-border)',
                      color: 'var(--color-text-dim)', fontSize: 11, fontWeight: 500,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td style={cellStyle}>
                      <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{t.name}</span>
                    </td>
                    <td style={{ ...cellStyle, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
                      {t.prefix}…
                    </td>
                    <td style={{ ...cellStyle, color: 'var(--color-text-dim)', fontSize: 12 }}>
                      {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}
                    </td>
                    <td style={{ ...cellStyle, color: 'var(--color-text-dim)', fontSize: 12 }}>
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      <button onClick={() => handleRevoke(t.id, t.name)} title="Revoke token" style={{
                        background: 'none', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius)',
                        padding: '4px 8px', color: 'var(--color-danger)', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center',
                      }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

const codeStyle: React.CSSProperties = {
  padding: '1px 6px', background: 'var(--color-bg)', border: '1px solid var(--color-border)',
  borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text)',
};

const cellStyle: React.CSSProperties = {
  padding: '10px 14px', borderBottom: '1px solid var(--color-border)',
};
