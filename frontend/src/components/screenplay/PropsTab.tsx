// Props: objects that appear in more than one frame, each with reference
// photos (uploaded, found in the free libraries, or drawn with AI). When the
// AI recreates a frame, a prop's main photo keeps it looking the same.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ImagePlus, Loader2, Package, Plus, Search, Sparkles, Star, Trash2 } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { Detail, Prop, ScreenplayDoc, ShotFind } from '../../api/screenplays';
import { EmptyState, Field } from '../ui';
import { newId, propsByShot } from './format';
import { SpImage } from './media';
import { Tile, msg } from './ShotFinder';
import { SearchWords } from './SearchWords';

interface Props {
  screenplayId: number;
  doc: ScreenplayDoc;
  detail?: Detail;
  update: (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string) => void;
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
}

export function PropsTab({ screenplayId, doc, detail, update, flush, setDetail }: Props) {
  const props = doc.props ?? [];
  const [selected, setSelected] = useState<string | null>(props[0]?.id ?? null);
  const p = props.find((x) => x.id === selected) ?? null;
  const photosFor = (pid: string) => (detail?.media.other ?? []).filter((m) => m.role === 'prop' && m.target === pid);
  const inShots = useMemo(() => {
    const by = propsByShot(doc);
    const out = new Map<string, number[]>();
    doc.shots.forEach((s, i) => {
      for (const x of by.get(s.id) ?? []) out.set(x.id, [...(out.get(x.id) ?? []), i + 1]);
    });
    return out;
  }, [doc]);

  const add = () => {
    const np: Prop = { id: newId('pr'), name: '' };
    update((d) => ({ ...d, props: [...(d.props ?? []), np] }));
    setSelected(np.id);
  };

  return (
    <div className="sp-chars">
      <aside className="sp-chars-list">
        <div className="sp-chars-actions">
          <button className="btn btn-primary btn-sm" onClick={add}>
            <Plus size={14} /> New prop
          </button>
        </div>
        {props.map((x) => {
          const main = x.primaryRefId ? photosFor(x.id).find((m) => m.id === x.primaryRefId) : photosFor(x.id).find((m) => m.status === 'ready');
          const shots = inShots.get(x.id) ?? [];
          return (
            <button key={x.id} className={`sp-char-item ${x.id === selected ? 'on' : ''}`} onClick={() => setSelected(x.id)}>
              <span className="sp-char-thumb">{main?.media_id ? <SpImage mediaId={main.media_id} /> : <Package size={16} />}</span>
              <span>
                <strong>{x.name || 'Unnamed prop'}</strong>
                <small>{shots.length ? `In shot${shots.length > 1 ? 's' : ''} ${shots.join(', ')}` : 'Not in any shot yet'}</small>
              </span>
            </button>
          );
        })}
      </aside>
      <section className="sp-char-main">
        {!p ? (
          <EmptyState title="No props yet">
            Add the objects that matter in more than one shot (a weapon, a phone, a car). Give each a photo, and when the AI recreates a frame it
            puts that exact prop in.
          </EmptyState>
        ) : (
          <PropForm
            key={p.id}
            screenplayId={screenplayId}
            prop={p}
            shots={inShots.get(p.id) ?? []}
            photos={photosFor(p.id)}
            update={update}
            flush={flush}
            setDetail={setDetail}
            onDelete={() => {
              if (!window.confirm(`Delete ${p.name || 'this prop'}?`)) return;
              update((d) => ({ ...d, props: (d.props ?? []).filter((x) => x.id !== p.id) }));
              setSelected(null);
            }}
          />
        )}
      </section>
    </div>
  );
}

