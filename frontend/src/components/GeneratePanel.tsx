import { useState, useEffect, useCallback, useRef } from 'react';
import { Image, Film, Loader, CheckCircle, XCircle, RefreshCw, AlertCircle, ChevronDown, ChevronUp, Clock, Aperture, Trash2 } from 'lucide-react';
import client from '../api/client';
import { generateImage, generateVideo, getJob, type Job } from '../api/jobs';
import { listMedia, deleteMedia, type MediaItem } from '../api/media';
import { MediaImage } from './MediaImage';
import { MediaVideo } from './MediaVideo';
import { MediaLightbox } from './MediaLightbox';

type Tab = 'generate' | 'gallery';
type GenType = 'image' | 'video';

interface GenerateModels { image: string[]; video: string[] }

interface ActiveJob {
  id: number;
  type: GenType;
  prompt: string;
  status: Job['status'];
  progress: number;
  mediaId?: number;
  error?: string;
  createdAt: number;
  startedAt?: number;
  videoMeta?: { frames: number; fps: number };
}

// ── Cinematic option tables ───────────────────────────────────────────────────

const FRAMERATE_LOOKS = [
  { value: '', label: 'None' },
  { value: 'cinematic 24fps, natural motion blur, film-like cadence', label: '24fps Cinematic' },
  { value: '30fps broadcast, smooth natural motion', label: '30fps Broadcast' },
  { value: '60fps high frame rate, hyper-real fluid motion', label: '60fps HFR' },
  { value: 'slow motion, overcranked, high-speed capture', label: 'Slow Motion' },
];

const LENS_TYPES = [
  { value: '', label: 'None' },
  { value: 'shot on 50mm normal lens, natural perspective', label: '50mm Normal' },
  { value: 'shot on 28mm wide angle lens, expanded field of view', label: '28mm Wide' },
  { value: 'shot on 16mm ultra-wide angle lens, dramatic perspective', label: '16mm Ultra-wide' },
  { value: 'shot on 85mm portrait telephoto lens, shallow depth of field, subject isolation', label: '85mm Portrait' },
  { value: 'shot on 200mm telephoto lens, compressed perspective, background compression', label: '200mm Telephoto' },
  { value: 'macro lens, extreme close-up, fine detail, shallow depth of field', label: 'Macro' },
  { value: 'fisheye lens, extreme barrel distortion, 180 degree field of view', label: 'Fisheye' },
  { value: 'anamorphic lens, 2.39:1 widescreen, oval bokeh, horizontal lens character', label: 'Anamorphic' },
];

const FILM_STOCKS = [
  { value: '', label: 'None' },
  { value: 'Kodak Vision3 250D film stock, warm daylight balanced, fine grain, rich shadows', label: 'Kodak Vision3 250D' },
  { value: 'Kodak Vision3 500T film stock, tungsten balanced, cinematic warm midtones', label: 'Kodak Vision3 500T' },
  { value: 'Kodak Portra 400, natural warm skin tones, wide exposure latitude', label: 'Kodak Portra 400' },
  { value: 'Fuji Eterna 500 film stock, cool desaturated tones, flat low-contrast look', label: 'Fuji Eterna 500' },
  { value: 'Fuji Velvia 50, ultra-saturated vivid colors, high contrast, punchy', label: 'Fuji Velvia 50' },
  { value: 'Ilford HP5 Plus, black and white film, medium contrast, fine grain monochrome', label: 'Ilford HP5 (B&W)' },
  { value: 'Kodak Tri-X 400, high contrast black and white, pronounced grain, gritty monochrome', label: 'Kodak Tri-X 400 (B&W)' },
];

const GRAIN_ISO = [
  { value: '', label: 'None' },
  { value: 'ISO 100, virtually grainless, pristine clean image', label: 'ISO 100 (clean)' },
  { value: 'ISO 400, fine film grain, subtle organic texture', label: 'ISO 400 (subtle)' },
  { value: 'ISO 800, visible film grain, textured cinematic look', label: 'ISO 800 (moderate)' },
  { value: 'ISO 1600, heavy film grain, gritty organic texture, raw look', label: 'ISO 1600 (heavy)' },
  { value: 'ISO 3200, extreme film grain, high noise, raw gritty underground aesthetic', label: 'ISO 3200 (extreme)' },
];

