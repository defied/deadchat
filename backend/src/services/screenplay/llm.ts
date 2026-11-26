// The model the screenplay tools use (summaries, search planning, photo
// checks, the shot mentor). It can differ from the chat's active model:
// Admin -> Media sets it; empty means "the active chat model".

import { getActiveModel } from '../chatModels';
import { llmJson as baseLlmJson, type LlmOptions } from '../influencers/llm';
import { getScreenplayModel } from '../media/settings';

export { asString } from '../influencers/llm';

export function screenplayModel(): string {
  return getScreenplayModel() || getActiveModel();
}

export function llmJson<T>(system: string, user: string, opts: LlmOptions = {}): Promise<T> {
  return baseLlmJson<T>(system, user, { ...opts, model: opts.model || screenplayModel() });
}
