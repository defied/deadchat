import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Film, Image as ImageIcon, ImagePlus, Sparkles, Wand2, X } from 'lucide-react';
import { getCatalog, startGeneration, type CatalogModel, type MediaKind, type Ratio } from '../../api/generate';
import { cancelJob, getJob, listJobs, type Job } from '../../api/jobs';
import { MediaImage } from '../MediaImage';
import { Alert, EmptyState, Field, Loading, errorMessage } from '../ui';
import { ModelPicker } from './ModelPicker';
import { StartImagePicker } from './StartImagePicker';
import { JobCard } from './JobCard';
import { COLOR_SCIENCES, FILM_STOCKS, FILTER_OPTIONS, LENS_TYPES } from './looks';

const RATIO_LABEL: Record<Ratio, string> = {
  '1:1': 'Square', '16:9': 'Wide', '9:16': 'Tall', '4:3': '4:3', '3:4': '3:4', '21:9': 'Cinema',
};

function bestAnimator(models: CatalogModel[], preferId?: string): CatalogModel | undefined {
  const ok = models.filter((m) => m.kind === 'video' && m.available && (m.needsImage || m.acceptsImage));
  return ok.find((m) => m.id === preferId) ?? ok.find((m) => m.needsImage && m.backend === 'local') ?? ok[0];
}

