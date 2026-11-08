// Evidence: drop in files or whole folders (a DICOM study export, a set of
// photos), then title, date, categorise, annotate and order them.

import { useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Bot, CheckCircle2, Eye, EyeOff, FolderUp, Loader2, Maximize2, Trash2, Upload } from 'lucide-react';
import * as api from '../../api/cases';
import { CATEGORIES, type CaseDetail, type CaseItem, type Category } from '../../api/cases';
import { Alert, EmptyState, errorMessage } from '../ui';
import { DownloadButton, Thumb, kindLabel } from './Viewer';
import { forget } from './blobs';

interface Props {
  detail: CaseDetail;
  setDetail: (fn: (d: CaseDetail) => CaseDetail) => void;
  refetch: () => void;
  onOpen: (itemId: number) => void;
}

interface Queued {
  key: string;
  name: string;
  progress: number;
  state: 'waiting' | 'uploading' | 'done' | 'failed';
  error?: string;
}

/** Every file in a drop, walking into folders. */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...dt.files];
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

const SKIP = /^(\.|thumbs\.db$|desktop\.ini$|dicomdir$)/i;

/** Grab a poster frame from a video in the browser (the server has no video decoder). */
async function posterOf(file: File): Promise<{ blob: Blob; duration: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('unplayable'));
      setTimeout(() => rej(new Error('timeout')), 15000);
    });
    v.currentTime = Math.min(1, (v.duration || 0) / 3);
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      setTimeout(res, 3000);
    });
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85));
    return blob ? { blob, duration: v.duration } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Evidence({ detail, setDetail, refetch, onOpen }: Props) {
  const caseId = detail.case.id;
  const [queue, setQueue] = useState<Queued[]>([]);
  const [category, setCategory] = useState<'' | Category>('');
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const dirInput = useRef<HTMLInputElement | null>(null);
  const items = detail.items;

  const patchQueue = (key: string, p: Partial<Queued>) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const uploadAll = async (files: File[]) => {
    const list = files.filter((f) => !SKIP.test(f.name) && f.size > 0);
    if (!list.length) return;
    const jobs = list.map((f, i) => ({ file: f, key: `${Date.now()}-${i}-${f.name}` }));
    setQueue((q) => [...q.filter((x) => x.state !== 'done'), ...jobs.map((j) => ({ key: j.key, name: j.file.webkitRelativePath || j.file.name, progress: 0, state: 'waiting' as const }))]);
    let next = 0;
    // Slices of one series must land in order of arrival only; the server sorts them.
    const worker = async () => {
      while (next < jobs.length) {
        const { file, key } = jobs[next++];
        patchQueue(key, { state: 'uploading' });
        try {
          const item = await api.uploadItem(caseId, file, category, (p) => patchQueue(key, { progress: p }));
          if (file.type.startsWith('video/') || /\.(mp4|m4v|webm|mov|ogv)$/i.test(file.name)) {
            const poster = await posterOf(file);
            if (poster) {
              await api.uploadThumb(caseId, item.id, poster.blob, poster.duration).catch(() => undefined);
              forget(api.itemUrl(caseId, item.id, ''));
            }
          }
          patchQueue(key, { state: 'done', progress: 1 });
        } catch (e) {
          patchQueue(key, { state: 'failed', error: errorMessage(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
    refetch();
  };

  const save = async (item: CaseItem, patch: Parameters<typeof api.updateItem>[2]) => {
    setDetail((d) => ({ ...d, items: d.items.map((x) => (x.id === item.id ? { ...x, ...patch } as CaseItem : x)) }));
    try {
      const updated = await api.updateItem(caseId, item.id, patch);
      setDetail((d) => ({ ...d, items: d.items.map((x) => (x.id === item.id ? updated : x)) }));
    } catch (e) {
      setError(errorMessage(e));
      refetch();
    }
  };

  const move = async (index: number, d: -1 | 1) => {
    const ids = items.map((i) => i.id);
    const j = index + d;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setDetail((x) => ({ ...x, items: ids.map((id) => x.items.find((i) => i.id === id)!) }));
    try {
      const fresh = await api.reorderItems(caseId, ids);
      setDetail(() => fresh);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const active = queue.filter((q) => q.state === 'uploading' || q.state === 'waiting').length;
  const failed = queue.filter((q) => q.state === 'failed');

  return (
    <div className="cs-evidence">
      <div
        className={`cs-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setOver(false);
          void uploadAll(await filesFromDrop(e.dataTransfer));
        }}
      >
        <Upload size={24} />
        <div className="cs-drop-text">
          <strong>Drop files or folders</strong>
          <span className="field-hint">
            DICOM (single images, cine loops, CT/MRI series, PDF reports), photos, videos, PDFs, text and CSV lab exports.
            Patient names and IDs in DICOM headers aren’t kept; text burned into images is, so cover it with the band
            control below.
          </span>
          <div className="cs-drop-actions">
            <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>
              <Upload size={13} /> Choose files
            </button>
            <button className="btn btn-sm" onClick={() => dirInput.current?.click()}>
              <FolderUp size={13} /> Choose a folder
            </button>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category | '')} aria-label="Category for new uploads">
              <option value="">Category: detect</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && uploadAll([...e.target.files])} />
        <input
          ref={(n) => {
            dirInput.current = n;
            n?.setAttribute('webkitdirectory', '');
          }}
          type="file"
          multiple
          hidden
          onChange={(e) => e.target.files && uploadAll([...e.target.files])}
        />
      </div>

      {queue.length > 0 && (
        <div className="cs-queue">
          <div className="cs-queue-head">
            {active ? <><Loader2 size={13} className="spin" /> Uploading {active} file{active === 1 ? '' : 's'}…</> : <><CheckCircle2 size={13} /> Uploads finished</>}
            {!active && <button className="btn btn-sm btn-ghost" onClick={() => setQueue([])}>Clear</button>}
          </div>
          {queue.filter((q) => q.state !== 'done').slice(0, 8).map((q) => (
            <div key={q.key} className={`cs-queue-row ${q.state}`}>
              <span className="cs-queue-name">{q.name}</span>
              {q.state === 'failed' ? <span className="cs-err">{q.error}</span> : <progress max={1} value={q.progress} />}
            </div>
          ))}
          {failed.length > 0 && <p className="field-hint">{failed.length} failed. Files over 256 MB are refused by the server.</p>}
        </div>
      )}
      {error && <Alert>{error}</Alert>}

      {items.length === 0 ? (
        <EmptyState title="No evidence yet">Add imaging, cine loops, ECGs, labs, reports and photos. Everything stays on your server.</EmptyState>
      ) : (
        <div className="cs-items">
          {items.map((it, i) => (
            <ItemRow
              key={it.id}
              caseId={caseId}
              item={it}
              first={i === 0}
              last={i === items.length - 1}
              onSave={(p) => save(it, p)}
              onMove={(d) => move(i, d)}
              onOpen={() => onOpen(it.id)}
              onDescribe={async () => {
                try {
                  const u = await api.describeItem(caseId, it.id);
                  setDetail((d) => ({ ...d, items: d.items.map((x) => (x.id === it.id ? u : x)) }));
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
              onDelete={async () => {
                if (!window.confirm(`Remove “${it.title}” from this case?`)) return;
                await api.deleteItem(caseId, it.id);
                setDetail((d) => ({ ...d, items: d.items.filter((x) => x.id !== it.id) }));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemRow({
  caseId,
  item,
  first,
  last,
  onSave,
  onMove,
  onOpen,
  onDescribe,
  onDelete,
}: {
  caseId: number;
  item: CaseItem;
  first: boolean;
  last: boolean;
  onSave: (p: Parameters<typeof api.updateItem>[2]) => void;
  onMove: (d: -1 | 1) => void;
  onOpen: () => void;
  onDescribe: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [ai, setAi] = useState(item.aiNotes ?? '');
  const [mask, setMask] = useState(item.maskTop);
  const [seen, setSeen] = useState({ title: item.title, notes: item.notes, ai: item.aiNotes });
  if (seen.title !== item.title || seen.notes !== item.notes || seen.ai !== item.aiNotes) {
    setSeen({ title: item.title, notes: item.notes, ai: item.aiNotes });
    setTitle(item.title);
    setNotes(item.notes ?? '');
    setAi(item.aiNotes ?? '');
  }
  const visual = item.kind === 'image' || item.kind === 'video' || item.frames > 0;
  const d = item.dicom;
  const facts = [
    kindLabel(item),
    d?.modality && d.modality !== kindLabel(item) ? d.modality : '',
    item.fps && item.frames > 1 && !item.stack ? `${item.fps} fps` : '',
    d?.heartRate ? `HR ${d.heartRate}` : '',
    d?.patientAge ? `age ${d.patientAge.replace(/^0+/, '')}` : '',
    item.sizeBytes ? (item.sizeBytes < 1024 * 1024 ? `${Math.max(1, Math.round(item.sizeBytes / 1024))} KB` : `${(item.sizeBytes / 1024 / 1024).toFixed(item.sizeBytes > 10 * 1024 * 1024 ? 0 : 1)} MB`) : '',
  ].filter(Boolean);

  return (
    <div className={`cs-item ${item.include ? '' : 'excluded'}`}>
      <button className="cs-item-thumb" onClick={onOpen} title="Open">
        <Thumb caseId={caseId} item={item} />
        <Maximize2 size={13} className="cs-open-ico" />
      </button>
      <div className="cs-item-body">
        <div className="cs-item-row1">
          <input className="cs-item-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== item.title && onSave({ title })} aria-label="Title" />
          <select value={item.category} onChange={(e) => onSave({ category: e.target.value as Category })} aria-label="Category">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input type="date" value={item.takenAt ?? ''} onChange={(e) => onSave({ takenAt: e.target.value })} aria-label="Date" />
        </div>
        <div className="cs-item-facts">
          {facts.join(' · ')}
          {item.status === 'processing' && <span className="cs-proc"><Loader2 size={11} className="spin" /> processing</span>}
          {d?.burnedInAnnotation && !item.maskTop && (
            <span className="cs-warn"><AlertTriangle size={11} /> The file says text is burned into the image: cover it before presenting</span>
          )}
        </div>
        {item.error && <div className="cs-warn"><AlertTriangle size={11} /> {item.error}</div>}
        <textarea rows={2} value={notes} placeholder="Your notes: what this shows, why it matters" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (item.notes ?? '') && onSave({ notes })} />
        {(item.aiNotes || item.aiStatus) && (
          <div className="cs-ai">
            <span className="cs-ai-label"><Bot size={12} /> AI notes (draft; check before presenting)</span>
            {item.aiStatus === 'running' ? (
              <span className="cs-proc"><Loader2 size={12} className="spin" /> Writing…</span>
            ) : (
              <textarea rows={3} value={ai} onChange={(e) => setAi(e.target.value)} onBlur={() => ai !== (item.aiNotes ?? '') && onSave({ aiNotes: ai })} />
            )}
            {item.aiStatus === 'failed' && <span className="cs-warn"><AlertTriangle size={11} /> {item.aiError}</span>}
          </div>
        )}
        <div className="cs-item-actions">
          <button className="btn btn-sm" onClick={onDescribe} disabled={item.aiStatus === 'running' || item.status !== 'ready'} title="Describe this with the local vision model">
            <Bot size={13} /> {item.aiNotes ? 'Redo AI notes' : 'AI notes'}
          </button>
          <button className={`btn btn-sm ${item.include ? '' : 'btn-ghost'}`} onClick={() => onSave({ include: !item.include })} title="Show in the overview and presentation">
            {item.include ? <Eye size={13} /> : <EyeOff size={13} />} {item.include ? 'In presentation' : 'Hidden'}
          </button>
          {visual && (
            <label className="cs-mask-ctl" title="Cover burned-in text at the top of the image">
              Cover top
              <input
                type="range"
                min={0}
                max={0.3}
                step={0.01}
                value={mask}
                onChange={(e) => setMask(Number(e.target.value))}
                onPointerUp={() => mask !== item.maskTop && onSave({ maskTop: mask })}
                onKeyUp={() => mask !== item.maskTop && onSave({ maskTop: mask })}
              />
              <span>{Math.round(mask * 100)}%</span>
            </label>
          )}
          <span className="sp-grow" />
          {item.originals > 0 && <DownloadButton caseId={caseId} item={item} label="Original" />}
          <button className="icon-btn" onClick={() => onMove(-1)} disabled={first} title="Move up"><ArrowUp size={14} /></button>
          <button className="icon-btn" onClick={() => onMove(1)} disabled={last} title="Move down"><ArrowDown size={14} /></button>
          <button className="icon-btn" onClick={onDelete} title="Remove"><Trash2 size={14} /></button>
        </div>
      </div>
    </div>
  );
}
