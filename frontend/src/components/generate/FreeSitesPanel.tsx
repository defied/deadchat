import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink, Film, Image as ImageIcon, Sparkles, Upload } from 'lucide-react';
import { refinePrompt, uploadMedia, type MediaKind } from '../../api/generate';
import { Alert, Field, Section, errorMessage } from '../ui';

interface Site {
  id: string;
  name: string;
  model: string;
  kind: MediaKind;
  allowance: string;
  url: string;
  /** some sites accept the prompt in the URL */
  prefill?: (prompt: string) => string;
  note?: string;
}

// Free daily allowances as reported in Aug–Oct 2026; sites change them without notice.
const SITES: Site[] = [
  { id: 'dreamina', name: 'Dreamina', model: 'Seedance 2.5', kind: 'video', allowance: '~120–225 credits/day (shared with images)', url: 'https://dreamina.capcut.com/ai-tool/home', note: 'ByteDance’s own app — the free way to use Seedance 2.5. May watermark.' },
  { id: 'flow', name: 'Google Flow', model: 'Veo 3.1 / Omni Flash', kind: 'video', allowance: '50 credits/day (~5 Veo Lite clips)', url: 'https://labs.google/fx/tools/flow', note: 'Video can be unavailable at peak hours (~14–17 UTC).' },
  { id: 'kling', name: 'Kling', model: 'Kling 3.0', kind: 'video', allowance: '~66 credits/day', url: 'https://app.klingai.com/global/', note: 'Watermark, non-commercial on free.' },
  { id: 'pixverse', name: 'PixVerse', model: 'PixVerse V6', kind: 'video', allowance: '~30–60 credits/day', url: 'https://app.pixverse.ai/', note: 'Up to 540–720p, resets 00:00 UTC.' },
  { id: 'firefly', name: 'Adobe Firefly', model: 'Firefly Video', kind: 'video', allowance: 'daily free generations', url: 'https://firefly.adobe.com/' },
  { id: 'vidu', name: 'Vidu', model: 'Vidu Q4', kind: 'video', allowance: 'daily login credits', url: 'https://www.vidu.com/' },
  { id: 'gemini', name: 'Google Gemini', model: 'Nano Banana 2', kind: 'image', allowance: 'resets every 5 hours', url: 'https://gemini.google.com/' },
  { id: 'dreamina-img', name: 'Dreamina', model: 'Seedream', kind: 'image', allowance: 'shares Dreamina’s daily credits', url: 'https://dreamina.capcut.com/ai-tool/home' },
  { id: 'bing', name: 'Bing Image Creator', model: 'MAI-Image / OpenAI', kind: 'image', allowance: '15 fast/day, then a slower queue', url: 'https://www.bing.com/images/create', prefill: (p) => `https://www.bing.com/images/create?q=${encodeURIComponent(p)}` },
  { id: 'leonardo', name: 'Leonardo', model: 'Leonardo models', kind: 'image', allowance: '150 tokens/day', url: 'https://app.leonardo.ai/', note: 'Free images are public.' },
  { id: 'krea', name: 'Krea', model: 'Krea 2', kind: 'image', allowance: '100 units/day', url: 'https://www.krea.ai/' },
  { id: 'recraft', name: 'Recraft', model: 'Recraft V4', kind: 'image', allowance: '30 credits/day', url: 'https://www.recraft.ai/' },
  { id: 'ideogram', name: 'Ideogram', model: 'Ideogram (typography)', kind: 'image', allowance: '~10 slow credits/day', url: 'https://ideogram.ai/', note: 'Free images are public.' },
];

