// Pure translators between Anthropic Messages API and Ollama chat API.
// No I/O — every dependency is passed in. This file is unit-tested standalone.

import { randomUUID } from 'crypto';
import type {
  AnthropicMessagesRequest,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicResponse,
  AnthropicStopReason,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaMessage,
  OllamaTool,
  OllamaToolCall,
} from '../types/anthropic';

// ── helpers ─────────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function blocksToText(blocks: AnthropicContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text') parts.push(b.text);
  }
  return parts.join('\n\n');
}

function toolResultContentToString(
  content: AnthropicToolResultBlock['content']
): string {
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  return blocksToText(content as AnthropicContentBlock[]);
}

// ── 3a. Anthropic request → Ollama request ──────────────────────────────────

export function anthropicToOllamaRequest(
  req: AnthropicMessagesRequest,
  serverOptions: Record<string, unknown> = {}
): OllamaChatRequest {
  const messages: OllamaMessage[] = [];

  // system
  if (typeof req.system === 'string') {
    if (req.system.length > 0) messages.push({ role: 'system', content: req.system });
  } else if (Array.isArray(req.system)) {
    const text = blocksToText(req.system);
    if (text.length > 0) messages.push({ role: 'system', content: text });
  }

  for (const m of req.messages) {
    appendTranslatedMessage(m, messages);
  }

  // options — server defaults first, client overrides
  const clientOptions: Record<string, unknown> = {};
  clientOptions.num_predict = req.max_tokens;
  if (req.temperature !== undefined) clientOptions.temperature = req.temperature;
  if (req.top_p !== undefined) clientOptions.top_p = req.top_p;
  if (req.top_k !== undefined) clientOptions.top_k = req.top_k;
  if (req.stop_sequences && req.stop_sequences.length > 0) {
    clientOptions.stop = req.stop_sequences;
  }
  const options = { ...serverOptions, ...clientOptions };

  // tools / tool_choice
  let tools: OllamaTool[] | undefined;
  const choice = req.tool_choice;
  const choiceType = typeof choice === 'string' ? choice : choice?.type;
  const toolsDisabled = choiceType === 'none';

  if (req.tools && req.tools.length > 0 && !toolsDisabled) {
    tools = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: isObject(t.input_schema)
          ? t.input_schema
          : { type: 'object', properties: {} },
      },
    }));
  }

  const out: OllamaChatRequest = {
    model: req.model,
    messages,
    stream: req.stream === true,
    options,
  };
  if (tools) out.tools = tools;
  return out;
}

function appendTranslatedMessage(
  m: AnthropicMessage,
  out: OllamaMessage[]
): void {
  if (typeof m.content === 'string') {
    out.push({ role: m.role, content: m.content });
    return;
  }

  const textParts: string[] = [];
  const toolCalls: OllamaToolCall[] = [];
  const toolResultMessages: OllamaMessage[] = [];

  for (const block of m.content) {
    switch (block.type) {
      case 'text':
        textParts.push(block.text);
        break;
      case 'image':
        // v1: drop. (Anthropic SDKs don't send images for tool-only flows.)
        break;
      case 'tool_use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
        break;
      case 'tool_result': {
        const raw = toolResultContentToString(block.content);
        const content = block.is_error ? `[error] ${raw}` : raw;
        toolResultMessages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content,
        });
        break;
      }
    }
  }

  if (m.role === 'assistant') {
    const msg: OllamaMessage = { role: 'assistant', content: textParts.join('\n\n') };
    if (toolCalls.length > 0) msg.tool_calls = toolCalls;
    out.push(msg);
    return;
  }

  // user role: tool_results (one per block) come first, then leftover text
  for (const tr of toolResultMessages) out.push(tr);
  if (textParts.length > 0) {
    out.push({ role: 'user', content: textParts.join('\n\n') });
  }
}

// ── 3b. Ollama response → Anthropic response ────────────────────────────────

