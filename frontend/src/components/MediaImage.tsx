import { useEffect, useState } from 'react';
import { fetchMediaBlobUrl } from '../api/media';
import { Image } from 'lucide-react';

interface MediaImageProps {
  mediaId: number;
  alt?: string;
}

export function MediaImage({ mediaId, alt = 'Generated image' }: MediaImageProps) {
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
        <Image size={14} /> Media #{mediaId} unavailable
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
        <Image size={14} /> Loading...
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      style={{
        maxWidth: '100%',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--color-border)',
        display: 'block',
        margin: '8px 0',
      }}
    />
  );
}
