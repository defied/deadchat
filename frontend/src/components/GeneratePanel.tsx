import { useState, useEffect, useCallback } from 'react';
import { Image, Film, Loader, CheckCircle, XCircle, RefreshCw, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import client from '../api/client';
import { generateImage, generateVideo, pollJob, type Job } from '../api/jobs';
import { listMedia, type MediaItem } from '../api/media';
import { MediaImage } from './MediaImage';

type Tab = 'generate' | 'gallery';
type GenType = 'image' | 'video';

interface GenerateModels { image: string[]; video: string[] }

interface ActiveJob {
  id: number;
  type: GenType;
  status: Job['status'];
  progress: number;
  mediaId?: number;
  error?: string;
}

const IMAGE_DEFAULTS = { steps: 20, cfg: 7.0, width: 1024, height: 1024 };
const VIDEO_DEFAULTS = { steps: 8,  cfg: 1.0, width: 512,  height: 512, frames: 65, fps: 24 };

function StatusIcon({ status }: { status: Job['status'] }) {
  if (status === 'succeeded') return <CheckCircle size={14} color="var(--color-success, #22c55e)" />;
  if (status === 'failed')    return <XCircle size={14} color="var(--color-error, #ef4444)" />;
  if (status === 'canceled')  return <XCircle size={14} color="var(--color-text-dim)" />;
  return <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--color-text)',
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-secondary)',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 4,
  display: 'block',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