export function CreatePanel() {
  const catalogQ = useQuery({ queryKey: ['media-catalog'], queryFn: getCatalog, refetchInterval: 60_000 });
  const catalog = catalogQ.data;
  const models = catalog?.models ?? [];

  const [kind, setKind] = useState<MediaKind>('image');
  const [modelIds, setModelIds] = useState<Record<MediaKind, string>>({ image: '', video: '' });
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [ratio, setRatio] = useState<Ratio>('1:1');
  const [resolution, setResolution] = useState<string | undefined>();
  const [duration, setDuration] = useState(5);
  const [fast, setFast] = useState(false);
  const [audio, setAudio] = useState(true);
  const [enhance, setEnhance] = useState(true);
  const [check, setCheck] = useState(true);
  const [seed, setSeed] = useState('');
  const [startImage, setStartImage] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [look, setLook] = useState({ lens: '', film: '', color: '', filters: new Set<string>() });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const formTop = useRef<HTMLDivElement>(null);

  // Initial model choice: admin default if available, else first available.
  useEffect(() => {
    if (!catalog) return;
    setEnhance(catalog.enhanceByDefault);
    setModelIds((cur) => {
      const pick = (k: MediaKind) => {
        if (cur[k] && models.some((m) => m.id === cur[k] && m.available)) return cur[k];
        const def = models.find((m) => m.id === catalog.defaults[k] && m.available);
        return def?.id ?? models.find((m) => m.kind === k && m.available)?.id ?? '';
      };
      return { image: pick('image'), video: pick('video') };
    });
  }, [catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const model = models.find((m) => m.id === modelIds[kind]);

  // Keep options valid for the selected model.
  useEffect(() => {
    if (!model) return;
    setRatio((r) => (model.ratios.includes(r) ? r : model.defaults.ratio));
    setResolution(model.defaults.resolution);
    if (model.durations) setDuration((d) => Math.min(model.durations!.max, Math.max(model.durations!.min, d)));
    if (!model.hasFastMode) setFast(false);
  }, [model?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recent jobs (survive reloads) + polling while anything is in flight.
  const loadJobs = useCallback(async () => {
    try {
      const all = await listJobs({ limit: 30 });
      setJobs(all.filter((j) => j.type === 'image' || j.type === 'video').slice(0, 12));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    loadJobs();
  }, [loadJobs]);
  const anyActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(async () => {
      const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
      const fresh = await Promise.all(active.map((j) => getJob(j.id).catch(() => j)));
      setJobs((cur) => cur.map((j) => fresh.find((f) => f.id === j.id) ?? j));
    }, 2000);
    return () => clearInterval(id);
  }, [anyActive, jobs]);

  const lookSuffix = useMemo(
    () => [look.lens, look.film, look.color, ...look.filters].filter(Boolean).join(', '),
    [look],
  );

  const needsImage = !!model?.needsImage;
  const takesImage = needsImage || !!model?.acceptsImage;
  const canSubmit = !!model?.available && prompt.trim().length > 0 && (!needsImage || startImage != null) && !submitting;

  const submit = async () => {
    if (!model || !canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const id = await startGeneration({
        catalogId: model.id,
        prompt: lookSuffix ? `${prompt.trim()}. ${lookSuffix}` : prompt.trim(),
        negative: negative.trim() || undefined,
        ratio,
        resolution,
        duration: model.durations ? duration : undefined,
        seed: seed.trim() ? Number(seed) : undefined,
        fast,
        audio,
        enhance,
        verifyAttempts: kind === 'image' && check ? 3 : 1,
        imageMediaId: takesImage && startImage != null ? startImage : undefined,
      });
      const job = await getJob(id);
      setJobs((cur) => [job, ...cur]);
    } catch (e) {
      setError(errorMessage(e, 'Could not start the job'));
    } finally {
      setSubmitting(false);
    }
  };

  const animate = (mediaId: number) => {
    const target = bestAnimator(models, catalog?.defaults.video);
    setKind('video');
    if (target) setModelIds((m) => ({ ...m, video: target.id }));
    setStartImage(mediaId);
    setPrompt('');
    formTop.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Gallery → 'Animate' arrives with the image id in navigation state.
  const location = useLocation();
  const navigate = useNavigate();
  const pendingAnimate = (location.state as { animate?: number } | null)?.animate;
  useEffect(() => {
    if (pendingAnimate == null || !catalog) return;
    animate(pendingAnimate);
    navigate(location.pathname, { replace: true, state: null });
  }, [pendingAnimate, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  if (catalogQ.isLoading) return <Loading label="Loading models…" />;
  if (catalogQ.isError) return <Alert>Could not load the model list: {errorMessage(catalogQ.error)}</Alert>;

  const comfyDown = models.length > 0 && models.every((m) => m.reason === 'ComfyUI is offline');

  return (
    <div className="gen-layout">
      <div className="gen-form" ref={formTop}>
        {comfyDown && (
          <Alert kind="warn">ComfyUI is offline on the GPU box, so nothing can be generated right now.</Alert>
        )}
        <div className="seg" role="tablist">
          <button className={kind === 'image' ? 'on' : ''} onClick={() => setKind('image')}>
            <ImageIcon size={14} /> Image
          </button>
          <button className={kind === 'video' ? 'on' : ''} onClick={() => setKind('video')}>
            <Film size={14} /> Video
          </button>
        </div>

        <Field label="Model">
          <ModelPicker
            models={models}
            kind={kind}
            value={modelIds[kind]}
            onChange={(id) => setModelIds((m) => ({ ...m, [kind]: id }))}
            hostedEnabled={!!catalog?.hostedEnabled}
            cloudflare={catalog?.cloudflare}
          />
        </Field>

        {takesImage && (
          <Field label={needsImage ? 'Start image (required)' : 'Start image (optional)'} hint="The video begins on this frame. Make one with an image model, then press “Animate this”.">
            <div className="start-image">
              <div className="start-thumb">{startImage != null ? <MediaImage mediaId={startImage} onClick={() => setPickerOpen(true)} /> : <ImagePlus size={20} />}</div>
              <button className="btn btn-sm" onClick={() => setPickerOpen(true)}>
                {startImage != null ? 'Change' : 'Choose…'}
              </button>
              {startImage != null && (
                <button className="icon-btn" title="Remove" onClick={() => setStartImage(null)}>
                  <X size={14} />
                </button>
              )}
            </div>
          </Field>
        )}

        <Field label={kind === 'video' && takesImage && startImage != null ? 'What should happen' : 'Describe it'}>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
            }}
            placeholder={
              kind === 'image'
                ? 'e.g. A lighthouse on a cliff at dusk, a sign reading “KEEP OUT”'
                : 'e.g. Slow dolly-in as waves crash against the rocks, gulls circling'
            }
            style={{ resize: 'vertical' }}
          />
        </Field>

        {model && (
          <>
            <Field label="Shape">
              <div className="chips">
                {model.ratios.map((r) => (
                  <button key={r} className={`chip${r === ratio ? ' on' : ''}`} onClick={() => setRatio(r)}>
                    {RATIO_LABEL[r]} <span style={{ opacity: 0.6 }}>{r}</span>
                  </button>
                ))}
              </div>
            </Field>

            <div className="opt-row">
              {model.resolutions && (
                <Field label="Resolution">
                  <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="input-sm">
                    {model.resolutions.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </Field>
              )}
              {model.durations && (
                <Field label={`Length · ${duration}s`}>
                  <input
                    type="range"
                    min={model.durations.min}
                    max={model.durations.max}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    style={{ padding: 0 }}
                  />
                </Field>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="toggle">
                <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />
                <span>
                  <Sparkles size={12} /> Refine my prompt <span className="field-hint">— the local LLM expands it into the detail this model follows best</span>
                </span>
              </label>
              {kind === 'image' && (
                <label className="toggle">
                  <input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} />
                  <span>
                    <Wand2 size={12} /> Check the result and retry <span className="field-hint">— a vision model compares the image to your request, fixes the prompt and tries again (up to 3 tries)</span>
                  </span>
                </label>
              )}
              {model.hasFastMode && (
                <label className="toggle">
                  <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} />
                  <span>
                    Draft quality <span className="field-hint">— much faster, lower fidelity; good for exploring</span>
                  </span>
                </label>
              )}
              {model.hasAudio && (
                <label className="toggle">
                  <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
                  <span>Generate sound</span>
                </label>
              )}
            </div>

            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowMore((v) => !v)}>
              {showMore ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Cinematic look, things to avoid, seed
              {lookSuffix && <span className="badge badge-accent">look on</span>}
            </button>
            {showMore && (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="opt-row">
                  <Field label="Lens">
                    <select className="input-sm" value={look.lens} onChange={(e) => setLook({ ...look, lens: e.target.value })}>
                      {LENS_TYPES.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Film stock">
                    <select className="input-sm" value={look.film} onChange={(e) => setLook({ ...look, film: e.target.value })}>
                      {FILM_STOCKS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Color">
                  <select className="input-sm" value={look.color} onChange={(e) => setLook({ ...look, color: e.target.value })}>
                    {COLOR_SCIENCES.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <div className="chips">
                  {FILTER_OPTIONS.map((o) => (
                    <button
                      key={o.label}
                      className={`chip${look.filters.has(o.value) ? ' on' : ''}`}
                      onClick={() => {
                        const f = new Set(look.filters);
                        if (f.has(o.value)) f.delete(o.value);
                        else f.add(o.value);
                        setLook({ ...look, filters: f });
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <Field label="Avoid (negative prompt)" hint="Only some models use this.">
                  <input className="input-sm" value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="e.g. text, watermark, blur" />
                </Field>
                <Field label="Seed" hint="Same seed + same prompt reproduces a result. Leave empty for random.">
                  <input className="input-sm" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} placeholder="random" />
                </Field>
              </div>
            )}
          </>
        )}

        {error && <Alert onClose={() => setError('')}>{error}</Alert>}
        <button className="btn btn-primary" disabled={!canSubmit} onClick={submit} style={{ padding: '10px 16px' }}>
          {submitting ? 'Starting…' : `Generate ${kind}`} <span style={{ opacity: 0.6, fontWeight: 400 }}>Ctrl+Enter</span>
        </button>
        {needsImage && startImage == null && <div className="field-hint">Choose a start image first.</div>}
      </div>

      <div className="job-list">
        {jobs.length === 0 ? (
          <EmptyState title="Nothing generated yet">Results appear here. Images can be animated into video with one click.</EmptyState>
        ) : (
          jobs.map((j) => {
            let id: string | undefined;
            try {
              id = (JSON.parse(j.params) as { catalogId?: string }).catalogId;
            } catch {
              /* legacy */
            }
            return (
              <JobCard
                key={j.id}
                view={{ job: j, model: models.find((m) => m.id === id) }}
                onAnimate={animate}
                onCancel={async (jobId) => {
                  await cancelJob(jobId).catch(() => {});
                  setJobs((cur) => cur.map((x) => (x.id === jobId ? { ...x, status: 'canceled' } : x)));
                }}
              />
            );
          })
        )}
      </div>

      {pickerOpen && (
        <StartImagePicker
          onClose={() => setPickerOpen(false)}
          onPick={(id) => {
            setStartImage(id);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
