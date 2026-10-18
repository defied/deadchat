import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Key, Plus, Trash2 } from 'lucide-react';
import * as tokensApi from '../api/tokens';
import type { ApiToken } from '../api/tokens';
import { getChatModels } from '../api/chat';
import { Alert, EmptyState, Loading, Modal, PageHeader, Section, errorMessage } from '../components/ui';
import { CopyButton } from '../components/chat/Markdown';
import { parseDbDate } from '../components/chat/ChatSidebar';

function Snippet({ text }: { text: string }) {
  return (
    <div className="snippet">
      {text}
      <CopyButton text={text} />
    </div>
  );
}

export function TokensPage() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  // Kept after the dialog closes so the snippets below stay copy-pasteable.
  const [lastToken, setLastToken] = useState<string | null>(null);

  const modelsQ = useQuery({ queryKey: ['chat-models'], queryFn: getChatModels, staleTime: 60_000 });
  const model = modelsQ.data?.defaultModel || 'qwen3.8:27b';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTokens(await tokensApi.listTokens());
    } catch (err) {
      setError(errorMessage(err, 'Failed to load tokens'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const result = await tokensApi.createToken(newName.trim());
      setCreatedToken(result.token);
      setLastToken(result.token);
      setNewName('');
      setShowCreate(false);
      refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to create token'));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (t: ApiToken) => {
    if (!window.confirm(`Revoke token "${t.name}"? Any clients using it will immediately lose access.`)) return;
    try {
      await tokensApi.revokeToken(t.id);
      refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to revoke token'));
    }
  };

  const base = window.location.origin;
  const tok = lastToken ?? 'dc_live_…';

  return (
    <div className="page">
      <div className="page-narrow">
        <PageHeader
          icon={<Key size={20} />}
          title="API access"
          subtitle="Use DeadChat's local models from Claude Code, OpenAI-compatible tools, or the Ollama CLI."
          actions={
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> New token
            </button>
          }
        />

        {error && <Alert onClose={() => setError('')}>{error}</Alert>}

        <Section title="Your tokens" hint="Tokens act as you. Revoke any you no longer use.">
          {loading ? (
            <Loading label="Loading tokens…" />
          ) : tokens.length === 0 ? (
            <EmptyState
              title="No tokens yet"
              action={
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                  <Plus size={14} /> Create your first token
                </button>
              }
            >
              Create one to connect an external client.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>Last used</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.id}>
                      <td className="strong">{t.name}</td>
                      <td className="mono">{t.prefix}…</td>
                      <td>{t.lastUsedAt ? parseDbDate(t.lastUsedAt).toLocaleString() : 'never'}</td>
                      <td>{parseDbDate(t.createdAt).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm btn-danger" onClick={() => handleRevoke(t)} title="Revoke token">
                          <Trash2 size={13} /> Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Connect a client" hint={<>Every request needs <code className="inline">Authorization: Bearer &lt;token&gt;</code>. Replace the token below with yours.</>}>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            <div className="card">
              <div className="section-title">Claude Code / Anthropic SDK</div>
              <div className="section-hint">
                <code className="inline">POST /v1/messages</code> with streaming and tool use.
              </div>
              <Snippet
                text={`export ANTHROPIC_BASE_URL="${base}"\nexport ANTHROPIC_AUTH_TOKEN="${tok}"\nexport ANTHROPIC_MODEL="${model}"\nclaude`}
              />
            </div>
            <div className="card">
              <div className="section-title">OpenAI-compatible</div>
              <div className="section-hint">Continue.dev, opencode, the OpenAI SDKs, LangChain…</div>
              <Snippet text={`base_url = "${base}/v1"\napi_key  = "${tok}"\nmodel    = "${model}"`} />
              <div className="field-hint">
                <code className="inline">/v1/models</code> · <code className="inline">/v1/chat/completions</code> ·{' '}
                <code className="inline">/v1/completions</code> · <code className="inline">/v1/embeddings</code>
              </div>
            </div>
            <div className="card">
              <div className="section-title">Ollama-native</div>
              <div className="section-hint">Anything that speaks the Ollama API.</div>
              <Snippet
                text={`curl ${base}/api/chat \\\n  -H "Authorization: Bearer ${tok}" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"hi"}]}'`}
              />
              <div className="field-hint">
                <code className="inline">/api/tags</code> · <code className="inline">/api/chat</code> ·{' '}
                <code className="inline">/api/generate</code> · <code className="inline">/api/embed</code> ·{' '}
                <code className="inline">/api/show</code> · <code className="inline">/api/ps</code>
              </div>
            </div>
          </div>
        </Section>
      </div>

      {showCreate && (
        <Modal
          title="Create API token"
          width={440}
          busy={creating}
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowCreate(false)} disabled={creating}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </>
          }
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Token name (e.g. Claude Code on laptop)"
            disabled={creating}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </Modal>
      )}

      {createdToken && (
        <Modal
          title={
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={17} style={{ color: 'var(--color-warning)' }} /> Copy your token now
            </span>
          }
          width={560}
          onClose={() => setCreatedToken(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setCreatedToken(null)}>
              Done
            </button>
          }
        >
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            This is the only time the full token is shown. If you lose it, revoke it and create a new one. The client
            snippets on this page now include it.
          </div>
          <Snippet text={createdToken} />
        </Modal>
      )}
    </div>
  );
}