const COLOR_SCIENCES = [
  { value: '', label: 'None' },
  { value: 'ARRI Alexa color science, LogC color grading, natural skin tones, cinematic warmth', label: 'ARRI Alexa' },
  { value: 'RED IPP2 color pipeline, wide color gamut, punchy highlights, high dynamic range', label: 'RED IPP2' },
  { value: 'Sony S-Log3 color science, extended dynamic range, clean clinical tones', label: 'Sony S-Log3' },
  { value: 'Kodak print film color science, warm golden tones, rich shadow detail', label: 'Kodak Print Film' },
  { value: 'Fujifilm color science, accurate vibrant natural colors, fine tonal gradation', label: 'Fujifilm' },
  { value: 'vintage film look, faded colors, lifted blacks, slight desaturation, nostalgic', label: 'Vintage / Faded' },
  { value: 'bleach bypass, desaturated, high contrast, silvery metallic tones, bleak', label: 'Bleach Bypass' },
];

const FILTER_OPTIONS = [
  { value: 'anamorphic lens flares, blue horizontal streak reflections', label: 'Anamorphic Flares' },
  { value: 'diffusion filter, Pro-Mist, soft ethereal glow on bright highlights', label: 'Diffusion / Pro-Mist' },
  { value: 'cross-process color treatment, unexpected hue shifts, experimental', label: 'Cross-process' },
  { value: 'natural vignette, darkened corners, focus toward center', label: 'Vignette' },
  { value: 'warm amber golden tones, golden hour sunlight', label: 'Warm Tones' },
  { value: 'cool teal blue tones, cold sterile atmosphere', label: 'Cool Tones' },
  { value: 'muted desaturated color palette, washed out', label: 'Desaturated' },
  { value: 'shallow depth of field, creamy bokeh, subject isolation', label: 'Shallow DOF' },
  { value: 'lens character, chromatic aberration, optical imperfections, organic', label: 'Lens Character' },
];

