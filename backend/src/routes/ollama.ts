import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import { config } from '../config';
import db from '../db/connection';
import { buildSnapshot, fetchNginxStatus, type RunningModelLite } from '../services/liveStats';
import { getOllamaUrl, getOllamaUrlOverride, setOllamaUrl } from '../services/appSettings';
import {
  getBackend,
  listBackends,
  primaryBackendId,
  primaryDefaultUrl,
  runWithBackendUrl,
  setBackendDefaultModel,
} from '../services/ollamaBackends';

const FRONTEND_STATUS_URL =
  process.env.FRONTEND_STATUS_URL || 'http://deadchat-frontend:8080/_nginx_status';

const router = Router();

// ?backend=<id> on any route below makes its Ollama calls go to that backend
// (e.g. pulling a model onto the Mac). Without it, the default backend is used.
router.use((req: Request, res: Response, next) => {
  const requested = req.query.backend;
  if (typeof requested !== 'string' || !requested) return next();
  const b = getBackend(requested);
  if (!b) {
    res.status(400).json({ error: `Unknown backend "${requested}"` });
    return;
  }
  runWithBackendUrl(b.url, next);
});

// GET /api/ollama/backends — every backend with URL, health and default model (admin only)
router.get('/backends', authenticate, adminOnly, (_req: Request, res: Response): void => {
  res.json({ backends: listBackends() });
});

// PUT /api/ollama/backends/:id/default-model — Body: { model: string | null } (admin only)
// The model new chats on that backend start with, and what a chat falls back
// to when it lands on that backend without a model the backend has.
router.put('/backends/:id/default-model', authenticate, adminOnly, (req: Request, res: Response): void => {
  const b = getBackend(req.params.id as string);
  if (!b) {
    res.status(404).json({ error: 'Unknown backend' });
    return;
  }
  const raw = req.body?.model;
  if (raw !== null && raw !== undefined && raw !== '' && typeof raw !== 'string') {
    res.status(400).json({ error: 'model must be a string or null' });
    return;
  }
  const backendModels = listBackends().find((x) => x.id === b.id)?.models;
  const model = typeof raw === 'string' ? raw.trim() : '';
  if (model && backendModels && !backendModels.includes(model)) {
    res.status(400).json({ error: `Model "${model}" is not installed on ${b.id}` });
    return;
  }
  setBackendDefaultModel(b.id, model || null);
  res.json({ backends: listBackends() });
});

// GET /api/ollama/active-model - accessible to all authenticated users
router.get('/active-model', authenticate, (_req: Request, res: Response): void => {
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_model') as { value: string } | undefined;
  res.json({ model: setting?.value || config.ollamaModel });
});

// GET /api/ollama/model-status?name=<model> — offload state for a single model.
// Accessible to all authenticated users (chat header chip uses it). Doesn't
// expose host/cluster metrics; only the requested model's GPU/CPU split.
router.get('/model-status', authenticate, async (req: Request, res: Response): Promise<void> => {
  const name = String(req.query.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'name query param is required' });
    return;
  }

  try {
    const response = await fetch(`${getOllamaUrl()}/api/ps`);
    if (!response.ok) {
      res.json({ name, status: 'unreachable', reachable: false });
      return;
    }
    const data = await response.json() as { models?: RunningModelLite[] };
    const m = (data.models || []).find((x) => x.name === name);
    if (!m) {
      res.json({ name, status: 'cold', reachable: true });
      return;
    }
    const total = m.size || 0;
    const vram  = m.size_vram || 0;
    const vramPct = total > 0 ? Math.max(0, Math.min(1, vram / total)) : 0;
    let status: 'gpu' | 'partial' | 'cpu';
    if (vramPct >= 0.999)      status = 'gpu';
    else if (vramPct <= 0.001) status = 'cpu';
    else                       status = 'partial';
    res.json({
      name,
      status,
      reachable: true,
      vramPct,
      vramMB:  vram  / (1024 * 1024),
      totalMB: total / (1024 * 1024),
    });
  } catch (err: any) {
    res.json({ name, status: 'unreachable', reachable: false, error: err.message });
  }
});

// All remaining routes require admin
// GET /api/ollama/models - list local models
router.get('/models', authenticate, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const response = await fetch(`${getOllamaUrl()}/api/tags`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to connect to Ollama: ${err.message}` });
  }
});

// GET /api/ollama/running - list running models
router.get('/running', authenticate, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const response = await fetch(`${getOllamaUrl()}/api/ps`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to connect to Ollama: ${err.message}` });
  }
});

