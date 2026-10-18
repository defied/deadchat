import { config } from '../config';
import { getOllamaUrl } from './appSettings';
import type { OllamaChatRequest, OllamaChatResponse as OllamaApiResponse } from '../types/anthropic';

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Base64-encoded images (no data: prefix) for vision-capable models. */
  images?: string[];
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    thinking?: string;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface ChatStreamChunk {
  content: string;
  /** Reasoning tokens from thinking-capable models (qwen3.x, gemma4, ...). */
  thinking: string;
  done: boolean;
  doneReason?: string;
  model?: string;
  promptTokens?: number;
  evalTokens?: number;
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptEvalDurationNs?: number;
  evalDurationNs?: number;
}

export interface ChatStreamOptions {
  /** Ollama `options` (temperature, num_ctx, ...). Usually from model settings. */
  options?: Record<string, unknown>;
  signal?: AbortSignal;
}

function toChunk(parsed: OllamaChatResponse): ChatStreamChunk {
  return {
    content: parsed.message?.content ?? '',
    thinking: parsed.message?.thinking ?? '',
    done: parsed.done,
    doneReason: parsed.done_reason,
    model: parsed.model,
    promptTokens: parsed.prompt_eval_count,
    evalTokens: parsed.eval_count,
    totalDurationNs: parsed.total_duration,
    loadDurationNs: parsed.load_duration,
    promptEvalDurationNs: parsed.prompt_eval_duration,
    evalDurationNs: parsed.eval_duration,
  };
}

export async function* chatStream(
  messages: OllamaMessage[],
  model?: string,
  opts: ChatStreamOptions = {},
): AsyncGenerator<ChatStreamChunk> {
  const body: Record<string, unknown> = {
    model: model || config.ollamaModel,
    messages,
    stream: true,
  };
  if (opts.options && Object.keys(opts.options).length > 0) body.options = opts.options;

  const response = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error('No response body from Ollama');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed: OllamaChatResponse & { error?: string };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // Skip malformed JSON lines
        }
        if (parsed.error) throw new Error(parsed.error);
        yield toChunk(parsed);
      }
    }

    if (buffer.trim()) {
      try {
        const parsed: OllamaChatResponse = JSON.parse(buffer);
        yield toChunk(parsed);
      } catch {
        // Skip malformed JSON
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export async function chatSync(
  messages: OllamaMessage[],
  model?: string
): Promise<{
  content: string;
  promptTokens: number;
  evalTokens: number;
  totalDuration: number;
}> {
  const response = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || config.ollamaModel,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data: OllamaChatResponse = await response.json();

  return {
    content: data.message.content,
    promptTokens: data.prompt_eval_count || 0,
    evalTokens: data.eval_count || 0,
    totalDuration: data.total_duration || 0,
  };
}

export async function generateImage(
  prompt: string
): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message:
      'Image generation is handled by the job queue. ' +
      'POST /api/generate/image to enqueue a job.',
  };
}

// Full request/response pass-through for the agent loop, which constructs the
// Ollama request via anthropicToOllamaRequest (includes tools, keep_alive, etc.).
export async function chatSyncRaw(req: OllamaChatRequest, signal?: AbortSignal): Promise<OllamaApiResponse> {
  const body = { ...req, stream: false };
  const response = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<OllamaApiResponse>;
}

// Evict a model from VRAM before running a heavy GPU job (video gen).
// keep_alive=0 tells Ollama to unload the model immediately.
export async function evictModel(model: string): Promise<void> {
  try {
    await fetch(`${getOllamaUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
    });
  } catch {
    // Best-effort — don't block the job if eviction fails
  }
}

// Evict every model Ollama currently has loaded (frees VRAM for ComfyUI).
export async function evictAllModels(): Promise<void> {
  try {
    const r = await fetch(`${getOllamaUrl()}/api/ps`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return;
    const data = (await r.json()) as { models?: Array<{ name: string }> };
    await Promise.all((data.models ?? []).map((m) => evictModel(m.name)));
  } catch {
    // Best-effort
  }
}

export { config };
