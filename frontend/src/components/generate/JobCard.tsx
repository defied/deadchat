import { useState } from 'react';
import { CheckCircle, Clapperboard, Cloud, Cpu, Loader2, ShieldCheck, Sparkles, X, XCircle } from 'lucide-react';
import type { Job } from '../../api/jobs';
import type { CatalogModel, GenerationMeta } from '../../api/generate';
import { MediaImage } from '../MediaImage';
import { MediaVideo } from '../MediaVideo';
import { formatElapsed } from '../JobProgress';
import { parseDbDate } from '../chat/ChatSidebar';

export interface JobView {
  job: Job;
  model?: CatalogModel;
}

function parseResult(job: Job): { mediaId?: number; meta: GenerationMeta } {
  if (!job.result) return { meta: {} };
  try {
    const r = JSON.parse(job.result) as { media_ids?: number[]; meta?: GenerationMeta };
    return { mediaId: r.media_ids?.[0], meta: r.meta ?? {} };
  } catch {
    return { meta: {} };
  }
}

function jobPrompt(job: Job): string {
  try {
    return String((JSON.parse(job.params) as { prompt?: string }).prompt ?? '');
  } catch {
    return '';
  }
}

export function JobCard({
  view,
  onAnimate,
  onCancel,
}: {
  view: JobView;
  onAnimate?: (mediaId: number) => void;
  onCancel?: (jobId: number) => void;
}) {
  const { job, model } = view;
  const [showPrompt, setShowPrompt] = useState(false);
  const { mediaId, meta } = parseResult(job);
  const active = job.status === 'queued' || job.status === 'running';
  const started = job.started_at ? parseDbDate(job.started_at).getTime() : parseDbDate(job.created_at).getTime();
  const ended = job.finished_at ? parseDbDate(job.finished_at).getTime() : Date.now();
  const elapsed = formatElapsed(Math.max(0, ended - started));

  return (
    <div className="card job-card">
      <div className="job-head">
        {active ? (
          <Loader2 size={15} className="spin" />
        ) : job.status === 'succeeded' ? (
          <CheckCircle size={15} color="var(--color-success)" />
        ) : (
          <XCircle size={15} color="var(--color-danger)" />
        )}
        <b>{model?.label ?? meta.modelLabel ?? job.type}</b>
        {model && (
          <span className="badge">
            {model.backend === 'api' ? <Cloud size={10} /> : <Cpu size={10} />} {model.backend === 'api' ? 'hosted' : 'local'}
          </span>
        )}
        {meta.verdict && (
          <span
            className={`badge ${meta.verdict.pass ? 'badge-success' : 'badge-warn'}`}
            title={meta.verdict.issues.length ? meta.verdict.issues.join('\n') : 'No issues found'}
          >
            <ShieldCheck size={10} /> check {meta.verdict.score}/10
            {(meta.attempts?.length ?? 0) > 1 ? ` · ${meta.attempts!.length} tries` : ''}
          </span>
        )}
        {meta.enhanced && (
          <span className="badge" title="The prompt was refined by the local LLM">
            <Sparkles size={10} /> refined
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-dim)', fontSize: 12 }}>
          {job.status === 'queued' ? 'queued' : elapsed}
        </span>
        {active && onCancel && (
          <button className="icon-btn" title="Cancel" onClick={() => onCancel(job.id)}>
            <X size={14} />
          </button>
        )}
      </div>

      <div className="job-prompt">{jobPrompt(job)}</div>

      {active && (
        <>
          <div className="progress">
            <div style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>
            {job.status === 'queued' ? 'Waiting for the GPU…' : job.stage || 'Working…'}
          </div>
        </>
      )}

      {job.status === 'failed' && <div className="alert alert-error" style={{ margin: 0 }}>{job.error}</div>}

      {mediaId && (
        <div className="job-result">
          {job.type === 'video' ? <MediaVideo mediaId={mediaId} maxHeight={480} /> : <MediaImage mediaId={mediaId} maxHeight={480} />}
        </div>
      )}

      {job.status === 'succeeded' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {job.type === 'image' && mediaId && onAnimate && (
            <button className="btn btn-sm" onClick={() => onAnimate(mediaId)}>
              <Clapperboard size={13} /> Animate this
            </button>
          )}
          {meta.finalPrompt && (
            <button className="btn btn-sm btn-ghost" onClick={() => setShowPrompt((v) => !v)}>
              {showPrompt ? 'Hide' : 'Show'} the prompt that was used
            </button>
          )}
        </div>
      )}
      {showPrompt && meta.finalPrompt && (
        <div className="snippet" style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, paddingRight: 12 }}>
          {meta.finalPrompt}
          {meta.seed != null && <div style={{ color: 'var(--color-text-dim)', marginTop: 6 }}>seed {meta.seed}</div>}
        </div>
      )}
    </div>
  );
}
