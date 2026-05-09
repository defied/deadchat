import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, AlertCircle, Pause, Play, RefreshCw, Cpu, MemoryStick, Zap, Server, Globe } from 'lucide-react';
import * as ollamaApi from '../../api/ollama';
import type { LiveStats, LiveRequestEvent } from '../../api/ollama';

const POLL_INTERVAL_MS = 2000;

function formatBytes(mb: number): string {
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDuration(ns?: number): string {
  if (!ns || !Number.isFinite(ns)) return '—';
  const ms = ns / 1e6;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

function formatRelative(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 1000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expiring';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return `${Math.floor(ms / 1000)}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function LiveStatsPanel() {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const poll = useCallback(async () => {
    try {
      const data = await ollamaApi.getLiveStats();
      setStats(data);
      setLastUpdated(Date.now());
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load live stats');
    }
  }, []);

  useEffect(() => {
    poll();
    const id = window.setInterval(() => {
      if (!pausedRef.current) poll();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  if (!stats && !error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-dim)', fontSize: 13 }}>
        Loading live stats...
      </div>
    );
  }

  const ollamaOk = !!stats && !stats.ollamaError;

  return (
    <div>
      {/* Header strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', marginBottom: 14,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <Dot ok={ollamaOk} />
          <span style={{ color: 'var(--color-text-secondary)' }}>
            Ollama {ollamaOk ? 'connected' : 'unreachable'}
          </span>
          {stats?.ollamaError && (
            <span style={{ color: 'var(--color-danger)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              ({stats.ollamaError})
            </span>
          )}
          <span style={{ color: 'var(--color-text-dim)', marginLeft: 12 }}>
            {paused
              ? 'paused'
              : lastUpdated
                ? `updated ${formatRelative(lastUpdated)}`
                : '...'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <IconBtn onClick={() => setPaused((p) => !p)} title={paused ? 'Resume polling' : 'Pause polling'}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </IconBtn>
          <IconBtn onClick={poll} title="Refresh now">
            <RefreshCw size={13} />
          </IconBtn>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 14,
          background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 'var(--radius)', color: 'var(--color-danger)', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {stats && (
        <>
          {/* Rolling metrics tiles */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10, marginBottom: 14,
          }}>
            <MetricTile
              icon={<Activity size={14} />}
              label={`requests (${Math.round(stats.rolling.windowMs / 60000)}m)`}
              value={stats.rolling.requests.toString()}
              sub={stats.rolling.errors ? `${stats.rolling.errors} errors` : 'no errors'}
            />
            <MetricTile
              icon={<Zap size={14} />}
              label="tokens/sec (avg)"
              value={stats.rolling.avgTokensPerSec.toFixed(1)}
              sub={`p50 ${stats.rolling.p50TokensPerSec.toFixed(1)} · p95 ${stats.rolling.p95TokensPerSec.toFixed(1)}`}
            />
            <MetricTile
              icon={<Activity size={14} />}
              label="tokens out"
              value={stats.rolling.totalEvalTokens.toLocaleString()}
              sub={`${stats.rolling.totalPromptTokens.toLocaleString()} in`}
            />
            <MetricTile
              icon={<Zap size={14} />}
              label="time to first token"
              value={stats.rolling.avgTtftMs > 0 ? `${Math.round(stats.rolling.avgTtftMs)} ms` : '—'}
              sub="window avg"
            />
          </div>

          {/* Resources row: Backend pod / Frontend pod / Cluster node */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 10, marginBottom: 14,
          }}>
            <Card title="Backend (pod)" icon={<Server size={13} />}>
              <BackendBlock stats={stats} />
            </Card>
            <Card title="Frontend (pod)" icon={<Globe size={13} />}>
              <FrontendBlock stats={stats} />
            </Card>
            <Card title="Cluster node (shared)" icon={<Cpu size={13} />}>
              <NodeBlock stats={stats} />
            </Card>
          </div>

          {/* GPU + loaded models row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 10, marginBottom: 14,
          }}>
            <Card title="GPU / VRAM (Ollama host)" icon={<Zap size={13} />}>
              <GpuBlock stats={stats} />
            </Card>
            <Card title={`Loaded models (${stats.running.length})`}>
              {stats.running.length === 0 ? (
                <div style={{ color: 'var(--color-text-dim)', fontSize: 13, padding: '4px 0' }}>
                  No models currently loaded into memory.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {stats.running.map((m) => (
                    <div key={m.name} style={{
                      padding: 10, background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <strong style={{ fontSize: 13, color: 'var(--color-text)' }}>{m.name}</strong>
                        <span style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>
                          TTL {formatExpiry(m.expires_at)}
                        </span>
                      </div>
                      <div style={{
                        marginTop: 6, fontSize: 11, color: 'var(--color-text-dim)',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        VRAM {formatBytes(m.size_vram / (1024 * 1024))} · total {formatBytes(m.size / (1024 * 1024))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Recent requests */}
          <Card title={`Recent requests (${stats.recent.length})`}>
            {stats.recent.length === 0 ? (
              <div style={{ color: 'var(--color-text-dim)', fontSize: 13, padding: '8px 0' }}>
                No requests yet — chat with a model to populate.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['When', 'User', 'Model', 'Prompt', 'Out', 'TTFT', 'Tok/s', 'Total', ''].map((h) => (
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
                    {stats.recent.map((r) => <RequestRow key={r.id} r={r} />)}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function RequestRow({ r }: { r: LiveRequestEvent }) {
  const ttft = r.firstTokenAt ? r.firstTokenAt - r.startedAt : undefined;
  const tps = r.evalDurationNs && r.evalTokens
    ? r.evalTokens / (r.evalDurationNs / 1e9)
    : undefined;

  return (
    <tr>
      <td style={cellStyle}>{formatRelative(r.finishedAt)}</td>
      <td style={cellStyle}>{r.username}</td>
      <td style={{ ...cellStyle, fontFamily: 'var(--font-mono)' }}>{r.model}</td>
      <td style={cellStyle}>{r.promptTokens || '—'}</td>
      <td style={cellStyle}>{r.evalTokens || '—'}</td>
      <td style={cellStyle}>{ttft !== undefined ? `${ttft} ms` : '—'}</td>
      <td style={cellStyle}>{tps !== undefined ? tps.toFixed(1) : '—'}</td>
      <td style={cellStyle}>{formatDuration(r.totalDurationNs)}</td>
      <td style={cellStyle}>
        {r.error && (
          <span title={r.error} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            color: 'var(--color-danger)', fontSize: 11,
          }}>
            <AlertCircle size={11} /> error
          </span>
        )}
      </td>
    </tr>
  );
}

const cellStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap',
};

function BackendBlock({ stats }: { stats: LiveStats }) {
  const heapPctOfRss = stats.backend.processRssMB > 0
    ? (stats.backend.processHeapUsedMB / stats.backend.processRssMB) * 100
    : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <GaugeRow
        icon={<MemoryStick size={13} />}
        label="Heap / RSS"
        pct={heapPctOfRss}
        detail={`${formatBytes(stats.backend.processHeapUsedMB)} / ${formatBytes(stats.backend.processRssMB)}`}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: 'var(--color-text-dim)',
        paddingTop: 4, borderTop: '1px solid var(--color-border)',
      }}>
        <span>Uptime {formatUptime(stats.backend.uptimeSec)}</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>Node {stats.backend.nodeVersion}</span>
      </div>
    </div>
  );
}

