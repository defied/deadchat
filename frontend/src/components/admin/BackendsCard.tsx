import { useCallback, useEffect, useState } from 'react';
import { Network, RefreshCw } from 'lucide-react';
import * as ollamaApi from '../../api/ollama';
import type { OllamaBackendInfo } from '../../api/ollama';

const REFRESH_MS = 15_000;

/**
 * Ollama backends (OLLAMA_BACKENDS): health, URL and the default model each
 * one uses for new chats and for chats that land on it without a model it has.
 */
export function BackendsCard() {
  const [backends, setBackends] = useState<OllamaBackendInfo[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBackends(await ollamaApi.listBackends());
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not load backends');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const changeDefault = async (id: string, model: string) => {
    setSaving(id);
    try {
      setBackends(await ollamaApi.setBackendDefaultModel(id, model || null));
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not save the default model');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div style={{
      padding: '12px 16px',
      marginBottom: 16,
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
        fontSize: 13, color: 'var(--color-text-secondary)',
      }}>
        <Network size={16} style={{ color: 'var(--color-text-dim)' }} />
        <span style={{ fontWeight: 500 }}>Ollama backends</span>
        <button
          onClick={load}
          title="Refresh"
          style={{
            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-dim)', display: 'flex', padding: 2,
          }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 8 }}>{error}</div>}
      {!backends && !error && <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>Loading…</div>}

      {backends && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--color-text-dim)', fontSize: 11, textAlign: 'left' }}>
              <th style={{ padding: '4px 8px 6px 0', fontWeight: 500 }}>Backend</th>
              <th style={{ padding: '4px 8px 6px', fontWeight: 500 }}>Status</th>
              <th style={{ padding: '4px 8px 6px', fontWeight: 500 }}>URL</th>
              <th style={{ padding: '4px 0 6px 8px', fontWeight: 500 }}>Default model</th>
            </tr>
          </thead>
          <tbody>
            {backends.map((b) => {
              const status =
                b.healthy === null
                  ? { label: 'checking', bg: 'var(--color-surface-light)', fg: 'var(--color-text-dim)' }
                  : b.healthy
                    ? { label: 'online', bg: 'rgba(34, 197, 94, 0.12)', fg: 'var(--color-success, #22c55e)' }
                    : { label: 'offline', bg: 'rgba(239, 68, 68, 0.1)', fg: 'var(--color-danger)' };
              const models = b.models ?? [];
              return (
                <tr key={b.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '8px 8px 8px 0', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 500 }}>{b.id}</span>
                    {b.primary && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-text-dim)' }}>primary</span>
                    )}
                  </td>
                  <td style={{ padding: 8 }}>
                    <span
                      title={b.error ?? undefined}
                      style={{
                        padding: '1px 6px', fontSize: 10, fontWeight: 500, borderRadius: 4,
                        background: status.bg, color: status.fg,
                      }}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td style={{ padding: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {b.url}
                  </td>
                  <td style={{ padding: '8px 0 8px 8px' }}>
                    <select
                      value={b.defaultModel ?? ''}
                      disabled={saving === b.id || models.length === 0}
                      onChange={(e) => changeDefault(b.id, e.target.value)}
                      style={{ fontSize: 12, maxWidth: 260 }}
                      title={models.length === 0 ? 'Model list unavailable until the backend answers' : undefined}
                    >
                      <option value="">{b.primary ? 'Global default model' : 'First installed model'}</option>
                      {b.defaultModel && !models.includes(b.defaultModel) && (
                        <option value={b.defaultModel}>{b.defaultModel} (not installed)</option>
                      )}
                      {models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 8 }}>
        Users pick a backend per chat when more than one is online. If a chat's backend goes offline, replies
        come from another online backend with its default model. Set the Mac's default to an MLX model.
        Backends are configured with <code>OLLAMA_BACKENDS</code>.
      </div>
    </div>
  );
}
