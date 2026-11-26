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
import { SearchWords } from './SearchWords';

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

  const [words, setWords] = useState<string[]>([]);
  const findId = find?.id;
  const planned = find?.plan.queries.join('\n') ?? '';
  // Show each search's words; the writer can edit them before searching again.
  useEffect(() => {
    setWords(planned ? planned.split('\n') : []);
  }, [findId, planned]);

  const search = useCallback(async (own?: string[]) => {
    setError(null);
    setSelected(null);
    try {
      await flush();
      setFind(await api.startFind(screenplayId, shot.id, own));
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
  const wordsEdited = !!find && words.join('\n') !== planned;
  const optionChanged = !!find && find.plan.queries.length > 0 && !!find.plan.peopleOptional !== !!shot.peopleOptional;
  const pick = find?.candidates.find((c) => c.key === selected) ?? find?.plan.turnedDown?.find((c) => c.key === selected) ?? null;

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
                {pick.check ? (
                  <strong title={`Shows: ${pick.check.sees}`}>
                    {pick.check.score}/10 · {pick.check.missing ? `Missing: ${pick.check.missing}` : 'Shows everything asked for'}
                    {pick.check.framing ? ` · ${pick.check.framing.seen}${pick.check.framing.match === 'yes' ? ' ✓' : pick.check.framing.match === 'no' ? ' (not the shot type)' : ''}` : ''}
                  </strong>
                ) : (
                  <strong title={pick.title}>{pick.title}</strong>
                )}
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
            <span className="sp-adj-head">From the script</span>
            {find?.plan.look ? <p>{find.plan.look}</p> : <p className="field-hint">{running ? 'Reading the shot…' : 'What the script describes for this shot.'}</p>}
            <span className="sp-adj-head">Searching for</span>
            <SearchWords words={words} onChange={setWords} disabled={running} />
            <span className="field-hint">Only these words are searched. Remove any you don’t want, or add your own.</span>
          </div>
          <div className="sp-find-notes">
            <label className="toggle sp-find-opt" title="Find photos of the place, angle and mood, with or without anyone in them. Your characters can be put in when the AI recreates the frame.">
              <input type="checkbox" checked={!!shot.peopleOptional} onChange={(e) => onPatch({ peopleOptional: e.target.checked ? true : undefined }, 'peopleOptional')} />
              <span>People optional: look for the place, angle and mood</span>
            </label>
            <AdjustmentNotes
              shot={shot}
              onChange={(adjustments: Adjustment[]) => onPatch({ adjustments }, 'adjustments')}
              hint="Steer the search: “night, not day”, “wider”, “no cars”. They also guide the AI when it recreates the frame."
            />
            <button
              className={`btn btn-sm ${notesChanged || wordsEdited || optionChanged ? 'btn-primary' : ''}`}
              onClick={() => void (wordsEdited ? search(words) : search())}
              disabled={running || (wordsEdited && !words.length)}
              title={wordsEdited ? 'Search exactly these words' : 'Read the script and notes again and choose the words'}
            >
              <RefreshCw size={13} className={running && !find?.candidates.length ? 'spin' : ''} />{' '}
              {wordsEdited ? 'Search these words' : notesChanged || optionChanged ? 'Search again with these settings' : 'Search again'}
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
                <span className="field-hint">Each photo is looked at to check it matches, so this can take a minute or two.</span>
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
        {!running && !!find?.plan.turnedDown?.length && (
          <details className="sp-find-down">
            <summary>
              {find.plan.turnedDown.length} photo{find.plan.turnedDown.length === 1 ? '' : 's'} didn’t match well enough. Show them
            </summary>
            <div className="sp-find-grid">
              {find.plan.turnedDown.map((c) => (
                <Tile key={c.key} c={c} selected={selected === c.key} isFrame={frameKey === c.key} onSelect={() => setSelected(selected === c.key ? null : c.key)} />
              ))}
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
}

export function Tile({ c, selected, isFrame, onSelect }: { c: ImageCandidate; selected: boolean; isFrame: boolean; onSelect: () => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <button
      className={`sp-find-tile ${selected ? 'on' : ''}`}
      onClick={onSelect}
      title={
        c.check
          ? `Shows: ${c.check.sees}${c.check.missing ? `\nMissing: ${c.check.missing}` : ''}${c.check.framing ? `\nFraming: ${c.check.framing.seen} (${c.check.framing.match === 'yes' ? 'matches the shot type' : c.check.framing.match === 'close' ? 'close to the shot type' : 'not the shot type'})` : ''}`
          : `${c.title}${c.creator ? ` · ${c.creator}` : ''}`
      }
      aria-pressed={selected}
    >
      <img src={c.thumbUrl} alt={c.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      <span className="sp-find-tile-meta">
        {c.check ? <b className={`sp-find-score s${Math.min(10, Math.max(0, c.check.score))}`}>{c.check.score}/10</b> : null} {c.sourceName} · {c.license.name}
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
