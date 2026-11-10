// Full multi-model analysis of one piece of evidence: pick a pipeline (one is
// suggested from the file and a first look), review every frame with the
// vision model, run the specialist models, and read the combined draft.
// Each stage shows progress, elapsed time and an estimate; observations jump
// the viewer to their frame.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Circle, Clock, Cpu, Loader2, Microscope, Play, Square, XCircle } from 'lucide-react';
import {
  analysisOptions,
  cancelAnalysis,
  getItemAnalysis,
  itemUrl,
  startAnalysis,
  suggestAnalysis,
  uploadSampledFrames,
  type Analysis,
  type AnalysisStage,
  type CaseItem,
  type PipelineId,
  type SpecialistResult,
} from '../../api/cases';
import { Markdown } from '../chat/Markdown';
import { blobUrl } from './blobs';
import { fmtDuration, sampleVideo } from './sampleVideo';
import { useReadOnly } from './access';

const LIVE = new Set(['queued', 'running']);
const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (e as Error)?.message ?? 'Failed';

export function canAnalyse(item: CaseItem): boolean {
  return item.status === 'ready' && (item.frames > 0 || (item.kind === 'image' && item.hasDisplay) || (item.kind === 'video' && item.hasDisplay && !!item.playable));
}

export function AnalysisPanel({ caseId, item, onSeek, onChanged }: { caseId: number; item: CaseItem; onSeek: (frame: number) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const key = ['case-analysis', caseId, item.id];
  const run = useQuery({
    queryKey: key,
    queryFn: () => getItemAnalysis(caseId, item.id),
    refetchInterval: (q) => (q.state.data?.current && LIVE.has(q.state.data.current.status) ? 2000 : false),
  });
  const current = run.data?.current ?? null;
  const live = !!current && LIVE.has(current.status);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) onChanged();
    wasLive.current = live;
  }, [live, onChanged]);

  const [showForm, setShowForm] = useState(false);
  const readOnly = useReadOnly();
  const form = !readOnly && (!current || showForm);

  return (
    <section className="cs-an">
      <h4>
        <Microscope size={12} /> Full analysis <span className="field-hint">draft</span>
      </h4>
      {run.isLoading ? (
        <Loader2 size={14} className="spin" />
      ) : form && !live ? (
        <StartForm caseId={caseId} item={item} onStarted={() => { setShowForm(false); void qc.invalidateQueries({ queryKey: key }); onChanged(); }} onCancel={current ? () => setShowForm(false) : undefined} />
      ) : !current ? (
        <p className="field-hint">Not analysed yet.</p>
      ) : current ? (
        <RunView caseId={caseId} item={item} a={current} onSeek={onSeek} onRerun={() => setShowForm(true)} onCanceled={() => void qc.invalidateQueries({ queryKey: key })} />
      ) : null}
    </section>
  );
}

// ── start ────────────────────────────────────────────────────────────────────

