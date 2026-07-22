import { useEffect, useState } from 'react';
import { fetchMediaBlobUrl } from '../api/media';
import { Film } from 'lucide-react';

interface MediaVideoProps {
  mediaId: number;
  className?: string;
}

export function MediaVideo({ mediaId, className }: MediaVideoProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let blobUrl: string | null = null;
    fetchMediaBlobUrl(mediaId)
      .then((url) => {
        blobUrl = url;
        setSrc(url);
      })
      .catch(() => setError(true));

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [mediaId]);

  if (error) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          background: 'var(--color-surface-hover)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          fontSize: 12,
          color: 'var(--color-text-dim)',
        }}
      >
        <Film size={14} /> Media #{mediaId} unavailable
      </div>
    );
  }

  if (!src) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          background: 'var(--color-surface-hover)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          fontSize: 12,
          color: 'var(--color-text-dim)',
        }}
      >
        <Film size={14} /> Loading...
      </div>
    );
  }

  return (
    <video
      src={src}
      controls
      loop
      playsInline
      className={className}
      style={{
        maxWidth: '100%',
        width: className ? '100%' : undefined,
        height: className ? '100%' : undefined,
        objectFit: className ? 'cover' : undefined,
        borderRadius: 'var(--radius)',
        border: '1px solid var(--color-border)',
        display: 'block',
        margin: className ? 0 : '8px 0',
      }}
    />
  );
}
