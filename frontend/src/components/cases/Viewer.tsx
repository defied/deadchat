// Viewers for every kind of evidence: cine loops and slice stacks (frame
// player), images, video, PDFs, text and tables. A black band can cover the
// top of an image where ultrasound and X-ray machines burn in patient details.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Contrast, Download, Loader2, Pause, Play, SkipBack, SkipForward, Sun, Repeat, FileQuestion } from 'lucide-react';
import { itemUrl, type CaseItem } from '../../api/cases';
import { blobUrl, useBlob, useFrames } from './blobs';

interface ViewerProps {
  caseId: number;
  item: CaseItem;
  /** Start cine loops playing. */
  autoplay?: boolean;
  /** Fill the available height (slides, drill-down). */
  tall?: boolean;
  /** Jump to a frame (0-based); `n` changes on every request so the same frame can be asked for twice. */
  seek?: Seek | null;
}

export interface Seek {
  frame: number;
  n: number;
}

export function Viewer({ caseId, item, autoplay = true, tall, seek }: ViewerProps) {
  const base = `/api/cases/${caseId}/items/${item.id}`;
  if (item.status === 'processing') {
    return <Placeholder icon={<Loader2 size={20} className="spin" />}>Preparing…</Placeholder>;
  }
  if (item.frames > 0) return <FramePlayer base={base} item={item} autoplay={autoplay} tall={tall} seek={seek} />;
  if (item.kind === 'image' && item.hasDisplay) return <ImageView url={`${base}/display`} item={item} tall={tall} />;
  if (item.kind === 'video' && item.hasDisplay && item.playable) return <VideoView url={`${base}/display`} item={item} tall={tall} autoplay={autoplay} seek={seek} />;
  if (item.hasDisplay && item.displayMime === 'application/pdf') return <PdfView url={`${base}/display`} tall={tall} />;
  if (item.hasDisplay && item.displayMime === 'text/plain') return <TextView url={`${base}/display`} tall={tall} />;
  if (item.table) return <TableView table={item.table} tall={tall} />;
  return (
    <Placeholder icon={<FileQuestion size={22} />}>
      <p>{item.error ?? 'This file can’t be shown here.'}</p>
      {item.originals > 0 && <DownloadButton caseId={caseId} item={item} />}
    </Placeholder>
  );
}

