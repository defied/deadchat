import { AsyncLocalStorage } from 'node:async_hooks';
// The model the screenplay tools use (summaries, search planning, photo
// checks, the shot mentor). It can differ from the chat's active model:
// Admin -> Media sets it; empty means "the active chat model".

import { getActiveModel } from '../chatModels';
import { llmJson as baseLlmJson, type LlmOptions } from '../influencers/llm';
import { getScreenplayModel } from '../media/settings';
import { withGpu } from './gpuGate';

export { asString } from '../influencers/llm';

export function screenplayModel(): string {
  return getScreenplayModel() || getActiveModel();
}

/** Who hears about waits for the GPU: the background task the call is part of (per async context). */
const waits = new AsyncLocalStorage<(why: string) => void>();
export function withWaitListener<T>(onWait: (why: string) => void, fn: () => Promise<T>): Promise<T> {
  return waits.run(onWait, fn);
}
export const currentWaitListener = () => waits.getStore();

/** The screenplay model, queued behind a render when it isn't loaded. */
export function llmJson<T>(system: string, user: string, opts: LlmOptions = {}): Promise<T> {
  const model = opts.model || screenplayModel();
  const onWait = waits.getStore();
  return withGpu(model, () => baseLlmJson<T>(system, user, { ...opts, model }), onWait);
}
