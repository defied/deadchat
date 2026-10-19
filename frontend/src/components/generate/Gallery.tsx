import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clapperboard, Maximize2, Trash2, Upload } from 'lucide-react';
import { deleteMedia, listMedia, type MediaItem } from '../../api/media';
import { parseMeta, uploadMedia } from '../../api/generate';
import { MediaImage } from '../MediaImage';
import { MediaVideo } from '../MediaVideo';
import { MediaLightbox } from '../MediaLightbox';
import { Alert, EmptyState, Loading, errorMessage } from '../ui';

type Filter = 'all' | 'image' | 'video';

export function Gallery() {
  const navigate = useNavigate();
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listMedia({ limit: 120, ...(filter === 'all' ? {} : { type: filter }) }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [filter]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  const remove = async (m: MediaItem) => {
    if (!window.confirm('Delete this file? This cannot be undone.')) return;
    try {
      await deleteMedia(m.id);
      setItems((cur) => cur?.filter((x) => x.id !== m.id) ?? null);
    } catch (e) {
      setError(errorMessage(e, 'Delete failed'));
    }
  };

  const visible = (items ?? []).filter((m) => m.type !== 'audio');

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="seg">
        {(['all', 'image', 'video'] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'image' ? 'Images' : 'Videos'}
          </button>
        ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setUploading(true);
            try {
              await uploadMedia(f);
              await load();
            } catch (err) {
              setError(errorMessage(err, 'Upload failed'));
            } finally {
              setUploading(false);
            }
          }}
        />
        <button className="btn btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload image or video'}
        </button>
      </div>
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {!items ? (
        <Loading />
      ) : visible.length === 0 ? (
        <EmptyState title="Your gallery is empty">Everything you generate is saved here.</EmptyState>
      ) : (
        <div className="gallery-grid">
          {visible.map((m) => {
            const meta = parseMeta(m.meta);
            return (
              <div key={m.id} className="gallery-item" title={m.prompt ?? ''}>
                {m.type === 'video' ? <MediaVideo mediaId={m.id} onClick={() => setOpen(m)} /> : <MediaImage mediaId={m.id} onClick={() => setOpen(m)} />}
                <div className="overlay">
                  {meta.modelLabel && <span className="badge" style={{ marginRight: 'auto' }}>{meta.modelLabel}</span>}
                  {m.type === 'image' && (
                    <button className="icon-btn" title="Animate into a video" onClick={() => navigate('/generate/create', { state: { animate: m.id } })}>
                      <Clapperboard size={14} />
                    </button>
                  )}
                  <button className="icon-btn" title="Open" onClick={() => setOpen(m)}>
                    <Maximize2 size={14} />
                  </button>
                  <button className="icon-btn danger" title="Delete" onClick={() => remove(m)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && <MediaLightbox item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
