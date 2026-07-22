import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, AlertCircle, Pause, Play, RefreshCw, Zap, Cpu, StopCircle, Trash2, Database } from 'lucide-react';
import * as comfyApi from '../../api/comfyui';
import type { ComfyLiveStats, ComfyModels, ComfyDevice } from '../../api/comfyui';

const POLL_INTERVAL_MS = 3000;

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

function formatRelative(iso: string): string {
  // history entries don't have timestamps in the summary, placeholder
  return iso;
}

export function ComfyUIStatsPanel() {
  const [stats, setStats] = useState<ComfyLiveStats | null>(null);
  const [models, setModels] = useState<ComfyModels | null>(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [urlEdit, setUrlEdit] = useState('');
  const [urlInfo, setUrlInfo] = useState<comfyApi.BackendUrlInfo | null>(null);
  const [urlSaving, setUrlSaving] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const poll = useCallback(async () => {
    try {
      const data = await comfyApi.getLiveStats();
      setStats(data);
      setLastUpdated(Date.now());
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load ComfyUI stats');
    }
  }, []);

  useEffect(() => {
    poll();
    const id = window.setInterval(() => {
      if (!pausedRef.current) poll();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  useEffect(() => {
    comfyApi.getModels().then(setModels).catch(() => {});
    comfyApi.getBackendUrl().then((info) => {
      setUrlInfo(info);
      setUrlEdit(info.isOverride ? info.url : '');
    }).catch(() => {});
  }, []);

  const handleInterrupt = async () => {
    try {
      setActionError('');
      await comfyApi.interrupt();
      poll();
    } catch (err: any) {
      setActionError(err?.response?.data?.error || err?.message || 'Interrupt failed');
    }
  };

  const handleClearQueue = async () => {
    if (!window.confirm('Clear the entire ComfyUI queue?')) return;
    try {
      setActionError('');
      await comfyApi.clearQueue();
      poll();
    } catch (err: any) {
      setActionError(err?.response?.data?.error || err?.message || 'Clear queue failed');
    }
  };

  const handleFreeVram = async () => {
    try {
      setActionError('');
      await comfyApi.freeMemory();
      poll();
    } catch (err: any) {
      setActionError(err?.response?.data?.error || err?.message || 'Free VRAM failed');
    }
  };

  const handleUrlSave = async () => {
    setUrlSaving(true);
    try {
      const info = await comfyApi.setBackendUrl(urlEdit.trim() || null);
      setUrlInfo(info);
      setUrlEdit(info.isOverride ? info.url : '');
      poll();
    } catch (err: any) {
      setActionError(err?.response?.data?.error || err?.message || 'Failed to update URL');
    } finally {
      setUrlSaving(false);
    }
  };

  const deltaLabel = lastUpdated
    ? (() => {
        const s = Math.floor((Date.now() - lastUpdated) / 1000);
        if (s < 5) return 'just now';
        if (s < 60) return `${s}s ago`;
        return `${Math.floor(s / 60)}m ago`;
      })()
    : '...';

  const ok = !!stats?.reachable;

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', marginBottom: 14,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <Dot ok={ok} />
          <span style={{ color: 'var(--color-text-secondary)' }}>
            ComfyUI {ok ? 'connected' : 'unreachable'}
          </span>
          {stats?.error && (
            <span style={{ color: 'var(--color-danger)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              ({stats.error})
            </span>
          )}
          <span style={{ color: 'var(--color-text-dim)', marginLeft: 12 }}>
            {paused ? 'paused' : deltaLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <IconBtn onClick={() => setPaused((p) => !p)} title={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </IconBtn>
          <IconBtn onClick={poll} title="Refresh now">
            <RefreshCw size={13} />
          </IconBtn>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {actionError && <ErrorBanner message={actionError} />}

      {stats && (
        <>
          {/* Queue tiles */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10, marginBottom: 14,
          }}>
            <MetricTile
              icon={<Activity size={14} />}
              label="running"
              value={stats.queue.running.toString()}
              sub={stats.queue.running > 0 ? 'generation in progress' : 'idle'}
            />
            <MetricTile
              icon={<Activity size={14} />}
              label="queued"
              value={stats.queue.pending.toString()}
              sub="pending jobs"
            />
            <MetricTile
              icon={<Activity size={14} />}
              label="recent (30)"
              value={stats.history.length.toString()}
              sub={`${stats.history.filter((h) => h.status === 'error').length} errors`}
            />
            {stats.system && (
              <MetricTile
                icon={<Cpu size={14} />}
                label="python"
                value={stats.system.python_version.split('.').slice(0, 2).join('.')}
                sub={stats.system.os}
              />
            )}
          </div>

          {/* VRAM devices */}
          {stats.devices.filter((d) => d.vram_total).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <SectionLabel icon={<Zap size={13} />} title="GPU / VRAM" />
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 10,
              }}>
                {stats.devices.filter((d) => d.vram_total).map((d, i) => (
                  <DeviceCard key={i} device={d} />
                ))}
              </div>
            </div>
          )}

          {/* Models + queue detail row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 10, marginBottom: 14,
          }}>
            {models && (
              <Card title="Installed models" icon={<Database size={13} />}>
                <ModelCountsBlock models={models} />
              </Card>
            )}
            {(stats.queue.running > 0 || stats.queue.pending > 0) && (
              <Card title="Queue detail" icon={<Activity size={13} />}>
                <QueueDetailBlock stats={stats} />
              </Card>
            )}
          </div>

          {/* Recent history table */}
          {stats.history.length > 0 && (
            <Card title={`Recent history (${stats.history.length})`} style={{ marginBottom: 14 }}>
              <HistoryTable entries={stats.history} />
            </Card>
          )}

          {/* Actions + URL */}
          <Card title="Controls & configuration">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <ActionBtn onClick={handleInterrupt} icon={<StopCircle size={13} />} label="Interrupt" danger />
                <ActionBtn onClick={handleClearQueue} icon={<Trash2 size={13} />} label="Clear queue" danger />
                <ActionBtn onClick={handleFreeVram} icon={<Zap size={13} />} label="Free VRAM" />
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                <div style={{
                  fontSize: 11, color: 'var(--color-text-dim)', marginBottom: 6,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  Backend URL
                  {urlInfo?.isOverride && (
                    <span style={{
                      marginLeft: 8, fontSize: 10, color: 'var(--color-accent-light)',
                      border: '1px solid var(--color-accent-light)',
                      borderRadius: 3, padding: '1px 5px',
                    }}>override</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                  Effective: {urlInfo?.url}
                  {!urlInfo?.isOverride && (
                    <span style={{ marginLeft: 8, opacity: 0.6 }}>(env default)</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={urlEdit}
                    onChange={(e) => setUrlEdit(e.target.value)}
                    placeholder={urlInfo?.default || 'http://host:8188'}
                    style={{
                      flex: 1, padding: '6px 10px', fontSize: 12,
                      background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)', color: 'var(--color-text)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                  <button
                    onClick={handleUrlSave}
                    disabled={urlSaving}
                    style={{
                      padding: '6px 14px', fontSize: 12, cursor: 'pointer',
                      background: 'var(--color-accent)', color: '#fff', border: 'none',
                      borderRadius: 'var(--radius)', opacity: urlSaving ? 0.6 : 1,
                    }}
                  >
                    {urlSaving ? 'Saving…' : 'Save'}
                  </button>
                  {urlInfo?.isOverride && (
                    <button
                      onClick={async () => {
                        const info = await comfyApi.setBackendUrl(null);
                        setUrlInfo(info);
                        setUrlEdit('');
                      }}
                      style={{
                        padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                        background: 'transparent', color: 'var(--color-text-dim)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function DeviceCard({ device }: { device: ComfyDevice }) {
  const total     = device.vram_total ?? 0;
  const free      = device.vram_free ?? 0;
  const used      = total - free;
  const pct       = total > 0 ? (used / total) * 100 : 0;
  const tTotal    = device.torch_vram_total ?? total;
  const tFree     = device.torch_vram_free ?? free;
  const tUsed     = tTotal - tFree;

  return (
    <Card title={device.name} icon={<Zap size={13} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <GaugeRow
          label="VRAM used"
          pct={pct}
          detail={`${formatBytes(used)} / ${formatBytes(total)}`}
        />
        {tTotal > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
            paddingTop: 8, borderTop: '1px solid var(--color-border)',
          }}>
            <StatPair label="Torch used" value={formatBytes(tUsed)} />
            <StatPair label="Torch free" value={formatBytes(tFree)} />
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)' }}>
          {device.type}{device.index !== undefined ? ` · device ${device.index}` : ''}
        </div>
      </div>
    </Card>
  );
}

function ModelCountsBlock({ models }: { models: ComfyModels }) {
  const rows: [string, number][] = [
    ['Checkpoints', models.checkpoints.length],
    ['UNETs (Flux)', models.unets.length],
    ['LoRAs', models.loras.length],
    ['VAE', models.vae.length],
    ['ControlNets', models.controlnets.length],
    ['Upscalers', models.upscalers.length],
    ['CLIP', models.clip.length],
  ].filter(([, count]) => (count as number) > 0) as [string, number][];

  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>No models found.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {rows.map(([label, count]) => (
        <StatPair key={label} label={label} value={count.toString()} />
      ))}
    </div>
  );
}

function QueueDetailBlock({ stats }: { stats: ComfyLiveStats }) {
  const items = [...stats.queue.runningItems, ...stats.queue.pendingItems];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item) => {
        const isRunning = stats.queue.runningItems.some((r) => r.promptId === item.promptId);
        return (
          <div key={item.promptId} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 12, fontFamily: 'var(--font-mono)',
          }}>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
              background: isRunning ? 'rgba(99,102,241,0.15)' : 'var(--color-bg)',
              color: isRunning ? 'var(--color-accent-light)' : 'var(--color-text-dim)',
              border: `1px solid ${isRunning ? 'rgba(99,102,241,0.3)' : 'var(--color-border)'}`,
            }}>
              {isRunning ? 'running' : `#${item.number}`}
            </span>
            <span style={{ color: 'var(--color-text-dim)' }}>{item.promptId.slice(0, 8)}…</span>
          </div>
        );
      })}
    </div>
  );
}

function HistoryTable({ entries }: { entries: ComfyLiveStats['history'] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Prompt ID', 'Status', 'Outputs', 'Error'].map((h) => (
              <th key={h} style={{
                textAlign: 'left', padding: '6px 10px',
                borderBottom: '1px solid var(--color-border)',
                color: 'var(--color-text-dim)', fontSize: 10, fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const isOk = e.status === 'success' || e.completed;
            const isErr = e.status === 'error';
            return (
              <tr key={e.promptId}>
                <td style={{ ...cellStyle, fontFamily: 'var(--font-mono)' }}>
                  {e.promptId.slice(0, 8)}…
                </td>
                <td style={cellStyle}>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    background: isOk ? 'rgba(34,197,94,0.1)' : isErr ? 'rgba(239,68,68,0.1)' : 'var(--color-bg)',
                    color: isOk ? 'var(--color-success,#22c55e)' : isErr ? 'var(--color-danger)' : 'var(--color-text-dim)',
                    border: `1px solid ${isOk ? 'rgba(34,197,94,0.3)' : isErr ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}`,
                  }}>
                    {e.status}
                  </span>
                </td>
                <td style={cellStyle}>{e.outputCount || '—'}</td>
                <td style={{ ...cellStyle, color: 'var(--color-danger)', maxWidth: 240 }}>
                  {e.error ? (
                    <span title={e.error} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.error}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

void formatRelative; // unused but kept for future timestamp support

const cellStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap',
};

function StatPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
        {value}
      </div>
    </div>
  );
}

function GaugeRow({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const colour = pct > 85 ? 'var(--color-danger)' : pct > 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-accent-light)';
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4,
      }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-dim)' }}>
          {detail} · {pct.toFixed(0)}%
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--color-bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(100, pct)}%`, height: '100%',
          background: colour, transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

function MetricTile({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub: string;
}) {
  return (
    <div style={{
      padding: 12, background: 'var(--color-surface)',
      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)', marginTop: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Card({ title, icon, children, style }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      padding: 14, background: 'var(--color-surface)',
      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
      ...style,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em',
        color: 'var(--color-text-dim)', marginBottom: 10,
      }}>
        {icon}{title}
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
      fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em',
      color: 'var(--color-text-dim)',
    }}>
      {icon}{title}
    </div>
  );
}

function ActionBtn({ onClick, icon, label, danger }: {
  onClick: () => void; icon: React.ReactNode; label: string; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', fontSize: 12, cursor: 'pointer',
        background: danger ? 'rgba(239,68,68,0.08)' : 'var(--color-bg)',
        color: danger ? 'var(--color-danger)' : 'var(--color-text-secondary)',
        border: `1px solid ${danger ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius)',
      }}
    >
      {icon}{label}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      padding: '10px 14px', marginBottom: 14,
      background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
      borderRadius: 'var(--radius)', color: 'var(--color-danger)', fontSize: 13,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <AlertCircle size={14} /> {message}
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: ok ? 'var(--color-success,#22c55e)' : 'var(--color-danger)',
      boxShadow: ok ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
    }} />
  );
}

function IconBtn({ onClick, title, children }: {
  onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
        border: '1px solid var(--color-border)', background: 'transparent',
        color: 'var(--color-text-secondary)', borderRadius: 'var(--radius)',
        cursor: 'pointer', fontSize: 12,
      }}
    >
      {children}
    </button>
  );
}
