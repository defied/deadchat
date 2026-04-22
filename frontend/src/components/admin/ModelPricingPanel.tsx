import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import {
  getModelPricing,
  upsertModelPricing,
  deleteModelPricing,
  type ModelPricing,
} from '../../api/users';

interface Draft {
  model: string;
  inputPerMtok: string;
  outputPerMtok: string;
  notes: string;
}

function toDraft(row: ModelPricing): Draft {
  return {
    model: row.model,
    inputPerMtok: String(row.input_per_mtok),
    outputPerMtok: String(row.output_per_mtok),
    notes: row.notes ?? '',
  };
}

export function ModelPricingPanel() {
  const [rows, setRows] = useState<ModelPricing[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>({
    model: '',
    inputPerMtok: '0',
    outputPerMtok: '0',
    notes: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getModelPricing();
      setRows(data);
      const next: Record<string, Draft> = {};
      for (const row of data) next[row.model] = toDraft(row);
      setDrafts(next);
    } catch (err: any) {
      setError(err.message || 'Failed to load pricing');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const updateDraft = (model: string, field: keyof Draft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [model]: { ...prev[model], [field]: value },
    }));
  };

  const isDirty = (row: ModelPricing): boolean => {
    const d = drafts[row.model];
    if (!d) return false;
    return (
      parseFloat(d.inputPerMtok) !== row.input_per_mtok ||
      parseFloat(d.outputPerMtok) !== row.output_per_mtok ||
      (d.notes || '') !== (row.notes ?? '')
    );
  };

  const handleSave = async (model: string) => {
    const d = drafts[model];
    if (!d) return;
    const inputPerMtok = parseFloat(d.inputPerMtok);
    const outputPerMtok = parseFloat(d.outputPerMtok);
    if (Number.isNaN(inputPerMtok) || Number.isNaN(outputPerMtok)) {
      setError('Input and output rates must be numbers');
      return;
    }
    setSavingModel(model);
    setError('');
    try {
      await upsertModelPricing(model, inputPerMtok, outputPerMtok, d.notes.trim() || null);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSavingModel(null);
    }
  };

  const handleDelete = async (model: string) => {
    if (model === '*') return;
    if (!window.confirm(`Remove pricing for "${model}"? Requests using this model will fall back to the * rate.`)) return;
    setSavingModel(model);
    setError('');
    try {
      await deleteModelPricing(model);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Delete failed');
    } finally {
      setSavingModel(null);
    }
  };

  const handleCreate = async () => {
    const model = newDraft.model.trim();
    if (!model) {
      setError('Model name required');
      return;
    }
    const inputPerMtok = parseFloat(newDraft.inputPerMtok);
    const outputPerMtok = parseFloat(newDraft.outputPerMtok);
    if (Number.isNaN(inputPerMtok) || Number.isNaN(outputPerMtok)) {
      setError('Input and output rates must be numbers');
      return;
    }
    setSavingModel(model);
    setError('');
    try {
      await upsertModelPricing(model, inputPerMtok, outputPerMtok, newDraft.notes.trim() || null);
      setNewDraft({ model: '', inputPerMtok: '0', outputPerMtok: '0', notes: '' });
      setShowNew(false);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Create failed');
    } finally {
      setSavingModel(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--color-text-dim)' }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
        Loading pricing...
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div style={{
          padding: '10px 14px',
          marginBottom: 16,
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 'var(--radius)',
          color: 'var(--color-danger)',
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: 2, display: 'flex' }}>
            <X size={14} />
          </button>
        </div>
      )}

      <div style={{
        padding: '10px 14px',
        marginBottom: 16,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        fontSize: 12,
        color: 'var(--color-text-dim)',
        lineHeight: 1.5,
      }}>
        Rates are in <strong style={{ color: 'var(--color-text-secondary)' }}>USD per 1M tokens</strong>.
        The <code>*</code> row is the fallback rate applied when a request's model has no explicit pricing.
        Changing a rate applies to future <em>and past</em> summary calculations — historical cost is re-derived from stored tokens on every query.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setShowNew((v) => !v)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          border: '1px solid var(--color-border-light)', background: 'var(--color-surface-light)',
          color: 'var(--color-text)', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
        }}>
          <Plus size={14} /> Add pricing row
        </button>
      </div>

      {showNew && (
        <div style={{
          padding: 16, marginBottom: 16, background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>New pricing entry</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr', gap: 8, marginBottom: 10 }}>
            <input
              value={newDraft.model}
              onChange={(e) => setNewDraft({ ...newDraft, model: e.target.value })}
              placeholder="Model name (exact match, e.g. llama3.1:8b)"
              autoFocus
            />
            <input
              value={newDraft.inputPerMtok}
              onChange={(e) => setNewDraft({ ...newDraft, inputPerMtok: e.target.value })}
              placeholder="$/1M in"
              type="number"
              step="0.01"
              min="0"
            />
            <input
              value={newDraft.outputPerMtok}
              onChange={(e) => setNewDraft({ ...newDraft, outputPerMtok: e.target.value })}
              placeholder="$/1M out"
              type="number"
              step="0.01"
              min="0"
            />
            <input
              value={newDraft.notes}
              onChange={(e) => setNewDraft({ ...newDraft, notes: e.target.value })}
              placeholder="Notes (optional)"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setShowNew(false); setNewDraft({ model: '', inputPerMtok: '0', outputPerMtok: '0', notes: '' }); }}
              style={{
                padding: '8px 16px', background: 'transparent', border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)', borderRadius: 'var(--radius)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={savingModel !== null}
              style={{
                padding: '8px 16px', background: 'var(--color-accent)', border: 'none',
                color: '#fff', fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div style={{
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
        overflow: 'hidden', background: 'var(--color-surface)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Model', 'Input ($/1M)', 'Output ($/1M)', 'Notes', 'Updated', ''].map((h) => (
                <th key={h} style={{
                  textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text-dim)', fontSize: 11, fontWeight: 500,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const d = drafts[row.model];
              if (!d) return null;
              const dirty = isDirty(row);
              const saving = savingModel === row.model;
              return (
                <tr key={row.model}>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text)' }}>
                      {row.model}
                    </span>
                    {row.model === '*' && (
                      <span style={{
                        marginLeft: 8,
                        padding: '1px 6px', fontSize: 10, fontWeight: 500, borderRadius: 4,
                        background: 'var(--color-accent-dim)', color: 'var(--color-accent-light)',
                      }}>
                        fallback
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <input
                      value={d.inputPerMtok}
                      onChange={(e) => updateDraft(row.model, 'inputPerMtok', e.target.value)}
                      type="number"
                      step="0.01"
                      min="0"
                      style={inputStyle}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      value={d.outputPerMtok}
                      onChange={(e) => updateDraft(row.model, 'outputPerMtok', e.target.value)}
                      type="number"
                      step="0.01"
                      min="0"
                      style={inputStyle}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      value={d.notes}
                      onChange={(e) => updateDraft(row.model, 'notes', e.target.value)}
                      placeholder="—"
                      style={inputStyle}
                    />
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-dim)', fontSize: 12 }}>
                    {row.updated_at ? new Date(row.updated_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => handleSave(row.model)}
                        disabled={!dirty || saving}
                        title={dirty ? 'Save changes' : 'No changes'}
                        style={{
                          background: dirty ? 'var(--color-accent)' : 'transparent',
                          border: `1px solid ${dirty ? 'var(--color-accent)' : 'var(--color-border)'}`,
                          borderRadius: 'var(--radius)',
                          padding: '4px 8px',
                          color: dirty ? '#fff' : 'var(--color-text-dim)',
                          cursor: dirty && !saving ? 'pointer' : 'default',
                          display: 'flex',
                          alignItems: 'center',
                          opacity: saving ? 0.5 : 1,
                        }}
                      >
                        {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
                      </button>
                      {row.model !== '*' && (
                        <button
                          onClick={() => handleDelete(row.model)}
                          disabled={saving}
                          title="Delete pricing row"
                          style={{
                            background: 'none',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: 'var(--radius)',
                            padding: '4px 8px',
                            color: 'var(--color-danger)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--color-border)',
  verticalAlign: 'middle',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--color-surface-light)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--color-text)',
  fontSize: 13,
  outline: 'none',
};
