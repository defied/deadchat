import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { listMedia, type MediaItem } from '../../api/media';
import { uploadStartImage } from '../../api/generate';
import { MediaImage } from '../MediaImage';
import { Alert, EmptyState, Loading, Modal, errorMessage } from '../ui';

/** Pick a start frame from your images or upload one. */
export function StartImagePicker({ onPick, onClose }: { onPick: (mediaId: number) => void; onClose: () => void }) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listMedia({ type: 'image', limit: 60 })
      .then(setItems)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const upload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const m = await uploadStartImage(file);
      onPick(m.id);
    } catch (e) {
      setError(errorMessage(e, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      title="Choose a start image"
      onClose={onClose}
      busy={uploading}
      footer={
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload an image'}
          </button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {!items ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState title="No images yet">Generate an image first, or upload one.</EmptyState>
      ) : (
        <div className="thumb-grid">
          {items.map((m) => (
            <button key={m.id} onClick={() => onPick(m.id)} title={m.prompt ?? ''}>
              <MediaImage mediaId={m.id} onClick={() => onPick(m.id)} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
