import { Clock } from 'lucide-react';

export type ProgressStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export interface JobProgressProps {
  status: ProgressStatus;
  progressPct: number; // 0-100
  startedAt?: number; // epoch ms
  createdAt: number; // epoch ms
  // Server-computed ETA (seconds). When omitted, falls back to local
  // extrapolation from elapsed-time / progress-so-far.
  etaSeconds?: number | null;
  statusLabel?: string;
}

// Reusable progress bar + elapsed/ETA readout, shared by plain generation jobs
// (GeneratePanel's JobCard) and creative-asset pipeline cards (AssetCard).
export function JobProgress({ status, progressPct, startedAt, createdAt, etaSeconds, statusLabel }: JobProgressProps) {
  const now = Date.now();
  const isActive = status === 'queued' || status === 'running';
  const referenceTime = startedAt ?? createdAt;
  const elapsedMs = now - referenceTime;
  const elapsedLabel = formatElapsed(Math.max(0, elapsedMs));

  let etaLabel: string | null = null;
  if (status === 'running') {
    if (etaSeconds != null && etaSeconds > 0) {
      etaLabel = formatElapsed(etaSeconds * 1000);
    } else if (etaSeconds == null && startedAt && progressPct > 2) {
      const runningMs = now - startedAt;
      const estimatedTotalMs = runningMs / (progressPct / 100);
      const remainingMs = estimatedTotalMs - runningMs;
      if (remainingMs > 0) etaLabel = formatElapsed(remainingMs);
    }
  }

  const barWidth = status === 'running'
    ? Math.max(2, Math.min(99, progressPct))
    : status === 'queued'
      ? 0
      : 100;

  if (!isActive) {
    if (!startedAt) return null;
    return (
      <div style={{ fontSize: 11, color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)' }}>
        Took {elapsedLabel}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
        {status === 'queued' ? (
          <div style={{
            height: '100%', width: '100%',
            background: `linear-gradient(90deg, transparent 0%, var(--color-accent) 50%, transparent 100%)`,
            animation: 'shimmer 1.5s infinite',
            backgroundSize: '200% 100%',
          }} />
        ) : (
          <div style={{
            height: '100%',
            width: `${barWidth}%`,
            background: 'var(--color-accent)',
            borderRadius: 2,
            transition: 'width 0.8s ease',
          }} />
        )}
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-dim)',
      }}>
        <span>
          {statusLabel ?? (status === 'queued'
            ? 'waiting in queue…'
            : progressPct > 0
              ? `${progressPct.toFixed(0)}% complete`
              : 'starting…')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={10} />
          {elapsedLabel}
          {etaLabel && (
            <span style={{ color: 'var(--color-text-secondary)', marginLeft: 4 }}>
              · ~{etaLabel} left
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
