import { useState, useEffect } from 'react';
import { X, Loader2, Info } from 'lucide-react';
import * as modelSettingsApi from '../../api/modelSettings';

interface Props {
  model: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface OptionField {
  key: string;
  label: string;
  type: 'int' | 'float';
  placeholder?: string;
  hint?: string;
}

const FIELDS: OptionField[] = [
  { key: 'num_ctx', label: 'Context window (num_ctx)', type: 'int', placeholder: '4096', hint: 'Max context tokens the model sees' },
  { key: 'num_gpu', label: 'GPU layers (num_gpu)', type: 'int', placeholder: 'auto', hint: 'Layers to offload to GPU. -1 = max, 0 = CPU only' },
  { key: 'num_batch', label: 'Batch size (num_batch)', type: 'int', placeholder: '512', hint: 'Prompt eval batch size' },
  { key: 'num_thread', label: 'Threads (num_thread)', type: 'int', placeholder: 'auto', hint: 'CPU threads; 0 = auto' },
  { key: 'num_predict', label: 'Max tokens (num_predict)', type: 'int', placeholder: '-1', hint: 'Max tokens to generate. -1 = until model stops' },
  { key: 'temperature', label: 'Temperature', type: 'float', placeholder: '0.8' },
  { key: 'top_k', label: 'top_k', type: 'int', placeholder: '40' },
  { key: 'top_p', label: 'top_p', type: 'float', placeholder: '0.9' },
  { key: 'repeat_penalty', label: 'repeat_penalty', type: 'float', placeholder: '1.1' },
  { key: 'seed', label: 'Seed', type: 'int', placeholder: '0', hint: '0 = random' },
  { key: 'mirostat', label: 'mirostat', type: 'int', placeholder: '0', hint: '0 = off, 1 = mirostat, 2 = mirostat 2.0' },
  { key: 'mirostat_tau', label: 'mirostat_tau', type: 'float', placeholder: '5.0' },
  { key: 'mirostat_eta', label: 'mirostat_eta', type: 'float', placeholder: '0.1' },
];

export function ModelSettingsEditor({ model, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const s = await modelSettingsApi.getModelSettings(model);
        if (cancelled) return;
        if (s) {
          setEnabled(s.enabled);
          const initial: Record<string, string> = {};
          for (const f of FIELDS) {
            const v = s.options[f.key];
            if (v !== undefined && v !== null) initial[f.key] = String(v);
          }
          setValues(initial);
        } else {
          setEnabled(true);
          setValues({});
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error || err?.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [model]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const options: Record<string, unknown> = {};
      for (const f of FIELDS) {
        const raw = values[f.key];
        if (raw === undefined || raw === '') continue;
        const n = f.type === 'int' ? parseInt(raw) : parseFloat(raw);
        if (Number.isNaN(n)) {
          setError(`Invalid number for ${f.label}`);
          setSaving(false);
          return;
        }
        options[f.key] = n;
      }
      await modelSettingsApi.upsertModelSettings(model, options, enabled);
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(`Reset settings for "${model}"? Server-side defaults will apply.`)) return;
    setSaving(true);
    setError('');
    try {
      await modelSettingsApi.deleteModelSettings(model).catch(() => undefined);
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640, maxHeight: '90vh', padding: 24, background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Settings: {model}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 2 }}>
              Applied when this model is requested via chat, generate, or the public API.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer', padding: 2, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{
            padding: '8px 12px', marginBottom: 12,
            background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 'var(--radius)', color: 'var(--color-danger)', fontSize: 12,
          }}>{error}</div>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--color-text-dim)' }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
            Loading...
          </div>
        ) : (
          <>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: 14,
              background: 'var(--color-bg)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)', fontSize: 13, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ width: 14, height: 14 }}
              />
              <span style={{ color: 'var(--color-text)' }}>
                Enabled &mdash; model is visible in <code>/api/tags</code> and <code>/v1/models</code>
              </span>
            </label>

            <div style={{
              flex: 1, overflowY: 'auto', display: 'grid',
              gridTemplateColumns: '1fr 1fr', gap: 10, paddingRight: 4,
            }}>
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                    {f.label}
                  </label>
                  <input
                    type="number"
                    step={f.type === 'float' ? 'any' : '1'}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    disabled={saving}
                    style={{ width: '100%', fontSize: 13 }}
                  />
                  {f.hint && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 3 }}>{f.hint}</div>
                  )}
                </div>
              ))}
            </div>

            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14, padding: '8px 12px',
              background: 'var(--color-bg)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--color-text-dim)',
            }}>
              <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>
                KV-cache quantization is server-side &mdash; set <code>OLLAMA_KV_CACHE_TYPE</code> (e.g. <code>q8_0</code>, <code>q4_0</code>) and <code>OLLAMA_FLASH_ATTENTION=1</code> on the Ollama deployment, not per-model.
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 }}>
              <button
                onClick={handleReset}
                disabled={saving}
                style={{
                  padding: '8px 14px', background: 'transparent', border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: 'var(--color-danger)', fontSize: 13, borderRadius: 'var(--radius)', cursor: 'pointer',
                }}
              >Reset to defaults</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={onClose}
                  disabled={saving}
                  style={{
                    padding: '8px 16px', background: 'transparent', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)', borderRadius: 'var(--radius)', cursor: 'pointer',
                  }}
                >Cancel</button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '8px 16px', background: 'var(--color-accent)', border: 'none',
                    color: '#fff', fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
                  }}
                >{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
