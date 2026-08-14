import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Loader, AlertCircle, History, X } from 'lucide-react';
import {
  getAsset, getAssetEstimate, reviseAsset, approveAsset, cancelAsset,
  type AssetDetail, type AssetEstimate, type AssetStage,
} from '../api/assets';
import { MediaImage } from './MediaImage';
import { MediaAudio } from './MediaAudio';
import { JobProgress, type ProgressStatus } from './JobProgress';

const POLL_INTERVAL_MS = 2000;

const ACTIVE_STAGES: AssetStage[] = ['draft_queued', 'draft_running', 'final_queued', 'final_running'];

// AssetCard is generic across asset types, but the preview media isn't
// always an image - character_voice produces audio. Add future
// audio-producing asset types here.
const AUDIO_ASSET_TYPES = new Set(['character_voice']);

// Maps a creative_assets.stage onto the queued/running/succeeded/failed/canceled
// vocabulary JobProgress already understands, so the same progress bar/ETA UI
// used for plain generation jobs works for asset pipeline stages too.
function toProgressStatus(stage: AssetStage): ProgressStatus {
  if (stage === 'draft_queued' || stage === 'final_queued') return 'queued';
  if (stage === 'draft_running' || stage === 'final_running') return 'running';
  if (stage === 'failed') return 'failed';
  if (stage === 'canceled') return 'canceled';
  return 'succeeded'; // awaiting_review / approved / final_ready
}

const STAGE_LABEL: Record<AssetStage, string> = {
  draft_queued: 'Draft queued',
  draft_running: 'Generating draft…',
  awaiting_review: 'Awaiting your review',
  revision_requested: 'Revision requested',
  approved: 'Approved',
  final_queued: 'Final render queued',
  final_running: 'Rendering final…',
  final_ready: 'Final ready',
  failed: 'Failed',
  canceled: 'Canceled',
};

function StageIcon({ stage }: { stage: AssetStage }) {
  if (stage === 'final_ready') return <CheckCircle size={14} color="var(--color-success, #22c55e)" />;
  if (stage === 'failed') return <XCircle size={14} color="var(--color-error, #ef4444)" />;
  if (stage === 'canceled') return <XCircle size={14} color="var(--color-text-dim)" />;
  if (ACTIVE_STAGES.includes(stage)) return <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />;
  return <CheckCircle size={14} color="var(--color-accent-light)" />;
}

export function AssetCard({ assetId }: { assetId: number }) {
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [estimate, setEstimate] = useState<AssetEstimate | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, est] = await Promise.all([getAsset(assetId), getAssetEstimate(assetId)]);
      setAsset(a);
      setEstimate(est);
    } catch { /* keep last known state, retry next tick */ }
  }, [assetId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!asset || !ACTIVE_STAGES.includes(asset.stage)) return;
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [asset, refresh]);

  if (!asset) {
    return (
      <div style={{ padding: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
        <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const params = (() => { try { return JSON.parse(asset.params) as Record<string, unknown>; } catch { return {}; } })();
  const prompt = typeof params.prompt === 'string' ? params.prompt : '';
  const previewMediaId = asset.stage === 'final_ready' ? asset.final_media_id : asset.draft_media_id;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e: unknown) {
      const ae = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ae?.response?.data?.error || ae?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StageIcon stage={asset.stage} />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', flex: 1 }}>
          {asset.name || asset.asset_type} <span style={{ color: 'var(--color-text-dim)' }}>#{asset.id}</span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>{STAGE_LABEL[asset.stage]}</span>
      </div>

      {prompt && (
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {prompt}
        </div>
      )}

      {ACTIVE_STAGES.includes(asset.stage) && (
        <JobProgress
          status={toProgressStatus(asset.stage)}
          progressPct={estimate?.progress_pct ?? 0}
          createdAt={Date.parse(`${asset.updated_at}Z`)}
          etaSeconds={estimate?.remaining_s ?? null}
          statusLabel={
            estimate?.sample_count === 0
              ? 'estimating (no history yet)…'
              : undefined
          }
        />
      )}

      {previewMediaId != null && (
        AUDIO_ASSET_TYPES.has(asset.asset_type)
          ? <MediaAudio mediaId={previewMediaId} />
          : <MediaImage mediaId={previewMediaId} alt={prompt || asset.asset_type} />
      )}

      {asset.stage === 'failed' && asset.error && (
        <div style={{ fontSize: 12, color: 'var(--color-error, #ef4444)' }}>{asset.error}</div>
      )}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-error, #ef4444)' }}>
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {(asset.stage === 'awaiting_review' || asset.stage === 'failed') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Request changes, e.g. 'make the jacket blue'…"
            rows={2}
            style={{
              background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
              color: 'var(--color-text)', padding: '6px 8px', fontSize: 12, resize: 'vertical', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={busy || !note.trim()}
              onClick={() => run(async () => { await reviseAsset(asset.id, note.trim()); setNote(''); })}
              style={btnStyle('secondary', busy || !note.trim())}
            >
              Request changes
            </button>
            {asset.stage === 'awaiting_review' && (
              <button
                disabled={busy}
                onClick={() => run(() => approveAsset(asset.id))}
                style={btnStyle('primary', busy)}
              >
                Approve &amp; render final
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {asset.revisions.length > 0 && (
          <button onClick={() => setShowHistory((v) => !v)} style={linkBtnStyle}>
            <History size={12} /> {asset.revisions.length} revision{asset.revisions.length !== 1 ? 's' : ''}
          </button>
        )}
        {ACTIVE_STAGES.includes(asset.stage) && (
          <button onClick={() => run(() => cancelAsset(asset.id))} style={linkBtnStyle} disabled={busy}>
            <X size={12} /> Cancel
          </button>
        )}
      </div>

      {showHistory && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
          {asset.revisions.map((r) => (
            <div key={r.id} style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>{new Date(r.created_at).toLocaleString()}</span> — "{r.note}"
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function btnStyle(kind: 'primary' | 'secondary', disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
    border: kind === 'primary' ? 'none' : '1px solid var(--color-border)',
    background: kind === 'primary' ? 'var(--color-accent)' : 'transparent',
    color: kind === 'primary' ? '#fff' : 'var(--color-text-secondary)',
  };
}

const linkBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
  cursor: 'pointer', color: 'var(--color-text-dim)', fontSize: 11, padding: 0,
};
