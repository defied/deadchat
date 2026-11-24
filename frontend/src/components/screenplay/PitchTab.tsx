// The pitch: a rip reel (clips, stills and storyboard frames cut to a
// soundtrack), the director's vision, and the treatment. Everything here is
// written and arranged by the user; nothing is generated.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Eye,
  FileText,
  Film,
  Image as ImageIcon,
  ListOrdered,
  Loader2,
  Music,
  Play,
  Plus,
  Printer,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import * as api from '../../api/screenplays';
import type { Detail, Pitch, Reel, ReelItem, ScreenplayDoc, ScreenplayMedia } from '../../api/screenplays';
import { soundCredit, soundMeta } from '../../api/screenplays';
import { Markdown } from '../chat/Markdown';
import { Alert, EmptyState, errorMessage } from '../ui';
import { cueName, newId, sceneNumbers, shotBlocks } from './format';
import { SpImage, useBlobUrl } from './media';

type Update = (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string) => void;
type Section = 'reel' | 'vision' | 'treatment';

interface Props {
  screenplayId: number;
  title: string;
  doc: ScreenplayDoc;
  detail?: Detail;
  update: Update;
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
  section: Section;
  onSection: (s: Section) => void;
}

const DEFAULT_HOLD = 3;
const CARD_SECONDS = 3.5;

export function PitchTab({ screenplayId, title, doc, detail, update, flush, setDetail, section, onSection }: Props) {
  const pitch = doc.pitch ?? {};
  const setPitch = (fn: (p: Pitch) => Pitch, group?: string) => update((d) => ({ ...d, pitch: fn(d.pitch ?? {}) }), group);
  const [printing, setPrinting] = useState(false);

  return (
    <div className="sp-pitch">
      <div className="sp-pitch-head">
        <label className="sp-logline">
          <span>Logline</span>
          <textarea
            rows={2}
            value={pitch.logline ?? ''}
            placeholder="One or two sentences: who wants what, what stands in the way, and what's at stake."
            onChange={(e) => setPitch((p) => ({ ...p, logline: e.target.value }), 'pitch:logline')}
          />
        </label>
        <div className="sp-pitch-nav" role="tablist">
          {([
            ['reel', 'Rip reel', <Film key="r" size={14} />],
            ['vision', 'Director’s vision', <Eye key="v" size={14} />],
            ['treatment', 'Treatment', <FileText key="t" size={14} />],
          ] as const).map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={section === id} className={section === id ? 'on' : ''} onClick={() => onSection(id)}>
              {icon} {label}
            </button>
          ))}
          <span className="sp-grow" />
          <button className="btn btn-sm" onClick={() => setPrinting(true)} title="Print or save the vision and treatment as a PDF">
            <Printer size={14} /> Pitch document
          </button>
        </div>
      </div>

      {section === 'reel' && <ReelEditor screenplayId={screenplayId} title={title} doc={doc} detail={detail} setPitch={setPitch} flush={flush} setDetail={setDetail} />}
      {section === 'vision' && <Vision doc={doc} detail={detail} setPitch={setPitch} />}
      {section === 'treatment' && <Treatment doc={doc} setPitch={setPitch} />}
      {printing && <PrintPitch title={title} doc={doc} detail={detail} onDone={() => setPrinting(false)} />}
    </div>
  );
}

// ── rip reel ─────────────────────────────────────────────────────────────────

/** Where an item's picture comes from: a media id, and whether it moves. */
function sourceOf(item: ReelItem, detail?: Detail): { mediaId: number | null; kind: 'video' | 'image'; label: string; missing?: string } {
  if (item.source.kind === 'frame') {
    const f = detail?.media.lastReady[`frame:${item.source.shotId}`];
    return { mediaId: f?.media_id ?? null, kind: 'image', label: 'Storyboard frame', missing: f ? undefined : 'This shot has no frame yet' };
  }
  const id = item.source.mediaRowId;
  const row = detail?.media.other.find((m) => m.id === id);
  return {
    mediaId: row?.media_id ?? null,
    kind: row?.target === 'video' ? 'video' : 'image',
    label: row?.label ?? 'Clip',
    missing: row ? undefined : 'This file was removed',
  };
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
}