export function GeneratePanel() {
  const [tab, setTab] = useState<Tab>('generate');
  const [genType, setGenType] = useState<GenType>('image');

  // Core params
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [width, setWidth] = useState(IMAGE_DEFAULTS.width);
  const [height, setHeight] = useState(IMAGE_DEFAULTS.height);

  // Advanced params
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [steps, setSteps] = useState(IMAGE_DEFAULTS.steps);
  const [cfg, setCfg] = useState(IMAGE_DEFAULTS.cfg);
  const [seed, setSeed] = useState('');
  const [frames, setFrames] = useState(VIDEO_DEFAULTS.frames);
  const [fps, setFps] = useState(VIDEO_DEFAULTS.fps);

  // State
  const [models, setModels] = useState<GenerateModels>({ image: [], video: [] });
  const [submitting, setSubmitting] = useState(false);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [gallery, setGallery] = useState<MediaItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When type changes, reset dimension/param defaults and clear model selection
  useEffect(() => {
    const d = genType === 'image' ? IMAGE_DEFAULTS : VIDEO_DEFAULTS;
    setWidth(d.width);
    setHeight(d.height);
    setSteps(d.steps);
    setCfg(d.cfg);
    setModel('');
  }, [genType]);

  // Fetch available models once
  useEffect(() => {
    client.get<GenerateModels>('/api/comfyui/generate-models')
      .then(({ data }) => setModels(data))
      .catch(() => {/* silently ignore */});
  }, []);

  const loadGallery = useCallback(async () => {
    setGalleryLoading(true);
    try {
      setGallery(await listMedia({ limit: 50 }));
    } catch { /* ignore */ } finally {
      setGalleryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'gallery') loadGallery();
  }, [tab, loadGallery]);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const seedVal = seed.trim() ? parseInt(seed.trim(), 10) : undefined;
      const modelVal = model || undefined;

      const resp = genType === 'image'
        ? await generateImage({ prompt: prompt.trim(), width, height, steps, cfg, seed: seedVal, model: modelVal })
        : await generateVideo({ prompt: prompt.trim(), width, height, steps, cfg, seed: seedVal, model: modelVal, frames, fps });

      const entry: ActiveJob = { id: resp.job_id, type: genType, status: 'queued', progress: 0 };
      setActiveJobs((prev) => [entry, ...prev]);
      setPrompt('');

      pollJob(resp.job_id).then((finalJob) => {
        setActiveJobs((prev) => prev.map((j) => {
          if (j.id !== resp.job_id) return j;
          let mediaId: number | undefined;
          try {
            const r = finalJob.result ? JSON.parse(finalJob.result) : null;
            mediaId = r?.media_ids?.[0] ?? r?.media_id;
          } catch { /* ignore */ }
          return { ...j, status: finalJob.status, progress: 100, mediaId, error: finalJob.error ?? undefined };
        }));
        if (finalJob.status === 'succeeded') loadGallery();
      }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Poll error';
        setActiveJobs((prev) => prev.map((j) => j.id !== resp.job_id ? j : { ...j, status: 'failed', error: msg }));
      });
    } catch (e: unknown) {
      const ae = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ae?.response?.data?.error || ae?.message || 'Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  };

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: '8px 18px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 500,
    background: tab === t ? 'var(--color-accent-dim)' : 'transparent',
    color: tab === t ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
  });

  const typeBtn = (t: GenType): React.CSSProperties => ({
    flex: 1, padding: '10px', borderRadius: 'var(--radius)', cursor: 'pointer',
    border: `1px solid ${genType === t ? 'var(--color-accent)' : 'var(--color-border)'}`,
    background: genType === t ? 'var(--color-accent-dim)' : 'var(--color-surface)',
    color: genType === t ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    fontSize: 13, fontWeight: 500,
  });

  const availableModels = genType === 'image' ? models.image : models.video;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px 24px', gap: 16 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
        <button style={tabStyle('generate')} onClick={() => setTab('generate')}>Generate</button>
        <button style={tabStyle('gallery')} onClick={() => setTab('gallery')}>Gallery</button>
      </div>

      {tab === 'generate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>
          {/* Type */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={typeBtn('image')} onClick={() => setGenType('image')}><Image size={16} /> Image</button>
            <button style={typeBtn('video')} onClick={() => setGenType('video')}><Film size={16} /> Video</button>
          </div>

          {/* Model */}
          {availableModels.length > 0 && (
            <Field label="Model">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">Default</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
          )}

          {/* Prompt */}
          <Field label="Prompt">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={`Describe the ${genType} you want to generate...`}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) handleSubmit(); }}
            />
          </Field>

          {/* Dimensions */}
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Width">
              <input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))}
                step={genType === 'image' ? 64 : 32} min={256} max={2048} style={inputStyle} />
            </Field>
            <Field label="Height">
              <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))}
                step={genType === 'image' ? 64 : 32} min={256} max={2048} style={inputStyle} />
            </Field>
          </div>

          {/* Advanced toggle */}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 12, padding: 0, alignSelf: 'flex-start',
            }}
          >
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Advanced options
          </button>

          {showAdvanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', background: 'var(--color-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <Field label={`Steps (${genType === 'image' ? '1–50' : '1–30'})`}>
                  <input type="number" value={steps} onChange={(e) => setSteps(Number(e.target.value))}
                    min={1} max={genType === 'image' ? 50 : 30} style={inputStyle} />
                </Field>
                <Field label={`CFG scale (${genType === 'image' ? '1–15' : '0.5–5'})`}>
                  <input type="number" value={cfg} onChange={(e) => setCfg(Number(e.target.value))}
                    min={0.5} max={genType === 'image' ? 15 : 5} step={0.5} style={inputStyle} />
                </Field>
              </div>

              {genType === 'video' && (
                <div style={{ display: 'flex', gap: 12 }}>
                  <Field label="Frames (n-1 divisible by 8)">
                    <input type="number" value={frames} onChange={(e) => setFrames(Number(e.target.value))}
                      min={25} max={257} step={8} style={inputStyle} />
                  </Field>
                  <Field label="FPS">
                    <input type="number" value={fps} onChange={(e) => setFps(Number(e.target.value))}
                      min={8} max={60} style={inputStyle} />
                  </Field>
                </div>
              )}

              <Field label="Seed (empty = random)">
                <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)}
                  placeholder="Random" style={inputStyle} />
              </Field>
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-error, #ef4444)', fontSize: 13 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !prompt.trim()}
            style={{
              padding: '10px 20px', background: 'var(--color-accent)', border: 'none',
              borderRadius: 'var(--radius)', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: submitting || !prompt.trim() ? 'not-allowed' : 'pointer',
              opacity: submitting || !prompt.trim() ? 0.6 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {submitting && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {submitting ? 'Queuing…' : `Generate ${genType === 'image' ? 'Image' : 'Video'}`}
          </button>

          {/* Active jobs */}
          {activeJobs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-dim)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Jobs</div>
              {activeJobs.map((job) => (
                <div key={job.id} style={{ padding: '10px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusIcon status={job.status} />
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', flex: 1 }}>{job.type} #{job.id}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-dim)', textTransform: 'capitalize' }}>{job.status}</span>
                  </div>
                  {(job.status === 'queued' || job.status === 'running') && (
                    <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: job.status === 'running' ? `${job.progress || 10}%` : '5%', background: 'var(--color-accent)', borderRadius: 2, transition: 'width 0.5s ease', animation: job.status === 'queued' ? 'pulse 1.5s infinite' : undefined }} />
                    </div>
                  )}
                  {job.status === 'failed' && job.error && (
                    <div style={{ fontSize: 12, color: 'var(--color-error, #ef4444)' }}>{job.error}</div>
                  )}
                  {job.status === 'succeeded' && job.mediaId && (
                    <MediaImage mediaId={job.mediaId} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'gallery' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{gallery.length} item{gallery.length !== 1 ? 's' : ''}</span>
            <button onClick={loadGallery} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 12 }}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {galleryLoading && <div style={{ textAlign: 'center', padding: 32 }}><Loader size={20} style={{ animation: 'spin 1s linear infinite' }} /></div>}
          {!galleryLoading && gallery.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-dim)', fontSize: 14 }}>No media yet. Generate something first!</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {gallery.map((item) => (
              <div key={item.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ aspectRatio: '1/1', overflow: 'hidden', background: '#1e1e2e' }}>
                  {item.type === 'image'
                    ? <MediaImage mediaId={item.id} alt={item.prompt ?? 'Generated image'} />
                    : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-dim)' }}><Film size={32} /></div>}
                </div>
                <div style={{ padding: '6px 8px' }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.prompt || item.filename}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-dim)', marginTop: 2 }}>{new Date(item.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