function StartForm({ caseId, item, onStarted, onCancel }: { caseId: number; item: CaseItem; onStarted: () => void; onCancel?: () => void }) {
  const opts = useQuery({ queryKey: ['case-analysis-options'], queryFn: analysisOptions, staleTime: 30_000 });
  const sugg = useQuery({ queryKey: ['case-analysis-suggest', caseId, item.id], queryFn: () => suggestAnalysis(caseId, item.id), staleTime: Infinity, retry: false });
  const [pipeline, setPipeline] = useState<PipelineId | ''>('');
  const [model, setModel] = useState('');
  const [skip, setSkip] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const chosen = pipeline || sugg.data?.pipeline || '';
  const frameModel = model || opts.data?.defaultFrameModel || '';
  const p = opts.data?.pipelines.find((x) => x.id === chosen);
  const fm = opts.data?.frameModels.find((m) => m.name === frameModel);
  // Default to skipping when the GPU service is offline, so a run is just the frame review and report.
  const skipSpecs = skip ?? !opts.data?.medService.reachable;
  const needsSampling = item.kind === 'video' && item.frames === 0 && !item.sampledFrames;

  const start = async () => {
    if (!chosen || !frameModel) return;
    setError(null);
    try {
      if (needsSampling) {
        abort.current = new AbortController();
        setBusy('Reading video frames…');
        const src = await blobUrl(itemUrl(caseId, item.id, 'display'));
        const { frames, fps } = await sampleVideo(src, (d, t) => setBusy(`Reading video frames… ${d}/${t}`), abort.current.signal);
        setBusy('Uploading frames…');
        await uploadSampledFrames(caseId, item.id, frames, fps, (f) => setBusy(`Uploading frames… ${Math.round(f * 100)}%`));
      }
      setBusy('Starting…');
      await startAnalysis(caseId, item.id, chosen, frameModel, skipSpecs);
      onStarted();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  if (opts.isLoading) return <span className="cs-proc"><Loader2 size={12} className="spin" /> Checking models…</span>;
  if (opts.error || !opts.data) return <span className="cs-warn"><AlertTriangle size={11} /> {errMsg(opts.error)}</span>;
  const o = opts.data;
  const frameCount = item.frames || item.sampledFrames?.count || (needsSampling ? null : 1);

  return (
    <div className="cs-an-form">
      <label className="cs-an-field">
        <span>Pipeline</span>
        <select value={chosen} onChange={(e) => setPipeline(e.target.value as PipelineId)} disabled={!!busy}>
          {!chosen && <option value="">{sugg.isLoading ? 'Suggesting…' : 'Pick one'}</option>}
          {o.pipelines.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
              {x.id === sugg.data?.pipeline ? ' (suggested)' : ''}
            </option>
          ))}
        </select>
      </label>
      {sugg.isLoading && <span className="cs-proc"><Loader2 size={11} className="spin" /> Taking a first look to suggest a pipeline…</span>}
      {sugg.data && <span className="field-hint">Suggested from {sugg.data.reasons.join('; ')}.</span>}
      {p && (
        <div className="cs-an-desc">
          <p>{p.description}</p>
          {p.specialists.length > 0 && (
            <ul className="cs-an-specs">
              {p.specialists.map((s) => (
                <li key={s.id} className={s.ready ? 'ok' : 'off'}>
                  {s.ready ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {s.label}
                  {!s.ready && <span className="field-hint"> ({s.error ?? 'not ready'})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <label className="cs-an-field">
        <span>Frame model</span>
        <select value={frameModel} onChange={(e) => setModel(e.target.value)} disabled={!!busy}>
          {o.frameModels.map((m) => (
            <option key={m.name} value={m.name} disabled={!m.installed}>
              {m.name}
              {m.parameterSize ? ` · ${m.parameterSize}` : ''}
              {m.recommended ? ' (recommended)' : ''}
              {!m.installed ? ' · not installed' : ''}
            </option>
          ))}
        </select>
      </label>
      {fm && !fm.installed && <span className="cs-warn"><AlertTriangle size={11} /> {fm.name} isn’t on the GPU box yet ({(fm.sizeBytes / 1e9).toFixed(0)} GB download).</span>}
      {p && p.specialists.length > 0 && (
        <label className="cs-an-check">
          <input type="checkbox" checked={skipSpecs} onChange={(e) => setSkip(e.target.checked)} disabled={!!busy} />
          Skip specialist models (frame review and report only)
        </label>
      )}
      {!o.medService.reachable && p?.specialists.length ? (
        <span className="field-hint"><Cpu size={11} /> Medical model service offline at {o.medService.url}.</span>
      ) : null}
      <span className="field-hint">
        <Clock size={11} /> {frameCount ? `Every ${item.stack ? 'slice' : 'frame'} (${frameCount}) is reviewed, ${Math.ceil(frameCount / 7)} window${frameCount > 7 ? 's' : ''} of up to 8.` : 'The video is read frame by frame first.'} Estimates appear once it starts.
      </span>
      {error && <span className="cs-warn"><AlertTriangle size={11} /> {error}</span>}
      <div className="cs-item-actions">
        <button className="btn btn-sm btn-primary" onClick={start} disabled={!!busy || !chosen || !fm?.installed}>
          {busy ? <Loader2 size={13} className="spin" /> : <Play size={13} />} {busy ?? 'Analyse'}
        </button>
        {busy && needsSampling && <button className="btn btn-sm" onClick={() => abort.current?.abort()}>Stop</button>}
        {onCancel && !busy && <button className="btn btn-sm btn-ghost" onClick={onCancel}>Back</button>}
      </div>
    </div>
  );
}

// ── progress and results ─────────────────────────────────────────────────────

function StageIcon({ s }: { s: AnalysisStage }) {
  if (s.status === 'running') return <Loader2 size={12} className="spin" />;
  if (s.status === 'done') return <CheckCircle2 size={12} className="cs-ok" />;
  if (s.status === 'failed') return <XCircle size={12} className="cs-bad" />;
  if (s.status === 'canceled') return <Square size={11} className="cs-dim" />;
  return <Circle size={11} className="cs-dim" />;
}

function RunView({ caseId, item, a, onSeek, onRerun, onCanceled }: { caseId: number; item: CaseItem; a: Analysis; onSeek: (f: number) => void; onRerun: () => void; onCanceled: () => void }) {
  const live = LIVE.has(a.status);
  const readOnly = useReadOnly();
  const [tab, setTab] = useState<'report' | 'timeline' | 'specialists'>('report');
  const r = a.results;
  const unit = r.frameUnit ?? 'frame';
  const obs = useMemo(
    () => (r.windows ?? []).flatMap((w) => w.observations.map((o) => ({ ...o, window: w }))).sort((x, y) => x.frame - y.frame),
    [r.windows],
  );
  const count = r.frameCount ?? 1;
  const specs = Object.entries(r.specialists ?? {});

  return (
    <div className="cs-an-run">
      <div className="cs-an-head">
        <strong>{a.pipelineLabel}</strong>
        <span className="field-hint">{a.frameModel}</span>
        <span className="sp-grow" />
        {live ? (
          <span className="cs-an-clock">
            <Clock size={11} /> {fmtDuration(a.elapsedS)} elapsed · ~{fmtDuration(a.etaS)} left
          </span>
        ) : (
          <span className={`cs-an-status ${a.status}`}>
            {a.status === 'done' ? 'Done' : a.status === 'canceled' ? 'Canceled' : 'Failed'} · {fmtDuration(a.elapsedS)}
          </span>
        )}
      </div>

      <ol className="cs-an-stages">
        {a.stages.map((s) => (
          <li key={s.id} className={s.status}>
            <StageIcon s={s} />
            <span className="cs-an-stage-label">{s.label}</span>
            {s.total > 1 && <span className="field-hint">{s.done}/{s.total} {s.unit}s</span>}
            <span className="sp-grow" />
            <span className="cs-an-time">
              {s.status === 'running'
                ? `${fmtDuration(s.elapsedS)}${s.etaS != null ? ` · ~${fmtDuration(s.etaS)} left` : ''}`
                : s.status === 'pending' && s.etaS != null
                  ? `~${fmtDuration(s.etaS)}`
                  : s.durationS != null
                    ? fmtDuration(s.durationS)
                    : ''}
            </span>
            {s.total > 1 && (s.status === 'running' || s.status === 'done') && (
              <progress max={s.total} value={s.done} />
            )}
            {s.error && <span className="cs-warn cs-an-err"><AlertTriangle size={11} /> {s.error}</span>}
          </li>
        ))}
      </ol>
      {a.error && <span className="cs-warn"><AlertTriangle size={11} /> {a.error}</span>}

      {obs.length > 0 && (
        <div className="cs-an-strip" title={`Observations along the ${unit}s; click to jump`}>
          {(r.windows ?? []).map((w) => (
            <span key={w.start} className="cs-an-cover" style={{ left: `${(w.start / count) * 100}%`, width: `${((w.end - w.start + 1) / count) * 100}%` }} />
          ))}
          {obs.map((o, i) => (
            <button key={i} className="cs-an-mark" style={{ left: `${((o.frame + 0.5) / count) * 100}%` }} onClick={() => onSeek(o.frame)} title={`${unit} ${o.frame + 1}${o.time ? ` @${o.time}` : ''}: ${o.finding}`} />
          ))}
        </div>
      )}

      <div className="cs-an-tabs">
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>Report</button>
        <button className={tab === 'timeline' ? 'on' : ''} onClick={() => setTab('timeline')}>
          {unit === 'slice' ? 'Slices' : 'Frames'} ({obs.length})
        </button>
        {specs.length > 0 && <button className={tab === 'specialists' ? 'on' : ''} onClick={() => setTab('specialists')}>Specialists ({specs.length})</button>}
      </div>

      {tab === 'report' &&
        (r.report ? (
          <div className="cs-an-report">
            <Markdown text={r.report} />
            <span className="field-hint">Written by {r.reportModel} from the analyses below. A draft: check it against the images.</span>
          </div>
        ) : (
          <p className="field-hint">{live ? 'The report is written after the frame review and specialist models finish.' : 'No report.'}</p>
        ))}

      {tab === 'timeline' && (
        <div className="cs-an-timeline">
          {(r.windows ?? []).map((w) => (
            <div key={w.start} className="cs-an-window">
              <button className="cs-an-range" onClick={() => onSeek(w.start)}>
                {unit}s {w.start + 1}–{w.end + 1}
                {unit === 'frame' && r.fps ? ` · ${(w.start / r.fps).toFixed(2)}–${((w.end + 1) / r.fps).toFixed(2)} s` : ''}
                <span className="field-hint"> · {fmtDuration(w.durationS)}</span>
              </button>
              {w.summary && <p>{w.summary}</p>}
              <ul>
                {w.observations.map((o, i) => (
                  <li key={i}>
                    <button className="cs-an-at" onClick={() => onSeek(o.frame)}>
                      {o.time ?? `#${o.frame + 1}`}
                    </button>{' '}
                    {o.finding}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!r.windows?.length && <p className="field-hint">No {unit}s reviewed yet.</p>}
        </div>
      )}

      {tab === 'specialists' && (
        <div className="cs-an-specialists">
          {specs.map(([id, s]) =>
            'error' in s ? (
              <div key={id} className="cs-an-spec">
                <strong>{id}</strong>
                <span className="cs-warn"><AlertTriangle size={11} /> {s.error}</span>
              </div>
            ) : (
              <SpecTable key={id} s={s} onSeek={onSeek} />
            ),
          )}
        </div>
      )}

      {!readOnly && (
      <div className="cs-item-actions">
        {live ? (
          <button
            className="btn btn-sm"
            onClick={async () => {
              await cancelAnalysis(caseId, item.id, a.id);
              onCanceled();
            }}
          >
            <Square size={12} /> Cancel
          </button>
        ) : (
          <button className="btn btn-sm" onClick={onRerun}>
            <Play size={12} /> Run again
          </button>
        )}
      </div>
      )}
    </div>
  );
}

function SpecTable({ s, onSeek }: { s: SpecialistResult; onSeek: (f: number) => void }) {
  return (
    <div className="cs-an-spec">
      <strong>
        {s.model}
        {s.version ? ` ${s.version}` : ''}
      </strong>
      <span className="field-hint"> · {fmtDuration(s.durationS)}</span>
      <table className="data-table">
        <tbody>
          {s.findings.map((f, i) => (
            <tr key={i}>
              <td>{f.label}</td>
              <td>
                {f.value !== undefined && f.value !== null ? `${String(f.value)}${f.unit ? ` ${f.unit}` : ''}` : ''}
                {typeof f.probability === 'number' && <span className="field-hint"> p={f.probability.toFixed(2)}</span>}
              </td>
              <td>
                {f.frames && (
                  <button className="cs-an-at" onClick={() => onSeek(f.frames![0])}>
                    #{f.frames[0] + 1}–{f.frames[1] + 1}
                  </button>
                )}
                {f.note && <span className="field-hint"> {f.note}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.warnings?.map((w, i) => (
        <span key={i} className="cs-warn"><AlertTriangle size={11} /> {w}</span>
      ))}
    </div>
  );
}
