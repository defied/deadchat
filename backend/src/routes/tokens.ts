import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { createToken, listTokens, revokeToken } from '../services/apiTokens';

const router = Router();

router.use(authenticate);

// GET /api/tokens — list caller's tokens
router.get('/', (req: Request, res: Response): void => {
  const rows = listTokens(req.user!.id);
  res.json({
    tokens: rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
    })),
  });
});

// POST /api/tokens — create token; plaintext returned ONCE
router.post('/', (req: Request, res: Response): void => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const { token, row } = createToken(req.user!.id, name.trim());
  res.status(201).json({
    token,
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
  });
});

// DELETE /api/tokens/:id — revoke
router.delete('/:id', (req: Request, res: Response): void => {
  const id = parseInt(req.params.id as string);
  const ok = revokeToken(req.user!.id, id);
  if (!ok) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }
  res.json({ message: 'Token revoked' });
});

export default router;
