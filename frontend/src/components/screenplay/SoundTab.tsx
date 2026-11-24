// Sound: tell the gatherer what you're after (or point it at a shot, a scene
// or the whole script). It works out the separate sounds wanted, searches
// free libraries (Internet Archive, and Freesound, Wikimedia Commons, Jamendo
// and ccMixter through Openverse), and lays out a collection per sound. You
// listen and keep the ones you want, for a shot or for the library.

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Search, Trash2, Volume2 } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { Detail, ScreenplayDoc, SoundCandidate, SoundHunt, SoundWant } from '../../api/screenplays';
import { soundCredit, soundMeta } from '../../api/screenplays';
import { Alert, EmptyState, errorMessage } from '../ui';
import { sceneNumbers } from './format';
import { MusicButton, PreviewButton } from './media';

interface Props {
  screenplayId: number;
  doc: ScreenplayDoc;
  detail?: Detail;
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
  /** Start scoped to this shot or scene (from a shot's "Find sounds"). */
  initialScope?: string | null;
}

const KIND_LABEL: Record<SoundWant['kind'], string> = { ambience: 'Ambience', effect: 'Effect', foley: 'Foley', music: 'Music' };

function fmtDur(s: number | null): string {
  if (s == null) return '';
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function LicenseBadge({ l }: { l: SoundCandidate['license'] }) {
  const cls = !l.attribution ? 'free' : l.commercial ? 'credit' : 'nc';
  const title = !l.attribution
    ? 'Public domain: use it any way you like, no credit needed'
    : l.commercial
      ? `Free to use and change, commercially too; credit the creator${l.code === 'by-sa' ? ' and share changes under the same licence' : ''}`
      : 'Free for non-commercial use with credit; fine for private pitching, not for a commercial release';
  return (
    <a className={`sp-lic ${cls}`} href={l.url ?? undefined} target="_blank" rel="noreferrer" title={title}>
      {l.name}
    </a>
  );
}

export function SoundTab({ screenplayId, doc, detail, flush, setDetail, initialScope }: Props) {
  const qc = useQueryClient();
  const [request, setRequest] = useState('');
  const [scope, setScope] = useState(initialScope ?? '');
  const [nc, setNc] = useState(false);
  const [huntId, setHuntId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const scopes = useMemo(() => {
    const scenes = sceneNumbers(doc.elements);
    const order = new Map(doc.elements.map((e, i) => [e.id, i]));
    const shots = [...doc.shots].sort((a, b) => (order.get(a.anchorId) ?? 0) - (order.get(b.anchorId) ?? 0));
    return [
      { value: '', label: 'Just my description' },
      { value: 'script', label: 'The whole script' },
      ...doc.elements.filter((e) => e.type === 'scene').map((e) => ({ value: e.id, label: `Scene ${scenes.get(e.id)}: ${e.text || '(untitled)'}` })),
      ...shots.map((s, i) => ({ value: s.id, label: `Shot ${i + 1}${s.type ? ` · ${s.type}` : ''}` })),
    ];
  }, [doc.elements, doc.shots]);
  const shotOptions = scopes.filter((s) => doc.shots.some((x) => x.id === s.value));

  const hunts = useQuery({ queryKey: ['sound-hunts', screenplayId], queryFn: () => api.listSoundHunts(screenplayId) });
  const current = huntId ?? hunts.data?.[0]?.id ?? null;
  const hunt = useQuery({
    queryKey: ['sound-hunt', screenplayId, current],
    queryFn: () => api.getSoundHunt(screenplayId, current!),
    enabled: current != null,
    refetchInterval: (q) => (q.state.data && !['done', 'failed'].includes(q.state.data.status) ? 1500 : false),
  });
  useEffect(() => {
    if (hunt.data && ['done', 'failed'].includes(hunt.data.status)) void qc.invalidateQueries({ queryKey: ['sound-hunts', screenplayId] });
  }, [hunt.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const gather = async () => {
    setError(null);
    setStarting(true);
    try {
      await flush();
      const h = await api.startSoundHunt(screenplayId, { scope, request, allowNonCommercial: nc });
      setHuntId(h.id);
      qc.setQueryData(['sound-hunt', screenplayId, h.id], h);
      void qc.invalidateQueries({ queryKey: ['sound-hunts', screenplayId] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const kept = (detail?.media.other ?? []).filter((m) => m.role === 'sound');
  const keptKeys = new Map(kept.map((m) => [soundMeta(m)?.key, m]));
  const live = hunt.data && !['done', 'failed'].includes(hunt.data.status);

  return (
    <div className="sp-sound">
      <div className="sp-sound-ask">
        <label className="sp-sound-request">
          <span>What are you looking for?</span>
          <textarea
            rows={3}
            value={request}
            placeholder="e.g. a storm hitting an old lighthouse, wind howling through gaps, a distant foghorn, and something sparse and mournful on cello"
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void gather();
            }}
          />
        </label>
        <div className="sp-sound-controls">
          <label>
            <span>Use the script from</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="tab-perm" title="Adds Creative Commons NonCommercial sounds: fine for private pitching, not for a commercial release.">
            <input type="checkbox" checked={nc} onChange={(e) => setNc(e.target.checked)} />
            Include non-commercial
          </label>
          <span className="sp-grow" />
          <button className="btn btn-primary" onClick={gather} disabled={starting || (!request.trim() && !scope)}>
            {starting ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Gather sounds
          </button>
        </div>
        <p className="field-hint">
          Searches only free libraries: the Internet Archive, and Freesound, Wikimedia Commons, Jamendo and ccMixter through Openverse. By default
          you only get sounds you can use and change in anything, including commercial work; some ask for a credit, which is kept for you.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}

      {(hunts.data?.length ?? 0) > 1 && (
        <div className="sp-sound-history">
          <span className="field-hint">Earlier searches:</span>
          {hunts.data!.map((h) => (
            <button key={h.id} className={`sp-chip ${h.id === current ? 'on' : ''}`} onClick={() => setHuntId(h.id)} title={new Date(`${h.created_at.replace(' ', 'T')}Z`).toLocaleString()}>
              {(h.request || scopes.find((s) => s.value === h.scope)?.label || 'Search').slice(0, 40)}
            </button>
          ))}
        </div>
      )}

      {hunt.data && (
        <section className="sp-sound-results">
          <div className="sp-sound-status">
            {live ? <Loader2 size={14} className="spin" /> : hunt.data.status === 'failed' ? <AlertTriangle size={14} /> : <Check size={14} />}
            <span>{hunt.data.status === 'failed' ? hunt.data.error : hunt.data.progress}</span>
          </div>
          {hunt.data.wants.map((w) => (
            <Collection
              key={w.id}
              want={w}
              hunt={hunt.data!}
              searching={!!live && !w.candidates.length}
              keptKeys={keptKeys}
              shotOptions={shotOptions}
              defaultTarget={doc.shots.some((s) => s.id === hunt.data!.scope) ? hunt.data!.scope : ''}
              onKeep={async (c, target) => {
                const r = await api.keepSound(screenplayId, hunt.data!.id, c.key, target);
                setDetail(r);
              }}
            />
          ))}
        </section>
      )}

      <Library screenplayId={screenplayId} kept={kept} shotOptions={shotOptions} setDetail={setDetail} />
    </div>
  );
}

function Collection({
  want,
  hunt,
  searching,
  keptKeys,
  shotOptions,
  defaultTarget,
  onKeep,
}: {
  want: SoundWant;
  hunt: SoundHunt;
  searching: boolean;
  keptKeys: Map<string | undefined, api.ScreenplayMedia>;
  shotOptions: Array<{ value: string; label: string }>;
  defaultTarget: string;
  onKeep: (c: SoundCandidate, target: string) => Promise<void>;
}) {
  const [target, setTarget] = useState(defaultTarget);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="sp-collection">
      <div className="sp-collection-head">
        <span className={`sp-kind ${want.kind}`}>{KIND_LABEL[want.kind]}</span>
        <h4>{want.want}</h4>
        <span className="field-hint" title="What the gatherer searched for">{want.queries.join(' · ')}</span>
        <span className="sp-grow" />
        <label className="sp-collection-target">
          Keep for
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">The sound library</option>
            {shotOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>
      {want.errors.map((e) => (
        <span key={e} className="cs-warn"><AlertTriangle size={11} /> {e}</span>
      ))}
      {error && <Alert>{error}</Alert>}
      {searching ? (
        <p className="field-hint"><Loader2 size={12} className="spin" /> Searching…</p>
      ) : want.candidates.length === 0 && want.errors.length >= 2 ? (
        <p className="field-hint">Neither library answered, so this wasn’t really searched. Try again in a minute.</p>
      ) : want.candidates.length === 0 ? (
        <p className="field-hint">Nothing free turned up. Try describing it differently{hunt.options.allowNonCommercial ? '' : ', or include non-commercial sounds'}.</p>
      ) : (
        <ul className="sp-cands">
          {want.candidates.map((c) => {
            const have = keptKeys.get(c.key);
            return (
              <li key={c.key} className={`sp-cand ${have ? 'kept' : ''}`}>
                <PreviewButton url={c.audioUrl} label={`Listen to ${c.title}`} />
                <div className="sp-cand-text">
                  <strong title={c.title}>{c.title}</strong>
                  <span className="field-hint">
                    {[c.creator, c.sourceName, fmtDur(c.durationS)].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <LicenseBadge l={c.license} />
                <a className="icon-btn" href={c.landingUrl} target="_blank" rel="noreferrer" title={`Open on ${c.sourceName}`}><ExternalLink size={13} /></a>
                <button
                  className={`btn btn-sm ${have ? '' : 'btn-primary'}`}
                  disabled={busy === c.key}
                  onClick={async () => {
                    setBusy(c.key);
                    setError(null);
                    try {
                      await onKeep(c, target);
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                  title={have ? 'Kept. Click to move it to the shot chosen above.' : 'Download it into this screenplay'}
                >
                  {busy === c.key ? <Loader2 size={13} className="spin" /> : have ? <Check size={13} /> : null} {have ? 'Kept' : 'Keep'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Library({
  screenplayId,
  kept,
  shotOptions,
  setDetail,
}: {
  screenplayId: number;
  kept: api.ScreenplayMedia[];
  shotOptions: Array<{ value: string; label: string }>;
  setDetail: (d: Detail) => void;
}) {
  const [copied, setCopied] = useState(false);
  const credits = kept
    .map((m) => ({ m, meta: soundMeta(m) }))
    .filter((x) => x.meta?.license.attribution)
    .map((x) => soundCredit(x.m.label ?? 'Untitled', x.meta!));
  if (!kept.length) {
    return (
      <section className="sp-sound-library">
        <h3>Kept sounds</h3>
        <EmptyState title="No sounds kept yet">Gather some above, listen, and keep the ones that fit.</EmptyState>
      </section>
    );
  }
  return (
    <section className="sp-sound-library">
      <h3>Kept sounds ({kept.length})</h3>
      <ul className="sp-cands">
        {kept.map((m) => {
          const meta = soundMeta(m);
          return (
            <li key={m.id} className="sp-cand">
              {m.media_id && <MusicButton mediaId={m.media_id} label={`Play ${m.label}`} />}
              <div className="sp-cand-text">
                <strong title={m.label ?? ''}>{m.label}</strong>
                <span className="field-hint">{[meta?.want, meta?.creator, meta?.sourceName, fmtDur(meta?.durationS ?? null)].filter(Boolean).join(' · ')}</span>
              </div>
              {meta && <LicenseBadge l={meta.license} />}
              <select
                value={m.target}
                onChange={async (e) => setDetail(await api.updateSound(screenplayId, m.id, { target: e.target.value }))}
                aria-label="Used in"
              >
                <option value="">Library only</option>
                {shotOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <label className="sp-vol" title="Volume under the picture">
                <Volume2 size={13} />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  defaultValue={meta?.volume ?? 0.8}
                  onPointerUp={async (e) => setDetail(await api.updateSound(screenplayId, m.id, { volume: Number((e.target as HTMLInputElement).value) }))}
                />
              </label>
              <button
                className="icon-btn"
                title="Remove"
                onClick={async () => {
                  if (window.confirm(`Remove “${m.label}”?`)) setDetail(await api.deleteMediaRow(screenplayId, m.id));
                }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          );
        })}
      </ul>
      {credits.length > 0 && (
        <div className="sp-credits">
          <div className="sp-credits-head">
            <strong>Sound credits</strong>
            <span className="field-hint">These sounds ask for a credit wherever you show the work. They’re added to the pitch document.</span>
            <span className="sp-grow" />
            <button
              className="btn btn-sm"
              onClick={async () => {
                await navigator.clipboard.writeText(credits.join('\n'));
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ul>{credits.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
