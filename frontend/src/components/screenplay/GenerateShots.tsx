// Generate shots: the local model breaks each scene without shots into a
// shot list (where shots start, type, length, lens). Shots arrive scene by
// scene; the whole run is one undo step. The script is never changed.
// Clear shots: remove every shot except locked ones (also one undo step).

import { useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { ScreenplayDoc, Shot } from '../../api/screenplays';
import { Alert, Modal, errorMessage } from '../ui';
import { newId, sceneNumbers } from './format';

type Update = (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string, opts?: { history?: boolean }) => void;
type Density = 'fewer' | 'normal' | 'more';

/** Scene headings that have no shot anchored anywhere in their scene. */
export function scenesWithoutShots(doc: ScreenplayDoc): string[] {
  const anchored = new Set(doc.shots.map((s) => s.anchorId));
  const out: string[] = [];
  let current: string | null = null;
  let has = false;
  for (const e of doc.elements) {
    if (e.type === 'scene') {
      if (current && !has) out.push(current);
      current = e.id;
      has = anchored.has(e.id);
    } else if (anchored.has(e.id)) has = true;
  }
  if (current && !has) out.push(current);
  return out;
}

/** Put suggested shots into the document in script order (skipping lines that already have one). */
export function addSuggested(d: ScreenplayDoc, shots: api.SuggestedShot[]): ScreenplayDoc {
  const have = new Set(d.shots.map((s) => s.anchorId));
  const fresh: Shot[] = shots
    .filter((s) => !have.has(s.anchorId) && d.elements.some((e) => e.id === s.anchorId))
    .map((s) => ({ id: newId('sh'), anchorId: s.anchorId, type: s.type, seconds: s.seconds, ...(s.lens ? { lens: s.lens } : {}), ...(s.notes ? { notes: s.notes } : {}) }));
  if (!fresh.length) return d;
  const order = new Map(d.elements.map((e, i) => [e.id, i]));
  return { ...d, shots: [...d.shots, ...fresh].sort((a, b) => (order.get(a.anchorId) ?? 0) - (order.get(b.anchorId) ?? 0)) };
}

export function GenerateShotsModal({
  screenplayId,
  doc,
  update,
  flush,
  onClose,
}: {
  screenplayId: number;
  doc: ScreenplayDoc;
  update: Update;
  flush: () => Promise<void>;
  onClose: () => void;
}) {
  const [density, setDensity] = useState<Density>('normal');
  const [pause, setPause] = useState(!doc.settings.paused);
  const [progress, setProgress] = useState<{ done: number; total: number; shots: number; rules: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const scenes = scenesWithoutShots(doc);
  const numbers = sceneNumbers(doc.elements);
  const running = !!progress && progress.done < progress.total && !stop.current;

  const run = async () => {
    setError(null);
    stop.current = false;
    await flush();
    let first = true;
    // One undo step for the whole run: the first change is recorded, the rest join it.
    const apply = (fn: (d: ScreenplayDoc) => ScreenplayDoc) => {
      update(fn, undefined, first ? undefined : { history: false });
      first = false;
    };
    if (pause) apply((d) => ({ ...d, settings: { ...d.settings, paused: true } }));
    const p = { done: 0, total: scenes.length, shots: 0, rules: 0 };
    setProgress({ ...p });
    for (const sceneId of scenes) {
      if (stop.current) break;
      try {
        const r = await api.suggestShots(screenplayId, sceneId, density);
        apply((d) => addSuggested(d, r.shots));
        p.shots += r.shots.length;
        if (r.source === 'rules') p.rules++;
      } catch (e) {
        setError(`Scene ${numbers.get(sceneId)}: ${errorMessage(e)}`);
      }
      p.done++;
      setProgress({ ...p });
    }
  };

  const finished = progress && (progress.done >= progress.total || stop.current);
  return (
    <Modal
      title="Generate shots"
      onClose={() => {
        stop.current = true;
        onClose();
      }}
      width={520}
      footer={
        finished ? (
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        ) : running ? (
          <button className="btn" onClick={() => (stop.current = true)}>Stop</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void run()} disabled={!scenes.length}>
              <Sparkles size={14} /> Generate
            </button>
          </>
        )
      }
    >
      {!progress ? (
        <div className="sp-gen">
          <p>
            {scenes.length
              ? `The local model reads ${scenes.length === 1 ? 'the scene' : `each of the ${scenes.length} scenes`} without shots and suggests where shots start, their type, length and lens. Your script isn’t changed, and Undo takes the whole lot back.`
              : 'Every scene already has shots. Clear shots first to start over.'}
          </p>
          <fieldset className="sp-gen-density">
            <legend>How many shots</legend>
            {([
              ['fewer', 'Fewer', 'Just enough to tell each scene'],
              ['normal', 'A shot per beat', 'New action, a reaction, a change of speaker'],
              ['more', 'Full coverage', 'Singles, reverses, inserts and reactions'],
            ] as const).map(([v, label, hint]) => (
              <label key={v} className="tab-perm">
                <input type="radio" name="density" checked={density === v} onChange={() => setDensity(v)} />
                <span>
                  {label} <span className="field-hint">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {!doc.settings.paused && (
            <label className="tab-perm">
              <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} />
              Pause frame renders so I can review the shots first
            </label>
          )}
        </div>
      ) : (
        <div className="sp-gen">
          <progress max={progress.total} value={progress.done} />
          <p>
            {!finished && <Loader2 size={13} className="spin" />} Scene {Math.min(progress.done + (finished ? 0 : 1), progress.total)} of {progress.total} ·{' '}
            {progress.shots} shot{progress.shots === 1 ? '' : 's'} added
          </p>
          {finished && progress.rules > 0 && (
            <p className="field-hint">
              The model wasn’t available for {progress.rules} scene{progress.rules === 1 ? '' : 's'}, so a simple breakdown was used there.
            </p>
          )}
          {finished && pause && <p className="field-hint">Frame renders are paused. Use “Resume renders” when you’re happy with the shots.</p>}
        </div>
      )}
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}
