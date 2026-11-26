// The shot finder: photos from free libraries that match a shot, ten at a
// time. The adjustment notes steer the search; the writer picks one and it
// becomes the shot's frame (and can then be recreated with the cast and props).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { Adjustment, Detail, ImageCandidate, Shot, ShotFind } from '../../api/screenplays';
import { Modal } from '../ui';
import { useScreenplayActions } from './actions';
import { AdjustmentNotes } from './AdjustmentNotes';

const busyStates: ShotFind['status'][] = ['queued', 'planning', 'searching'];

const activeNotes = (shot: Shot) => (shot.adjustments ?? []).filter((a) => !a.off && a.text.trim()).map((a) => a.text.trim().replace(/\s+/g, ' '));

export function ShotFinder({
  shot,
  number,
  detail,
  onPatch,
  onClose,
  onRecreate,
}: {
  shot: Shot;
  number: number;
  detail?: Detail;
  onPatch: (p: Partial<Shot>, field: string) => void;
  onClose: () => void;
  /** After "Use and recreate": open the recreate step for the new frame. */
  onRecreate?: () => void;
}) {
  const { screenplayId, flush, setDetail } = useScreenplayActions();
  const [find, setFind] = useState<ShotFind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keeping, setKeeping] = useState(false);
  const started = useRef(false);

  const search = useCallback(async () => {
    setError(null);
    setSelected(null);
    try {
      await flush();
      setFind(await api.startFind(screenplayId, shot.id));
    } catch (e) {
      setError(msg(e));
    }
  }, [flush, screenplayId, shot.id]);

  // Open on the last search for this shot, or start one.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const last = await api.latestFind(screenplayId, shot.id);
        if (last) setFind(last);
        else await search();
      } catch (e) {
        setError(msg(e));
      }
    })();
  }, [screenplayId, shot.id, search]);

  // Follow a running search.
  const running = !!find && busyStates.includes(find.status);
  useEffect(() => {
    if (!find || !running) return;
    const t = setTimeout(() => void api.getFind(screenplayId, find.id).then(setFind).catch((e) => setError(msg(e))), 1200);
    return () => clearTimeout(t);
  }, [find, running, screenplayId]);

  const more = async () => {
    if (!find) return;
    setError(null);
    try {
      setFind(await api.findMore(screenplayId, find.id));
    } catch (e) {
      setError(msg(e));
    }
  };

  const kept = useMemo(() => {
    const keys = new Map<string, number>();
    for (const m of detail?.media.other ?? []) {
      const f = api.foundMeta(m);
      if (f && m.role === 'reference') keys.set(f.key, m.id);
    }
    return keys;
  }, [detail]);
  const frameKey = useMemo(() => [...kept.entries()].find(([, id]) => id === shot.frameImage)?.[0] ?? null, [kept, shot.frameImage]);

  const use = async (andRecreate = false) => {
    if (!find || !selected) return;
    setKeeping(true);
    setError(null);
    try {
      const d = await api.keepFound(screenplayId, find.id, selected);
      setDetail(d);
      onPatch({ frameImage: d.added }, 'frameImage');
      onClose();
      if (andRecreate) onRecreate?.();
    } catch (e) {
      setError(msg(e));
    } finally {
      setKeeping(false);
    }
  };

  const notesNow = activeNotes(shot);
  const notesChanged = !!find && find.plan.queries.length > 0 && notesNow.join('\n') !== (find.plan.notes ?? []).join('\n');
  const pick = find?.candidates.find((c) => c.key === selected) ?? null;

  return (
    <Modal
      title={`Find a shot · Shot ${number}${shot.type ? ` · ${shot.type}` : ''}`}
      onClose={onClose}
      width={1180}
      busy={keeping}
      footer={
        <div className="sp-find-foot">
          <div className="sp-find-credit">
            {pick ? (
              <>
                <strong title={pick.title}>{pick.title}</strong>
                <span>
                  {pick.creator ? `${pick.creator} · ` : ''}
                  {pick.sourceName} ·{' '}
                  {pick.license.url ? (
                    <a href={pick.license.url} target="_blank" rel="noreferrer">
                      {pick.license.name}
                    </a>
                  ) : (
                    pick.license.name
                  )}
                  {pick.license.attribution ? ' · credit needed' : ''}
                </span>
                <a href={pick.landingUrl} target="_blank" rel="noreferrer" className="sp-find-src">
                  Source <ExternalLink size={11} />
                </a>
              </>
            ) : (
              <span className="field-hint">Pick a photo to use as this shot’s frame.</span>
            )}
          </div>
          <button className="btn" onClick={() => void more()} disabled={!find || running || find.status === 'failed' || !find.candidates.length}>
            {running && find?.candidates.length ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Find more
          </button>
          <button className="btn" onClick={() => void use()} disabled={!pick || keeping}>
            <Check size={14} /> Use as frame
          </button>
          {onRecreate && (
            <button className="btn btn-primary" onClick={() => void use(true)} disabled={!pick || keeping} title="Use it, then have the AI put your characters and props into it">
              {keeping ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Use & recreate with cast
            </button>
          )}
        </div>
      }
    >
      <div className="sp-find">
        <div className="sp-find-top">
          <div className="sp-find-plan">
            <span className="sp-adj-head">Looking for</span>
            {find?.plan.look ? <p>{find.plan.look}</p> : <p className="field-hint">{running ? 'Reading the shot…' : 'What the script describes for this shot.'}</p>}
            {!!find?.plan.queries.length && (
              <div className="sp-find-queries">
                {find.plan.queries.map((q) => (
                  <span key={q} className="sp-chip">{q}</span>
                ))}
              </div>
            )}
          </div>
          <div className="sp-find-notes">
            <AdjustmentNotes
              shot={shot}
              onChange={(adjustments: Adjustment[]) => onPatch({ adjustments }, 'adjustments')}
              hint="Steer the search: “night, not day”, “wider”, “no cars”. They also guide the AI when it recreates the frame."
            />
            <button className={`btn btn-sm ${notesChanged ? 'btn-primary' : ''}`} onClick={() => void search()} disabled={running}>
              <RefreshCw size={13} className={running && !find?.candidates.length ? 'spin' : ''} /> {notesChanged ? 'Search again with these notes' : 'Search again'}
            </button>
          </div>
        </div>

        {error && <div className="sp-shot-warn"><AlertTriangle size={12} /> {error}</div>}
        {find?.status === 'failed' && <div className="sp-shot-warn"><AlertTriangle size={12} /> {find.error}</div>}
        {find?.status === 'done' && find.error && <div className="field-hint">Some libraries didn’t answer: {find.error}</div>}

        {!find?.candidates.length ? (
          <div className="sp-find-empty">
            {running || !find ? (
              <>
                <Loader2 size={16} className="spin" /> {find?.progress || 'Starting…'}
              </>
            ) : (
              find.progress || 'No photos yet.'
            )}
          </div>
        ) : (
          <div className="sp-find-grid">
            {find.candidates.map((c) => (
              <Tile key={c.key} c={c} selected={selected === c.key} isFrame={frameKey === c.key} onSelect={() => setSelected(selected === c.key ? null : c.key)} />
            ))}
            {running && (
              <div className="sp-find-tile loading">
                <Loader2 size={16} className="spin" />
                <span>{find.progress}</span>
              </div>
            )}
          </div>
        )}
        {find?.status === 'done' && !!find.candidates.length && <p className="field-hint sp-find-count">{find.progress}</p>}
      </div>
    </Modal>
  );
}

export function Tile({ c, selected, isFrame, onSelect }: { c: ImageCandidate; selected: boolean; isFrame: boolean; onSelect: () => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <button className={`sp-find-tile ${selected ? 'on' : ''}`} onClick={onSelect} title={`${c.title}${c.creator ? ` · ${c.creator}` : ''}`} aria-pressed={selected}>
      <img src={c.thumbUrl} alt={c.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      <span className="sp-find-tile-meta">
        {c.sourceName} · {c.license.name}
      </span>
      {selected && (
        <span className="sp-find-tick">
          <Check size={13} />
        </span>
      )}
      {isFrame && <span className="sp-find-badge">Frame</span>}
    </button>
  );
}

export function msg(e: unknown): string {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (e as Error).message;
}
