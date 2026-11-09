// Characters: build each one out (human or not), and generate reference
// photos from their description. The appearance and wardrobe written here go
// into every shot the character is in.

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ImagePlus, Loader2, Plus, Sparkles, Star, Trash2, UserPlus, Users } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { Character, CharacterKind, Detail, ScreenplayDoc } from '../../api/screenplays';
import { Alert, EmptyState, Field, errorMessage } from '../ui';
import { answersTo, cueName, newId, titleCase } from './format';
import { SpImage } from './media';

const KINDS: Array<{ value: CharacterKind; label: string }> = [
  { value: 'human', label: 'Human' },
  { value: 'animal', label: 'Animal' },
  { value: 'creature', label: 'Creature' },
  { value: 'robot', label: 'Robot / machine' },
  { value: 'alien', label: 'Alien' },
  { value: 'spirit', label: 'Spirit / supernatural' },
  { value: 'other', label: 'Other' },
];

const VIEWS = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'full', label: 'Full body' },
  { value: 'profile', label: 'Profile' },
  { value: 'expressions', label: 'Expression sheet' },
];

interface Props {
  screenplayId: number;
  doc: ScreenplayDoc;
  detail?: Detail;
  update: (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string, opts?: { history?: boolean }) => void;
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
}


export function CharactersTab({ screenplayId, doc, detail, update, flush, setDetail }: Props) {
  const [selected, setSelected] = useState<string | null>(doc.characters[0]?.id ?? null);
  const c = doc.characters.find((x) => x.id === selected) ?? null;

  const scriptNames = useMemo(() => {
    const names = new Set<string>();
    for (const e of doc.elements) if (e.type === 'character') {
      const n = cueName(e.text);
      if (n) names.add(n.toUpperCase());
    }
    return [...names].filter((n) => !doc.characters.some((x) => answersTo(x, n)));
  }, [doc.elements, doc.characters]);

  const add = (name = 'New character') => {
    const ch: Character = { id: newId('ch'), name, kind: 'human' };
    update((d) => ({ ...d, characters: [...d.characters, ch] }));
    setSelected(ch.id);
  };
  const importAll = () => {
    const fresh = scriptNames.map((n) => ({ id: newId('ch'), name: titleCase(n), kind: 'human' as CharacterKind }));
    update((d) => ({ ...d, characters: [...d.characters, ...fresh] }));
    if (!selected && fresh[0]) setSelected(fresh[0].id);
  };

  const photosFor = (id: string) => (detail?.media.other ?? []).filter((m) => m.role === 'character' && m.target === id);

  return (
    <div className="sp-chars">
      <aside className="sp-chars-list">
        <div className="sp-chars-actions">
          <button className="btn btn-primary btn-sm" onClick={() => add()}>
            <Plus size={14} /> New character
          </button>
          {scriptNames.length > 0 && (
            <button className="btn btn-sm" onClick={importAll} title={scriptNames.join(', ')}>
              <UserPlus size={14} /> Add {scriptNames.length} from script
            </button>
          )}
        </div>
        {doc.characters.map((x) => {
          const primary = x.primaryRefId ? photosFor(x.id).find((m) => m.id === x.primaryRefId) : undefined;
          return (
            <button key={x.id} className={`sp-char-item ${x.id === selected ? 'on' : ''}`} onClick={() => setSelected(x.id)}>
              <span className="sp-char-thumb">{primary?.media_id ? <SpImage mediaId={primary.media_id} /> : <Users size={16} />}</span>
              <span>
                <strong>{x.name || 'Unnamed'}</strong>
                <small>
                  {x.placeholder ? (
                    <span className="sp-placeholder" title="Added from the script. Fill in a description to use it in shots.">Placeholder · from the script</span>
                  ) : (
                    [KINDS.find((k) => k.value === x.kind)?.label, x.role].filter(Boolean).join(' · ')
                  )}
                </small>
              </span>
            </button>
          );
        })}
      </aside>
      <section className="sp-char-main">
        {!c ? (
          <EmptyState title="No character selected">
            Create characters, or add the ones already speaking in your script. Their descriptions go into every shot they appear in.
          </EmptyState>
        ) : (
          <CharacterForm
            key={c.id}
            screenplayId={screenplayId}
            doc={doc}
            character={c}
            photos={photosFor(c.id)}
            update={update}
            flush={flush}
            setDetail={setDetail}
            onDelete={() => {
              if (!window.confirm(`Delete ${c.name}?`)) return;
              update((d) => ({
                ...d,
                characters: d.characters.filter((x) => x.id !== c.id),
                plans: Object.fromEntries(Object.entries(d.plans).map(([k, p]) => [k, { items: p.items.filter((it) => !(it.kind === 'character' && it.ref === c.id)) }])),
              }));
              setSelected(null);
            }}
          />
        )}
      </section>
    </div>
  );
}

