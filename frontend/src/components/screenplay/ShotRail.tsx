// Storyboard shots beside the script. Each card sits level with the element
// it's pinned to (pushed down when cards would overlap) and shows the example
// frame DeadChat keeps in step with that part of the script.

import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, AudioLines, Image as ImageIcon, ImagePlus, Search, Sparkles, Clapperboard, Dices, Loader2, LayoutGrid, Music, Lock, LockOpen, Plus, RefreshCw, SlidersHorizontal, Trash2, Clock, X } from 'lucide-react';
import type { Adjustment, Detail, ScreenplayDoc, Shot, ShotPlanView } from '../../api/screenplays';
import { LENS_TYPES, foundMeta, isVoiceRow, recreatedFrom, soundMeta, summarizeShot, updateMedia, updateSound, uploadReference } from '../../api/screenplays';
import { useScreenplayActions } from './actions';
import { Modal } from '../ui';
import { SHOT_TYPES, newId, sortShots, timecode } from './format';
import { MusicButton, SpImage } from './media';
import { AdjustmentNotes } from './AdjustmentNotes';
import { ShotFinder } from './ShotFinder';
import { RecreateFrame } from './RecreateFrame';

const LENSES = [14, 18, 24, 35, 50, 85, 100, 135];
const GAP = 12;

interface RailProps {
  screenplayId: number;
  doc: ScreenplayDoc;
  detail?: Detail;
  update: (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string) => void;
  nodes: RefObject<Map<string, HTMLTextAreaElement>>;
  pageRef: RefObject<HTMLDivElement | null>;
  onOpenPlan: (sceneId: string, shotId: string) => void;
  onFocusAnchor: (elementId: string) => void;
  onRefresh: (shotId: string) => Promise<void>;
  hoverShot: string | null;
  onHoverShot: (shotId: string | null) => void;
}

export function ShotRail({ doc, detail, update, nodes, pageRef, onOpenPlan, onFocusAnchor, onRefresh, hoverShot, onHoverShot }: RailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [tops, setTops] = useState<Record<string, number>>({});
  const [height, setHeight] = useState(0);
  const [, setTick] = useState(0);

  const order = useMemo(() => new Map(doc.elements.map((e, i) => [e.id, i])), [doc.elements]);
  const shots = useMemo(
    () => sortShots(doc.shots.filter((s) => order.has(s.anchorId)), doc.elements),
    [doc.shots, doc.elements, order],
  );
  const starts = useMemo(() => {
    let t = 0;
    return shots.map((s) => {
      const at = t;
      t += s.seconds ?? 0;
      return at;
    });
  }, [shots]);
  const sceneOf = (anchorId: string) => {
    for (let i = order.get(anchorId) ?? -1; i >= 0; i--) if (doc.elements[i].type === 'scene') return doc.elements[i].id;
    return '';
  };

  // Lay cards out level with their anchors. Guard against layout feedback
  // (e.g. a scrollbar appearing as the rail grows and reflowing the page).
  const passes = useRef(0);
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    if (passes.current++ === 0) requestAnimationFrame(() => (passes.current = 0));
    if (passes.current > 4) return;
    const base = rail.getBoundingClientRect().top;
    let bottom = 0;
    const next: Record<string, number> = {};
    for (const s of shots) {
      const anchor = nodes.current?.get(s.anchorId);
      const want = anchor ? anchor.getBoundingClientRect().top - base : bottom;
      const top = Math.max(want, bottom);
      next[s.id] = Math.round(top);
      bottom = top + (cards.current.get(s.id)?.offsetHeight ?? 260) + GAP;
    }
    const changed = Object.keys(next).length !== Object.keys(tops).length || Object.entries(next).some(([k, v]) => tops[k] !== v);
    if (changed) setTops(next);
    if (Math.round(bottom) !== height) setHeight(Math.round(bottom));
  });

  // Re-layout when the page or a card changes size.
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    if (pageRef.current) ro.observe(pageRef.current);
    cards.current.forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [pageRef, shots.length]);

  const patch = (id: string, p: Partial<Shot>, field: string) =>
    update((d) => ({ ...d, shots: d.shots.map((s) => (s.id === id ? { ...s, ...p } : s)) }), `shot:${id}:${field}`);
  const remove = (id: string) =>
    update((d) => ({
      ...d,
      shots: d.shots.filter((s) => s.id !== id),
      plans: Object.fromEntries(Object.entries(d.plans).map(([k, p]) => [k, { items: p.items.filter((it) => !(it.kind === 'camera' && it.ref === id)) }])),
    }));

  return (
    <div className="sp-rail" ref={railRef} style={{ minHeight: height }}>
      <datalist id="sp-shot-types">
        {SHOT_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {shots.length === 0 && (
        <div className="sp-rail-empty">
          <Clapperboard size={18} />
          <p>
            Highlight the part of the script a shot shows and click <strong>Shot from highlight</strong>. The agent sums up what’s in it; adjust that,
            then <strong>Find a shot</strong> to pick a matching photo for its frame (and recreate it with your cast and props), or draw one with AI.
          </p>
        </div>
      )}
      {shots.map((s, i) => (
        <div
          key={s.id}
          className={`sp-shot-wrap${hoverShot === s.id ? ' lit' : ''}`}
          style={{ top: tops[s.id] ?? 0 }}
          onMouseEnter={() => onHoverShot(s.id)}
          onMouseLeave={() => onHoverShot(null)}
          ref={(n) => {
            if (n) cards.current.set(s.id, n);
            else cards.current.delete(s.id);
          }}
        >
          <ShotCard
            shot={s}
            number={i + 1}
            start={starts[i]}
            detail={detail}
            onPatch={(p, field) => patch(s.id, p, field)}
            onDelete={() => remove(s.id)}
            onPlan={() => onOpenPlan(sceneOf(s.anchorId), s.id)}
            onFocus={() => onFocusAnchor(s.anchorId)}
            onRefresh={() => onRefresh(s.id)}
            heading={doc.elements.find((e) => e.id === sceneOf(s.anchorId))?.text ?? ''}
          />
        </div>
      ))}
    </div>
  );
}