function ReelEditor({
  screenplayId,
  title,
  doc,
  detail,
  setPitch,
  flush,
  setDetail,
}: {
  screenplayId: number;
  title: string;
  doc: ScreenplayDoc;
  detail?: Detail;
  setPitch: (fn: (p: Pitch) => Pitch, group?: string) => void;
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
}) {
  const reel: Reel = doc.pitch?.reel ?? { items: [] };
  const setReel = (fn: (r: Reel) => Reel, group?: string) => setPitch((p) => ({ ...p, reel: fn(p.reel ?? { items: [] }) }), group);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [playing, setPlaying] = useState<false | 'reel' | 'animatic'>(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const input = useRef<HTMLInputElement | null>(null);
  const files = (detail?.media.other ?? []).filter((m) => m.role === 'reel');
  const audio = files.filter((m) => m.target === 'audio');

  const scenes = useMemo(() => sceneNumbers(doc.elements), [doc.elements]);
  const shotsWithFrames = useMemo(() => {
    const order = new Map(doc.elements.map((e, i) => [e.id, i]));
    return [...doc.shots]
      .sort((a, b) => (order.get(a.anchorId) ?? 0) - (order.get(b.anchorId) ?? 0))
      .map((s, i) => ({ shot: s, n: i + 1, frame: detail?.media.lastReady[`frame:${s.id}`] }))
      .filter((x) => x.frame?.media_id);
  }, [doc.shots, doc.elements, detail]);

  const upload = async (list: FileList | File[]) => {
    setError(null);
    try {
      await flush();
      const added: Array<{ id: number; kind: string }> = [];
      const all = Array.from(list);
      for (const [i, f] of all.entries()) {
        setBusy(`Uploading ${f.name}${all.length > 1 ? ` (${i + 1}/${all.length})` : ''}…`);
        const r = await api.uploadReelFile(screenplayId, f, (p) => setBusy(`Uploading ${f.name}… ${Math.round(p * 100)}%`));
        setDetail(r);
        const row = r.media.other.find((m) => m.id === r.added);
        if (row) added.push({ id: row.id, kind: row.target });
      }
      setReel((r) => {
        const items = [...r.items, ...added.filter((a) => a.kind !== 'audio').map((a): ReelItem => ({ id: newId('rl'), source: { kind: 'upload', mediaRowId: a.id } }))];
        const song = added.find((a) => a.kind === 'audio');
        return { ...r, items, soundtrack: r.soundtrack ?? (song ? { kind: 'upload', mediaRowId: song.id } : undefined) };
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const setItem = (id: string, patch: Partial<ReelItem>, field: string) => setReel((r) => ({ ...r, items: r.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }), `reel:${id}:${field}`);
  const move = (i: number, d: -1 | 1) =>
    setReel((r) => {
      const items = [...r.items];
      const j = i + d;
      if (j < 0 || j >= items.length) return r;
      [items[i], items[j]] = [items[j], items[i]];
      return { ...r, items };
    });
  const length = (it: ReelItem) => {
    const src = sourceOf(it, detail);
    if (src.kind === 'image') return it.hold ?? DEFAULT_HOLD;
    const full = durations[it.id];
    const end = it.out ?? full;
    return end != null ? Math.max(0, end - (it.in ?? 0)) : 0;
  };
  const total = reel.items.reduce((t, it) => t + length(it), 0) + (reel.openCard === false ? 0 : CARD_SECONDS) + (reel.endCard ? CARD_SECONDS : 0);
  const removeFile = async (m: ScreenplayMedia) => {
    if (!window.confirm(`Delete “${m.label ?? 'this file'}” from the reel library?`)) return;
    await flush();
    setReel((r) => ({
      ...r,
      items: r.items.filter((it) => !(it.source.kind === 'upload' && it.source.mediaRowId === m.id)),
      soundtrack: r.soundtrack?.kind === 'upload' && r.soundtrack.mediaRowId === m.id ? undefined : r.soundtrack,
    }));
    setDetail(await api.deleteMediaRow(screenplayId, m.id));
  };

  return (
    <div className="sp-reel">
      <p className="field-hint sp-pitch-intro">
        A rip reel sets the tone in a couple of minutes: clips and stills that feel like your film, cut to music. Upload clips, stills and a
        soundtrack, or use your storyboard frames. Clips from other films are for private pitching only; clear anything you show publicly.
      </p>

      <div
        className={`sp-reel-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
      >
        {busy ? (
          <span><Loader2 size={14} className="spin" /> {busy}</span>
        ) : (
          <>
            <Upload size={16} /> Drop clips (MP4, WebM, MOV), stills or a soundtrack here
            <button className="btn btn-sm" onClick={() => input.current?.click()}>Choose files</button>
          </>
        )}
        <input ref={input} type="file" hidden multiple accept="video/mp4,video/webm,video/quicktime,image/*,audio/*" onChange={(e) => e.target.files && void upload(e.target.files)} />
      </div>
      {error && <Alert>{error}</Alert>}

      <div className="sp-reel-bar">
        <button className="btn btn-primary" disabled={!reel.items.length} onClick={() => setPlaying('reel')}>
          <Play size={14} /> Play reel
        </button>
        <button className="btn" disabled={!doc.shots.length} onClick={() => setPlaying('animatic')} title="Every shot in script order, for its length, with dialogue subtitles, its sounds and music cue">
          <Clapperboard size={14} /> Play animatic
        </button>
        <span className="field-hint">
          {reel.items.length} item{reel.items.length === 1 ? '' : 's'} · about {fmt(total)}
        </span>
        <span className="sp-grow" />
        <label className="sp-reel-field">
          <Music size={13} />
          <select
            value={reel.soundtrack ? (reel.soundtrack.kind === 'upload' ? `u:${reel.soundtrack.mediaRowId}` : `c:${reel.soundtrack.shotId}`) : ''}
            onChange={(e) => {
              const v = e.target.value;
              setReel((r) => ({
                ...r,
                soundtrack: !v ? undefined : v.startsWith('u:') ? { kind: 'upload', mediaRowId: Number(v.slice(2)) } : { kind: 'cue', shotId: v.slice(2) },
              }));
            }}
            aria-label="Soundtrack"
          >
            <option value="">No soundtrack</option>
            {audio.length > 0 && (
              <optgroup label="Uploaded">
                {audio.map((m) => <option key={m.id} value={`u:${m.id}`}>{m.label ?? `Track ${m.id}`}</option>)}
              </optgroup>
            )}
            {doc.shots.some((s) => detail?.media.lastReady[`music:${s.id}`]) && (
              <optgroup label="Shot music cues">
                {doc.shots
                  .map((s, i) => ({ s, i, cue: detail?.media.lastReady[`music:${s.id}`] }))
                  .filter((x) => x.cue)
                  .map((x) => <option key={x.s.id} value={`c:${x.s.id}`}>Shot {x.i + 1}: {x.s.music}</option>)}
              </optgroup>
            )}
          </select>
        </label>
      </div>

      <div className="sp-reel-cards">
        <label className="tab-perm">
          <input type="checkbox" checked={reel.openCard !== false} onChange={(e) => setReel((r) => ({ ...r, openCard: e.target.checked ? undefined : false }))} />
          Open on a title card ({title}{doc.pitch?.logline ? ' and the logline' : ''})
        </label>
        <input value={reel.endCard ?? ''} placeholder="End card text, e.g. a tagline or your contact" onChange={(e) => setReel((r) => ({ ...r, endCard: e.target.value || undefined }), 'reel:end')} aria-label="End card" />
      </div>

      {reel.items.length === 0 ? (
        <EmptyState title="The reel is empty">Upload clips and stills above, or add storyboard frames below.</EmptyState>
      ) : (
        <ol className="sp-reel-items">
          {reel.items.map((it, i) => {
            const src = sourceOf(it, detail);
            return (
              <li key={it.id} className="sp-reel-item">
                <span className="sp-reel-n">{i + 1}</span>
                <div className="sp-reel-thumb">
                  {src.mediaId ? (
                    src.kind === 'video' ? (
                      <ReelVideoThumb mediaId={src.mediaId} at={it.in ?? 0} onDuration={(d) => setDurations((m) => (m[it.id] === d ? m : { ...m, [it.id]: d }))} />
                    ) : (
                      <SpImage mediaId={src.mediaId} />
                    )
                  ) : (
                    <div className="sp-img-missing">{src.missing}</div>
                  )}
                </div>
                <div className="sp-reel-meta">
                  <span className="sp-reel-label">
                    {src.kind === 'video' ? <Film size={12} /> : it.source.kind === 'frame' ? <Clapperboard size={12} /> : <ImageIcon size={12} />} {src.label}
                    {src.missing && (
                      <span className="cs-warn"><AlertTriangle size={11} /> {src.missing}</span>
                    )}
                  </span>
                  <input value={it.caption ?? ''} placeholder="Text on screen (optional)" onChange={(e) => setItem(it.id, { caption: e.target.value || undefined }, 'caption')} aria-label="Caption" />
                  <div className="sp-reel-timing">
                    {src.kind === 'video' ? (
                      <>
                        <label>
                          In
                          <input type="number" min={0} step={0.1} value={it.in ?? ''} placeholder="0" onChange={(e) => setItem(it.id, { in: e.target.value === '' ? undefined : Number(e.target.value) }, 'in')} />
                        </label>
                        <label>
                          Out
                          <input type="number" min={0} step={0.1} value={it.out ?? ''} placeholder={durations[it.id] ? durations[it.id].toFixed(1) : 'end'} onChange={(e) => setItem(it.id, { out: e.target.value === '' ? undefined : Number(e.target.value) }, 'out')} />
                        </label>
                        <span className="field-hint">{length(it) ? `${length(it).toFixed(1)} s` : ''}</span>
                      </>
                    ) : (
                      <label>
                        On screen
                        <input type="number" min={0.5} max={60} step={0.5} value={it.hold ?? DEFAULT_HOLD} onChange={(e) => setItem(it.id, { hold: Number(e.target.value) || DEFAULT_HOLD }, 'hold')} />
                        s
                      </label>
                    )}
                  </div>
                </div>
                <div className="sp-reel-actions">
                  <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Earlier"><ArrowUp size={14} /></button>
                  <button className="icon-btn" disabled={i === reel.items.length - 1} onClick={() => move(i, 1)} title="Later"><ArrowDown size={14} /></button>
                  <button className="icon-btn" onClick={() => setReel((r) => ({ ...r, items: r.items.filter((x) => x.id !== it.id) }))} title="Take out of the reel"><X size={14} /></button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {shotsWithFrames.length > 0 && (
        <details className="sp-reel-frames">
          <summary>
            <Clapperboard size={13} /> Add storyboard frames ({shotsWithFrames.length})
          </summary>
          <div className="sp-reel-grid">
            {shotsWithFrames.map(({ shot, n, frame }) => {
              const used = reel.items.some((it) => it.source.kind === 'frame' && it.source.shotId === shot.id);
              const anchor = doc.elements.find((e) => e.id === shot.anchorId);
              let scene: number | undefined;
              for (let i = doc.elements.indexOf(anchor!); i >= 0; i--) if (doc.elements[i]?.type === 'scene') { scene = scenes.get(doc.elements[i].id); break; }
              return (
                <button
                  key={shot.id}
                  className={`sp-reel-pick ${used ? 'used' : ''}`}
                  onClick={() => setReel((r) => ({ ...r, items: [...r.items, { id: newId('rl'), source: { kind: 'frame', shotId: shot.id } }] }))}
                  title={used ? 'Already in the reel; add it again' : 'Add to the reel'}
                >
                  <SpImage mediaId={frame!.media_id!} />
                  <span>Shot {n}{scene ? ` · scene ${scene}` : ''}{used ? ' · in reel' : ''}</span>
                  <Plus size={14} className="sp-reel-plus" />
                </button>
              );
            })}
          </div>
        </details>
      )}

      {files.length > 0 && (
        <details className="sp-reel-library">
          <summary>Uploaded files ({files.length})</summary>
          <ul>
            {files.map((m) => {
              const inReel = reel.items.some((it) => it.source.kind === 'upload' && it.source.mediaRowId === m.id);
              return (
                <li key={m.id}>
                  {m.target === 'video' ? <Film size={13} /> : m.target === 'audio' ? <Music size={13} /> : <ImageIcon size={13} />}
                  <span>{m.label}</span>
                  <span className="sp-grow" />
                  {m.target !== 'audio' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setReel((r) => ({ ...r, items: [...r.items, { id: newId('rl'), source: { kind: 'upload', mediaRowId: m.id } }] }))}>
                      <Plus size={12} /> {inReel ? 'Add again' : 'Add'}
                    </button>
                  )}
                  <button className="icon-btn" onClick={() => void removeFile(m)} title="Delete file"><Trash2 size={13} /></button>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {playing && (
        <ReelPlayer
          beats={playing === 'animatic' ? animaticBeats(title, doc, detail) : reelBeats(title, doc, detail)}
          soundtrackMediaId={
            playing === 'animatic'
              ? null
              : reel.soundtrack?.kind === 'upload'
                ? detail?.media.other.find((m) => m.id === (reel.soundtrack as { mediaRowId: number }).mediaRowId)?.media_id
                : reel.soundtrack?.kind === 'cue'
                  ? detail?.media.lastReady[`music:${reel.soundtrack.shotId}`]?.media_id
                  : null
          }
          onClose={() => setPlaying(false)}
        />
      )}
    </div>
  );
}

function ReelVideoThumb({ mediaId, at, onDuration }: { mediaId: number; at: number; onDuration: (d: number) => void }) {
  const { url, failed } = useBlobUrl(mediaId);
  if (failed) return <div className="sp-img-missing">Unavailable</div>;
  if (!url) return <div className="sp-img-loading"><Loader2 size={16} className="spin" /></div>;
  return (
    <video
      src={`${url}#t=${at}`}
      muted
      preload="metadata"
      playsInline
      onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && onDuration(e.currentTarget.duration)}
    />
  );
}

// ── player ───────────────────────────────────────────────────────────────────

/** Sounds that play under one beat (a shot's kept sounds, or its music cue). */
interface Layer {
  mediaId: number;
  volume: number;
}

type Beat = { layers?: Layer[] } & (
  | { kind: 'card'; title: string; sub?: string; seconds: number; shot?: boolean }
  | { kind: 'image'; mediaId: number; seconds: number; caption?: string }
  | { kind: 'video'; mediaId: number; from: number; to?: number; caption?: string }
);

/** A shot's kept sounds (and, for the animatic, its music cue) as layers. */
function shotLayers(shotId: string, detail: Detail | undefined, withCue: boolean): Layer[] {
  const out: Layer[] = (detail?.media.other ?? [])
    .filter((m) => m.role === 'sound' && m.target === shotId && m.media_id)
    .map((m) => ({ mediaId: m.media_id!, volume: soundMeta(m)?.volume ?? 0.8 }));
  const cue = withCue ? detail?.media.lastReady[`music:${shotId}`]?.media_id : undefined;
  if (cue) out.push({ mediaId: cue, volume: 0.7 });
  return out;
}

function reelBeats(title: string, doc: ScreenplayDoc, detail?: Detail): Beat[] {
  const reel = doc.pitch?.reel ?? { items: [] };
  const out: Beat[] = [];
  if (reel.openCard !== false) out.push({ kind: 'card', title: doc.titlePage?.title || title, sub: doc.pitch?.logline, seconds: CARD_SECONDS });
  for (const it of reel.items) {
    const src = sourceOf(it, detail);
    if (!src.mediaId) continue;
    // A storyboard frame brings its shot's sounds along (the soundtrack covers music).
    const layers = it.source.kind === 'frame' ? shotLayers(it.source.shotId, detail, false) : undefined;
    if (src.kind === 'video') out.push({ kind: 'video', mediaId: src.mediaId, from: it.in ?? 0, to: it.out, caption: it.caption, layers });
    else out.push({ kind: 'image', mediaId: src.mediaId, seconds: it.hold ?? DEFAULT_HOLD, caption: it.caption, layers });
  }
  if (reel.endCard) out.push({ kind: 'card', title: reel.endCard, seconds: CARD_SECONDS });
  return out;
}

/**
 * The animatic: every shot in script order for its length, its dialogue as
 * subtitles, with its kept sounds and music cue. Shots without a frame show
 * their action line on a card.
 */
export function animaticBeats(title: string, doc: ScreenplayDoc, detail?: Detail): Beat[] {
  const blocks = shotBlocks(doc);
  const order = new Map(doc.elements.map((e, i) => [e.id, i]));
  const shots = [...doc.shots].sort((a, b) => (order.get(a.anchorId) ?? 0) - (order.get(b.anchorId) ?? 0));
  const out: Beat[] = [{ kind: 'card', title: doc.titlePage?.title || title, sub: doc.pitch?.logline, seconds: CARD_SECONDS }];
  for (const s of shots) {
    const els = doc.elements.filter((e) => blocks.get(e.id) === s.id);
    const lines: string[] = [];
    for (let i = 0; i < els.length; i++) {
      if (els[i].type !== 'character') continue;
      const who = cueName(els[i].text);
      const said = els.slice(i + 1).find((e) => e.type === 'dialogue')?.text;
      if (said) lines.push(`${who}: ${said}`);
    }
    const seconds = s.seconds ?? DEFAULT_HOLD;
    const frame = detail?.media.lastReady[`frame:${s.id}`]?.media_id;
    const layers = shotLayers(s.id, detail, true);
    if (frame) out.push({ kind: 'image', mediaId: frame, seconds, caption: lines.join('\n') || undefined, layers });
    else out.push({ kind: 'card', shot: true, title: els.find((e) => e.type === 'action')?.text ?? s.type ?? 'Shot', sub: lines.join('\n') || undefined, seconds, layers });
  }
  out.push({ kind: 'card', title: 'End', seconds: 2 });
  return out;
}

function ReelPlayer({ beats, soundtrackMediaId, onClose }: { beats: Beat[]; soundtrackMediaId?: number | null; onClose: () => void }) {
  const { url: soundUrl } = useBlobUrl(soundtrackMediaId ?? null);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const beat = beats[i];
  const next = () => setI((x) => (x + 1 < beats.length ? x + 1 : x === beats.length - 1 ? beats.length : x));
  const done = i >= beats.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Stills and cards advance on a timer.
  useEffect(() => {
    if (!beat || paused || beat.kind === 'video') return;
    const t = window.setTimeout(next, beat.seconds * 1000);
    return () => window.clearTimeout(t);
  }, [i, paused, beat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    if (paused || done) a.pause();
    else void a.play().catch(() => undefined);
  }, [paused, done, soundUrl]);

  return (
    <div className="sp-reel-player" onClick={() => setPaused((p) => !p)}>
      {soundUrl && <audio ref={audio} src={soundUrl} />}
      {done ? (
        <div className="sp-reel-card">
          <h2>End of reel</h2>
          <div className="sp-reel-end-actions" onClick={(e) => e.stopPropagation()}>
            <button className="btn" onClick={() => { setI(0); if (audio.current) audio.current.currentTime = 0; }}><Play size={14} /> Play again</button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : beat.kind === 'card' ? (
        <div className={`sp-reel-card ${beat.shot ? 'shot' : ''}`}>
          <h2>{beat.title}</h2>
          {beat.sub && <p>{beat.sub}</p>}
        </div>
      ) : beat.kind === 'image' ? (
        <SpImage mediaId={beat.mediaId} className="sp-reel-media" />
      ) : (
        <ReelVideo key={i} beat={beat} paused={paused} onEnd={next} />
      )}
      {!done && beat.kind !== 'card' && beat.caption && <div className="sp-reel-caption">{beat.caption}</div>}
      {!done && !paused && beat.layers?.map((l, n) => <LayerAudio key={`${i}-${n}`} layer={l} />)}
      <div className="sp-reel-hud" onClick={(e) => e.stopPropagation()}>
        <span>{Math.min(i + 1, beats.length)} / {beats.length}{paused ? ' · paused' : ''}</span>
        <span className="field-hint">Space pauses · ← → skip · Esc closes</span>
        <button className="icon-btn" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
    </div>
  );
}

function LayerAudio({ layer }: { layer: Layer }) {
  const { url } = useBlobUrl(layer.mediaId);
  const a = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!a.current || !url) return;
    a.current.volume = Math.max(0, Math.min(1, layer.volume));
    void a.current.play().catch(() => undefined);
  }, [url, layer.volume]);
  return url ? <audio ref={a} src={url} /> : null;
}

function ReelVideo({ beat, paused, onEnd }: { beat: Extract<Beat, { kind: 'video' }>; paused: boolean; onEnd: () => void }) {
  const { url } = useBlobUrl(beat.mediaId);
  const v = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    if (paused) el.pause();
    else void el.play().catch(() => undefined);
  }, [paused, url]);
  if (!url) return <Loader2 size={24} className="spin" />;
  return (
    <video
      ref={v}
      className="sp-reel-media"
      src={url}
      muted
      playsInline
      autoPlay
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = beat.from;
      }}
      onTimeUpdate={(e) => {
        if (beat.to != null && e.currentTarget.currentTime >= beat.to) onEnd();
      }}
      onEnded={onEnd}
    />
  );
}

