// Small JSON-in/JSON-out helper over the Ollama backends, for the influencer
// pipelines (persona ideas, captions, claim extraction, fact-check verdicts).

import { getOllamaUrl } from '../appSettings';
import { getActiveModel } from '../chatModels';

const TIMEOUT_MS = 240_000;

export interface LlmOptions {
  temperature?: number;
  images?: string[];
  model?: string;
}

/** Ask the model for a JSON object. Throws if the reply isn't valid JSON. */
export async function llmJson<T>(system: string, user: string, opts: LlmOptions = {}): Promise<T> {
  const r = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: opts.model || getActiveModel(),
      stream: false,
      think: false,
      format: 'json',
      // Short keep-alive: ComfyUI may need the GPU right after this.
      keep_alive: '60s',
      options: { temperature: opts.temperature ?? 0.4, num_ctx: 16384 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user, ...(opts.images?.length ? { images: opts.images } : {}) },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = (await r.json()) as { message?: { content?: string } };
  const content = data.message?.content ?? '';
  try {
    return JSON.parse(content) as T;
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error('The model did not return JSON');
  }
}

export function asString(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function asStringArray(v: unknown, maxItems = 20, maxLen = 300): string[] {
  return Array.isArray(v) ? v.map((x) => asString(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
}
