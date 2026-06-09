import { Router, Request, Response } from 'express';
import cron from 'node-cron';
import db from '../db/connection';
import { authenticate } from '../middleware/auth';
import { registerSchedule, unregisterSchedule } from '../services/scheduler';
import type { Schedule } from '../types/models';

const router = Router();

router.use(authenticate);

// GET /api/schedules
router.get('/', (req: Request, res: Response): void => {
  const schedules = db.prepare(
    'SELECT * FROM schedules WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user!.id) as Schedule[];
  res.json(schedules);
});

// GET /api/schedules/:id
router.get('/:id', (req: Request, res: Response): void => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?')
    .get(parseInt(String(req.params.id), 10)) as Schedule | undefined;
  if (!s) { res.status(404).json({ error: 'Not found' }); return; }
  if (s.user_id !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }
  res.json(s);
});

// POST /api/schedules
router.post('/', (req: Request, res: Response): void => {
  const { name, cron: cronExpr, goal, agent_id, agent_source, enabled } = req.body as {
    name?: string; cron?: string; goal?: string;
    agent_id?: number; agent_source?: string; enabled?: boolean;
  };
  if (!name || !cronExpr || !goal) {
    res.status(400).json({ error: 'name, cron, and goal are required' }); return;
  }
  if (!cron.validate(cronExpr)) {
    res.status(400).json({ error: `Invalid cron expression: "${cronExpr}"` }); return;
  }

  const result = db.prepare(`
    INSERT INTO schedules (user_id, name, cron, goal, agent_id, agent_source, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.user!.id, name, cronExpr, goal, agent_id ?? null, agent_source ?? null, enabled !== false ? 1 : 0);

  const s = db.prepare('SELECT * FROM schedules WHERE id = ?')
    .get(result.lastInsertRowid) as Schedule;

  if (s.enabled) registerSchedule(s);
  res.status(201).json(s);
});

// PATCH /api/schedules/:id
router.patch('/:id', (req: Request, res: Response): void => {
  const id = parseInt(String(req.params.id), 10);
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Schedule | undefined;
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (existing.user_id !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }

  const { name, cron: cronExpr, goal, agent_id, agent_source, enabled } = req.body as Partial<{
    name: string; cron: string; goal: string;
    agent_id: number; agent_source: string; enabled: number;
  }>;
  if (cronExpr && !cron.validate(cronExpr)) {
    res.status(400).json({ error: `Invalid cron expression: "${cronExpr}"` }); return;
  }

  db.prepare(`
    UPDATE schedules
    SET name = COALESCE(?, name),
        cron = COALESCE(?, cron),
        goal = COALESCE(?, goal),
        agent_id = COALESCE(?, agent_id),
        agent_source = COALESCE(?, agent_source),
        enabled = COALESCE(?, enabled)
    WHERE id = ?
  `).run(name ?? null, cronExpr ?? null, goal ?? null, agent_id ?? null, agent_source ?? null, enabled ?? null, id);

  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Schedule;
  unregisterSchedule(id);
  if (s.enabled) registerSchedule(s);
  res.json(s);
});

// DELETE /api/schedules/:id
router.delete('/:id', (req: Request, res: Response): void => {
  const id = parseInt(String(req.params.id), 10);
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Schedule | undefined;
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (existing.user_id !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }

  unregisterSchedule(id);
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  res.json({ deleted: true });
});

export default router;