function ShotCard({
  shot,
  number,
  start,
  detail,
  onPatch,
  onDelete,
  onPlan,
  onFocus,
  onRefresh,
  heading,
}: {
  heading: string;
  shot: Shot;
  number: number;
  start: number;
  detail?: Detail;
  onPatch: (p: Partial<Shot>, field: string) => void;
  onDelete: () => void;
  onPlan: () => void;
  onFocus: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const { screenplayId } = useScreenplayActions();
  const [summarizing, setSummarizing] = useState(false);
  const resummarize = async () => {
    if (!shot.excerpt) return;
    setSummarizing(true);
    try {
      onPatch({ summary: await summarizeShot(screenplayId, heading, shot.excerpt) }, 'summary');
    } catch {
      /* keep what's there */
    } finally {
      setSummarizing(false);
    }
  };
  const [recreating, setRecreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
    } catch (e) {
      setRefreshError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const plan = detail?.plans[shot.id];
  const latest = detail?.media.latest[`frame:${shot.id}`];
  const rendered = detail?.media.lastReady[`frame:${shot.id}`];
  // The writer's chosen image: a photo, or the AI's recreation of one (shown
  // over the original photo while it's being made, or if it failed).
  const frameRow = shot.frameImage ? detail?.media.other.find((m) => m.id === shot.frameImage) : undefined;
  const rec = recreatedFrom(frameRow);
  const original = rec ? detail?.media.other.find((m) => m.id === rec.from && m.media_id) : undefined;
  const ownRow = frameRow?.status === 'ready' && frameRow.media_id ? frameRow : original;
  const recreatePending = frameRow?.status === 'pending';
  const recreateError = rec && frameRow?.status === 'failed' ? frameRow.error || 'The AI couldn’t recreate this shot' : null;
  const recreateBase = rec ? original : ownRow?.role === 'reference' ? ownRow : undefined;
  // An image the writer chose stands in for the rendered frame.
  const ready = ownRow ?? rendered;
  const cue = detail?.media.latest[`music:${shot.id}`];
  const cueReady = detail?.media.lastReady[`music:${shot.id}`];
  const pending = latest?.status === 'pending';
  const locked = !!shot.locked;
  const outOfDate = !locked && (!!plan?.stale || !!plan?.musicStale);
  const staleWhat = plan?.stale && plan?.musicStale ? 'frame and music' : plan?.stale ? 'frame' : 'music';
  const failed = latest?.status === 'failed' && !ownRow ? latest.error : null;
  const found = foundMeta(frameRow) ?? foundMeta(ownRow);

  let note: string | null = null;
  if (plan?.blocked) note = plan.blocked;
  else if (plan?.waiting) note = plan.waiting;
  else if (plan?.adjusting && !shot.locked) note = 'Applying adjustment notes…';

  return (
    <div className={`sp-shot ${pending ? 'busy' : ''} ${locked ? 'locked' : ''}`} data-shot-id={shot.id}>
      <div className="sp-shot-head">
        <button className="sp-shot-no" onClick={onFocus} title="Go to this part of the script">
          Shot {number}
        </button>
        <span className="sp-shot-tc" title="Starts at">
          <Clock size={11} /> {timecode(start)}
        </span>
        {cueReady?.media_id && <MusicButton key={cueReady.media_id} mediaId={cueReady.media_id} label={cue?.status === 'pending' ? 'Play the previous cue (new one rendering)' : 'Play music cue'} />}
        {cue?.status === 'pending' && <Loader2 size={12} className="spin" aria-label="Music updating" />}
        <span className="sp-grow" />
        <button className="icon-btn" title="Find a shot: photos that match this part of the script" onClick={() => setFinding(true)}>
          <Search size={14} />
        </button>
        <button className="icon-btn" title="Set plan: camera, cast and lights" onClick={onPlan}>
          <LayoutGrid size={14} />
        </button>
        <button
          className={`icon-btn ${locked ? 'sp-lock on' : 'sp-lock'}`}
          title={locked ? 'Locked: this frame and music stay as they are. Click to unlock.' : 'Lock this shot: keep the frame and music even if the script changes'}
          aria-pressed={locked}
          onClick={() => onPatch({ locked: locked ? undefined : true }, 'locked')}
        >
          {locked ? <Lock size={14} /> : <LockOpen size={14} />}
        </button>
        {(outOfDate || refreshing) && (
          <button className="icon-btn sp-refresh" title={`Changed since the ${staleWhat} rendered. Refresh to update it.`} onClick={refresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
        )}
        <button
          className="icon-btn"
          title={rendered ? 'Draw a new take with AI' : 'Draw this shot with AI'}
          onClick={() => {
            onPatch({ take: (shot.take ?? 0) + 1 }, 'take');
            void refresh();
          }}
          disabled={!!plan?.waiting || !!plan?.blocked || refreshing || locked}
        >
          <Dices size={14} />
        </button>
        <button className="icon-btn" title="Remove shot" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>

      <div className="sp-shot-summary" title={shot.excerpt ? `Highlighted: “${shot.excerpt}”` : undefined}>
        <span className="sp-adj-head">
          In this shot
          {(summarizing || (shot.excerpt && shot.summary === undefined)) && <Loader2 size={11} className="spin" aria-label="Summarizing" />}
          <span className="sp-grow" />
          {shot.excerpt && (
            <button className="icon-btn" title="Summarize the highlighted text again" onClick={() => void resummarize()} disabled={summarizing}>
              <RefreshCw size={11} />
            </button>
          )}
        </span>
        <textarea
          rows={2}
          value={shot.summary ?? ''}
          placeholder={shot.excerpt ? 'Summarizing the highlighted text…' : 'What the camera sees, e.g. “Jane grips a knife at the kitchen counter.”'}
          onChange={(e) => onPatch({ summary: e.target.value }, 'summary')}
          aria-label="What's in this shot"
        />
      </div>
      {!ready?.media_id && !pending && !recreatePending ? (
        <div className="sp-frame sp-frame-start">
          <span>{plan?.blocked ?? 'No frame yet'}</span>
          <div>
            <button className="btn btn-sm btn-primary" onClick={() => setFinding(true)}>
              <Search size={13} /> Find a shot
            </button>
            <button
              className="btn btn-sm"
              onClick={() => void refresh()}
              disabled={!!plan?.waiting || !!plan?.blocked || refreshing || locked}
              title={plan?.waiting ?? 'Draw this frame from scratch with the image model'}
            >
              {refreshing ? <Loader2 size={13} className="spin" /> : <Dices size={13} />} Draw with AI
            </button>
          </div>
          {plan?.waiting && <small>{plan.waiting}</small>}
        </div>
      ) : (
      <button className="sp-frame" onClick={() => ready?.media_id && setOpen(true)} disabled={!ready?.media_id}>
        {ready?.media_id ? <SpImage mediaId={ready.media_id} alt={`Shot ${number}`} /> : <div className="sp-frame-empty">{note ?? ''}</div>}
        {pending && !locked && (
          <span className="sp-frame-status">
            <Loader2 size={12} className="spin" /> {ready ? 'Updating to match the script…' : 'Rendering…'}
          </span>
        )}
        {recreatePending && (
          <span className="sp-frame-status">
            <Loader2 size={12} className="spin" /> Recreating with your cast and props…
          </span>
        )}
        {locked && (
          <span className="sp-frame-lock" title="Locked">
            <Lock size={11} /> Locked
          </span>
        )}
        {!pending && !locked && plan?.adjusting && ready && !ownRow && (
          <span className="sp-frame-status">
            <Loader2 size={12} className="spin" /> Applying adjustment notes…
          </span>
        )}
      </button>
      )}
      {(recreateBase || rec) && !locked && (
        <div className="sp-frame-actions">
          {recreateBase && (
            <button className="btn btn-sm btn-ghost" onClick={() => setRecreating(true)} disabled={recreatePending} title="The AI keeps this photo’s camera, setting and light, and puts your characters and props in">
              <Sparkles size={12} /> {rec ? 'Recreate again' : 'Recreate with cast & props'}
            </button>
          )}
          {rec && original && (
            <button className="btn btn-sm btn-ghost" onClick={() => onPatch({ frameImage: original.id }, 'frameImage')} disabled={recreatePending}>
              Use the original photo
            </button>
          )}
        </div>
      )}
      {recreateError && <div className="sp-shot-warn"><AlertTriangle size={12} /> {recreateError}</div>}
      {found && (
        <div className="sp-found-credit" title={found.title}>
          <a href={found.landingUrl} target="_blank" rel="noreferrer">{found.title}</a>
          <span>
            {found.creator ? ` · ${found.creator}` : ''} · {found.sourceName} · {found.license.name}
          </span>
        </div>
      )}
      {plan?.blocked && <div className="sp-shot-warn"><AlertTriangle size={12} /> {plan.blocked}</div>}
      {outOfDate && !pending && !refreshing && !ownRow && (
        <button className="sp-stale" onClick={refresh}>
          <RefreshCw size={11} /> Shot settings changed. Refresh to update the {staleWhat}.
        </button>
      )}
      {refreshError && <div className="sp-shot-warn"><AlertTriangle size={12} /> {refreshError}</div>}
      {!plan?.blocked && ready && note && <div className="sp-shot-note">{note}</div>}
      {failed && !pending && <div className="sp-shot-warn"><AlertTriangle size={12} /> {failed}</div>}

      <div className="sp-shot-fields">
        <label className="wide">
          <span>Shot type</span>
          <input list="sp-shot-types" value={shot.type ?? ''} placeholder="Wide establishing…" onChange={(e) => onPatch({ type: e.target.value }, 'type')} />
        </label>
        <label>
          <span>Seconds</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={shot.seconds ?? ''}
            onChange={(e) => onPatch({ seconds: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) }, 'seconds')}
          />
        </label>
        <label>
          <span>Lens</span>
          <select value={shot.lens ?? ''} onChange={(e) => onPatch({ lens: e.target.value ? Number(e.target.value) : undefined }, 'lens')}>
            <option value="">Auto</option>
            {LENSES.map((l) => (
              <option key={l} value={l}>
                {l}mm
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Glass</span>
          <select value={shot.lensType ?? ''} onChange={(e) => onPatch({ lensType: e.target.value || undefined }, 'lensType')}>
            <option value="">Film default</option>
            {LENS_TYPES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>
            <Music size={11} /> Music
            {cue?.status === 'pending' && <Loader2 size={11} className="spin" />}
          </span>
          <textarea rows={1} value={shot.music ?? ''} placeholder="e.g. sparse piano, melancholy, slow" onChange={(e) => onPatch({ music: e.target.value }, 'music')} />
        </label>
        {cue?.status === 'failed' && <div className="sp-shot-warn wide"><AlertTriangle size={12} /> {cue.error}</div>}
        <ShotImages shot={shot} detail={detail} onPatch={onPatch} />
        <ShotSounds shot={shot} detail={detail} />
        <AdjustmentNotes shot={shot} plan={plan} onChange={(adjustments) => onPatch({ adjustments }, 'adjustments')} />
        <label className="wide">
          <span>Notes</span>
          <textarea rows={1} value={shot.notes ?? ''} placeholder="Blocking, movement, VFX… (for you; not used for the frame)" onChange={(e) => onPatch({ notes: e.target.value }, 'notes')} />
        </label>
      </div>
      {recreating && recreateBase && <RecreateFrame shot={shot} number={number} baseRow={recreateBase} detail={detail} onPatch={onPatch} onClose={() => setRecreating(false)} />}
      {finding && <ShotFinder shot={shot} number={number} detail={detail} onPatch={onPatch} onClose={() => setFinding(false)} onRecreate={() => setRecreating(true)} />}
      {open && ready?.media_id && (
        <Modal title={`Shot ${number}${shot.type ? ` · ${shot.type}` : ''}`} onClose={() => setOpen(false)} width={1100}>
          <div className="sp-frame-large">
            <SpImage mediaId={ready.media_id} alt={`Shot ${number}`} />
          </div>
          {ready.prompt && (
            <details className="sp-prompt">
              <summary>What the image model was asked for</summary>
              <p>{ready.prompt}</p>
              {plan?.basePrompt && plan.basePrompt !== ready.prompt && (
                <>
                  <h4>From the script, before adjustment notes</h4>
                  <p>{plan.basePrompt}</p>
                </>
              )}
            </details>
          )}
        </Modal>
      )}
    </div>
  );
}

/** Sounds kept for this shot: add from the library, set volume, take off, or gather more. */
function ShotSounds({ shot, detail }: { shot: Shot; detail?: Detail }) {
  const navigate = useNavigate();
  const { screenplayId, flush, setDetail } = useScreenplayActions();
  const [busy, setBusy] = useState(false);
  const all = (detail?.media.other ?? []).filter((m) => m.role === 'sound' && !isVoiceRow(m));
  const mine = all.filter((m) => m.target === shot.id);
  const others = all.filter((m) => m.target !== shot.id);
  const act = async (fn: () => Promise<Detail>) => {
    setBusy(true);
    try {
      await flush();
      setDetail(await fn());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sp-shot-media wide">
      <span className="sp-adj-head">
        <AudioLines size={11} /> Sounds
        {busy && <Loader2 size={11} className="spin" />}
      </span>
      {mine.map((m) => (
        <div key={m.id} className="sp-shot-media-row">
          {m.media_id && <MusicButton mediaId={m.media_id} label={`Play ${m.label}`} />}
          <span className="sp-shot-media-name" title={m.label ?? ''}>{m.label}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={soundMeta(m)?.volume ?? 0.8}
            title="Volume under the picture"
            aria-label={`Volume of ${m.label}`}
            onPointerUp={(e) => void act(() => updateSound(screenplayId, m.id, { volume: Number((e.target as HTMLInputElement).value) }))}
          />
          <button className="icon-btn" title="Take off this shot (stays in the library)" onClick={() => void act(() => updateSound(screenplayId, m.id, { target: '' }))}>
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="sp-shot-media-add">
        {others.length > 0 && (
          <select value="" onChange={(e) => e.target.value && void act(() => updateSound(screenplayId, Number(e.target.value), { target: shot.id }))} aria-label="Add a kept sound">
            <option value="">Add a kept sound…</option>
            {others.map((m) => <option key={m.id} value={m.id}>{m.label}{m.target ? ' (in another shot)' : ''}</option>)}
          </select>
        )}
        <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/screenplays/${screenplayId}/sound?scope=${encodeURIComponent(shot.id)}`)} title="Gather sounds for this shot from free libraries">
          <Search size={12} /> Find sounds
        </button>
      </div>
    </div>
  );
}

/**
 * Images for this shot: reference images steer its frame (their look is
 * described and added to the prompt); one can stand in as the frame itself.
 */
function ShotImages({ shot, detail, onPatch }: { shot: Shot; detail?: Detail; onPatch: (p: Partial<Shot>, field: string) => void }) {
  const { screenplayId, flush, setDetail } = useScreenplayActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const refs = (detail?.media.other ?? []).filter((m) => m.role === 'reference' && m.media_id);
  const mine = refs.filter((m) => m.target === shot.id);
  const others = refs.filter((m) => m.target !== shot.id);
  const act = async (fn: () => Promise<Detail>) => {
    setBusy(true);
    setError(null);
    try {
      await flush();
      setDetail(await fn());
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sp-shot-media wide">
      <span className="sp-adj-head">
        <ImageIcon size={11} /> Images
        {busy && <Loader2 size={11} className="spin" />}
      </span>
      {mine.length > 0 && (
        <div className="sp-shot-thumbs">
          {mine.map((m) => {
            const isFrame = shot.frameImage === m.id;
            return (
              <figure key={m.id} className={`sp-shot-thumb ${isFrame ? 'frame' : ''}`} title={m.caption ?? m.label ?? ''}>
                <SpImage mediaId={m.media_id!} />
                <figcaption>
                  <button
                    className={`btn btn-sm ${isFrame ? 'btn-primary' : 'btn-ghost'}`}
                    title={isFrame ? 'This image is the frame. Click to render one again.' : 'Use this image as the frame instead of rendering one'}
                    onClick={() => onPatch({ frameImage: isFrame ? undefined : m.id }, 'frameImage')}
                  >
                    {isFrame ? 'Frame' : 'Use as frame'}
                  </button>
                  <button
                    className="icon-btn"
                    title="Stop using it for this shot (stays in References)"
                    onClick={() => {
                      if (isFrame) onPatch({ frameImage: undefined }, 'frameImage');
                      void act(() => updateMedia(screenplayId, m.id, { target: '' }));
                    }}
                  >
                    <X size={12} />
                  </button>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
      <div className="sp-shot-media-add">
        <button className="btn btn-sm btn-ghost" onClick={() => input.current?.click()} disabled={busy} title="Upload a photo or still for this shot">
          <ImagePlus size={12} /> Add image
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void act(() => uploadReference(screenplayId, f, shot.id));
          }}
        />
        {others.length > 0 && (
          <select value="" onChange={(e) => e.target.value && void act(() => updateMedia(screenplayId, Number(e.target.value), { target: shot.id }))} aria-label="Use a reference image">
            <option value="">Use a reference image…</option>
            {others.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.caption?.slice(0, 50) ?? `Image ${m.id}`}</option>)}
          </select>
        )}
      </div>
      {mine.length > 0 && !shot.frameImage && <span className="field-hint">Their look (light, palette, framing) steers this shot’s frame.</span>}
      {error && <div className="sp-shot-warn"><AlertTriangle size={12} /> {error}</div>}
    </div>
  );
}