function FrontendBlock({ stats }: { stats: LiveStats }) {
  const fe = stats.frontend;
  if (!fe.status) {
    return (
      <div style={{ color: 'var(--color-text-dim)', fontSize: 12, padding: '4px 0' }}>
        {fe.error || 'Frontend status unavailable'}
        <div style={{ fontSize: 11, marginTop: 4 }}>
          Backend scrapes <code>http://deadchat-frontend:8080/_nginx_status</code>. If you just rolled out, give the new frontend pod a minute to come up.
        </div>
      </div>
    );
  }
  const s = fe.status;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <StatPair label="Active conns" value={s.active.toString()} />
        <StatPair label="Requests (total)" value={s.requests.toLocaleString()} />
        <StatPair label="Reading" value={s.reading.toString()} />
        <StatPair label="Writing" value={s.writing.toString()} />
        <StatPair label="Waiting" value={s.waiting.toString()} />
        <StatPair label="Accepted / handled" value={`${s.accepts.toLocaleString()} / ${s.handled.toLocaleString()}`} />
      </div>
      <div style={{
        fontSize: 11, color: 'var(--color-text-dim)',
        paddingTop: 4, borderTop: '1px solid var(--color-border)',
      }}>
        nginx stub_status · static assets + /api proxy
      </div>
    </div>
  );
}

