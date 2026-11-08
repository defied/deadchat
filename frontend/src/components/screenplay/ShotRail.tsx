// Storyboard shots beside the script. Each card sits level with the element
// it's pinned to (pushed down when cards would overlap) and shows the example
// frame DeadChat keeps in step with that part of the script.

import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AlertTriangle, Clapperboard, Dices, Loader2, LayoutGrid, Music, Trash2, Clock } from 'lucide-react';
import type { Detail, ScreenplayDoc, Shot } from '../../api/screenplays';
import { Modal } from '../ui';
import { SHOT_TYPES, timecode } from './format';
import { MusicButton, SpImage } from './media';

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
}

export function ShotRail({ doc, detail, update, nodes, pageRef, onOpenPlan, onFocusAnchor }: RailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [tops, setTops] = useState<Record<string, number>>({});
  const [height, setHeight] = useState(0);
  const [, setTick] = useState(0);

  const order = useMemo(() => new Map(doc.elements.map((e, i) => [e.id, i])), [doc.elements]);
  const shots = useMemo(
    () => doc.shots.filter((s) => order.has(s.anchorId)).sort((a, b) => order.get(a.anchorId)! - order.get(b.anchorId)!),
    [doc.shots, order],
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
            Hover a scene heading or action line and click <strong>Shot</strong> to pin a storyboard shot to it. Pick a shot type
            and DeadChat renders an example frame from what you wrote, and re-renders it when you revise that part.
          </p>
        </div>
      )}
      {shots.map((s, i) => (
        <div
          key={s.id}
          className="sp-shot-wrap"
          style={{ top: tops[s.id] ?? 0 }}
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
}: {
  shot: Shot;
  number: number;
  start: number;
  detail?: Detail;
  onPatch: (p: Partial<Shot>, field: string) => void;
  onDelete: () => void;
  onPlan: () => void;
  onFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const plan = detail?.plans[shot.id];
  const latest = detail?.media.latest[`frame:${shot.id}`];
  const ready = detail?.media.lastReady[`frame:${shot.id}`];
  const cue = detail?.media.latest[`music:${shot.id}`];
  const cueReady = detail?.media.lastReady[`music:${shot.id}`];
  const pending = latest?.status === 'pending';
  const failed = latest?.status === 'failed' ? latest.error : null;

  let note: string | null = null;
  if (plan?.blocked) note = plan.blocked;
  else if (plan?.waiting) note = plan.waiting;

  return (
    <div className={`sp-shot ${pending ? 'busy' : ''}`}>
      <div className="sp-shot-head">
        <button className="sp-shot-no" onClick={onFocus} title="Go to this part of the script">
          Shot {number}
        </button>
        <span className="sp-shot-tc" title="Starts at">
          <Clock size={11} /> {timecode(start)}
        </span>
        {cueReady?.media_id && <MusicButton mediaId={cueReady.media_id} />}
        <span className="sp-grow" />
        <button className="icon-btn" title="Set plan: camera, cast and lights" onClick={onPlan}>
          <LayoutGrid size={14} />
        </button>
        <button className="icon-btn" title="Re-roll: render a different take" onClick={() => onPatch({ take: (shot.take ?? 0) + 1 }, 'take')} disabled={!!plan?.waiting || !!plan?.blocked}>
          <Dices size={14} />
        </button>
        <button className="icon-btn" title="Remove shot" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>

      <button className="sp-frame" onClick={() => ready?.media_id && setOpen(true)} disabled={!ready?.media_id}>
        {ready?.media_id ? <SpImage mediaId={ready.media_id} alt={`Shot ${number}`} /> : <div className="sp-frame-empty">{note ?? (pending ? '' : 'No frame yet')}</div>}
        {pending && (
          <span className="sp-frame-status">
            <Loader2 size={12} className="spin" /> {ready ? 'Updating to match the script…' : 'Rendering…'}
          </span>
        )}
      </button>
      {plan?.blocked && <div className="sp-shot-warn"><AlertTriangle size={12} /> {plan.blocked}</div>}
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
        <label className="wide">
          <span>
            <Music size={11} /> Music
            {cue?.status === 'pending' && <Loader2 size={11} className="spin" />}
          </span>
          <textarea rows={1} value={shot.music ?? ''} placeholder="e.g. sparse piano, melancholy, slow" onChange={(e) => onPatch({ music: e.target.value }, 'music')} />
        </label>
        {cue?.status === 'failed' && <div className="sp-shot-warn wide"><AlertTriangle size={12} /> {cue.error}</div>}
        <label className="wide">
          <span>Notes</span>
          <textarea rows={1} value={shot.notes ?? ''} placeholder="Blocking, movement, VFX…" onChange={(e) => onPatch({ notes: e.target.value }, 'notes')} />
        </label>
      </div>
      {open && ready?.media_id && (
        <Modal title={`Shot ${number}${shot.type ? ` · ${shot.type}` : ''}`} onClose={() => setOpen(false)} width={1100}>
          <div className="sp-frame-large">
            <SpImage mediaId={ready.media_id} alt={`Shot ${number}`} />
          </div>
          {ready.prompt && (
            <details className="sp-prompt">
              <summary>What the image model was asked for</summary>
              <p>{ready.prompt}</p>
            </details>
          )}
        </Modal>
      )}
    </div>
  );
}
