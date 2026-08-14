import { useEffect, useState } from 'react';
import { fetchMediaBlobUrl } from '../api/media';
import { Music } from 'lucide-react';

interface MediaAudioProps {
  mediaId: number;
}

export function MediaAudio({ mediaId }: MediaAudioProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let blobUrl: string | null = null;
    fetchMediaBlobUrl(mediaId)
      .then((url) => { blobUrl = url; setSrc(url); })
      .catch(() => setError(true));
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [mediaId]);

  if (error) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--color-text-dim)' }}>
        <Music size={14} /> Audio #{mediaId} unavailable
      </div>
    );
  }

  if (!src) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--color-text-dim)' }}>
        <Music size={14} /> Loading...
      </div>
    );
  }

  return (
    <audio controls src={src} style={{ width: '100%', display: 'block', margin: '8px 0' }} />
  );
}