function CharacterForm({
  screenplayId,
  doc,
  character: c,
  photos,
  update,
  flush,
  setDetail,
  onDelete,
}: {
  screenplayId: number;
  doc: ScreenplayDoc;
  character: Character;
  photos: api.ScreenplayMedia[];
  update: Props['update'];
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
  onDelete: () => void;
}) {
  const [views, setViews] = useState<string[]>(['portrait', 'full']);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [proposal, setProposal] = useState<string | null>(null);

  // Editing a placeholder makes it a real profile (it's no longer removed automatically).
  const set = (patch: Partial<Character>, field: string) =>
    update((d) => ({ ...d, characters: d.characters.map((x) => (x.id === c.id ? { ...x, ...patch, placeholder: undefined } : x)) }), `char:${c.id}:${field}`);

  const scenes = useMemo(() => {
    const out: number[] = [];
    let n = 0;
    let inScene = false;
    const name = c.name.trim().toUpperCase();
    if (!name) return out;
    const re = new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'iu');
    for (const e of doc.elements) {
      if (e.type === 'scene') {
        n++;
        inScene = false;
      }
      if (!inScene && ((e.type === 'character' && cueName(e.text).toUpperCase() === name) || (e.type === 'action' && re.test(e.text)))) {
        out.push(n);
        inScene = true;
      }
    }
    return out;
  }, [doc.elements, c.name]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const nonHuman = c.kind && c.kind !== 'human';

  return (
    <div className="sp-char-form">
      <div className="sp-char-top">
        <input className="sp-char-name" value={c.name} onChange={(e) => set({ name: e.target.value }, 'name')} placeholder="Name as it appears in the script" aria-label="Name" />
        <button className="btn btn-danger btn-sm" onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
      {c.placeholder && (
        <p className="sp-placeholder-note">
          Placeholder: added because {c.name.toUpperCase()} speaks in the script. Fill in what they look like so shots can show them; it stays once you edit it.
        </p>
      )}
      <p className="field-hint">{scenes.length ? `Appears in scene ${scenes.join(', ')}.` : 'Not in the script yet: the name must match the character cue.'}</p>

      <div className="sp-grid3">
        <Field label="Kind">
          <select value={c.kind ?? 'human'} onChange={(e) => set({ kind: e.target.value as CharacterKind }, 'kind')}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={nonHuman ? 'Species / type' : 'Role'}>
          {nonHuman ? (
            <input value={c.species ?? ''} onChange={(e) => set({ species: e.target.value }, 'species')} placeholder="e.g. border collie, android, dragon" />
          ) : (
            <input value={c.role ?? ''} onChange={(e) => set({ role: e.target.value }, 'role')} placeholder="e.g. protagonist" />
          )}
        </Field>
        <Field label="Age">
          <input value={c.age ?? ''} onChange={(e) => set({ age: e.target.value }, 'age')} placeholder="e.g. 40s, ancient" />
        </Field>
        <Field label="Gender">
          <input value={c.gender ?? ''} onChange={(e) => set({ gender: e.target.value }, 'gender')} placeholder="optional" />
        </Field>
        {nonHuman && (
          <Field label="Role">
            <input value={c.role ?? ''} onChange={(e) => set({ role: e.target.value }, 'role')} placeholder="e.g. sidekick" />
          </Field>
        )}
      </div>

      <Field label="Appearance" hint="What the camera sees: body, face, hair or surface, build, distinguishing marks. Used in every shot this character is in.">
        <textarea rows={4} value={c.appearance ?? ''} onChange={(e) => set({ appearance: e.target.value }, 'appearance')} />
      </Field>
      <div className="sp-refine">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Rough notes or changes, e.g. “scar over left eye, older, greyer”" />
        <button
          className="btn btn-sm"
          disabled={!!busy || (!notes.trim() && !c.appearance?.trim())}
          onClick={() =>
            run('refine', async () => {
              await flush();
              setProposal(await api.refineCharacter(screenplayId, c.id, notes));
            })
          }
        >
          {busy === 'refine' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Write it up
        </button>
      </div>
      {proposal && (
        <div className="sp-proposal">
          <p>{proposal}</p>
          <div>
            <button className="btn btn-primary btn-sm" onClick={() => { set({ appearance: proposal }, 'appearance'); setProposal(null); setNotes(''); }}>
              <Check size={14} /> Use this
            </button>
            <button className="btn btn-sm" onClick={() => setProposal(null)}>Discard</button>
          </div>
        </div>
      )}

      <Field label="Wardrobe" hint="Default costume in shots. Describe a change in the action when it differs.">
        <textarea rows={2} value={c.wardrobe ?? ''} onChange={(e) => set({ wardrobe: e.target.value }, 'wardrobe')} />
      </Field>
      <div className="sp-grid2">
        <Field label="Personality">
          <textarea rows={3} value={c.personality ?? ''} onChange={(e) => set({ personality: e.target.value }, 'personality')} />
        </Field>
        <Field label="Voice">
          <textarea rows={3} value={c.voice ?? ''} onChange={(e) => set({ voice: e.target.value }, 'voice')} placeholder="Accent, rhythm, verbal tics" />
        </Field>
      </div>
      <Field label="Backstory">
        <textarea rows={4} value={c.backstory ?? ''} onChange={(e) => set({ backstory: e.target.value }, 'backstory')} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} value={c.notes ?? ''} onChange={(e) => set({ notes: e.target.value }, 'notes')} />
      </Field>

      <h3 className="sp-h3">Reference photos</h3>
      <div className="sp-views">
        {VIEWS.map((v) => (
          <label key={v.value} className="toggle">
            <input type="checkbox" checked={views.includes(v.value)} onChange={(e) => setViews(e.target.checked ? [...views, v.value] : views.filter((x) => x !== v.value))} />
            <span>{v.label}</span>
          </label>
        ))}
        <button
          className="btn btn-primary btn-sm"
          disabled={!!busy || !views.length}
          onClick={() =>
            run('refs', async () => {
              await flush();
              setDetail(await api.characterRefs(screenplayId, c.id, views));
            })
          }
        >
          {busy === 'refs' ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />} Generate
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="sp-photos">
        {photos.length === 0 && <p className="field-hint">No photos yet. Describe the character, pick views and generate.</p>}
        {[...photos].reverse().map((m) => (
          <figure key={m.id} className={`sp-photo ${c.primaryRefId === m.id ? 'primary' : ''}`}>
            {m.status === 'ready' && m.media_id ? (
              <SpImage mediaId={m.media_id} alt={m.label ?? ''} />
            ) : m.status === 'pending' ? (
              <div className="sp-img-loading"><Loader2 size={16} className="spin" /></div>
            ) : (
              <div className="sp-img-missing"><AlertTriangle size={14} /> {m.error || 'Failed'}</div>
            )}
            <figcaption>
              <span>{VIEWS.find((v) => v.value === m.label)?.label ?? m.label}</span>
              {m.status === 'ready' && (
                <button className="icon-btn" title="Main photo" onClick={() => set({ primaryRefId: m.id }, 'primary')}>
                  <Star size={13} fill={c.primaryRefId === m.id ? 'currentColor' : 'none'} />
                </button>
              )}
              <button
                className="icon-btn"
                title="Remove"
                onClick={() => run('del', async () => setDetail(await api.deleteMediaRow(screenplayId, m.id)))}
              >
                <Trash2 size={13} />
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
