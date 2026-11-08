// Set plan: a top-down (orthographic) view of each scene. Place the cast,
// a camera per shot, lights and set pieces; the staging is turned into words
// for that shot's frame, which re-renders to match.

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Camera, Box, Lightbulb, Loader2, Minus, Plus, Trash2, UserRound, Users, Crosshair } from 'lucide-react';
import type { Detail, PlanItem, ScreenplayDoc, SetPlan as Plan } from '../../api/screenplays';
import { EmptyState, Field } from '../ui';
import { cueName, defaultLens, newId, sceneNumbers } from './format';
import { SpImage } from './media';

interface Props {
  doc: ScreenplayDoc;
  detail?: Detail;
  update: (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string) => void;
  sceneId: string | null;
  focusShot: string | null;
  onScene: (id: string) => void;
}

const LIGHT_FILL: Record<NonNullable<PlanItem['color']>, string> = {
  warm: '#f5b453', neutral: '#f4f4f5', cool: '#8ec5ff', moonlight: '#b7c7ff', red: '#f87171', green: '#4ade80', blue: '#60a5fa',
};
const PALETTE = ['#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#fb923c', '#2dd4bf', '#e879f9'];
const LENSES = [14, 18, 24, 35, 50, 85, 100, 135];

function fov(lens: number): number {
  return 2 * Math.atan(18 / Math.max(8, lens));
}
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function SetPlan({ doc, detail, update, sceneId, focusShot, onScene }: Props) {
  const scenes = useMemo(() => doc.elements.filter((e) => e.type === 'scene'), [doc.elements]);
  const numbers = useMemo(() => sceneNumbers(doc.elements), [doc.elements]);
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0] ?? null;
  const plan: Plan = (scene && doc.plans[scene.id]) || { items: [] };
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ cx: 0, cy: 0, scale: 48 }); // px per metre
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'rotate' | 'pan'; dx: number; dy: number; sx: number; sy: number; cx: number; cy: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });

  useEffect(() => {
    if (scene && sceneId !== scene.id) onScene(scene.id);
  }, [scene, sceneId, onScene]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Element range of the scene, its shots, and the characters it mentions.
  const range = useMemo(() => {
    if (!scene) return { start: 0, end: 0 };
    const start = doc.elements.findIndex((e) => e.id === scene.id);
    let end = start + 1;
    while (end < doc.elements.length && doc.elements[end].type !== 'scene') end++;
    return { start, end };
  }, [doc.elements, scene]);
  const sceneEls = doc.elements.slice(range.start, range.end);
  const sceneIds = new Set(sceneEls.map((e) => e.id));
  const allShotNo = useMemo(() => {
    const order = new Map(doc.elements.map((e, i) => [e.id, i]));
    return new Map([...doc.shots].sort((a, b) => (order.get(a.anchorId) ?? 0) - (order.get(b.anchorId) ?? 0)).map((s, i) => [s.id, i + 1]));
  }, [doc.elements, doc.shots]);
  const sceneShots = doc.shots.filter((s) => sceneIds.has(s.anchorId));
  const sceneCast = doc.characters.filter((c) => {
    const name = c.name.trim().toUpperCase();
    if (!name) return false;
    return sceneEls.some((e) => (e.type === 'character' && cueName(e.text).toUpperCase() === name) || (e.type === 'action' && e.text.toUpperCase().includes(name)));
  });

  const sel = plan.items.find((i) => i.id === selected) ?? null;
  const focusCam = plan.items.find((i) => i.kind === 'camera' && i.ref === focusShot) ?? null;
  useEffect(() => {
    if (focusCam) setSelected(focusCam.id);
  }, [focusCam?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewCam = sel?.kind === 'camera' ? sel : focusCam ?? plan.items.find((i) => i.kind === 'camera') ?? null;

  if (!scene) {
    return (
      <EmptyState title="No scenes yet">
        Write a scene heading (INT. / EXT.) in the script. Each scene gets its own set plan.
      </EmptyState>
    );
  }

  const setPlan = (fn: (items: PlanItem[]) => PlanItem[], group?: string) =>
    update((d) => ({ ...d, plans: { ...d.plans, [scene.id]: { items: fn((d.plans[scene.id] ?? { items: [] }).items) } } }), group);
  const patchItem = (id: string, p: Partial<PlanItem>, group = `plan:${id}`) => setPlan((items) => items.map((i) => (i.id === id ? { ...i, ...p } : i)), group);
  const removeItem = (id: string) => {
    setPlan((items) => items.filter((i) => i.id !== id));
    setSelected(null);
  };

  const nameOf = (it: PlanItem) =>
    it.kind === 'character'
      ? doc.characters.find((c) => c.id === it.ref)?.name ?? it.label ?? 'Figure'
      : it.kind === 'camera'
        ? `Shot ${allShotNo.get(it.ref ?? '') ?? '?'}`
        : it.label || (it.kind === 'light' ? 'Light' : 'Prop');
  const colorOf = (it: PlanItem) => PALETTE[Math.max(0, doc.characters.findIndex((c) => c.id === it.ref)) % PALETTE.length];

  // ── adding ──
  const centre = () => ({ x: view.cx, y: view.cy });
  const addCast = () => {
    const missing = sceneCast.filter((c) => !plan.items.some((i) => i.kind === 'character' && i.ref === c.id));
    const c0 = centre();
    setPlan((items) => [
      ...items,
      ...missing.map((c, i) => ({ id: newId('pi'), kind: 'character' as const, ref: c.id, x: c0.x + (i - (missing.length - 1) / 2) * 1.2, y: c0.y, rot: 90 })),
    ]);
  };
  const addCamera = (shotId: string) => {
    const cast = plan.items.filter((i) => i.kind === 'character');
    const target = cast.length ? { x: cast.reduce((a, i) => a + i.x, 0) / cast.length, y: cast.reduce((a, i) => a + i.y, 0) / cast.length } : centre();
    const pos = { x: target.x, y: target.y + 4 };
    const it: PlanItem = { id: newId('pi'), kind: 'camera', ref: shotId, x: pos.x, y: pos.y, rot: deg(Math.atan2(target.y - pos.y, target.x - pos.x)), height: 'eye' };
    setPlan((items) => [...items, it]);
    setSelected(it.id);
  };
  const addLight = () => {
    const c0 = centre();
    const it: PlanItem = { id: newId('pi'), kind: 'light', x: c0.x - 3, y: c0.y - 2, rot: 30, color: 'warm', quality: 'soft' };
    setPlan((items) => [...items, it]);
    setSelected(it.id);
  };
  const addProp = () => {
    const c0 = centre();
    const it: PlanItem = { id: newId('pi'), kind: 'prop', x: c0.x, y: c0.y - 2, rot: 0, w: 1.6, h: 0.8, label: 'Table' };
    setPlan((items) => [...items, it]);
    setSelected(it.id);
  };
  const addFigure = (characterId: string) => {
    const c0 = centre();
    const it: PlanItem = { id: newId('pi'), kind: 'character', ref: characterId, x: c0.x, y: c0.y, rot: 90 };
    setPlan((items) => [...items, it]);
    setSelected(it.id);
  };

  // ── pointer ──
  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: view.cx + (clientX - r.left - r.width / 2) / view.scale, y: view.cy + (clientY - r.top - r.height / 2) / view.scale };
  };
  const startDrag = (e: RPointerEvent, it: PlanItem | null, mode: 'move' | 'rotate' | 'pan') => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    drag.current = { id: it?.id ?? '', mode, dx: it ? w.x - it.x : 0, dy: it ? w.y - it.y : 0, sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy };
    if (it) setSelected(it.id);
    else setSelected(null);
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pan') {
      setView((v) => ({ ...v, cx: d.cx - (e.clientX - d.sx) / v.scale, cy: d.cy - (e.clientY - d.sy) / v.scale }));
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const it = plan.items.find((i) => i.id === d.id);
    if (!it) return;
    if (d.mode === 'move') {
      const snap = (v: number) => (e.shiftKey ? v : Math.round(v * 10) / 10);
      patchItem(d.id, { x: snap(w.x - d.dx), y: snap(w.y - d.dy) });
    } else {
      let a = deg(Math.atan2(w.y - it.y, w.x - it.x));
      if (!e.shiftKey) a = Math.round(a / 5) * 5;
      patchItem(d.id, { rot: a });
    }
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const f = Math.exp(-e.deltaY * 0.0015);
    setView((v) => ({ ...v, scale: Math.min(240, Math.max(10, v.scale * f)) }));
  };

  // ── drawing ──
  const halfW = size.w / 2 / view.scale;
  const halfH = size.h / 2 / view.scale;
  const vb = `${view.cx - halfW} ${view.cy - halfH} ${halfW * 2} ${halfH * 2}`;
  const grid: JSX.Element[] = [];
  for (let x = Math.floor(view.cx - halfW); x <= view.cx + halfW; x++) grid.push(<line key={`x${x}`} x1={x} x2={x} y1={view.cy - halfH} y2={view.cy + halfH} className={x % 5 === 0 ? 'major' : ''} />);
  for (let y = Math.floor(view.cy - halfH); y <= view.cy + halfH; y++) grid.push(<line key={`y${y}`} y1={y} y2={y} x1={view.cx - halfW} x2={view.cx + halfW} className={y % 5 === 0 ? 'major' : ''} />);
  const fs = 12 / view.scale; // label font size in metres

  const frameOf = (shotId?: string) => (shotId ? detail?.media.lastReady[`frame:${shotId}`] : undefined);
  const pendingOf = (shotId?: string) => (shotId ? detail?.media.latest[`frame:${shotId}`]?.status === 'pending' : false);
  const unplacedShots = sceneShots.filter((s) => !plan.items.some((i) => i.kind === 'camera' && i.ref === s.id));
  const unplacedCast = sceneCast.filter((c) => !plan.items.some((i) => i.kind === 'character' && i.ref === c.id));

  return (
    <div className="sp-plan">
      <div className="sp-plan-bar">
        <select value={scene.id} onChange={(e) => { onScene(e.target.value); setSelected(null); }} aria-label="Scene">
          {scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {numbers.get(s.id)}. {s.text || '(untitled scene)'}
            </option>
          ))}
        </select>
        <span className="sp-grow" />
        {unplacedCast.length > 0 && (
          <button className="btn btn-sm" onClick={addCast}>
            <Users size={14} /> Place cast ({unplacedCast.length})
          </button>
        )}
        <select
          className="btn btn-sm"
          value=""
          onChange={(e) => e.target.value && addCamera(e.target.value)}
          disabled={!unplacedShots.length}
          title={unplacedShots.length ? 'Add a camera for a shot in this scene' : 'Every shot in this scene has a camera'}
        >
          <option value="">{unplacedShots.length ? '＋ Camera for…' : 'All shots have cameras'}</option>
          {unplacedShots.map((s) => (
            <option key={s.id} value={s.id}>
              Shot {allShotNo.get(s.id)}{s.type ? ` · ${s.type}` : ''}
            </option>
          ))}
        </select>
        <select className="btn btn-sm" value="" onChange={(e) => e.target.value && addFigure(e.target.value)} disabled={!doc.characters.length}>
          <option value="">＋ Character…</option>
          {doc.characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={addLight}><Lightbulb size={14} /> Light</button>
        <button className="btn btn-sm" onClick={addProp}><Box size={14} /> Set piece</button>
        <button className="icon-btn" title="Zoom out" onClick={() => setView((v) => ({ ...v, scale: Math.max(10, v.scale / 1.25) }))}><Minus size={14} /></button>
        <button className="icon-btn" title="Zoom in" onClick={() => setView((v) => ({ ...v, scale: Math.min(240, v.scale * 1.25) }))}><Plus size={14} /></button>
        <button className="icon-btn" title="Centre" onClick={() => setView((v) => ({ ...v, cx: 0, cy: 0 }))}><Crosshair size={14} /></button>
      </div>

      <div className="sp-plan-body">
        <svg
          ref={svgRef}
          className="sp-plan-canvas"
          viewBox={vb}
          onPointerDown={(e) => startDrag(e, null, 'pan')}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && sel) removeItem(sel.id);
          }}
        >
          <g className="sp-grid">{grid}</g>
          {/* camera cones first, under everything */}
          {plan.items.filter((i) => i.kind === 'camera').map((it) => {
            const shot = doc.shots.find((s) => s.id === it.ref);
            const lens = shot?.lens ?? it.lens ?? defaultLens(shot?.type);
            const h = fov(lens) / 2;
            const L = 8;
            const a = rad(it.rot);
            const p1 = { x: it.x + L * Math.cos(a - h), y: it.y + L * Math.sin(a - h) };
            const p2 = { x: it.x + L * Math.cos(a + h), y: it.y + L * Math.sin(a + h) };
            return <path key={`cone${it.id}`} d={`M${it.x},${it.y} L${p1.x},${p1.y} L${p2.x},${p2.y} Z`} className={`sp-cone ${it.id === selected ? 'on' : ''}`} />;
          })}
          {plan.items.map((it) => {
            const on = it.id === selected;
            const a = rad(it.rot);
            const handle = { x: it.x + 0.9 * Math.cos(a), y: it.y + 0.9 * Math.sin(a) };
            let body: JSX.Element;
            if (it.kind === 'character') {
              body = (
                <g>
                  <circle cx={it.x} cy={it.y} r={0.3} fill={colorOf(it)} className="sp-fig" />
                  <path d={`M${it.x + 0.42 * Math.cos(a)},${it.y + 0.42 * Math.sin(a)} L${it.x + 0.22 * Math.cos(a + 0.9)},${it.y + 0.22 * Math.sin(a + 0.9)} L${it.x + 0.22 * Math.cos(a - 0.9)},${it.y + 0.22 * Math.sin(a - 0.9)} Z`} fill={colorOf(it)} />
                </g>
              );
            } else if (it.kind === 'camera') {
              body = (
                <g transform={`rotate(${it.rot} ${it.x} ${it.y})`}>
                  <rect x={it.x - 0.35} y={it.y - 0.22} width={0.5} height={0.44} rx={0.06} className="sp-cam" />
                  <path d={`M${it.x + 0.15},${it.y - 0.12} L${it.x + 0.4},${it.y - 0.22} L${it.x + 0.4},${it.y + 0.22} L${it.x + 0.15},${it.y + 0.12} Z`} className="sp-cam" />
                </g>
              );
            } else if (it.kind === 'light') {
              body = (
                <g>
                  <line x1={it.x} y1={it.y} x2={it.x + 0.9 * Math.cos(a)} y2={it.y + 0.9 * Math.sin(a)} stroke={LIGHT_FILL[it.color ?? 'neutral']} strokeWidth={0.06} strokeDasharray="0.12 0.08" />
                  <circle cx={it.x} cy={it.y} r={0.26} fill={LIGHT_FILL[it.color ?? 'neutral']} className="sp-light" />
                </g>
              );
            } else {
              const w = it.w ?? 1;
              const hh = it.h ?? 1;
              body = <rect x={it.x - w / 2} y={it.y - hh / 2} width={w} height={hh} transform={`rotate(${it.rot} ${it.x} ${it.y})`} className="sp-prop" />;
            }
            return (
              <g key={it.id} className={`sp-item ${on ? 'on' : ''}`}>
                <g onPointerDown={(e) => startDrag(e, it, 'move')} style={{ cursor: 'move' }}>
                  {body}
                  {on && <circle cx={it.x} cy={it.y} r={it.kind === 'prop' ? Math.max(it.w ?? 1, it.h ?? 1) / 2 + 0.15 : 0.5} className="sp-sel" />}
                </g>
                <text x={it.x} y={it.y + (it.kind === 'prop' ? (it.h ?? 1) / 2 + 0.1 : 0.45) + fs} fontSize={fs} className="sp-label">
                  {nameOf(it)}
                </text>
                {on && <circle cx={handle.x} cy={handle.y} r={0.13} className="sp-rot" onPointerDown={(e) => startDrag(e, it, 'rotate')} />}
              </g>
            );
          })}
        </svg>

        <aside className="sp-plan-side">
          {previewCam && (
            <div className="sp-plan-preview">
              <div className="sp-plan-preview-head">
                <Camera size={13} /> {nameOf(previewCam)}
                {pendingOf(previewCam.ref) && <span className="sp-mini-status"><Loader2 size={11} className="spin" /> updating</span>}
              </div>
              <div className="sp-frame small">
                {frameOf(previewCam.ref)?.media_id ? <SpImage mediaId={frameOf(previewCam.ref)!.media_id!} /> : <div className="sp-frame-empty">{detail?.plans[previewCam.ref ?? '']?.waiting ?? 'No frame yet'}</div>}
              </div>
              {detail?.plans[previewCam.ref ?? '']?.staging && <p className="sp-staging">{detail.plans[previewCam.ref ?? ''].staging}</p>}
            </div>
          )}

          {sel ? (
            <div className="sp-props">
              <div className="sp-props-head">
                {sel.kind === 'character' ? <UserRound size={14} /> : sel.kind === 'camera' ? <Camera size={14} /> : sel.kind === 'light' ? <Lightbulb size={14} /> : <Box size={14} />}
                <strong>{nameOf(sel)}</strong>
                <span className="sp-grow" />
                <button className="icon-btn" title="Remove" onClick={() => removeItem(sel.id)}><Trash2 size={14} /></button>
              </div>
              {sel.kind === 'character' && (
                <Field label="Character">
                  <select value={sel.ref ?? ''} onChange={(e) => patchItem(sel.id, { ref: e.target.value })}>
                    {doc.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )}
              {(sel.kind === 'light' || sel.kind === 'prop') && (
                <Field label="Label">
                  <input value={sel.label ?? ''} onChange={(e) => patchItem(sel.id, { label: e.target.value }, `plan:${sel.id}:label`)} placeholder={sel.kind === 'light' ? 'Key, window, lamp…' : 'Table, car, door…'} />
                </Field>
              )}
              {sel.kind === 'camera' && (
                <>
                  <Field label="Lens" hint={doc.shots.find((s) => s.id === sel.ref)?.lens ? 'Set on the shot card, which wins.' : undefined}>
                    <select value={sel.lens ?? ''} onChange={(e) => patchItem(sel.id, { lens: e.target.value ? Number(e.target.value) : undefined })}>
                      <option value="">Auto ({defaultLens(doc.shots.find((s) => s.id === sel.ref)?.type)}mm from the shot type)</option>
                      {LENSES.map((l) => <option key={l} value={l}>{l}mm</option>)}
                    </select>
                  </Field>
                  <Field label="Height">
                    <select value={sel.height ?? 'eye'} onChange={(e) => patchItem(sel.id, { height: e.target.value as PlanItem['height'] })}>
                      <option value="ground">Ground level</option>
                      <option value="low">Low angle</option>
                      <option value="eye">Eye level</option>
                      <option value="high">High angle</option>
                      <option value="overhead">Overhead</option>
                    </select>
                  </Field>
                </>
              )}
              {sel.kind === 'light' && (
                <div className="sp-grid2">
                  <Field label="Colour">
                    <select value={sel.color ?? 'neutral'} onChange={(e) => patchItem(sel.id, { color: e.target.value as PlanItem['color'] })}>
                      <option value="warm">Warm tungsten</option>
                      <option value="neutral">Neutral</option>
                      <option value="cool">Cool daylight</option>
                      <option value="moonlight">Moonlight</option>
                      <option value="red">Red</option>
                      <option value="green">Green</option>
                      <option value="blue">Blue</option>
                    </select>
                  </Field>
                  <Field label="Quality">
                    <select value={sel.quality ?? 'soft'} onChange={(e) => patchItem(sel.id, { quality: e.target.value as PlanItem['quality'] })}>
                      <option value="soft">Soft</option>
                      <option value="hard">Hard</option>
                    </select>
                  </Field>
                  <label className="toggle">
                    <input type="checkbox" checked={!!sel.practical} onChange={(e) => patchItem(sel.id, { practical: e.target.checked || undefined })} />
                    <span>Practical (a lamp in the set)</span>
                  </label>
                </div>
              )}
              {sel.kind === 'prop' && (
                <div className="sp-grid2">
                  <Field label="Width (m)">
                    <input type="number" step={0.1} min={0.1} value={sel.w ?? 1} onChange={(e) => patchItem(sel.id, { w: Math.max(0.1, Number(e.target.value)) })} />
                  </Field>
                  <Field label="Depth (m)">
                    <input type="number" step={0.1} min={0.1} value={sel.h ?? 1} onChange={(e) => patchItem(sel.id, { h: Math.max(0.1, Number(e.target.value)) })} />
                  </Field>
                </div>
              )}
              <Field label="Facing (°)">
                <input type="number" step={5} value={Math.round(sel.rot)} onChange={(e) => patchItem(sel.id, { rot: Number(e.target.value) })} />
              </Field>
            </div>
          ) : (
            <p className="field-hint sp-plan-help">
              Drag to move, drag the small dot to turn, scroll to zoom, drag the floor to pan. Each grid square is one metre. Moving a
              camera, a character or a light re-renders that shot’s frame to match.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
