import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import { config } from '../config';
import db from '../db/connection';

const router = Router();

// GET /api/ollama/active-model - accessible to all authenticated users
router.get('/active-model', authenticate, (_req: Request, res: Response): void => {
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_model') as { value: string } | undefined;
  res.json({ model: setting?.value || config.ollamaModel });
});

// All remaining routes require admin
// GET /api/ollama/models - list local models
router.get('/models', authenticate, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const response = await fetch(`${config.ollamaUrl}/api/tags`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to connect to Ollama: ${err.message}` });
  }
});

// GET /api/ollama/running - list running models
router.get('/running', authenticate, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const response = await fetch(`${config.ollamaUrl}/api/ps`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to connect to Ollama: ${err.message}` });
  }
});

// POST /api/ollama/pull - pull a model (streaming progress)
router.post('/pull', authenticate, adminOnly, async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  try {
    const response = await fetch(`${config.ollamaUrl}/api/pull`, {
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
    const response = await fetch(`${config.ollamaUrl}/api/delete`, {
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
    const response = await fetch(`${config.ollamaUrl}/api/create`, {
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
    const response = await fetch(`${config.ollamaUrl}/api/show`, {
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
    const response = await fetch(`${config.ollamaUrl}/api/copy`, {
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

export default router;