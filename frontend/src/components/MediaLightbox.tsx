import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Maximize2, Minimize2, Film, Image, Loader } from 'lucide-react';
import { fetchMediaBlobUrl } from '../api/media';
import type { MediaItem } from '../api/media';

interface Props {
  item: MediaItem;
  onClose: () => void;
}

export function MediaLightbox({ item, onClose }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let blobUrl: string | null = null;
    setSrc(null);
    setError(false);
    fetchMediaBlobUrl(item.id)
      .then((url) => { blobUrl = url; setSrc(url); })
      .catch(() => setError(true));
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }, []);

  const sizeLabel = item.width && item.height ? `${item.width}×${item.height}` : null;
  const durationLabel = item.duration_s ? `${item.duration_s.toFixed(1)}s` : null;
  const TypeIcon = item.type === 'video' ? Film : Image;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', flexDirection: 'column',
          maxWidth: '92vw', maxHeight: '92vh',
          width: 'max-content',
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-lg, 10px)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          flexShrink: 0,
        }}>
          <TypeIcon size={13} style={{ color: 'var(--color-text-dim)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.filename}
            {sizeLabel && <span style={{ color: 'var(--color-text-secondary)', marginLeft: 8 }}>{sizeLabel}</span>}
            {durationLabel && <span style={{ color: 'var(--color-text-secondary)', marginLeft: 8 }}>{durationLabel}</span>}
          </span>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            style={iconBtnStyle}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button onClick={onClose} title="Close (Esc)" style={iconBtnStyle}>
            <X size={14} />
          </button>
        </div>

        {/* Media */}
        <div style={{
          flex: 1, minHeight: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0e0e14',
          overflow: 'auto',
        }}>
          {!src && !error && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--color-text-dim)', padding: 48 }}>
              <Loader size={22} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13 }}>Loading…</span>
            </div>
          )}
          {error && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--color-text-dim)', padding: 48 }}>
              <TypeIcon size={28} />
              <span style={{ fontSize: 13 }}>Media unavailable</span>
            </div>
          )}
          {src && item.type === 'image' && (
            <img
              src={src}
              alt={item.prompt ?? ''}
              style={{ maxWidth: '88vw', maxHeight: '78vh', objectFit: 'contain', display: 'block' }}
            />
          )}
          {src && item.type === 'video' && (
            <video
              src={src}
              controls
              loop
              playsInline
              autoPlay
              style={{ maxWidth: '88vw', maxHeight: '78vh', display: 'block' }}
            />
          )}
        </div>

        {/* Metadata footer */}
        {(item.prompt || item.created_at) && (
          <div style={{
            padding: '8px 14px', flexShrink: 0,
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            maxWidth: '92vw',
          }}>
            {item.prompt && (
              <div style={{
                fontSize: 12, color: 'var(--color-text-secondary)',
                lineHeight: 1.5, maxHeight: 56, overflow: 'hidden',
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
              }}>
                {item.prompt}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 3 }}>
              {new Date(item.created_at).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, flexShrink: 0,
  border: 'none', cursor: 'pointer',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  borderRadius: 'var(--radius)',
};