// GET /api/ollama/live-stats - loaded models + host + recent request telemetry
router.get('/live-stats', authenticate, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  const [psResult, nginxStatus] = await Promise.all([
    (async () => {
      try {
        const response = await fetch(`${getOllamaUrl()}/api/ps`);
        if (!response.ok) return { running: [] as RunningModelLite[], error: `Ollama responded ${response.status}` };
        const data = await response.json() as { models?: RunningModelLite[] };
        return { running: data.models || [], error: undefined as string | undefined };
      } catch (err: any) {
        return { running: [] as RunningModelLite[], error: err.message as string };
      }
    })(),
    fetchNginxStatus(FRONTEND_STATUS_URL),
  ]);

  const snapshot = buildSnapshot({
    runningModels: psResult.running,
    nginxStatus,
    nginxError: nginxStatus ? undefined : 'Frontend status unreachable',
    ollamaReachable: !psResult.error,
  });

  res.json({
    running: psResult.running,
    ollamaError: psResult.error,
    ...snapshot,
  });
});

// POST /api/ollama/pull - pull a model (streaming progress)
router.post('/pull', authenticate, adminOnly, async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  try {
    const response = await fetch(`${getOllamaUrl()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      res.status(response.status).json({ error: text });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err: any) {
    res.status(502).json({ error: `Failed to pull model: ${err.message}` });
  }
});

// DELETE /api/ollama/models/:name - delete a model
router.delete('/models/:name', authenticate, adminOnly, async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params;
  try {
    const response = await fetch(`${getOllamaUrl()}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ error: text });
      return;
    }
    res.json({ message: `Model ${name} deleted` });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to delete model: ${err.message}` });
  }
});

// POST /api/ollama/create - create a custom model from Modelfile
router.post('/create', authenticate, adminOnly, async (req: Request, res: Response): Promise<void> => {
  const { name, modelfile } = req.body;
  if (!name || !modelfile) {
    res.status(400).json({ error: 'Name and modelfile are required' });
    return;
  }

  try {
    const response = await fetch(`${getOllamaUrl()}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, modelfile, stream: true }),
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      res.status(response.status).json({ error: text });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err: any) {
    res.status(502).json({ error: `Failed to create model: ${err.message}` });
  }
});

// GET /api/ollama/model/:name - show model info
router.get('/model/:name', authenticate, adminOnly, async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params;
  try {
    const response = await fetch(`${getOllamaUrl()}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to get model info: ${err.message}` });
  }
});

// POST /api/ollama/copy - copy/duplicate a model
router.post('/copy', authenticate, adminOnly, async (req: Request, res: Response): Promise<void> => {
  const { source, destination } = req.body;
  if (!source || !destination) {
    res.status(400).json({ error: 'Source and destination are required' });
    return;
  }

  try {
    const response = await fetch(`${getOllamaUrl()}/api/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, destination }),
    });
    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ error: text });
      return;
    }
    res.json({ message: `Model copied from ${source} to ${destination}` });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to copy model: ${err.message}` });
  }
});

// PUT /api/ollama/active-model - set the active model for all users (admin only)
router.put('/active-model', authenticate, adminOnly, (req: Request, res: Response): void => {
  const { model } = req.body;
  if (!model) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_model');
  if (existing) {
    db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(model, 'active_model');
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('active_model', model);
  }

  res.json({ model, message: `Active model set to ${model} for all users` });
});

// GET /api/ollama/backend-url - return effective Ollama URL + env default (admin only)
router.get('/backend-url', authenticate, adminOnly, (_req: Request, res: Response): void => {
  const override = getOllamaUrlOverride();
  res.json({
    url: getBackend(primaryBackendId())!.url,
    default: primaryDefaultUrl(),
    isOverride: override !== null,
    backends: listBackends(),
  });
});

// PUT /api/ollama/backend-url - set or clear the Ollama URL override (admin only)
// Body: { url: string | null }. null/empty string clears the override.
router.put('/backend-url', authenticate, adminOnly, (req: Request, res: Response): void => {
  const raw = req.body?.url;

  if (raw === null || raw === undefined || raw === '') {
    setOllamaUrl(null);
    res.json({
      url: getBackend(primaryBackendId())!.url,
      default: primaryDefaultUrl(),
      isOverride: false,
      message: 'Ollama URL override cleared; using boot-time default',
    });
    return;
  }

  if (typeof raw !== 'string') {
    res.status(400).json({ error: 'url must be a string or null' });
    return;
  }

  const trimmed = raw.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    res.status(400).json({ error: 'url is not a valid URL' });
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.status(400).json({ error: 'url must use http:// or https://' });
    return;
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    res.status(400).json({ error: 'url must not contain a path' });
    return;
  }
  if (parsed.search || parsed.hash) {
    res.status(400).json({ error: 'url must not contain a query string or fragment' });
    return;
  }

  const normalised = `${parsed.protocol}//${parsed.host}`;
  setOllamaUrl(normalised);
  res.json({
    url: normalised,
    default: primaryDefaultUrl(),
    isOverride: true,
    message: `Ollama URL set to ${normalised}`,
  });
});

export default router;