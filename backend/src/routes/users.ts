import { Router, Request, Response } from 'express';
import db from '../db/connection';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import { hashPassword } from '../services/auth';
import {
  getUserUsage,
  getUsageSummary,
  listModelPricing,
  upsertModelPricing,
  deleteModelPricing,
} from '../services/usage';
import type { User } from '../types/models';

const router = Router();

// All user management routes require admin
router.use(authenticate, adminOnly);

// GET /api/users/usage/summary - must be before /:id routes
router.get('/usage/summary', (req: Request, res: Response): void => {
  const days = parseInt(req.query.days as string) || 30;
  res.json(getUsageSummary(days));
});

// GET /api/users/usage/pricing
router.get('/usage/pricing', (_req: Request, res: Response): void => {
  res.json({ pricing: listModelPricing() });
});

// PUT /api/users/usage/pricing/:model
router.put('/usage/pricing/:model', (req: Request, res: Response): void => {
  const model = req.params.model as string;
  const { inputPerMtok, outputPerMtok, notes } = req.body || {};
  if (typeof inputPerMtok !== 'number' || typeof outputPerMtok !== 'number') {
    res.status(400).json({ error: 'inputPerMtok and outputPerMtok must be numbers' });
    return;
  }
  const row = upsertModelPricing(model, inputPerMtok, outputPerMtok, notes ?? null);
  res.json({ pricing: row });
});

// DELETE /api/users/usage/pricing/:model
router.delete('/usage/pricing/:model', (req: Request, res: Response): void => {
  const model = req.params.model as string;
  const ok = deleteModelPricing(model);
  if (!ok) {
    res.status(400).json({ error: 'Cannot delete fallback (*) or unknown model' });
    return;
  }
  res.json({ message: 'Deleted' });
});

// GET /api/users
router.get('/', (req: Request, res: Response): void => {
  const users = db.prepare(
    'SELECT id, username, email, role, created_at, updated_at FROM users ORDER BY created_at DESC'
  ).all();

  res.json({ users });
});

// POST /api/users
router.post('/', (req: Request, res: Response): void => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password) {
    res.status(400).json({ error: 'Username, email, and password are required' });
    return;
  }

  const existing = db.prepare(
    'SELECT id FROM users WHERE username = ? OR email = ?'
  ).get(username, email);

  if (existing) {
    res.status(409).json({ error: 'Username or email already exists' });
    return;
  }

  const passwordHash = hashPassword(password);
  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(username, email, passwordHash, role || 'user');

  const user = db.prepare(
    'SELECT id, username, email, role, created_at FROM users WHERE id = ?'
  ).get(result.lastInsertRowid);

  res.status(201).json({ user });
});

// PUT /api/users/:id
router.put('/:id', (req: Request, res: Response): void => {
  const userId = parseInt(req.params.id as string);
  const { username, email, password, role } = req.body;

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;

  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Check for conflicts if username or email is being changed
  if (username && username !== existing.username) {
    const conflict = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
    if (conflict) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
  }

  if (email && email !== existing.email) {
    const conflict = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId);
    if (conflict) {
      res.status(409).json({ error: 'Email already exists' });
      return;
    }
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (username) { updates.push('username = ?'); values.push(username); }
  if (email) { updates.push('email = ?'); values.push(email); }
  if (password) { updates.push('password_hash = ?'); values.push(hashPassword(password)); }
  if (role) { updates.push('role = ?'); values.push(role); }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  updates.push("updated_at = datetime('now')");
  values.push(userId);

  db.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).run(...values);

  const user = db.prepare(
    'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?'
  ).get(userId);

  res.json({ user });
});

// DELETE /api/users/:id
router.delete('/:id', (req: Request, res: Response): void => {
  const userId = parseInt(req.params.id as string);

  if (userId === req.user!.id) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);

  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  res.json({ message: 'User deleted' });
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', (req: Request, res: Response): void => {
  const userId = parseInt(req.params.id as string);
  const { password } = req.body;

  if (!password || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  db.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(hashPassword(password), userId);

  res.json({ message: 'Password reset' });
});

// GET /api/users/:id/usage
router.get('/:id/usage', (req: Request, res: Response): void => {
  const userId = parseInt(req.params.id as string);
  const days = parseInt(req.query.days as string) || 30;

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const usage = getUserUsage(userId, days);
  res.json({ usage, days });
});

export default router;
