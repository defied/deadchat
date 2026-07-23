import { useEffect, useRef, useState } from 'react';
import { fetchMediaBlobUrl } from '../api/media';
import { Film, Play } from 'lucide-react';

interface MediaVideoProps {
  mediaId: number;
  /** When provided, renders as a clickable thumbnail (no controls, play overlay) */
  onClick?: () => void;
  /** Max height for constrained player display */
  maxHeight?: number;
}

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

export function MediaVideo({ mediaId, onClick, maxHeight }: MediaVideoProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isThumbnail = !!onClick;

  useEffect(() => {
    let blobUrl: string | null = null;
    fetchMediaBlobUrl(mediaId)
      .then((url) => { blobUrl = url; setSrc(url); })
      .catch(() => setError(true));
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [mediaId]);

  if (error) {
    return isThumbnail ? (
      <div style={fillPlaceholder}><Film size={20} /><span>Unavailable</span></div>
    ) : (
      <div style={inlinePlaceholder}><Film size={14} /> Media #{mediaId} unavailable</div>
    );
  }

  if (!src) {
    return isThumbnail ? (
      <div style={fillPlaceholder}><Film size={20} /><span>Loading…</span></div>
    ) : (
      <div style={inlinePlaceholder}><Film size={14} /> Loading...</div>
    );
  }

  if (isThumbnail) {
    return (
      <div
        onClick={onClick}
        style={{ position: 'relative', width: '100%', height: '100%', cursor: 'pointer', overflow: 'hidden' }}
      >
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
        />
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.25)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Play size={16} fill="#fff" color="#fff" style={{ marginLeft: 2 }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <video
      src={src}
      controls
      loop
      playsInline
      style={{
        maxWidth: '100%',
        maxHeight: maxHeight ?? undefined,
        width: '100%',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--color-border)',
        display: 'block',
        margin: '8px 0',
      }}
    />
  );
}
