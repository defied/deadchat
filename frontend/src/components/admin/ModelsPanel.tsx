import { useState, useEffect, useCallback } from 'react';
import {
  Download, Trash2, Check, Copy, Info, Play, Plus, X, RefreshCw, Loader2, Sliders,
} from 'lucide-react';
import * as ollamaApi from '../../api/ollama';
import type { OllamaModel, RunningModel } from '../../api/ollama';
import { ModelSettingsEditor } from './ModelSettingsEditor';

function formatSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
}

export function ModelsPanel() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [running, setRunning] = useState<RunningModel[]>([]);
  const [activeModel, setActiveModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pull state
  const [showPull, setShowPull] = useState(false);
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<string[]>([]);

  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createModelfile, setCreateModelfile] = useState('');
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState<string[]>([]);

  // Copy state
  const [copySource, setCopySource] = useState<string | null>(null);
  const [copyDest, setCopyDest] = useState('');

  // Info state
  const [infoModel, setInfoModel] = useState<string | null>(null);
  const [infoData, setInfoData] = useState<string>('');

  // Per-model settings editor
  const [settingsModel, setSettingsModel] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [m, r, a] = await Promise.all([
        ollamaApi.listModels(),
        ollamaApi.listRunning(),
        ollamaApi.getActiveModel(),
      ]);
      setModels(m);
      setRunning(r);
      setActiveModel(a);
    } catch (err: any) {
      setError(err.message || 'Failed to load models');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSetActive = async (name: string) => {
    try {
      await ollamaApi.setActiveModel(name);
      setActiveModel(name);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`Delete model "${name}"? This cannot be undone.`)) return;
    try {
      await ollamaApi.deleteModel(name);
      refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePull = async () => {
    if (!pullName.trim()) return;
    setPulling(true);
    setPullProgress([]);
    try {
      await ollamaApi.pullModel(pullName.trim(), (line) => {
        try {
          const parsed = JSON.parse(line);
          const status = parsed.status || '';
          const pct = parsed.completed && parsed.total
            ? ` (${Math.round((parsed.completed / parsed.total) * 100)}%)`
            : '';
          setPullProgress((prev) => {
            const msg = `${status}${pct}`;
            if (prev.length > 0 && prev[prev.length - 1].startsWith(status.split(' ')[0])) {
              return [...prev.slice(0, -1), msg];
            }
            return [...prev, msg];
          });
        } catch {
          setPullProgress((prev) => [...prev, line]);
        }
      });
      setPullName('');
      setShowPull(false);
      refresh();
    } catch (err: any) {
      setPullProgress((prev) => [...prev, `Error: ${err.message}`]);
    } finally {
      setPulling(false);
    }
  };

  const handleCreate = async () => {
    if (!createName.trim() || !createModelfile.trim()) return;
    setCreating(true);
    setCreateProgress([]);
    try {
      await ollamaApi.createModel(createName.trim(), createModelfile.trim(), (line) => {
        try {
          const parsed = JSON.parse(line);
          setCreateProgress((prev) => [...prev, parsed.status || line]);
        } catch {
          setCreateProgress((prev) => [...prev, line]);
        }
      });
      setCreateName('');
      setCreateModelfile('');
      setShowCreate(false);
      refresh();
    } catch (err: any) {
      setCreateProgress((prev) => [...prev, `Error: ${err.message}`]);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!copySource || !copyDest.trim()) return;
    try {
      await ollamaApi.copyModel(copySource, copyDest.trim());
      setCopySource(null);
      setCopyDest('');
      refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleShowInfo = async (name: string) => {
    try {
      const info = await ollamaApi.getModelInfo(name);
      setInfoData(JSON.stringify(info, null, 2));
      setInfoModel(name);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const isRunning = (name: string) => running.some((r) => r.name === name);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--color-text-dim)' }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
        Loading models...
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

      {/* Active model indicator */}
      <div style={{
        padding: '12px 16px',
        marginBottom: 16,
        background: 'var(--color-accent-dim)',
        border: '1px solid rgba(99, 102, 241, 0.2)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        color: 'var(--color-text-secondary)',
      }}>
        <Check size={16} style={{ color: 'var(--color-accent-light)' }} />
        Active model: <strong style={{ color: 'var(--color-accent-light)' }}>{activeModel || 'None set'}</strong>
      </div>

      {/* Actions bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => { setShowPull(!showPull); setShowCreate(false); }} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          border: '1px solid var(--color-border-light)', background: 'var(--color-surface-light)',
          color: 'var(--color-text)', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
        }}>
          <Download size={14} /> Pull Model
        </button>
        <button onClick={() => { setShowCreate(!showCreate); setShowPull(false); }} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          border: '1px solid var(--color-border-light)', background: 'var(--color-surface-light)',
          color: 'var(--color-text)', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
        }}>
          <Plus size={14} /> Create Model
        </button>
        <button onClick={refresh} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          border: '1px solid var(--color-border)', background: 'transparent',
          color: 'var(--color-text-secondary)', fontSize: 13, borderRadius: 'var(--radius)', cursor: 'pointer',
        }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Pull form */}
      {showPull && (
        <div style={{
          padding: 16, marginBottom: 16, background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Pull a model</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={pullName}
              onChange={(e) => setPullName(e.target.value)}
              placeholder="e.g. llama3, gemma4, mistral"
              disabled={pulling}
              style={{ flex: 1 }}
              onKeyDown={(e) => e.key === 'Enter' && handlePull()}
            />
            <button onClick={handlePull} disabled={pulling || !pullName.trim()} style={{
              padding: '10px 20px', background: 'var(--color-accent)', border: 'none',
              color: '#fff', fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
            }}>
              {pulling ? 'Pulling...' : 'Pull'}
            </button>
          </div>
          {pullProgress.length > 0 && (
            <div style={{
              marginTop: 10, padding: 10, background: 'var(--color-bg)', borderRadius: 'var(--radius)',
              fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-dim)',
              maxHeight: 150, overflowY: 'auto',
            }}>
              {pullProgress.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div style={{
          padding: 16, marginBottom: 16, background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Create a custom model</div>
          <input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Model name"
            disabled={creating}
            style={{ marginBottom: 8 }}
          />
          <textarea
            value={createModelfile}
            onChange={(e) => setCreateModelfile(e.target.value)}
            placeholder={'FROM llama3\nSYSTEM You are a helpful assistant.'}
            disabled={creating}
            rows={6}
            style={{
              width: '100%', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 13,
              padding: '10px 14px', background: 'var(--color-surface-light)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
              color: 'var(--color-text)', outline: 'none', marginBottom: 8,
            }}
          />
          <button onClick={handleCreate} disabled={creating || !createName.trim() || !createModelfile.trim()} style={{
            padding: '10px 20px', background: 'var(--color-accent)', border: 'none',
            color: '#fff', fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
          }}>
            {creating ? 'Creating...' : 'Create'}
          </button>
          {createProgress.length > 0 && (
            <div style={{
              marginTop: 10, padding: 10, background: 'var(--color-bg)', borderRadius: 'var(--radius)',
              fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-dim)',
              maxHeight: 150, overflowY: 'auto',
            }}>
              {createProgress.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Copy modal */}
      {copySource && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setCopySource(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 400, padding: 24, background: 'var(--color-surface)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>
              Copy "{copySource}"
            </div>
            <input
              value={copyDest}
              onChange={(e) => setCopyDest(e.target.value)}
              placeholder="New model name"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCopy()}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setCopySource(null)} style={{
                padding: '8px 16px', background: 'transparent', border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)', borderRadius: 'var(--radius)', cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={handleCopy} disabled={!copyDest.trim()} style={{
                padding: '8px 16px', background: 'var(--color-accent)', border: 'none',
                color: '#fff', fontWeight: 500, borderRadius: 'var(--radius)', cursor: 'pointer',
              }}>Copy</button>
            </div>
          </div>
        </div>
      )}

      {/* Info modal */}
      {infoModel && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setInfoModel(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 600, maxHeight: '80vh', padding: 24, background: 'var(--color-surface)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Model: {infoModel}</div>
              <button onClick={() => setInfoModel(null)} style={{ background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer', padding: 2, display: 'flex' }}>
                <X size={18} />
              </button>
            </div>
            <pre style={{
              flex: 1, overflowY: 'auto', padding: 12, background: 'var(--color-bg)',
              borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 12,
              color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {infoData}
            </pre>
          </div>
        </div>
      )}

      {/* Models table */}
      <div style={{
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
        overflow: 'hidden', background: 'var(--color-surface)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Model', 'Size', 'Modified', 'Status', 'Actions'].map((h) => (
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
            {models.map((model) => (
              <tr
                key={model.name}
                style={{ transition: 'background 0.1s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{model.name}</span>
                    {activeModel === model.name && (
                      <span style={{
                        padding: '1px 6px', fontSize: 10, fontWeight: 500, borderRadius: 4,
                        background: 'var(--color-accent-dim)', color: 'var(--color-accent-light)',
                      }}>
                        active
                      </span>
                    )}
                  </div>
                  {model.details?.parameter_size && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 2 }}>
                      {model.details.family} · {model.details.parameter_size} · {model.details.quantization_level}
                    </div>
                  )}
                </td>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  {formatSize(model.size)}
                </td>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-dim)', fontSize: 12 }}>
                  {new Date(model.modified_at).toLocaleDateString()}
                </td>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
                  {isRunning(model.name) ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                      borderRadius: 4, fontSize: 11, fontWeight: 500,
                      background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-success)',
                    }}>
                      <Play size={10} /> Running
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-text-dim)', fontSize: 12 }}>Idle</span>
                  )}
                </td>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {activeModel !== model.name && (
                      <button onClick={() => handleSetActive(model.name)} title="Set as active" style={{
                        background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                        padding: '4px 8px', color: 'var(--color-accent-light)', cursor: 'pointer', display: 'flex', alignItems: 'center',
                      }}>
                        <Check size={13} />
                      </button>
                    )}
                    <button onClick={() => handleShowInfo(model.name)} title="Model info" style={{
                      background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                      padding: '4px 8px', color: 'var(--color-text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    }}>
                      <Info size={13} />
                    </button>
                    <button onClick={() => setSettingsModel(model.name)} title="Per-model settings" style={{
                      background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                      padding: '4px 8px', color: 'var(--color-text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    }}>
                      <Sliders size={13} />
                    </button>
                    <button onClick={() => { setCopySource(model.name); setCopyDest(''); }} title="Copy model" style={{
                      background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                      padding: '4px 8px', color: 'var(--color-text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    }}>
                      <Copy size={13} />
                    </button>
                    <button onClick={() => handleDelete(model.name)} title="Delete model" style={{
                      background: 'none', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius)',
                      padding: '4px 8px', color: 'var(--color-danger)', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {models.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-dim)', fontSize: 13 }}>
            No models found. Pull a model to get started.
          </div>
        )}
      </div>

      {settingsModel && (
        <ModelSettingsEditor
          model={settingsModel}
          onClose={() => setSettingsModel(null)}
        />
      )}
    </div>
  );
}