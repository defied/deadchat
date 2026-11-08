// Reference images: upload photos that show the look you want for a shot, a
// scene or the whole screenplay. Each one is described (lighting, palette,
// framing, mood) and that description steers the matching frames.

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { Detail, ScreenplayDoc, ScreenplayMedia } from '../../api/screenplays';
import { Alert, EmptyState, errorMessage } from '../ui';
import { sceneNumbers } from './format';
import { SpImage } from './media';

interface Props {
  screenplayId: number;
  doc: ScreenplayDoc;
  detail?: Detail;
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
}

export function ReferencesTab({ screenplayId, doc, detail, flush, setDetail }: Props) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const refs = (detail?.media.other ?? []).filter((m) => m.role === 'reference');

  const targets = useMemo(() => {
    const scenes = sceneNumbers(doc.elements);
    const order = new Map(doc.elements.map((e, i) => [e.id, i]));
    const shots = [...doc.shots].sort((a, b) => (order.get(a.anchorId) ?? 0) - (order.get(b.anchorId) ?? 0));
    const sceneOf = (anchorId: string) => {
      for (let i = order.get(anchorId) ?? -1; i >= 0; i--) if (doc.elements[i].type === 'scene') return scenes.get(doc.elements[i].id);
      return undefined;
    };
    return [
      { value: '', label: 'Whole screenplay (overall look)' },
      ...doc.elements.filter((e) => e.type === 'scene').map((e) => ({ value: e.id, label: `Scene ${scenes.get(e.id)}: ${e.text || '(untitled)'}` })),
      ...shots.map((s, i) => ({ value: s.id, label: `Shot ${i + 1}${s.type ? ` · ${s.type}` : ''}${sceneOf(s.anchorId) ? ` (scene ${sceneOf(s.anchorId)})` : ''}` })),
    ];
  }, [doc.elements, doc.shots]);

  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    setError(null);
    try {
      await flush();
      for (const f of Array.from(files)) {
        if (!f.type.startsWith('image/')) continue;
        setDetail(await api.uploadReference(screenplayId, f, target));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp-refs">
      <div
        className={`sp-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <ImagePlus size={22} />
        <div>
          <strong>Drop photos here</strong> or{' '}
          <button className="btn btn-sm" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : null} choose files
          </button>
          <p className="field-hint">They show the look you want: lighting, colour, framing, mood. They’re described in words and folded into the matching frames.</p>
        </div>
        <label className="sp-drop-target">
          <span>Use for</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>
      {error && <Alert>{error}</Alert>}
      {refs.length === 0 ? (
        <EmptyState title="No reference images yet">Upload stills, paintings or photos to steer how shots look.</EmptyState>
      ) : (
        <div className="sp-ref-grid">
          {[...refs].reverse().map((m) => (
            <RefCard key={m.id} m={m} targets={targets} screenplayId={screenplayId} setDetail={setDetail} />
          ))}
        </div>
      )}
    </div>
  );
}

function RefCard({
  m,
  targets,
  screenplayId,
  setDetail,
}: {
  m: ScreenplayMedia;
  targets: Array<{ value: string; label: string }>;
  screenplayId: number;
  setDetail: (d: Detail) => void;
}) {
  const [caption, setCaption] = useState(m.caption ?? '');
  const [lastSeen, setLastSeen] = useState(m.caption);
  if (m.caption !== lastSeen) {
    setLastSeen(m.caption);
    setCaption(m.caption ?? '');
  }
  const save = async (patch: { target?: string; caption?: string }) => setDetail(await api.updateMedia(screenplayId, m.id, patch));
  const describing = !m.caption && !m.error;
  return (
    <figure className="sp-ref">
      {m.media_id && <SpImage mediaId={m.media_id} alt={m.label ?? 'Reference'} />}
      <figcaption>
        <select value={m.target} onChange={(e) => void save({ target: e.target.value })} aria-label="Use for">
          {!targets.some((t) => t.value === m.target) && <option value={m.target}>(deleted shot or scene)</option>}
          {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {describing ? (
          <p className="sp-ref-busy"><Loader2 size={12} className="spin" /> Describing the look…</p>
        ) : (
          <textarea
            rows={3}
            value={caption}
            placeholder="Describe the look to borrow"
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => caption !== (m.caption ?? '') && void save({ caption })}
          />
        )}
        {m.error && <p className="sp-shot-warn"><AlertTriangle size={12} /> {m.error}</p>}
        <button className="btn btn-sm btn-ghost" onClick={async () => setDetail(await api.deleteMediaRow(screenplayId, m.id))}>
          <Trash2 size={13} /> Remove
        </button>
      </figcaption>
    </figure>
  );
}