function parseToolArgs(args: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof args !== 'string') return args ?? {};
  try {
    const parsed = JSON.parse(args);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function pickStopReason(
  resp: OllamaChatResponse,
  hasToolUse: boolean,
  text: string,
  stopSequences?: string[]
): { reason: AnthropicStopReason; sequence: string | null } {
  if (hasToolUse) return { reason: 'tool_use', sequence: null };
  if (resp.done_reason === 'length') return { reason: 'max_tokens', sequence: null };
  if (stopSequences && text.length > 0) {
    for (const s of stopSequences) {
      if (s.length > 0 && text.endsWith(s)) {
        return { reason: 'stop_sequence', sequence: s };
      }
    }
  }
  return { reason: 'end_turn', sequence: null };
}

export function ollamaToAnthropicResponse(
  resp: OllamaChatResponse,
  requestModel: string,
  stopSequences?: string[]
): AnthropicResponse {
  const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];
  const text = resp.message?.content ?? '';
  if (text.length > 0) content.push({ type: 'text', text });

  const toolCalls = resp.message?.tool_calls ?? [];
  for (const tc of toolCalls) {
    content.push({
      type: 'tool_use',
      id: tc.id ?? `toolu_${randomUUID()}`,
      name: tc.function.name,
      input: parseToolArgs(tc.function.arguments),
    });
  }

  if (content.length === 0) content.push({ type: 'text', text: '' });

  const { reason, sequence } = pickStopReason(
    resp,
    toolCalls.length > 0,
    text,
    stopSequences
  );

  return {
    id: `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: requestModel,
    content,
    stop_reason: reason,
    stop_sequence: sequence,
    usage: {
      input_tokens: resp.prompt_eval_count ?? 0,
      output_tokens: resp.eval_count ?? 0,
    },
  };
}

// ── 3c. Streaming: NDJSON line iterable → Anthropic SSE events ──────────────

export interface OllamaStreamChunk {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface SseStreamOptions {
  requestModel: string;
  stopSequences?: string[];
}

/**
 * Drives an async iterable of parsed Ollama NDJSON chunks and yields
 * Anthropic-formatted SSE strings (each ending in \n\n).
 *
 * The reader/decoder/line-splitting lives in the route; this generator only
 * sees already-parsed chunk objects so it stays fully unit-testable.
 */
export async function* ollamaStreamToAnthropicSSE(
  chunks: AsyncIterable<OllamaStreamChunk>,
  opts: SseStreamOptions
): AsyncGenerator<string> {
  const messageId = `msg_${randomUUID()}`;
  let textOpen = false;
  let textBuffer = '';
  let toolIndex = -1; // -1 = no tool block opened yet
  let nextBlockIndex = 0;
  let evalCount = 0;
  let promptCount = 0;
  let upstreamDoneReason: string | undefined;
  let toolUseEmitted = false;

  yield sse('message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: opts.requestModel,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  for await (const chunk of chunks) {
    if (chunk.prompt_eval_count !== undefined) promptCount = chunk.prompt_eval_count;
    if (chunk.eval_count !== undefined) evalCount = chunk.eval_count;
    if (chunk.done_reason !== undefined) upstreamDoneReason = chunk.done_reason;

    const text = chunk.message?.content ?? '';
    if (text.length > 0) {
      if (!textOpen) {
        const idx = nextBlockIndex++;
        yield sse('content_block_start', {
          type: 'content_block_start',
          index: idx,
          content_block: { type: 'text', text: '' },
        });
        textOpen = true;
        toolIndex = idx;
      }
      textBuffer += text;
      yield sse('content_block_delta', {
        type: 'content_block_delta',
        index: toolIndex,
        delta: { type: 'text_delta', text },
      });
    }

    const toolCalls = chunk.message?.tool_calls ?? [];
    if (toolCalls.length > 0) {
      if (textOpen) {
        yield sse('content_block_stop', {
          type: 'content_block_stop',
          index: toolIndex,
        });
        textOpen = false;
      }
      for (const tc of toolCalls) {
        const idx = nextBlockIndex++;
        const id = tc.id ?? `toolu_${randomUUID()}`;
        const input = parseToolArgs(tc.function.arguments);
        yield sse('content_block_start', {
          type: 'content_block_start',
          index: idx,
          content_block: { type: 'tool_use', id, name: tc.function.name, input: {} },
        });
        yield sse('content_block_delta', {
          type: 'content_block_delta',
          index: idx,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
        });
        yield sse('content_block_stop', {
          type: 'content_block_stop',
          index: idx,
        });
        toolUseEmitted = true;
      }
    }

    if (chunk.done) break;
  }

  if (textOpen) {
    yield sse('content_block_stop', {
      type: 'content_block_stop',
      index: toolIndex,
    });
    textOpen = false;
  }

  let stopReason: AnthropicStopReason = 'end_turn';
  let stopSequence: string | null = null;
  if (toolUseEmitted) {
    stopReason = 'tool_use';
  } else if (upstreamDoneReason === 'length') {
    stopReason = 'max_tokens';
  } else if (opts.stopSequences && textBuffer.length > 0) {
    for (const s of opts.stopSequences) {
      if (s.length > 0 && textBuffer.endsWith(s)) {
        stopReason = 'stop_sequence';
        stopSequence = s;
        break;
      }
    }
  }

  yield sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: stopSequence },
    usage: { input_tokens: promptCount, output_tokens: evalCount },
  });
  yield sse('message_stop', { type: 'message_stop' });
}
