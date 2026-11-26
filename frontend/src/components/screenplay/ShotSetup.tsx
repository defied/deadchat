// Setting up a shot with the shot mentor, before any image is found or drawn.
// Left: the script and the shot list (the fields a cinematography model judges).
// Right: the mentor, who suggests values with reasons, asks about what's open
// and explains the terms. Nothing changes on the shot list unless the writer
// picks it.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Dices, GraduationCap, Loader2, Search, Send } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { MentorState, Shot } from '../../api/screenplays';
import { Modal } from '../ui';
import { useScreenplayActions } from './actions';
import { SETUP_FIELDS, typeFromSetup, type SetupField, type ShotSetup } from './cinema';
import { msg } from './ShotFinder';

const FIELDS = Object.keys(SETUP_FIELDS) as SetupField[];
const CORE: SetupField[] = ['size', 'framing', 'angle'];

export function ShotSetupDialog({
  shot,
  number,
  onPatch,
  onClose,
  onFind,
  onGenerate,
}: {
  shot: Shot;
  number: number;
  onPatch: (p: Partial<Shot>, field: string) => void;
  onClose: () => void;
  onFind: () => void;
  onGenerate: () => void;
}) {
  const { screenplayId, flush } = useScreenplayActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const mentor = shot.mentor;
  const setup = shot.setup ?? {};
  const latest = useRef(shot);
  latest.current = shot;
  const chatEnd = useRef<HTMLDivElement | null>(null);

  const talk = async (message?: string) => {
    setBusy(true);
    setError(null);
    try {
      await flush();
      const m: MentorState = await api.mentorTurn(screenplayId, shot.id, message);
      onPatch({ mentor: m }, 'mentor');
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  // The mentor opens the conversation.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || mentor?.messages.length) return;
    opened.current = true;
    void talk();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' });
  }, [mentor?.messages.length, busy]);

  const setField = (field: SetupField, value: string | undefined) => {
    const next: ShotSetup = { ...(latest.current.setup ?? {}) };
    if (value) next[field] = value;
    else delete next[field];
    const has = Object.keys(next).length > 0;
    onPatch({ setup: has ? next : undefined, ...(typeFromSetup(next) ? { type: typeFromSetup(next) } : {}) }, 'setup');
  };

  /** Pick a value and tell the mentor, so it can follow up. */
  const choose = async (field: SetupField, value: string) => {
    setField(field, value);
    // Let the save carry the new value before the mentor reads the shot.
    await new Promise((r) => setTimeout(r, 50));
    await talk(`${SETUP_FIELDS[field].label}: ${value}`);
  };

  const open = CORE.filter((f) => !setup[f]);
  const ready = !!mentor?.ready && open.length === 0;
  const suggestionFor = (f: SetupField) => mentor?.suggestions?.find((s) => s.field === f && s.value !== setup[f]);

  return (
    <Modal
      title={`Set up shot ${number}`}
      onClose={onClose}
      width={1120}
      footer={
        <div className="sp-find-foot">
          <span className={`sp-setup-status ${ready ? 'ok' : ''}`}>
            {ready ? (
              <>
                <Check size={13} /> The mentor thinks this shot is ready.
              </>
            ) : open.length ? (
              `Still open: ${open.map((f) => SETUP_FIELDS[f].label.toLowerCase()).join(', ')}`
            ) : (
              'Shot size, framing and angle are set.'
            )}
          </span>
          <span className="sp-grow" />
          <button className="btn" onClick={onGenerate} title="Draw this frame with AI from the shot list">
            <Dices size={14} /> Generate with AI
          </button>
          <button className={`btn ${ready || !open.length ? 'btn-primary' : ''}`} onClick={onFind} title="Find photos that match this shot">
            <Search size={14} /> Find images
          </button>
        </div>
      }
    >
      <div className="sp-setup">
        <div className="sp-setup-left">
          <span className="sp-adj-head">From the script</span>
          <blockquote className="sp-setup-quote">{shot.excerpt || shot.summary || 'This shot has no highlighted text.'}</blockquote>
          {shot.summary && shot.summary !== shot.excerpt && <p className="field-hint">In this shot: {shot.summary}</p>}
          <span className="sp-adj-head">Shot list</span>
          <div className="sp-setup-fields">
            {FIELDS.map((f) => {
              const sug = suggestionFor(f);
              return (
                <label key={f} className={`sp-setup-field ${CORE.includes(f) ? 'core' : ''}`}>
                  <span>{SETUP_FIELDS[f].label}</span>
                  <select value={setup[f] ?? ''} onChange={(e) => setField(f, e.target.value || undefined)}>
                    <option value="">Not set</option>
                    {SETUP_FIELDS[f].options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  {sug && (
                    <button className="sp-setup-sug" title={sug.why} onClick={() => void choose(f, sug.value)} disabled={busy}>
                      Mentor suggests <b>{sug.value}</b>: use it
                    </button>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        <div className="sp-setup-mentor">
          <span className="sp-adj-head">
            <GraduationCap size={12} /> Shot mentor
          </span>
          <div className="sp-setup-chat">
            {(mentor?.messages ?? []).map((m, i) => (
              <div key={i} className={`sp-setup-msg ${m.from}`}>
                {m.text}
              </div>
            ))}
            {mentor?.suggestions?.length ? (
              <div className="sp-setup-why">
                {mentor.suggestions.map((s) => (
                  <p key={s.field}>
                    <b>
                      {SETUP_FIELDS[s.field].label}: {s.value}.
                    </b>{' '}
                    {s.why}
                  </p>
                ))}
              </div>
            ) : null}
            {!busy &&
              mentor?.questions?.map((q) => (
                <div key={q.question} className="sp-setup-q">
                  <p>{q.question}</p>
                  <div>
                    {q.options.map((o) => (
                      <button key={o} className="sp-chip" onClick={() => void (q.field ? choose(q.field, o) : talk(o))}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            {busy && (
              <div className="sp-setup-msg mentor thinking">
                <Loader2 size={13} className="spin" /> Thinking…
              </div>
            )}
            <div ref={chatEnd} />
          </div>
          {error && (
            <div className="sp-shot-warn">
              <AlertTriangle size={12} /> {error}
            </div>
          )}
          <form
            className="sp-setup-ask"
            onSubmit={(e) => {
              e.preventDefault();
              const t = draft.trim();
              if (!t) return;
              setDraft('');
              void talk(t);
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Answer, or ask anything about the shot…" disabled={busy} />
            <button className="btn btn-sm btn-primary" disabled={busy || !draft.trim()} type="submit" aria-label="Send">
              <Send size={13} />
            </button>
          </form>
        </div>
      </div>
    </Modal>
  );
}
