// Sharing the GPU box between the screenplay's AI calls (Ollama) and image /
// video renders (ComfyUI, the heavy job queue). A model that's already
// loaded answers straight away. One that isn't waits until the render in
// progress is done; while it's loading and answering, no new heavy render
// starts (the job queue asks `gpuHeld()`).

import db from '../../db/connection';
import { getOllamaUrl } from '../appSettings';

let held = 0;

/** True while a screenplay AI call has the GPU: the job queue holds back heavy renders. */
export function gpuHeld(): boolean {
  return held > 0;
}

export const deps = {
  /** Models Ollama has in memory right now. */
  async loaded(): Promise<string[]> {
    try {
      const r = await fetch(`${getOllamaUrl()}/api/ps`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return [];
      return (((await r.json()) as { models?: Array<{ name: string; model?: string }> }).models ?? []).flatMap((m) => [m.name, m.model ?? '']);
    } catch {
      return [];
    }
  },
  /** Heavy renders running, and waiting ahead. */
  renders(): { running: number; queued: number } {
    const row = db
      .prepare("SELECT SUM(status = 'running') AS running, SUM(status = 'queued') AS queued FROM jobs WHERE heavy = 1 AND status IN ('running', 'queued')")
      .get() as { running: number | null; queued: number | null };
    return { running: row.running ?? 0, queued: row.queued ?? 0 };
  },
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

const same = (a: string, b: string) => a === b || a.replace(/:latest$/, '') === b.replace(/:latest$/, '');

/**
 * Run an AI call on `model`, waiting first if the model isn't loaded and a
 * render is using the GPU. `onWait` hears why it's waiting.
 */
export async function withGpu<T>(model: string, fn: () => Promise<T>, onWait?: (why: string) => void): Promise<T> {
  for (let waited = 0; ; waited++) {
    const loaded = (await deps.loaded()).some((m) => m && same(m, model));
    const { running, queued } = deps.renders();
    if (loaded || running === 0) break;
    onWait?.(
      `Queued: waiting for ${running === 1 ? 'the image render' : `${running} renders`}${queued ? ` (and ${queued} more)` : ''} to finish before loading ${model}…`,
    );
    await deps.sleep(waited < 10 ? 3000 : 6000);
  }
  held++;
  try {
    return await fn();
  } finally {
    held--;
  }
}
