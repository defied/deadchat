import { config } from '../config';

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export async function* chatStream(
  messages: OllamaMessage[],
  model?: string
): AsyncGenerator<{ content: string; done: boolean; promptTokens?: number; evalTokens?: number }> {
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || config.ollamaModel,
      messages,
      stream: true,
    }),
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed: OllamaChatResponse = JSON.parse(line);
        yield {
          content: parsed.message.content,
          done: parsed.done,
          promptTokens: parsed.prompt_eval_count,
          evalTokens: parsed.eval_count,
        };
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    try {
      const parsed: OllamaChatResponse = JSON.parse(buffer);
      yield {
        content: parsed.message.content,
        done: parsed.done,
        promptTokens: parsed.prompt_eval_count,
        evalTokens: parsed.eval_count,
      };
    } catch {
      // Skip malformed JSON
    }
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
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
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
      'Image generation requires a compatible model (e.g., stable-diffusion). ' +
      'The current model (' + config.ollamaModel + ') does not support image generation. ' +
      'Please configure a compatible model and try again.',
  };
}