// ── director's vision ────────────────────────────────────────────────────────

const VISION_FIELDS: Array<{ key: keyof NonNullable<Pitch['vision']>; label: string; hint: string; rows: number }> = [
  { key: 'tone', label: 'Tone', hint: 'How it should feel to watch, moment to moment.', rows: 3 },
  { key: 'look', label: 'Look', hint: 'Camera, lenses, movement, palette, light, production design.', rows: 4 },
  { key: 'sound', label: 'Sound and music', hint: 'Score, source music, silence, the sound world.', rows: 3 },
  { key: 'themes', label: 'Themes', hint: 'What it’s really about.', rows: 3 },
  { key: 'audience', label: 'Audience', hint: 'Who it’s for and where they’ll watch it.', rows: 2 },
  { key: 'whyNow', label: 'Why now, why me', hint: 'Why this story matters today, and why you’re the one to tell it.', rows: 3 },
];

function Vision({ doc, detail, setPitch }: { doc: ScreenplayDoc; detail?: Detail; setPitch: (fn: (p: Pitch) => Pitch, group?: string) => void }) {
  const v = doc.pitch?.vision ?? {};
  const setV = (patch: Partial<NonNullable<Pitch['vision']>>, field: string) => setPitch((p) => ({ ...p, vision: { ...p.vision, ...patch } }), `vision:${field}`);
  const [comp, setComp] = useState('');
  const refs = (detail?.media.other ?? []).filter((m) => m.role === 'reference' && m.media_id);
  const board = v.moodboard ?? [];
  const addComp = () => {
    const c = comp.trim();
    if (!c) return;
    setV({ comps: [...(v.comps ?? []), c] }, 'comps');
    setComp('');
  };

  return (
    <div className="sp-vision">
      <label className="sp-vision-field wide">
        <span>Director’s statement</span>
        <small className="field-hint">In your own voice: what you see, what you want the audience to feel, and how you’ll get there.</small>
        <textarea rows={8} value={v.statement ?? ''} onChange={(e) => setV({ statement: e.target.value }, 'statement')} />
      </label>
      <div className="sp-vision-grid">
        {VISION_FIELDS.map((f) => (
          <label key={f.key} className="sp-vision-field">
            <span>{f.label}</span>
            <small className="field-hint">{f.hint}</small>
            <textarea rows={f.rows} value={(v[f.key] as string) ?? ''} onChange={(e) => setV({ [f.key]: e.target.value } as Partial<NonNullable<Pitch['vision']>>, f.key)} />
          </label>
        ))}
      </div>

      <div className="sp-vision-field wide">
        <span>Comparables</span>
        <small className="field-hint">Titles it sits beside, like “Arrival meets The Remains of the Day”.</small>
        <div className="sp-comps">
          {(v.comps ?? []).map((c, i) => (
            <span key={`${c}-${i}`} className="sp-comp">
              {c}
              <button className="icon-btn" title="Remove" onClick={() => setV({ comps: (v.comps ?? []).filter((_, j) => j !== i) }, 'comps')}><X size={11} /></button>
            </span>
          ))}
          <input
            value={comp}
            placeholder="Add a comparable and press Enter"
            onChange={(e) => setComp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addComp();
              }
            }}
            onBlur={addComp}
          />
        </div>
      </div>

      <div className="sp-vision-field wide">
        <span>Mood board</span>
        <small className="field-hint">Pick from the images on the References tab. Click to add or remove.</small>
        {refs.length ? (
          <div className="sp-board">
            {refs.map((m) => {
              const on = board.includes(m.id);
              return (
                <button key={m.id} className={`sp-board-img ${on ? 'on' : ''}`} onClick={() => setV({ moodboard: on ? board.filter((x) => x !== m.id) : [...board, m.id] }, 'board')} title={m.caption ?? m.label ?? ''}>
                  <SpImage mediaId={m.media_id!} />
                  {on && <span className="sp-board-n">{board.indexOf(m.id) + 1}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="field-hint">No reference images yet. Add some on the References tab.</p>
        )}
      </div>
    </div>
  );
}

// ── treatment ────────────────────────────────────────────────────────────────

function Treatment({ doc, setPitch }: { doc: ScreenplayDoc; setPitch: (fn: (p: Pitch) => Pitch, group?: string) => void }) {
  const text = doc.pitch?.treatment ?? '';
  const [preview, setPreview] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const pages = Math.max(1, Math.round(words / 400));
  const set = (t: string) => setPitch((p) => ({ ...p, treatment: t }), 'treatment');

  /** Insert at the cursor (or the end), as plain text the writer then works on. */
  const insert = (block: string) => {
    const el = area.current;
    const at = el && document.activeElement === el ? el.selectionStart : text.length;
    const before = text.slice(0, at);
    const sep = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    set(`${before}${sep}${block}\n\n${text.slice(at).replace(/^\n+/, '')}`.replace(/\n{3,}$/, '\n'));
    setPreview(false);
  };
  const outline = () => {
    const n = sceneNumbers(doc.elements);
    const lines = doc.elements.filter((e) => e.type === 'scene' && e.text.trim()).map((e) => `- **${n.get(e.id)}. ${e.text.trim()}**: `);
    return lines.length ? `## Scene outline\n\n${lines.join('\n')}` : '';
  };
  const cast = () => {
    const speaking = new Map<string, number>();
    for (const e of doc.elements) if (e.type === 'character') { const k = cueName(e.text).toUpperCase(); speaking.set(k, (speaking.get(k) ?? 0) + 1); }
    const named = doc.characters.filter((c) => c.name.trim());
    const lines = named
      .sort((a, b) => (speaking.get(b.name.toUpperCase()) ?? 0) - (speaking.get(a.name.toUpperCase()) ?? 0))
      .map((c) => `- **${c.name}**${c.role ? ` (${c.role})` : ''}: ${[c.age, c.personality].filter(Boolean).join('. ')}`);
    return lines.length ? `## Characters\n\n${lines.join('\n')}` : '';
  };

  return (
    <div className="sp-treatment">
      <div className="sp-treatment-bar">
        <button className={`btn btn-sm ${preview ? '' : 'btn-primary'}`} onClick={() => setPreview(false)}>Write</button>
        <button className={`btn btn-sm ${preview ? 'btn-primary' : ''}`} onClick={() => setPreview(true)}>Preview</button>
        <span className="sp-grow" />
        <button className="btn btn-sm" disabled={!outline()} onClick={() => insert(outline())} title="Insert a list of your scene headings to write under">
          <ListOrdered size={13} /> Insert scene outline
        </button>
        <button className="btn btn-sm" disabled={!cast()} onClick={() => insert(cast())} title="Insert the characters from the Characters tab">
          <Users size={13} /> Insert characters
        </button>
      </div>
      {preview ? (
        <div className="sp-treatment-preview">{text.trim() ? <Markdown text={text} /> : <p className="field-hint">Nothing written yet.</p>}</div>
      ) : (
        <textarea
          ref={area}
          className="sp-treatment-text"
          value={text}
          onChange={(e) => set(e.target.value)}
          placeholder={'The story told in present-tense prose, beginning to end, with the ending.\n\nUse ## for section headings (e.g. ## Act One), **bold** for character introductions.'}
        />
      )}
      <div className="field-hint sp-treatment-count">
        {words.toLocaleString()} words · about {pages} page{pages === 1 ? '' : 's'}
      </div>
    </div>
  );
}

// ── print ────────────────────────────────────────────────────────────────────

function PrintPitch({ title, doc, detail, onDone }: { title: string; doc: ScreenplayDoc; detail?: Detail; onDone: () => void }) {
  const ids = (doc.pitch?.vision?.moodboard ?? [])
    .map((rid) => detail?.media.other.find((m) => m.id === rid)?.media_id)
    .filter((x): x is number => !!x);
  const html = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Render offscreen with the images loaded, then hand the HTML to a print window.
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const root = html.current;
      if (!root || cancelled) return;
      await Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = r; }))));
      const w = window.open('', '_blank');
      if (!w) {
        setError('Allow pop-ups for this site to print the pitch document.');
        return;
      }
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${(doc.titlePage?.title || title).replace(/</g, '&lt;')}: pitch</title><style>${PRINT_CSS}</style></head><body>${root.innerHTML}</body></html>`);
      w.document.close();
      w.focus();
      window.setTimeout(() => {
        w.print();
        onDone();
      }, 400);
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const p = doc.pitch ?? {};
  const v = p.vision ?? {};
  const tp = doc.titlePage ?? {};
  const credits = (detail?.media.other ?? [])
    .filter((m) => m.role === 'sound')
    .map((m) => ({ m, meta: soundMeta(m) }))
    .filter((x) => x.meta?.license.attribution)
    .map((x) => soundCredit(x.m.label ?? 'Untitled', x.meta!));
  return (
    <div className="sp-print-pitch-wait">
      {error ? (
        <Alert>
          {error} <button className="btn btn-sm" onClick={onDone}>Close</button>
        </Alert>
      ) : (
        <span><Loader2 size={14} className="spin" /> Preparing the pitch document…</span>
      )}
      <div ref={html} className="sp-print-source" aria-hidden>
        <section className="cover">
          <h1>{tp.title || title}</h1>
          {tp.author && <p className="by">{tp.credit || 'Written by'} {tp.author}</p>}
          {p.logline && <p className="logline">{p.logline}</p>}
          {tp.contact && <p className="contact">{tp.contact}</p>}
        </section>
        {(v.statement || VISION_FIELDS.some((f) => v[f.key]) || v.comps?.length) && (
          <section>
            <h2>Director’s vision</h2>
            {v.statement && <div className="prose">{v.statement}</div>}
            {VISION_FIELDS.filter((f) => v[f.key]).map((f) => (
              <div key={f.key}>
                <h3>{f.label}</h3>
                <div className="prose">{v[f.key] as string}</div>
              </div>
            ))}
            {!!v.comps?.length && (
              <>
                <h3>Comparables</h3>
                <ul>{v.comps.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </>
            )}
            {ids.length > 0 && (
              <>
                <h3>Mood board</h3>
                <div className="board">{ids.map((id) => <PrintImg key={id} mediaId={id} />)}</div>
              </>
            )}
          </section>
        )}
        {p.treatment?.trim() && (
          <section>
            <h2>Treatment</h2>
            <div className="treatment"><Markdown text={p.treatment} /></div>
          </section>
        )}
        {credits.length > 0 && (
          <section className="credits">
            <h2>Sound credits</h2>
            <ul>{credits.map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        )}
      </div>
    </div>
  );
}

function PrintImg({ mediaId }: { mediaId: number }) {
  const { url } = useBlobUrl(mediaId);
  return url ? <img src={url} alt="" /> : null;
}

const PRINT_CSS = `
@page { size: letter; margin: 0.8in; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.5; color: #111; margin: 0; }
h1 { font-size: 30pt; margin: 2.2in 0 0.2in; text-align: center; letter-spacing: 0.02em; }
h2 { font-size: 17pt; margin: 0 0 0.15in; border-bottom: 1px solid #999; padding-bottom: 4pt; }
h3 { font-size: 12pt; margin: 0.22in 0 0.05in; text-transform: uppercase; letter-spacing: 0.06em; color: #444; }
section { page-break-before: always; }
section.cover { page-break-before: auto; text-align: center; min-height: 9in; }
.by { font-style: italic; }
.logline { font-size: 13pt; margin: 0.5in auto 0; max-width: 5.5in; }
.contact { white-space: pre-wrap; margin-top: 2in; font-size: 10pt; color: #444; }
.prose { white-space: pre-wrap; }
.board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt; }
.board img { width: 100%; aspect-ratio: 16/9; object-fit: cover; }
.treatment p { margin: 0 0 0.12in; }
.treatment h2, .treatment h3 { border: 0; page-break-after: avoid; }
.credits li { font-size: 10pt; margin-bottom: 3pt; }
`;
