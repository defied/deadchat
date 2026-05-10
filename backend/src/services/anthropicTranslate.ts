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
        // Ollama's /api/chat parses `arguments` as either a string or an
        // object. The string path runs a second JSON parser that fails on
        // multiply-escaped values (multi-line code, nested quotes) with
        // `Value looks like object, but can't find closing '}' symbol`.
        // Send the raw object — the Ollama type already accepts both.
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: isObject(block.input) ? block.input : {},
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

// Salvage tool calls that the model emitted as text markup instead of via the
// structured tool_calls field. Open-weight models (notably qwen3-coder) sometimes
// drift to formats Ollama's parser doesn't recognize, dropping the call into
// plain text. Without salvage, the agent loop sees no tool_use and stops.
//
// Handles two formats observed in practice:
//   1. Llama-style: <function=NAME><parameter=K>V</parameter>...</function>
//   2. Qwen JSON-style: <tool_call>{"name":"X","arguments":{...}}</tool_call>
//
// `knownTools` is required to avoid false positives — only matches against the
// tools the request actually declared.
export interface ExtractedToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ExtractionResult {
  cleanedText: string;
  toolCalls: ExtractedToolCall[];
}

function maybeJsonValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return raw;
  if (
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    /^-?\d+(\.\d+)?$/.test(trimmed) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }
  return raw.trim();
}

export function extractEmbeddedToolCalls(
  text: string,
  knownTools: string[]
): ExtractionResult {
  if (!text || knownTools.length === 0) return { cleanedText: text, toolCalls: [] };

  const known = new Set(knownTools);
  const calls: ExtractedToolCall[] = [];
  let cleaned = text;

  // Pattern 1: <function=NAME>...<parameter=K>V</parameter>...</function>
  cleaned = cleaned.replace(
    /<function=([\w.-]+)>([\s\S]*?)<\/function>/g,
    (match, name: string, body: string): string => {
      if (!known.has(name)) return match;
      const input: Record<string, unknown> = {};
      const paramRe = /<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(body)) !== null) {
        input[pm[1]] = maybeJsonValue(pm[2]);
      }
      calls.push({ name, input });
      return '';
    }
  );

  // Pattern 2: <tool_call>{"name":"X","arguments":{...}}</tool_call>
  cleaned = cleaned.replace(
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g,
    (match, body: string): string => {
      try {
        const obj = JSON.parse(body);
        if (
          isObject(obj) &&
          typeof obj.name === 'string' &&
          known.has(obj.name)
        ) {
          calls.push({
            name: obj.name,
            input: isObject(obj.arguments) ? obj.arguments : {},
          });
          return '';
        }
      } catch {
        // not JSON; leave it
      }
      return match;
    }
  );

  // Strip any orphaned closing tags left behind by truncated markup.
  cleaned = cleaned.replace(/<\/(?:tool_call|function|parameter)>/g, '');
  cleaned = cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return { cleanedText: cleaned, toolCalls: calls };
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
  stopSequences?: string[],
  knownTools: string[] = []
): AnthropicResponse {
  const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];
  const rawText = resp.message?.content ?? '';
  const structured = resp.message?.tool_calls ?? [];

  // Salvage embedded markup only when Ollama returned no structured calls —
  // if the model already emitted them properly we don't second-guess.
  let displayText = rawText;
  const salvaged: ExtractedToolCall[] =
    structured.length === 0
      ? extractEmbeddedToolCalls(rawText, knownTools).toolCalls
      : [];
  if (salvaged.length > 0) {
    displayText = extractEmbeddedToolCalls(rawText, knownTools).cleanedText;
  }

  if (displayText.length > 0) content.push({ type: 'text', text: displayText });

  for (const tc of structured) {
    content.push({
      type: 'tool_use',
      id: tc.id ?? `toolu_${randomUUID()}`,
      name: tc.function.name,
      input: parseToolArgs(tc.function.arguments),
    });
  }
  for (const sc of salvaged) {
    content.push({
      type: 'tool_use',
      id: `toolu_${randomUUID()}`,
      name: sc.name,
      input: sc.input,
    });
  }

  if (content.length === 0) content.push({ type: 'text', text: '' });

  const hasToolUse = structured.length > 0 || salvaged.length > 0;
  const { reason, sequence } = pickStopReason(
    resp,
    hasToolUse,
    displayText,
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
  knownTools?: string[];
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

  // Salvage path: model emitted tool-call markup as text instead of structured
  // tool_calls. Without this the agent loop sees no tool_use and stops.
  if (!toolUseEmitted && textBuffer.length > 0 && (opts.knownTools?.length ?? 0) > 0) {
    const { toolCalls: salvaged } = extractEmbeddedToolCalls(
      textBuffer,
      opts.knownTools!
    );
    for (const sc of salvaged) {
      const idx = nextBlockIndex++;
      const id = `toolu_${randomUUID()}`;
      yield sse('content_block_start', {
        type: 'content_block_start',
        index: idx,
        content_block: { type: 'tool_use', id, name: sc.name, input: {} },
      });
      yield sse('content_block_delta', {
        type: 'content_block_delta',
        index: idx,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(sc.input) },
      });
      yield sse('content_block_stop', { type: 'content_block_stop', index: idx });
      toolUseEmitted = true;
    }
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
