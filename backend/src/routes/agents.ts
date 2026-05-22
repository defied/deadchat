import { Router, Request, Response } from 'express';
import db from '../db/connection';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import type { LibraryAgent, UserAgent } from '../types/models';

const router = Router();
router.use(authenticate);

// ─── Library (readable by all authenticated users) ─────────────────────────

router.get('/library', (_req: Request, res: Response): void => {
  const agents = db.prepare(
    'SELECT * FROM agent_library ORDER BY name COLLATE NOCASE ASC'
  ).all() as LibraryAgent[];
  res.json({ agents });
});

router.get('/library/:id', (req: Request, res: Response): void => {
  const id = parseInt(req.params.id as string);
  const agent = db.prepare('SELECT * FROM agent_library WHERE id = ?').get(id) as LibraryAgent | undefined;
  if (!agent) { res.status(404).json({ error: 'Library agent not found' }); return; }
  res.json({ agent });
});

// ─── User's own agents (CRUD scoped to req.user) ───────────────────────────

router.get('/mine', (req: Request, res: Response): void => {
  const agents = db.prepare(
    'SELECT * FROM user_agents WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.user!.id) as UserAgent[];
  res.json({ agents });
});

router.post('/mine', (req: Request, res: Response): void => {
  const { name, description, system_prompt, source_library_id } = req.body || {};
  if (!name || typeof name !== 'string' || !system_prompt || typeof system_prompt !== 'string') {
    res.status(400).json({ error: 'name and system_prompt are required strings' });
    return;
  }
  const result = db.prepare(
    `INSERT INTO user_agents (user_id, name, description, system_prompt, source_library_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    req.user!.id,
    name.trim(),
    String(description || '').trim(),
    system_prompt,
    typeof source_library_id === 'number' ? source_library_id : null,
  );
  const agent = db.prepare('SELECT * FROM user_agents WHERE id = ?').get(result.lastInsertRowid) as UserAgent;
  res.status(201).json({ agent });
});

router.put('/mine/:id', (req: Request, res: Response): void => {
  const id = parseInt(req.params.id as string);
  const existing = db.prepare(
    'SELECT id FROM user_agents WHERE id = ? AND user_id = ?'
  ).get(id, req.user!.id);
  if (!existing) { res.status(404).json({ error: 'Agent not found' }); return; }

  const { name, description, system_prompt } = req.body || {};
  if (!name || typeof name !== 'string' || !system_prompt || typeof system_prompt !== 'string') {
    res.status(400).json({ error: 'name and system_prompt are required strings' });
    return;
  }
  db.prepare(
    `UPDATE user_agents
     SET name = ?, description = ?, system_prompt = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name.trim(), String(description || '').trim(), system_prompt, id);

  const agent = db.prepare('SELECT * FROM user_agents WHERE id = ?').get(id) as UserAgent;
  res.json({ agent });
});

router.delete('/mine/:id', (req: Request, res: Response): void => {
  const id = parseInt(req.params.id as string);
  const result = db.prepare(
    'DELETE FROM user_agents WHERE id = ? AND user_id = ?'
  ).run(id, req.user!.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Agent not found' }); return; }
  res.json({ message: 'Agent deleted' });
});

// Clone a library agent into the user's own list (copy of the system prompt
// is taken at clone time; later edits to the library agent don't propagate).
router.post('/mine/clone-library/:id', (req: Request, res: Response): void => {
  const libId = parseInt(req.params.id as string);
  const src = db.prepare('SELECT * FROM agent_library WHERE id = ?').get(libId) as LibraryAgent | undefined;
  if (!src) { res.status(404).json({ error: 'Library agent not found' }); return; }

  const result = db.prepare(
    `INSERT INTO user_agents (user_id, name, description, system_prompt, source_library_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(req.user!.id, src.name, src.description, src.system_prompt, libId);
  const agent = db.prepare('SELECT * FROM user_agents WHERE id = ?').get(result.lastInsertRowid) as UserAgent;
  res.status(201).json({ agent });
});

// ─── Library writes (admin-only) ───────────────────────────────────────────

router.post('/library', adminOnly, (req: Request, res: Response): void => {
  const { name, description, system_prompt } = req.body || {};
  if (!name || typeof name !== 'string' || !system_prompt || typeof system_prompt !== 'string') {
    res.status(400).json({ error: 'name and system_prompt are required strings' });
    return;
  }
  const result = db.prepare(
    `INSERT INTO agent_library (name, description, system_prompt, created_by_user_id)
     VALUES (?, ?, ?, ?)`
  ).run(name.trim(), String(description || '').trim(), system_prompt, req.user!.id);
  const agent = db.prepare('SELECT * FROM agent_library WHERE id = ?').get(result.lastInsertRowid) as LibraryAgent;
  res.status(201).json({ agent });
});

router.put('/library/:id', adminOnly, (req: Request, res: Response): void => {
  const id = parseInt(req.params.id as string);
  const existing = db.prepare('SELECT id FROM agent_library WHERE id = ?').get(id);
  if (!existing) { res.status(404).json({ error: 'Library agent not found' }); return; }

  const { name, description, system_prompt } = req.body || {};
  if (!name || typeof name !== 'string' || !system_prompt || typeof system_prompt !== 'string') {
    res.status(400).json({ error: 'name and system_prompt are required strings' });
    return;
  }
  db.prepare(
    `UPDATE agent_library
     SET name = ?, description = ?, system_prompt = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name.trim(), String(description || '').trim(), system_prompt, id);

  const agent = db.prepare('SELECT * FROM agent_library WHERE id = ?').get(id) as LibraryAgent;
  res.json({ agent });
});

router.delete('/library/:id', adminOnly, (req: Request, res: Response): void => {
  const id = parseInt(req.params.id as string);
  const result = db.prepare('DELETE FROM agent_library WHERE id = ?').run(id);
  if (result.changes === 0) { res.status(404).json({ error: 'Library agent not found' }); return; }
  res.json({ message: 'Library agent deleted' });
});

export default router;
