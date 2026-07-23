import { useEffect, useState } from 'react';
import { fetchMediaBlobUrl } from '../api/media';
import { Image } from 'lucide-react';

interface MediaImageProps {
  mediaId: number;
  alt?: string;
  /** When provided, image becomes a clickable thumbnail */
  onClick?: () => void;
  /** Max height for constrained display (e.g. job card results) */
  maxHeight?: number;
}

const inlinePlaceholder: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  background: 'var(--color-surface-hover)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  fontSize: 12,
  color: 'var(--color-text-dim)',
};

const fillPlaceholder: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  height: '100%',
  fontSize: 12,
  color: 'var(--color-text-dim)',
};

export function MediaImage({ mediaId, alt = 'Generated image', onClick, maxHeight }: MediaImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const fill = !!onClick;

  useEffect(() => {
    let blobUrl: string | null = null;
    fetchMediaBlobUrl(mediaId)
      .then((url) => { blobUrl = url; setSrc(url); })
      .catch(() => setError(true));
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [mediaId]);

  if (error) {
    return fill ? (
      <div style={fillPlaceholder}><Image size={20} /><span>Unavailable</span></div>
    ) : (
      <div style={inlinePlaceholder}><Image size={14} /> Media #{mediaId} unavailable</div>
    );
  }

  if (!src) {
    return fill ? (
      <div style={fillPlaceholder}><Image size={20} /><span>Loading…</span></div>
    ) : (
      <div style={inlinePlaceholder}><Image size={14} /> Loading...</div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onClick={onClick}
      style={{
        maxWidth: '100%',
        maxHeight: maxHeight ?? undefined,
        width: fill ? '100%' : undefined,
        height: fill ? '100%' : undefined,
        objectFit: fill ? 'cover' : undefined,
        borderRadius: fill ? 0 : 'var(--radius)',
        border: fill ? 'none' : '1px solid var(--color-border)',
        display: 'block',
        margin: fill ? 0 : '8px 0',
        cursor: onClick ? 'pointer' : undefined,
      }}
    />
  );
}
