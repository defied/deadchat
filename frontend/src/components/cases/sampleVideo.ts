// Sample a video into still frames in the browser (the server has no video
// decoder), so the analysis can look at every frame.

export const MAX_SAMPLED_FRAMES = 1500;

/** Frames per second to sample: the clip's likely rate, capped so long clips stay under the limit. */
export function sampleFps(durationS: number, nativeFps = 30): number {
  if (!Number.isFinite(durationS) || durationS <= 0) return nativeFps;
  return Math.max(1, Math.min(nativeFps, Math.floor((MAX_SAMPLED_FRAMES / durationS) * 100) / 100));
}

export async function sampleVideo(
  src: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ frames: Blob[]; fps: number }> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  v.src = src;
  await new Promise<void>((ok, fail) => {
    v.onloadedmetadata = () => ok();
    v.onerror = () => fail(new Error('This video can’t be decoded in the browser'));
  });
  const fps = sampleFps(v.duration);
  const total = Math.max(1, Math.floor(v.duration * fps));
  const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  const ctx = c.getContext('2d')!;
  const frames: Blob[] = [];
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    await new Promise<void>((ok) => {
      v.onseeked = () => ok();
      // Middle of the frame interval avoids landing on a boundary.
      v.currentTime = Math.min(v.duration - 0.001, (i + 0.5) / fps);
    });
    ctx.drawImage(v, 0, 0, c.width, c.height);
    frames.push(await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('Couldn’t capture a frame'))), 'image/jpeg', 0.88)));
    onProgress(i + 1, total);
  }
  v.removeAttribute('src');
  v.load();
  return { frames, fps };
}

/** "45 s", "3 min 20 s", "1 h 4 min". */
export function fmtDuration(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '–';
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t} s`;
  if (t < 3600) return `${Math.floor(t / 60)} min${t % 60 ? ` ${t % 60} s` : ''}`;
  const m = Math.round((t % 3600) / 60);
  return `${Math.floor(t / 3600)} h${m ? ` ${m} min` : ''}`;
}