function Placeholder({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="cs-placeholder">
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function DownloadButton({ caseId, item, label = 'Download original' }: { caseId: number; item: CaseItem; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const url = await blobUrl(itemUrl(caseId, item.id, 'original/0'));
          const a = document.createElement('a');
          a.href = url;
          a.download = item.originalName ?? item.title;
          a.click();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={13} className="spin" /> : <Download size={13} />} {label}
    </button>
  );
}

/** Size the media box to the picture's aspect ratio so it scales up to fill the stage and the mask lines up. */
function fitStyle(item: CaseItem): CSSProperties {
  const ar = item.width && item.height ? item.width / item.height : 4 / 3;
  return { ['--ar' as string]: ar, aspectRatio: String(ar) };
}

/** Covers burned-in text at the top of an image. */
function Mask({ amount }: { amount: number }) {
  if (!amount) return null;
  return <div className="cs-mask" style={{ height: `${amount * 100}%` }} aria-hidden />;
}

interface Adjust {
  brightness: number;
  contrast: number;
  invert: boolean;
}
const NO_ADJUST: Adjust = { brightness: 1, contrast: 1, invert: false };
const filterOf = (a: Adjust) => `brightness(${a.brightness}) contrast(${a.contrast})${a.invert ? ' invert(1)' : ''}`;

function AdjustBar({ adjust, onChange }: { adjust: Adjust; onChange: (a: Adjust) => void }) {
  return (
    <div className="cs-adjust">
      <label title="Brightness">
        <Sun size={12} />
        <input type="range" min={0.3} max={2.5} step={0.05} value={adjust.brightness} onChange={(e) => onChange({ ...adjust, brightness: Number(e.target.value) })} />
      </label>
      <label title="Contrast">
        <Contrast size={12} />
        <input type="range" min={0.3} max={3} step={0.05} value={adjust.contrast} onChange={(e) => onChange({ ...adjust, contrast: Number(e.target.value) })} />
      </label>
      <button className={`cs-chip ${adjust.invert ? 'on' : ''}`} onClick={() => onChange({ ...adjust, invert: !adjust.invert })}>
        Invert
      </button>
      {(adjust.brightness !== 1 || adjust.contrast !== 1 || adjust.invert) && (
        <button className="cs-chip" onClick={() => onChange(NO_ADJUST)}>Reset</button>
      )}
    </div>
  );
}

// ── cine loops and slice stacks ──────────────────────────────────────────────

const SPEEDS = [0.25, 0.5, 1, 2];

function FramePlayer({ base, item, autoplay, tall, seek }: { base: string; item: CaseItem; autoplay: boolean; tall?: boolean; seek?: Seek | null }) {
  const count = item.frames;
  const stack = item.stack;
  const start = stack ? Math.floor(count / 2) : 0;
  const { images, loaded } = useFrames(base, count, start);
  const [index, setIndex] = useState(start);
  const [playing, setPlaying] = useState(!stack && count > 1 && autoplay);
  const [speed, setSpeed] = useState(1);
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const fps = item.fps || 30;

  useEffect(() => {
    if (!seek) return;
    setPlaying(false);
    setIndex(Math.min(count - 1, Math.max(0, seek.frame)));
  }, [seek, count]);

  // Draw the current frame (or the nearest loaded one while loading).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let img = images[index];
    for (let d = 1; !img && d < count; d++) img = images[(index - d + count) % count];
    if (!img) return;
    if (c.width !== img.naturalWidth || c.height !== img.naturalHeight) {
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
    }
    c.getContext('2d')!.drawImage(img, 0, 0);
  }, [images, index, count]);

  // Playback clock.
  useEffect(() => {
    if (!playing || count < 2) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += ((now - last) / 1000) * fps * speed;
      last = now;
      if (acc >= 1) {
        const step = Math.floor(acc);
        acc -= step;
        setIndex((i) => (i + step) % count);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, speed, count]);

  const step = useCallback(
    (d: number) => {
      setPlaying(false);
      setIndex((i) => (stack ? Math.min(count - 1, Math.max(0, i + d)) : (i + d + count) % count));
    },
    [count, stack],
  );

  return (
    <div
      className={`cs-player ${tall ? 'tall' : ''}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault();
          if (count > 1) setPlaying((p) => !p);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          step(-1);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          step(1);
        }
      }}
      onWheel={(e) => {
        if (!stack) return;
        step(e.deltaY > 0 ? 1 : -1);
      }}
    >
      <div className="cs-stage">
        <div className="cs-media fit" style={fitStyle(item)}>
          <canvas ref={canvas} style={{ filter: filterOf(adjust) }} />
          <Mask amount={item.maskTop} />
        </div>
        {loaded < Math.min(count, 2) && (
          <span className="cs-loading">
            <Loader2 size={14} className="spin" /> Loading frames…
          </span>
        )}
      </div>
      <div className="cs-controls">
        {count > 1 && (
          <>
            {!stack && (
              <button className="icon-btn" onClick={() => setPlaying(!playing)} title={playing ? 'Pause (space)' : 'Play (space)'}>
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
            )}
            <button className="icon-btn" onClick={() => step(-1)} title={stack ? 'Previous slice (↓ or scroll)' : 'Previous frame (←)'}>
              <SkipBack size={14} />
            </button>
            <button className="icon-btn" onClick={() => step(1)} title={stack ? 'Next slice (↑ or scroll)' : 'Next frame (→)'}>
              <SkipForward size={14} />
            </button>
            <input
              className="cs-scrub"
              type="range"
              min={0}
              max={count - 1}
              value={index}
              onChange={(e) => {
                setPlaying(false);
                setIndex(Number(e.target.value));
              }}
              aria-label={stack ? 'Slice' : 'Frame'}
            />
            <span className="cs-count">
              {stack ? 'Slice' : 'Frame'} {index + 1}/{count}
              {loaded < count && ` · ${Math.round((loaded / count) * 100)}%`}
            </span>
            {!stack && (
              <select className="cs-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title={`${fps} fps recorded`}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            )}
            {!stack && <Repeat size={13} className="cs-dim" aria-label="Loops" />}
          </>
        )}
        <AdjustBar adjust={adjust} onChange={setAdjust} />
      </div>
    </div>
  );
}

// ── images, video, documents, data ───────────────────────────────────────────

function ImageView({ url, item, tall }: { url: string; item: CaseItem; tall?: boolean }) {
  const { url: src, failed } = useBlob(url);
  const [zoom, setZoom] = useState(false);
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST);
  if (failed) return <Placeholder icon={<FileQuestion size={20} />}>Couldn’t load the image.</Placeholder>;
  return (
    <div className={`cs-player ${tall ? 'tall' : ''}`}>
      <div className={`cs-stage ${zoom ? 'zoomed' : ''}`} onClick={() => setZoom(!zoom)} title={zoom ? 'Fit' : 'Actual size'}>
        {src ? (
          <div className={`cs-media ${zoom ? '' : 'fit'}`} style={zoom ? undefined : fitStyle(item)}>
            <img src={src} alt={item.title} style={{ filter: filterOf(adjust) }} draggable={false} />
            <Mask amount={item.maskTop} />
          </div>
        ) : (
          <Loader2 size={18} className="spin" />
        )}
      </div>
      <div className="cs-controls">
        <AdjustBar adjust={adjust} onChange={setAdjust} />
      </div>
    </div>
  );
}

function VideoView({ url, item, tall, autoplay, seek }: { url: string; item: CaseItem; tall?: boolean; autoplay: boolean; seek?: Seek | null }) {
  const { url: src, failed } = useBlob(url);
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = video.current;
    if (!seek || !v || !item.sampledFrames) return;
    v.pause();
    v.currentTime = seek.frame / item.sampledFrames.fps;
  }, [seek, item.sampledFrames, src]);
  if (failed) return <Placeholder icon={<FileQuestion size={20} />}>Couldn’t load the video.</Placeholder>;
  return (
    <div className={`cs-player ${tall ? 'tall' : ''}`}>
      <div className="cs-stage">
        {src ? (
          <div className="cs-media fit" style={fitStyle(item)}>
            <video ref={video} src={src} controls loop muted autoPlay={autoplay} playsInline />
            <Mask amount={item.maskTop} />
          </div>
        ) : (
          <Loader2 size={18} className="spin" />
        )}
      </div>
    </div>
  );
}

function PdfView({ url, tall }: { url: string; tall?: boolean }) {
  const { url: src, failed } = useBlob(url);
  if (failed) return <Placeholder icon={<FileQuestion size={20} />}>Couldn’t load the document.</Placeholder>;
  return <div className={`cs-doc ${tall ? 'tall' : ''}`}>{src ? <iframe src={src} title="Document" /> : <Loader2 size={18} className="spin" />}</div>;
}

function TextView({ url, tall }: { url: string; tall?: boolean }) {
  const { url: src } = useBlob(url);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (src) void fetch(src).then((r) => r.text()).then(setText);
  }, [src]);
  return <pre className={`cs-text ${tall ? 'tall' : ''}`}>{text ?? 'Loading…'}</pre>;
}

export function TableView({ table, tall }: { table: NonNullable<CaseItem['table']>; tall?: boolean }) {
  return (
    <div className={`cs-table ${tall ? 'tall' : ''}`}>
      <table className="data-table">
        <thead>
          <tr>{table.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {table.total > table.rows.length && <p className="field-hint">Showing {table.rows.length} of {table.total} rows.</p>}
    </div>
  );
}

/** Card thumbnail; cine thumbnails play on hover. */
export function Thumb({ caseId, item }: { caseId: number; item: CaseItem }) {
  const { url } = useBlob(item.hasThumb ? itemUrl(caseId, item.id, `thumb?v=${item.hasThumb ? 1 : 0}`) : null);
  return (
    <div className="cs-thumb">
      {url ? <img src={url} alt="" draggable={false} /> : <span className="cs-thumb-kind">{kindLabel(item)}</span>}
      <Mask amount={item.maskTop} />
      {item.status === 'processing' && <Loader2 size={14} className="spin cs-thumb-spin" />}
    </div>
  );
}

export function kindLabel(item: CaseItem): string {
  if (item.frames > 1) return item.stack ? `${item.frames} slices` : `Cine · ${item.frames} frames`;
  if (item.kind === 'video') return 'Video';
  if (item.displayMime === 'application/pdf') return 'PDF';
  if (item.table) return 'Table';
  if (item.kind === 'document') return 'Document';
  if (item.kind === 'dicom') return item.dicom?.modality ?? 'DICOM';
  if (item.kind === 'image') return 'Image';
  return 'File';
}
