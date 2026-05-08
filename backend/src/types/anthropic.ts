// Minimal types for the Anthropic Messages API surface we accept on input
// and emit on output. Intentionally narrow — only what /v1/messages exercises.
// Unknown fields on inputs are ignored, not validated.

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  // accepted and ignored:
  cache_control?: unknown;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: { type: string; media_type?: string; data?: string; url?: string };
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<AnthropicTextBlock | AnthropicImageBlock>;
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | 'auto'
  | 'any'
  | 'none'
  | {
      type: 'auto' | 'any' | 'tool' | 'none';
      name?: string;
      disable_parallel_tool_use?: boolean;
    };

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  metadata?: Record<string, unknown>;
}

export type AnthropicStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use';

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  stop_reason: AnthropicStopReason;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

// ── Ollama side (the bits we touch) ─────────────────────────────────────────

export interface OllamaToolCall {
  id?: string;
  type?: 'function';
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
  images?: string[];
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  tools?: OllamaTool[];
  options?: Record<string, unknown>;
  format?: string;
  keep_alive?: string | number;
}

export interface OllamaChatResponse {
  model: string;
  created_at?: string;
  message: { role: string; content: string; tool_calls?: OllamaToolCall[] };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}
