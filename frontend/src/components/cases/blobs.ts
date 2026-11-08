// Authenticated file fetches for case evidence, cached as blob URLs for the
// session (frames of a cine loop are reused by the board, viewer and slides).

import { useEffect, useState } from 'react';
import client from '../../api/client';

const cache = new Map<string, Promise<string>>();

export function blobUrl(url: string): Promise<string> {
  let p = cache.get(url);
  if (!p) {
    p = client.get<Blob>(url, { responseType: 'blob', timeout: 0 }).then((r) => URL.createObjectURL(r.data));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** Forget cached files for an item (after it changes, e.g. a new thumbnail). */
export function forget(prefix: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

export function useBlob(url: string | null): { url: string | null; failed: boolean } {
  const [s, setS] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    if (!url) {
      setS({ url: null, failed: false });
      return;
    }
    let live = true;
    setS({ url: null, failed: false });
    blobUrl(url)
      .then((u) => live && setS({ url: u, failed: false }))
      .catch(() => live && setS({ url: null, failed: true }));
    return () => {
      live = false;
    };
  }, [url]);
  return s;
}

/**
 * Load every frame of a loop or stack, a few at a time, starting from
 * `first` so the visible frame arrives first. Returns images as they load.
 */
export function useFrames(base: string, count: number, first = 0): { images: Array<HTMLImageElement | undefined>; loaded: number } {
  const [images, setImages] = useState<Array<HTMLImageElement | undefined>>([]);
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    let live = true;
    const out: Array<HTMLImageElement | undefined> = new Array(count);
    setImages(out.slice());
    setLoaded(0);
    const order = Array.from({ length: count }, (_, i) => (first + i) % count);
    let next = 0;
    let done = 0;
    let flush: number | null = null;
    const publish = () => {
      flush = null;
      if (live) {
        setImages(out.slice());
        setLoaded(done);
      }
    };
    const worker = async () => {
      while (live && next < order.length) {
        const i = order[next++];
        try {
          const url = await blobUrl(`${base}/frames/${i}`);
          const img = new Image();
          img.src = url;
          await img.decode().catch(() => undefined);
          out[i] = img;
        } catch {
          /* leave the gap */
        }
        done++;
        if (flush == null) flush = window.setTimeout(publish, done < 4 ? 0 : 120);
      }
    };
    void Promise.all(Array.from({ length: Math.min(6, count) }, worker)).then(publish);
    return () => {
      live = false;
      if (flush != null) window.clearTimeout(flush);
    };
  }, [base, count, first]);
  return { images, loaded };
}