function buildCinematicSuffix(opts: {
  framerateLook: string;
  lens: string;
  filmStock: string;
  iso: string;
  colorScience: string;
  filters: Set<string>;
}): string {
  const parts = [
    opts.framerateLook,
    opts.lens,
    opts.filmStock,
    opts.iso,
    opts.colorScience,
    ...Array.from(opts.filters),
  ].filter(Boolean);
  return parts.join(', ');
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const IMAGE_DEFAULTS = { steps: 20, cfg: 7.0, width: 1024, height: 1024 };
const VIDEO_DEFAULTS = { steps: 20, cfg: 3.5, width: 512, height: 512, frames: 81, fps: 16 };

function framesForDuration(durationSec: number, fps: number): number {
  const raw = Math.max(5, Math.round(durationSec * fps));
  const rem = (raw - 1) % 4;
  return rem === 0 ? raw : raw + (4 - rem);
}

const POLL_INTERVAL_MS = 2000;

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function SectionToggle({ label, icon, active, open, onToggle }: {
  label: string; icon: React.ReactNode; active: boolean; open: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 12, padding: 0, alignSelf: 'flex-start',
      }}
    >
      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      {icon}
      {label}
      {active && (
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 10,
          background: 'var(--color-accent-dim)', color: 'var(--color-accent-light)',
          border: '1px solid rgba(99,102,241,0.3)', marginLeft: 2,
        }}>active</span>
      )}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GeneratePanel() {
  const [tab, setTab] = useState<Tab>('generate');
  const [genType, setGenType] = useState<GenType>('image');

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [width, setWidth] = useState(IMAGE_DEFAULTS.width);
  const [height, setHeight] = useState(IMAGE_DEFAULTS.height);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [steps, setSteps] = useState(IMAGE_DEFAULTS.steps);
  const [cfg, setCfg] = useState(IMAGE_DEFAULTS.cfg);
  const [seed, setSeed] = useState('');
  const [frames, setFrames] = useState(VIDEO_DEFAULTS.frames);
  const [fps, setFps] = useState(VIDEO_DEFAULTS.fps);
  const [duration, setDuration] = useState(VIDEO_DEFAULTS.frames / VIDEO_DEFAULTS.fps);

  // Cinematography
  const [showCinema, setShowCinema] = useState(false);
  const [framerateLook, setFramerateLook] = useState('');
  const [lens, setLens] = useState('');
  const [filmStock, setFilmStock] = useState('');
  const [iso, setIso] = useState('');
  const [colorScience, setColorScience] = useState('');
  const [filters, setFilters] = useState<Set<string>>(new Set());

  const [models, setModels] = useState<GenerateModels>({ image: [], video: [] });
  const [submitting, setSubmitting] = useState(false);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [gallery, setGallery] = useState<MediaItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const pollCleanups = useRef<Map<number, () => void>>(new Map());
  useEffect(() => {
    return () => { pollCleanups.current.forEach((fn) => fn()); };
  }, []);

  useEffect(() => {
    const d = genType === 'image' ? IMAGE_DEFAULTS : VIDEO_DEFAULTS;
    setWidth(d.width);
    setHeight(d.height);
    setSteps(d.steps);
    setCfg(d.cfg);
    if (genType === 'video') {
      setFrames(VIDEO_DEFAULTS.frames);
      setFps(VIDEO_DEFAULTS.fps);
      setDuration(VIDEO_DEFAULTS.frames / VIDEO_DEFAULTS.fps);
    }
    setModel('');
  }, [genType]);

  const handleDurationChange = (sec: number) => { setDuration(sec); setFrames(framesForDuration(sec, fps)); };
  const handleFpsChange = (newFps: number) => { setFps(newFps); setFrames(framesForDuration(duration, newFps)); };
  const handleFramesChange = (newFrames: number) => { setFrames(newFrames); setDuration(+(newFrames / fps).toFixed(2)); };

  const toggleFilter = (val: string) => {
    setFilters((prev) => {
      const next = new Set(prev);
      next.has(val) ? next.delete(val) : next.add(val);
      return next;
    });
  };

  const clearCinematics = () => {
    setFramerateLook(''); setLens(''); setFilmStock('');
    setIso(''); setColorScience(''); setFilters(new Set());
  };

  useEffect(() => {
    client.get<GenerateModels>('/api/comfyui/generate-models')
      .then(({ data }) => setModels(data))
      .catch(() => {});
  }, []);

  const loadGallery = useCallback(async () => {
    setGalleryLoading(true);
    try { setGallery(await listMedia({ limit: 50 })); }
    catch { /* ignore */ } finally { setGalleryLoading(false); }
  }, []);

  useEffect(() => { if (tab === 'gallery') loadGallery(); }, [tab, loadGallery]);

  const startPolling = useCallback((jobId: number) => {
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const job = await getJob(jobId);
        if (!active) return;
        setActiveJobs((prev) => prev.map((j) => {
          if (j.id !== jobId) return j;
          const startedAt = job.started_at ? new Date(job.started_at).getTime() : j.startedAt;
          const updates: Partial<ActiveJob> = { status: job.status, progress: job.progress, startedAt };
          if (job.status === 'succeeded') {
            try {
              const r = job.result ? JSON.parse(job.result) : null;
              updates.mediaId = r?.media_ids?.[0] ?? r?.media_id;
            } catch { /* ignore */ }
          }
          if (job.error) updates.error = job.error;
          return { ...j, ...updates };
        }));
        if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
          active = false;
          clearInterval(intervalId);
          pollCleanups.current.delete(jobId);
          if (job.status === 'succeeded') loadGallery();
        }
      } catch { /* retry */ }
    };
    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    const cleanup = () => { active = false; clearInterval(intervalId); };
    pollCleanups.current.set(jobId, cleanup);
    return cleanup;
  }, [loadGallery]);

  const cinematicSuffix = buildCinematicSuffix({ framerateLook, lens, filmStock, iso, colorScience, filters });
  const hasCinematics = cinematicSuffix.length > 0;
  const fullPrompt = (base: string) => {
    if (!cinematicSuffix) return base;
    return base.trimEnd().replace(/[,.]$/, '') + ', ' + cinematicSuffix;
  };

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const seedVal = seed.trim() ? parseInt(seed.trim(), 10) : undefined;
      const modelVal = model || undefined;
      const finalPrompt = fullPrompt(prompt.trim());

      const resp = genType === 'image'
        ? await generateImage({ prompt: finalPrompt, width, height, steps, cfg, seed: seedVal, model: modelVal })
        : await generateVideo({ prompt: finalPrompt, width, height, steps, cfg, seed: seedVal, model: modelVal, frames, fps });

      setActiveJobs((prev) => [{
        id: resp.job_id, type: genType, prompt: finalPrompt,
        status: 'queued', progress: 0, createdAt: Date.now(),
        videoMeta: genType === 'video' ? { frames, fps } : undefined,
      }, ...prev]);
      startPolling(resp.job_id);
      setPrompt('');
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
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
        <button style={tabStyle('generate')} onClick={() => setTab('generate')}>Generate</button>
        <button style={tabStyle('gallery')} onClick={() => setTab('gallery')}>Gallery</button>
      </div>

      {tab === 'generate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={typeBtn('image')} onClick={() => setGenType('image')}><Image size={16} /> Image</button>
            <button style={typeBtn('video')} onClick={() => setGenType('video')}><Film size={16} /> Video</button>
          </div>

          {availableModels.length > 0 && (
            <Field label="Model">
              <select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Default</option>
                {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          )}

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

          {genType === 'video' && (
            <Field label={`Duration (seconds) — ${frames} frames @ ${fps}fps`}>
              <input type="number" value={duration} onChange={(e) => handleDurationChange(Number(e.target.value))}
                min={0.5} max={16} step={0.5} style={inputStyle} />
            </Field>
          )}

          {/* Advanced */}
          <SectionToggle
            label="Advanced options" icon={null} active={false}
            open={showAdvanced} onToggle={() => setShowAdvanced((v) => !v)}
          />
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
                  <Field label="Frames (n-1 divisible by 4)">
                    <input type="number" value={frames} onChange={(e) => handleFramesChange(Number(e.target.value))}
                      min={5} max={257} step={4} style={inputStyle} />
                  </Field>
                  <Field label="FPS">
                    <input type="number" value={fps} onChange={(e) => handleFpsChange(Number(e.target.value))}
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

          {/* Cinematography */}
          <SectionToggle
            label="Cinematography"
            icon={<Aperture size={13} />}
            active={hasCinematics}
            open={showCinema}
            onToggle={() => setShowCinema((v) => !v)}
          />
          {showCinema && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', background: 'var(--color-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}>

              {genType === 'video' && (
                <Field label="Framerate look">
                  <select value={framerateLook} onChange={(e) => setFramerateLook(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    {FRAMERATE_LOOKS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                <Field label="Lens">
                  <select value={lens} onChange={(e) => setLens(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    {LENS_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Film Stock">
                  <select value={filmStock} onChange={(e) => setFilmStock(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    {FILM_STOCKS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <Field label="Grain / ISO">
                  <select value={iso} onChange={(e) => setIso(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    {GRAIN_ISO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Color Science">
                  <select value={colorScience} onChange={(e) => setColorScience(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    {COLOR_SCIENCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Filters">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                  {FILTER_OPTIONS.map((f) => {
                    const on = filters.has(f.value);
                    return (
                      <button
                        key={f.value}
                        onClick={() => toggleFilter(f.value)}
                        style={{
                          padding: '4px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 20,
                          border: `1px solid ${on ? 'rgba(99,102,241,0.5)' : 'var(--color-border)'}`,
                          background: on ? 'var(--color-accent-dim)' : 'var(--color-bg)',
                          color: on ? 'var(--color-accent-light)' : 'var(--color-text-dim)',
                          transition: 'all 0.1s',
                        }}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Suffix preview */}
              {hasCinematics && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{
                    fontSize: 11, color: 'var(--color-text-dim)', padding: '6px 10px',
                    background: 'var(--color-bg)', borderRadius: 'var(--radius)',
                    border: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)',
                    lineHeight: 1.5, wordBreak: 'break-word',
                  }}>
                    <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'inherit', fontWeight: 500 }}>Appending: </span>
                    {cinematicSuffix}
                  </div>
                  <button
                    onClick={clearCinematics}
                    style={{
                      alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                      background: 'transparent', color: 'var(--color-text-dim)',
                      border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                    }}
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-error, #ef4444)', fontSize: 13 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

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

          {activeJobs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-dim)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Jobs</div>
              {activeJobs.map((job) => <JobCard key={job.id} job={job} />)}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {gallery.map((item) => (
              <GalleryCard
                key={item.id}
                item={item}
                onOpen={() => setLightboxItem(item)}
                onDelete={async () => {
                  if (!window.confirm('Delete this item?')) return;
                  try {
                    await deleteMedia(item.id);
                    setGallery((prev) => prev.filter((i) => i.id !== item.id));
                    if (lightboxItem?.id === item.id) setLightboxItem(null);
                  } catch { /* ignore */ }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {lightboxItem && (
        <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      )}
    </div>
  );
}

// ── Gallery card ──────────────────────────────────────────────────────────────

function GalleryCard({ item, onOpen, onDelete }: { item: MediaItem; onOpen: () => void; onDelete: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Thumbnail */}
      <div style={{ aspectRatio: '1/1', overflow: 'hidden', background: '#0e0e14', position: 'relative' }}>
        {item.type === 'image'
          ? <MediaImage mediaId={item.id} alt={item.prompt ?? ''} onClick={onOpen} />
          : <MediaVideo mediaId={item.id} onClick={onOpen} />}
      </div>

      {/* Footer */}
      <div style={{ padding: '5px 8px 6px' }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.prompt || item.filename}
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-text-dim)', marginTop: 1, opacity: 0.7 }}>
          {new Date(item.created_at).toLocaleDateString()}
        </div>
      </div>

      {/* Delete button — visible on hover */}
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
          style={{
            position: 'absolute', top: 5, right: 5,
            width: 24, height: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.65)',
            border: 'none', borderRadius: 'var(--radius)',
            color: '#ef4444', cursor: 'pointer',
          }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

// ── Job card ──────────────────────────────────────────────────────────────────

function JobCard({ job }: { job: ActiveJob }) {
  const now = Date.now();
  const isActive = job.status === 'queued' || job.status === 'running';
  const elapsedMs = now - (job.startedAt ?? job.createdAt);
  const elapsedLabel = formatElapsed(Math.max(0, elapsedMs));

  let etaLabel: string | null = null;
  if (job.status === 'running' && job.startedAt && job.progress > 2) {
    const runningMs = now - job.startedAt;
    const remaining = (runningMs / (job.progress / 100)) - runningMs;
    if (remaining > 0) etaLabel = formatElapsed(remaining);
  }

  const barWidth = job.status === 'running' ? Math.max(2, Math.min(99, job.progress)) : 100;

  return (
    <div style={{ padding: '10px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusIcon status={job.status} />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', flex: 1 }}>
          {job.type === 'video' ? <Film size={12} style={{ display: 'inline', marginRight: 4 }} /> : null}
          {job.type} #{job.id}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-dim)', textTransform: 'capitalize' }}>{job.status}</span>
      </div>

      {job.prompt && (
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.prompt}</div>
      )}

      {isActive && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
            {job.status === 'queued' ? (
              <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, transparent 0%, var(--color-accent) 50%, transparent 100%)', animation: 'shimmer 1.5s infinite', backgroundSize: '200% 100%' }} />
            ) : (
              <div style={{ height: '100%', width: `${barWidth}%`, background: 'var(--color-accent)', borderRadius: 2, transition: 'width 0.8s ease' }} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-dim)' }}>
            <span>
              {job.status === 'queued' ? 'waiting in queue…' : job.progress > 0 ? `${job.progress.toFixed(0)}% complete` : 'starting…'}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={10} />
              {elapsedLabel}
              {etaLabel && <span style={{ color: 'var(--color-text-secondary)', marginLeft: 4 }}>· ~{etaLabel} left</span>}
            </span>
          </div>
          {job.type === 'video' && job.videoMeta && (
            <div style={{ fontSize: 11, color: 'var(--color-text-dim)', paddingTop: 4, borderTop: '1px solid var(--color-border)' }}>
              {job.videoMeta.frames} frames · {job.videoMeta.fps}fps · ~{(job.videoMeta.frames / job.videoMeta.fps).toFixed(1)}s
              {job.status === 'running' && !etaLabel && job.progress === 0 && <span style={{ marginLeft: 8, opacity: 0.7 }}>loading model…</span>}
            </div>
          )}
        </div>
      )}

      {!isActive && job.startedAt && (
        <div style={{ fontSize: 11, color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)' }}>
          Took {elapsedLabel}
        </div>
      )}

      {job.status === 'failed' && job.error && (
        <div style={{ fontSize: 12, color: 'var(--color-error, #ef4444)' }}>{job.error}</div>
      )}

      {job.status === 'succeeded' && job.mediaId && (
        <div style={{ borderRadius: 'var(--radius)', overflow: 'hidden', maxHeight: 220 }}>
          {job.type === 'video'
            ? <MediaVideo mediaId={job.mediaId} maxHeight={220} />
            : <MediaImage mediaId={job.mediaId} maxHeight={220} />}
        </div>
      )}
    </div>
  );
}