function PropForm({
  screenplayId,
  prop: p,
  shots,
  photos,
  update,
  flush,
  setDetail,
  onDelete,
}: {
  screenplayId: number;
  prop: Prop;
  shots: number[];
  photos: api.ScreenplayMedia[];
  update: Props['update'];
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<Prop>, field: string) =>
    update((d) => ({ ...d, props: (d.props ?? []).map((x) => (x.id === p.id ? { ...x, ...patch } : x)) }), `prop:${p.id}:${field}`);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };
  const main = p.primaryRefId ?? photos.find((m) => m.status === 'ready')?.id;

  return (
    <div className="sp-char-form">
      <div className="sp-char-top">
        <input className="sp-char-name" value={p.name} onChange={(e) => set({ name: e.target.value }, 'name')} placeholder="Name, as the script calls it" aria-label="Name" autoFocus={!p.name} />
        <button className="btn btn-danger btn-sm" onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
      <p className="field-hint">{shots.length ? `Mentioned in shot ${shots.join(', ')}.` : 'Not mentioned in any shot yet: the script must use its name or one of the other names below.'}</p>
      <Field label="Also called" hint="Other words the script uses for it, separated by commas, e.g. “the blade, cleaver”.">
        <input value={p.aliases ?? ''} onChange={(e) => set({ aliases: e.target.value }, 'aliases')} />
      </Field>
      <Field label="What it looks like" hint="Used when the AI puts it into a frame, and to search for photos.">
        <textarea rows={3} value={p.description ?? ''} onChange={(e) => set({ description: e.target.value }, 'description')} placeholder="e.g. a battered red rotary phone with a coiled cord" />
      </Field>

      <h3 className="sp-h3">Photos</h3>
      <div className="sp-views">
        <button className="btn btn-primary btn-sm" disabled={!p.name.trim()} onClick={() => setSearching(true)}>
          <Search size={14} /> Find photos
        </button>
        <button className="btn btn-sm" disabled={!!busy} onClick={() => input.current?.click()}>
          {busy === 'upload' ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />} Upload
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void run('upload', async () => {
              await flush();
              setDetail(await api.uploadPropImage(screenplayId, p.id, f));
            });
          }}
        />
        <button
          className="btn btn-sm"
          disabled={!!busy || !p.name.trim()}
          title="Draw a clean reference photo from the description"
          onClick={() => void run('draw', async () => {
            await flush();
            setDetail(await api.drawProp(screenplayId, p.id));
          })}
        >
          {busy === 'draw' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Draw with AI
        </button>
      </div>
      {error && <div className="sp-shot-warn"><AlertTriangle size={12} /> {error}</div>}
      {searching && <PropSearch screenplayId={screenplayId} prop={p} photos={photos} flush={flush} setDetail={setDetail} onClose={() => setSearching(false)} />}
      <div className="sp-photos">
        {photos.length === 0 && <p className="field-hint">No photos yet. Find one, upload your own, or draw one with AI. The starred photo is the one the AI uses.</p>}
        {[...photos].reverse().map((m) => {
          const found = api.foundMeta(m);
          return (
            <figure key={m.id} className={`sp-photo ${main === m.id ? 'primary' : ''}`} title={found ? `${found.title} · ${found.sourceName} · ${found.license.name}` : (m.label ?? '')}>
              {m.status === 'ready' && m.media_id ? (
                <SpImage mediaId={m.media_id} alt={m.label ?? ''} />
              ) : m.status === 'pending' ? (
                <div className="sp-img-loading"><Loader2 size={16} className="spin" /></div>
              ) : (
                <div className="sp-img-missing"><AlertTriangle size={14} /> {m.error || 'Failed'}</div>
              )}
              <figcaption>
                <span>{found ? found.sourceName : m.label === 'Drawn with AI' ? 'Drawn with AI' : 'Uploaded'}</span>
                {m.status === 'ready' && (
                  <button className="icon-btn" title="Main photo: the one the AI uses" onClick={() => set({ primaryRefId: m.id }, 'primary')}>
                    <Star size={13} fill={main === m.id ? 'currentColor' : 'none'} />
                  </button>
                )}
                <button
                  className="icon-btn"
                  title="Remove"
                  onClick={() => void run('del', async () => {
                    if (p.primaryRefId === m.id) set({ primaryRefId: undefined }, 'primary');
                    setDetail(await api.deleteMediaRow(screenplayId, m.id));
                  })}
                >
                  <Trash2 size={13} />
                </button>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

/** Photos of the prop from the free libraries; keep as many as you like. */
function PropSearch({
  screenplayId,
  prop,
  photos,
  flush,
  setDetail,
  onClose,
}: {
  screenplayId: number;
  prop: Prop;
  photos: api.ScreenplayMedia[];
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
  onClose: () => void;
}) {
  const [find, setFind] = useState<ShotFind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keeping, setKeeping] = useState<string | null>(null);
  const started = useRef(false);
  const running = !!find && ['queued', 'planning', 'searching'].includes(find.status);
  const kept = new Set(photos.map((m) => api.foundMeta(m)?.key).filter(Boolean));

  const [words, setWords] = useState<string[]>([]);
  const planned = find?.plan.queries.join('\n') ?? '';
  useEffect(() => {
    setWords(planned ? planned.split('\n') : []);
  }, [find?.id, planned]);
  const edited = !!find && words.join('\n') !== planned;

  const search = async (own?: string[]) => {
    setError(null);
    try {
      await flush();
      setFind(await api.startPropFind(screenplayId, prop.id, own));
    } catch (e) {
      setError(msg(e));
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const last = await api.latestPropFind(screenplayId, prop.id);
        // A new search when the name or description changed since the last one.
        if (last && last.plan.look === (prop.description?.trim() || prop.name)) setFind(last);
        else await search();
      } catch (e) {
        setError(msg(e));
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!find || !running) return;
    const t = setTimeout(() => void api.getFind(screenplayId, find.id).then(setFind).catch((e) => setError(msg(e))), 1200);
    return () => clearTimeout(t);
  }, [find, running, screenplayId]);

  const keep = async (key: string) => {
    if (!find) return;
    setKeeping(key);
    setError(null);
    try {
      setDetail(await api.keepFound(screenplayId, find.id, key));
    } catch (e) {
      setError(msg(e));
    } finally {
      setKeeping(null);
    }
  };

  return (
    <div className="sp-prop-search">
      <div className="sp-prop-search-head">
        <span className="sp-adj-head">Searching for</span>
        <SearchWords words={words} onChange={setWords} disabled={running} />
        <span className="sp-grow" />
        <button className={`btn btn-sm ${edited ? 'btn-primary' : ''}`} onClick={() => void (edited ? search(words) : search())} disabled={running || (edited && !words.length)}>
          {edited ? 'Search these words' : 'Search again'}
        </button>
        <button className="btn btn-sm" onClick={onClose}>Done</button>
      </div>
      {error && <div className="sp-shot-warn"><AlertTriangle size={12} /> {error}</div>}
      {find?.status === 'failed' && <div className="sp-shot-warn"><AlertTriangle size={12} /> {find.error}</div>}
      {!find?.candidates.length ? (
        <div className="sp-find-empty small">{running || !find ? <><Loader2 size={16} className="spin" /> {find?.progress || 'Starting…'}</> : find.progress || 'No photos found.'}</div>
      ) : (
        <>
          <p className="field-hint">Click a photo to keep it. Keep as many as you like, then star the best one.</p>
          <div className="sp-find-grid">
            {find.candidates.map((c) => (
              <div key={c.key} className="sp-prop-tile">
                <Tile c={c} selected={kept.has(c.key)} isFrame={false} onSelect={() => !kept.has(c.key) && void keep(c.key)} />
                {keeping === c.key && <span className="sp-prop-keeping"><Loader2 size={14} className="spin" /></span>}
                {kept.has(c.key) && <span className="sp-prop-kept"><Check size={11} /> Kept</span>}
              </div>
            ))}
          </div>
          <div className="sp-prop-search-foot">
            <span className="field-hint">{running ? find.progress : find.progress}</span>
            <button className="btn btn-sm" disabled={running} onClick={() => void api.findMore(screenplayId, find.id).then(setFind).catch((e) => setError(msg(e)))}>
              {running ? <Loader2 size={13} className="spin" /> : <Search size={13} />} Find more
            </button>
          </div>
        </>
      )}
    </div>
  );
}
