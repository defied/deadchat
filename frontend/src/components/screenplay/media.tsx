// Authenticated media for the screenplay views: images and a play/pause
// button for music cues. Blob URLs are cached per media id for the session,
// so polling and re-renders don't refetch files.

import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { fetchMediaBlobUrl } from '../../api/media';

const cache = new Map<number, Promise<string>>();

function blobUrl(id: number): Promise<string> {
  let p = cache.get(id);
  if (!p) {
    p = fetchMediaBlobUrl(id);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export function useBlobUrl(id: number | null | undefined): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    if (!id) {
      setState({ url: null, failed: false });
      return;
    }
    let live = true;
    blobUrl(id)
      .then((url) => live && setState({ url, failed: false }))
      .catch(() => live && setState({ url: null, failed: true }));
    return () => {
      live = false;
    };
  }, [id]);
  return state;
}

export function SpImage({ mediaId, alt = '', className }: { mediaId: number; alt?: string; className?: string }) {
  const { url, failed } = useBlobUrl(mediaId);
  if (failed) return <div className={`sp-img-missing ${className ?? ''}`}>Unavailable</div>;
  if (!url) return <div className={`sp-img-loading ${className ?? ''}`}><Loader2 size={16} className="spin" /></div>;
  return <img src={url} alt={alt} className={className} draggable={false} />;
}

/** Only one cue plays at a time. */
let playing: HTMLAudioElement | null = null;

export function MusicButton({ mediaId, label = 'Play music cue' }: { mediaId: number; label?: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = async () => {
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    setState('loading');
    try {
      if (!audio.current) {
        const a = new Audio(await blobUrl(mediaId));
        a.onended = () => setState('idle');
        a.onpause = () => setState('idle');
        audio.current = a;
      }
      if (playing && playing !== audio.current) playing.pause();
      playing = audio.current;
      audio.current.currentTime = 0;
      await audio.current.play();
      setState('playing');
    } catch {
      setState('idle');
    }
  };
  return (
    <button className={`sp-play ${state === 'playing' ? 'on' : ''}`} onClick={toggle} title={state === 'playing' ? 'Stop' : label} aria-label={label}>
      {state === 'loading' ? <Loader2 size={14} className="spin" /> : state === 'playing' ? <Pause size={14} /> : <Play size={14} />}
    </button>
  );
}