function NodeBlock({ stats }: { stats: LiveStats }) {
  const memUsed = stats.node.totalMemMB - stats.node.freeMemMB;
  const memPct = (memUsed / stats.node.totalMemMB) * 100;
  const loadPct = Math.min(100, (stats.node.loadavg[0] / stats.node.cpus) * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <GaugeRow
        icon={<MemoryStick size={13} />}
        label="System RAM"
        pct={memPct}
        detail={`${formatBytes(memUsed)} / ${formatBytes(stats.node.totalMemMB)}`}
      />
      <GaugeRow
        icon={<Cpu size={13} />}
        label={`CPU load (${stats.node.cpus} cores)`}
        pct={loadPct}
        detail={`${stats.node.loadavg.map((l) => l.toFixed(2)).join(' · ')}`}
      />
      <div style={{
        fontSize: 11, color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)',
        paddingTop: 4, borderTop: '1px solid var(--color-border)',
      }}>
        {stats.node.platform} · shared by all pods on this node
      </div>
    </div>
  );
}

function GpuBlock({ stats }: { stats: LiveStats }) {
  const { gpu } = stats;
  if (!gpu.reachable) {
    return (
      <div style={{ color: 'var(--color-text-dim)', fontSize: 12, padding: '4px 0' }}>
        Ollama host not reachable — cannot read VRAM occupancy.
      </div>
    );
  }
  if (gpu.models.length === 0) {
    return (
      <div style={{ color: 'var(--color-text-dim)', fontSize: 12, padding: '4px 0' }}>
        No models currently in VRAM. <span style={{ opacity: 0.7 }}>Chat with a model to populate.</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4,
        }}>
          <span>Total VRAM occupied</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-text)' }}>
            {formatBytes(gpu.totalVramMB)}
          </span>
        </div>
      </div>
      {gpu.models.map((m) => {
        const pct = Math.round((m.vramPct ?? 0) * 100);
        let label: string, color: string;
        if (pct >= 100)     { label = 'GPU';            color = 'var(--color-success, #22c55e)'; }
        else if (pct === 0) { label = 'CPU';            color = 'var(--color-danger, #ef4444)'; }
        else                { label = `GPU+CPU ${pct}%`; color = 'var(--color-warning, #f59e0b)'; }
        return (
          <div key={m.name} style={{
            fontSize: 11, color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)',
            display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
          }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{m.name}</span>
            <span style={{
              color, border: `1px solid ${color}`, borderRadius: 3,
              padding: '0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
            }}>{label}</span>
            <span>{formatBytes(m.vramMB)} / {formatBytes(m.totalMB)}</span>
          </div>
        );
      })}
      <div style={{
        fontSize: 11, color: 'var(--color-text-dim)',
        paddingTop: 4, borderTop: '1px solid var(--color-border)',
      }}>
        Source: {gpu.source} · occupancy only (not utilization %)
      </div>
    </div>
  );
}

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

function GaugeRow({ icon, label, pct, detail }: {
  icon: React.ReactNode; label: string; pct: number; detail: string;
}) {
  const colour = pct > 85 ? 'var(--color-danger)' : pct > 60 ? 'var(--color-warning, #f59e0b)' : 'var(--color-accent-light)';
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{icon}{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-dim)' }}>
          {detail} · {pct.toFixed(0)}%
        </span>
      </div>
      <div style={{
        height: 6, background: 'var(--color-bg)', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(100, pct)}%`, height: '100%', background: colour,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 14, background: 'var(--color-surface)',
      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
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

function Dot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: ok ? 'var(--color-success, #22c55e)' : 'var(--color-danger)',
      boxShadow: ok ? '0 0 6px rgba(34, 197, 94, 0.5)' : 'none',
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