export function FreeSitesPanel() {
  const [kind, setKind] = useState<MediaKind>('video');
  const [prompt, setPrompt] = useState('');
  const [refined, setRefined] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  const copy = async (siteId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(siteId);
      setTimeout(() => setCopied((c) => (c === siteId ? null : c)), 2000);
    } catch {
      setError('Could not copy (the browser blocked clipboard access). Select the text and copy it manually.');
    }
  };

  const launch = async (site: Site) => {
    if (!prompt.trim()) {
      setError('Write what you want first.');
      return;
    }
    setError('');
    // Open the tab synchronously (popup blockers), then point it at the site.
    const tab = window.open('about:blank', '_blank');
    setBusy(site.id);
    let text = prompt.trim();
    try {
      text = await refinePrompt(prompt, site.kind, `${site.model} (${site.name})`);
      setRefined((r) => ({ ...r, [site.id]: text }));
    } catch (e) {
      setError(`${errorMessage(e)} — copied your original prompt instead.`);
    } finally {
      setBusy(null);
    }
    await copy(site.id, text);
    const target = site.prefill ? site.prefill(text) : site.url;
    if (tab) tab.location.href = target;
    else window.open(target, '_blank', 'noopener');
  };

  const sites = SITES.filter((s) => s.kind === kind);

  return (
    <div style={{ maxWidth: 1100 }}>
      <Alert kind="info">
        These sites give free credits every day but only work in their own web apps (no free API), so DeadChat can’t
        run them for you. It refines your prompt for each site’s model, copies it, and opens the site — paste, generate,
        then import the result below to keep it in your gallery or animate it locally.
      </Alert>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          <button className={kind === 'video' ? 'on' : ''} onClick={() => setKind('video')}>
            <Film size={14} /> Video sites
          </button>
          <button className={kind === 'image' ? 'on' : ''} onClick={() => setKind('image')}>
            <ImageIcon size={14} /> Image sites
          </button>
        </div>
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={kind === 'video' ? 'e.g. A fox runs through snowy woods at dawn, tracking shot' : 'e.g. A neon sign that says "OPEN LATE" above a rainy alley'}
          style={{ resize: 'vertical' }}
        />
      </div>

      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      <div className="card-grid" style={{ marginBottom: 28 }}>
        {sites.map((s) => (
          <div key={s.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <b>{s.name}</b>
              <span className="badge">{s.model}</span>
            </div>
            <div className="field-hint" style={{ marginTop: 0 }}>Free: {s.allowance}</div>
            {s.note && <div className="field-hint" style={{ marginTop: 0 }}>{s.note}</div>}
            {refined[s.id] && (
              <div className="snippet" style={{ fontFamily: 'var(--font-sans)', fontSize: 12, maxHeight: 120, overflowY: 'auto' }}>
                {refined[s.id]}
                <button className="icon-btn" title="Copy again" onClick={() => copy(s.id, refined[s.id])}>
                  {copied === s.id ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => launch(s)}>
                <Sparkles size={13} /> {busy === s.id ? 'Refining…' : copied === s.id ? 'Copied — paste it there' : 'Refine, copy & open'}
              </button>
              <a className="btn btn-sm" href={s.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} /> Open
              </a>
            </div>
          </div>
        ))}
      </div>

      <ImportBox sources={SITES} defaultPrompt={Object.values(refined).pop() ?? prompt} />
    </div>
  );
}

function ImportBox({ sources, defaultPrompt }: { sources: Site[]; defaultPrompt: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState(sources[0].id);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState<{ id: number; type: string } | null>(null);
  const [error, setError] = useState('');

  const upload = async (file: File) => {
    const s = sources.find((x) => x.id === source)!;
    setUploading(true);
    setError('');
    setDone(null);
    try {
      const m = await uploadMedia(file, { prompt: defaultPrompt || undefined, source: `${s.name} · ${s.model}` });
      setDone({ id: m.id, type: m.type });
    } catch (e) {
      setError(errorMessage(e, 'Import failed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Section title={<><Upload size={14} /> Import a result</>} hint="Download the image or video from the site, then add it here. It’s saved with its source and prompt.">
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 240 }}>
          <Field label="Made with">
            <select className="input-sm" value={source} onChange={(e) => setSource(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.model}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.[0]) upload(e.target.files[0]);
            e.target.value = '';
          }}
        />
        <button className="btn" disabled={uploading} onClick={() => fileRef.current?.click()} style={{ marginBottom: 14 }}>
          <Upload size={14} /> {uploading ? 'Importing…' : 'Choose file…'}
        </button>
        {done && (
          <div style={{ marginBottom: 14, fontSize: 13 }}>
            Imported.{' '}
            {done.type === 'image' ? (
              <Link to="/generate/create" state={{ animate: done.id }}>Animate it locally →</Link>
            ) : (
              <Link to="/generate/gallery">Open the gallery →</Link>
            )}
          </div>
        )}
      </div>
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
    </Section>
  );
}
