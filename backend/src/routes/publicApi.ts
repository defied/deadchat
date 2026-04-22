import { Router, Request, Response } from 'express';
import { authenticateApiToken } from '../middleware/apiToken';
import { config } from '../config';
import { getOptionsForModel, getEnabledModels } from '../services/modelSettings';
import { logUsage } from '../services/usage';

const router = Router();
const auth = authenticateApiToken;

async function proxyJson(
  upstreamPath: string,
  method: 'GET' | 'POST' | 'DELETE',
  body: unknown,
  res: Response
): Promise<void> {
  try {
    const resp = await fetch(`${config.ollamaUrl}${upstreamPath}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    res.status(resp.status);
    const ct = resp.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Upstream Ollama unreachable: ${msg}` });
  }
}

async function proxyStream(
  upstreamPath: string,
  body: unknown,
  req: Request,
  res: Response,
  onDone?: (stats: { promptTokens: number; evalTokens: number; model: string }) => void
): Promise<void> {
  const started = Date.now();
  let promptTokens = 0;
  let evalTokens = 0;
  let model = '';

  try {
    const upstream = await fetch(`${config.ollamaUrl}${upstreamPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') || 'application/x-ndjson';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'no-cache');

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      res.send(text);
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let clientClosed = false;
    req.on('close', () => {
      clientClosed = true;
      reader.cancel().catch(() => undefined);
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done || clientClosed) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      res.write(chunk);

      // Parse NDJSON lines to extract final token counts for usage logging
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.model) model = parsed.model;
          if (parsed.prompt_eval_count) promptTokens = parsed.prompt_eval_count;
          if (parsed.eval_count) evalTokens = parsed.eval_count;
        } catch {
          // non-JSON, ignore
        }
      }
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Upstream Ollama unreachable: ${msg}` });
    } else {
      res.end();
    }
  } finally {
    const duration = Date.now() - started;
    try {
      logUsage(req.user!.id, null, `public:${upstreamPath}`, model || null, promptTokens, evalTokens, duration);
    } catch {
      // never fail request on logging failure
    }
    if (onDone) onDone({ promptTokens, evalTokens, model });
  }
}

function mergeOptions(
  model: string | undefined,
  clientOptions: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!model) return clientOptions;
  const serverOptions = getOptionsForModel(model);
  if (Object.keys(serverOptions).length === 0 && !clientOptions) return undefined;
  return { ...serverOptions, ...(clientOptions || {}) };
}

function filterTags(data: unknown): unknown {
  const enabled = getEnabledModels();
  if (enabled.length === 0) return data;
  if (typeof data !== 'object' || data === null) return data;
  const obj = data as { models?: Array<{ name?: string; model?: string }> };
  if (!Array.isArray(obj.models)) return data;
  const filtered = obj.models.filter((m) => {
    const name = m.model || m.name;
    return typeof name === 'string' && (enabled.includes(name) || enabled.includes(name.split(':')[0]));
  });
  return { ...obj, models: filtered };
}

// ========== Ollama-native ==========

router.get('/api/tags', auth, async (_req, res) => {
  try {
    const resp = await fetch(`${config.ollamaUrl}/api/tags`);
    const data = await resp.json();
    res.status(resp.status).json(filterTags(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Upstream Ollama unreachable: ${msg}` });
  }
});

router.get('/api/version', auth, (_req, res) => {
  proxyJson('/api/version', 'GET', undefined, res);
});

router.get('/api/ps', auth, (_req, res) => {
  proxyJson('/api/ps', 'GET', undefined, res);
});

router.post('/api/show', auth, (req, res) => {
  proxyJson('/api/show', 'POST', req.body, res);
});

router.post('/api/chat', auth, (req, res) => {
  const body = { ...req.body, options: mergeOptions(req.body?.model, req.body?.options) };
  if (body.options === undefined) delete body.options;
  proxyStream('/api/chat', body, req, res);
});

router.post('/api/generate', auth, (req, res) => {
  const body = { ...req.body, options: mergeOptions(req.body?.model, req.body?.options) };
  if (body.options === undefined) delete body.options;
  proxyStream('/api/generate', body, req, res);
});

router.post('/api/embeddings', auth, (req, res) => {
  proxyJson('/api/embeddings', 'POST', req.body, res);
});

router.post('/api/embed', auth, (req, res) => {
  proxyJson('/api/embed', 'POST', req.body, res);
});

// ========== OpenAI-compatible (passthrough to Ollama's /v1/*) ==========

router.get('/v1/models', auth, async (_req, res) => {
  try {
    const resp = await fetch(`${config.ollamaUrl}/v1/models`);
    const data = await resp.json();
    const enabled = getEnabledModels();
    if (enabled.length > 0 && typeof data === 'object' && data !== null) {
      const obj = data as { data?: Array<{ id?: string }> };
      if (Array.isArray(obj.data)) {
        obj.data = obj.data.filter((m) =>
          typeof m.id === 'string' && (enabled.includes(m.id) || enabled.includes(m.id.split(':')[0]))
        );
      }
    }
    res.status(resp.status).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Upstream Ollama unreachable: ${msg}` });
  }
});

router.post('/v1/chat/completions', auth, (req, res) => {
  const serverOptions = req.body?.model ? getOptionsForModel(req.body.model) : {};
  const body = { ...serverOptions, ...req.body };
  proxyStream('/v1/chat/completions', body, req, res);
});

router.post('/v1/completions', auth, (req, res) => {
  const serverOptions = req.body?.model ? getOptionsForModel(req.body.model) : {};
  const body = { ...serverOptions, ...req.body };
  proxyStream('/v1/completions', body, req, res);
});

router.post('/v1/embeddings', auth, (req, res) => {
  proxyJson('/v1/embeddings', 'POST', req.body, res);
});

export default router;
