// Recreate a shot's picked photo with the AI: same camera, setting and light,
// with the film's characters and props put in from their main photos.

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Package, Sparkles, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import * as api from '../../api/screenplays';
import type { Adjustment, Detail, RecreateCandidates, Shot } from '../../api/screenplays';
import { Modal } from '../ui';
import { useScreenplayActions } from './actions';
import { AdjustmentNotes } from './AdjustmentNotes';
import { SpImage } from './media';
import { msg } from './ShotFinder';

export function RecreateFrame({
  shot,
  number,
  baseRow,
  onPatch,
  onClose,
}: {
  shot: Shot;
  number: number;
  baseRow: api.ScreenplayMedia;
  detail?: Detail;
  onPatch: (p: Partial<Shot>, field: string) => void;
  onClose: () => void;
}) {
  const { screenplayId, flush, setDetail } = useScreenplayActions();
  const [cand, setCand] = useState<RecreateCandidates | null>(null);
  const [chars, setChars] = useState<Set<string>>(new Set());
  const [props, setProps] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        await flush();
        const c = await api.recreateCandidates(screenplayId, shot.id);
        setCand(c);
        setChars(new Set(c.characters.map((x) => x.id)));
        setProps(new Set(c.props.map((x) => x.id)));
      } catch (e) {
        setError(msg(e));
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await flush();
      const d = await api.recreateFrame(screenplayId, shot.id, baseRow.id, [...chars], [...props]);
      setDetail(d);
      onPatch({ frameImage: d.added }, 'frameImage');
      onClose();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };
  const nothing = !!cand && chars.size === 0 && props.size === 0;

  return (
    <Modal
      title={`Recreate shot ${number} with your cast and props`}
      onClose={onClose}
      width={980}
      busy={busy}
      footer={
        <div className="sp-find-foot">
          <span className="field-hint sp-grow">FLUX.2 on your GPU box keeps this photo’s camera, setting and light. About 2 minutes. The original stays in the shot’s images.</span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void go()} disabled={busy || !cand}>
            {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Recreate
          </button>
        </div>
      }
    >
      <div className="sp-recreate">
        <div className="sp-recreate-photo">{baseRow.media_id && <SpImage mediaId={baseRow.media_id} alt="Picked photo" />}</div>
        <div className="sp-recreate-side">
          {!cand ? (
            <div className="sp-find-empty small">{error ? '' : <><Loader2 size={16} className="spin" /> Reading the shot…</>}</div>
          ) : (
            <>
              <section>
                <span className="sp-adj-head"><User size={11} /> Characters in this shot</span>
                {cand.characters.length === 0 && <p className="field-hint">Nobody from your cast is named in this part of the script.</p>}
                {cand.characters.map((c) => (
                  <label key={c.id} className={`sp-recreate-pick ${chars.has(c.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={chars.has(c.id)} onChange={() => toggle(chars, setChars, c.id)} />
                    <span className="sp-recreate-thumb">{c.photo ? <SpImage mediaId={c.photo} /> : <User size={14} />}</span>
                    <span>
                      <strong>{c.name}</strong>
                      <small>{c.photo ? 'Their main photo keeps the face the same' : 'No photo yet: described in words only'}</small>
                    </span>
                  </label>
                ))}
                {cand.characters.some((c) => !c.photo) && (
                  <p className="field-hint">
                    Add a headshot in <Link to={`/screenplays/${screenplayId}/characters`}>Characters</Link> (Casting gives four to choose from) for a face that matches across shots.
                  </p>
                )}
              </section>
              <section>
                <span className="sp-adj-head"><Package size={11} /> Props in this shot</span>
                {cand.props.length === 0 && (
                  <p className="field-hint">
                    No props from your <Link to={`/screenplays/${screenplayId}/props`}>Props</Link> list are named in this part of the script.
                  </p>
                )}
                {cand.props.map((p) => (
                  <label key={p.id} className={`sp-recreate-pick ${props.has(p.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={props.has(p.id)} onChange={() => toggle(props, setProps, p.id)} />
                    <span className="sp-recreate-thumb">{p.photo ? <SpImage mediaId={p.photo} /> : <Package size={14} />}</span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.photo ? 'Its main photo keeps it the same' : 'No photo yet: described in words only'}</small>
                    </span>
                  </label>
                ))}
              </section>
              <AdjustmentNotes shot={shot} onChange={(adjustments: Adjustment[]) => onPatch({ adjustments }, 'adjustments')} hint="Anything else to change while recreating: “raining”, “he holds the phone up”." />
              {nothing && <p className="field-hint">Nothing selected: the photo is redrawn in the film’s style and with your notes.</p>}
            </>
          )}
          {error && <div className="sp-shot-warn"><AlertTriangle size={12} /> {error}</div>}
        </div>
      </div>
    </Modal>
  );
}
