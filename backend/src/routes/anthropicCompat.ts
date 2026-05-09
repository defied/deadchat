import { Router, Request, Response } from 'express';
import { authenticateApiToken } from '../middleware/apiToken';
import { config } from '../config';
import { getOptionsForModel } from '../services/modelSettings';
import { logUsage } from '../services/usage';
import {
  anthropicToOllamaRequest,
  ollamaToAnthropicResponse,
  ollamaStreamToAnthropicSSE,
  type OllamaStreamChunk,
} from '../services/anthropicTranslate';
import type {
  AnthropicMessagesRequest,
  OllamaChatResponse,
} from '../types/anthropic';

const router = Router();

function errorEnvelope(type: string, message: string): { type: 'error'; error: { type: string; message: string } } {
  return { type: 'error', error: { type, message } };
}

function validate(req: AnthropicMessagesRequest): string | null {
  if (!req || typeof req !== 'object') return 'request body must be a JSON object';
  if (typeof req.model !== 'string' || req.model.length === 0) return 'model is required';
  if (typeof req.max_tokens !== 'number' || req.max_tokens <= 0) return 'max_tokens is required and must be > 0';
  if (!Array.isArray(req.messages)) return 'messages must be an array';
  return null;
}

async function* parseOllamaNdjson(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<OllamaStreamChunk> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as OllamaStreamChunk;
      } catch {
        // skip non-JSON
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as OllamaStreamChunk;
    } catch {
      // ignore
    }
  }
}

router.post('/v1/messages', authenticateApiToken, async (req: Request, res: Response): Promise<void> => {
  const started = Date.now();
  let promptTokens = 0;
  let evalTokens = 0;
  const body = req.body as AnthropicMessagesRequest;
  const model = body?.model ?? '';

  const validationError = validate(body);
  if (validationError) {
    res.status(400).json(errorEnvelope('invalid_request_error', validationError));
    return;
  }

  const serverOptions = model ? getOptionsForModel(model) : {};
  const ollamaReq = anthropicToOllamaRequest(body, serverOptions);

  try {
    const upstream = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ollamaReq),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      res
        .status(upstream.status >= 500 ? 502 : upstream.status)
        .json(errorEnvelope('api_error', `upstream Ollama error (${upstream.status}): ${text}`));
      return;
    }

    if (body.stream === true) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const reader = upstream.body.getReader();
      let clientClosed = false;
      req.on('close', () => {
        clientClosed = true;
        reader.cancel().catch(() => undefined);
      });

      // ping every 15s so proxies don't time out long generations.
      const pingTimer = setInterval(() => {
        if (!res.writableEnded) {
          res.write(`event: ping\ndata: {"type":"ping"}\n\n`);
        }
      }, 15_000);

      try {
        const events = ollamaStreamToAnthropicSSE(
          (async function* () {
            for await (const chunk of parseOllamaNdjson(reader)) {
              if (clientClosed) return;
              if (chunk.prompt_eval_count !== undefined) promptTokens = chunk.prompt_eval_count;
              if (chunk.eval_count !== undefined) evalTokens = chunk.eval_count;
              yield chunk;
            }
          })(),
          { requestModel: model, stopSequences: body.stop_sequences }
        );
        for await (const evt of events) {
          if (clientClosed || res.writableEnded) break;
          res.write(evt);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.writableEnded) {
          res.write(
            `event: error\ndata: ${JSON.stringify(errorEnvelope('api_error', msg))}\n\n`
          );
        }
      } finally {
        clearInterval(pingTimer);
        if (!res.writableEnded) res.end();
      }
      return;
    }

    // Non-streaming path
    const data = (await upstream.json()) as OllamaChatResponse;
    promptTokens = data.prompt_eval_count ?? 0;
    evalTokens = data.eval_count ?? 0;
    const out = ollamaToAnthropicResponse(data, model, body.stop_sequences);
    res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(502).json(errorEnvelope('api_error', `upstream Ollama unreachable: ${msg}`));
    } else if (!res.writableEnded) {
      res.end();
    }
  } finally {
    const durationMs = Date.now() - started;
    try {
      logUsage(req.user!.id, null, 'public:/v1/messages', model || null, promptTokens, evalTokens, durationMs);
    } catch {
      // never fail the request on logging failure
    }
  }
});

export default router;
