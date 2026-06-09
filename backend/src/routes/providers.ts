import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import {
  listProviders,
  getProviderById,
  upsertProvider,
  deleteProvider,
} from '../services/providers/registry';
import { encrypt } from '../services/secrets';
import type { Provider, ProviderKind, MediaCapability } from '../types/models';

const router = Router();

router.use(authenticate);
router.use(adminOnly);

// GET /api/providers
router.get('/', (_req: Request, res: Response): void => {
  res.json(listProviders().map(stripSecrets));
});

// GET /api/providers/:id
router.get('/:id', (req: Request, res: Response): void => {
  const p = getProviderById(parseInt(String(req.params.id), 10));
  if (!p) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(stripSecrets(p));
});

// POST /api/providers
router.post('/', (req: Request, res: Response): void => {
  const { name, kind, capability, base_url, config, priority, enabled, api_key } = req.body as {
    name: string; kind: ProviderKind; capability: MediaCapability;
    base_url?: string; config?: Record<string, unknown>;
    priority?: number; enabled?: boolean; api_key?: string;
  };
  if (!name || !kind || !capability) {
    res.status(400).json({ error: 'name, kind, and capability are required' }); return;
  }
  const secrets = api_key ? encrypt(JSON.stringify({ api_key })) : null;
  const p = upsertProvider({
    name, kind, capability,
    enabled: enabled !== false ? 1 : 0,
    is_default: 0,
    priority: priority ?? (kind === 'local_comfyui' ? 100 : 10),
    base_url: base_url ?? null,
    config: JSON.stringify(config ?? {}),
    secrets,
  });
  res.status(201).json(stripSecrets(p));
});

// PATCH /api/providers/:id
router.patch('/:id', (req: Request, res: Response): void => {
  const existing = getProviderById(parseInt(String(req.params.id), 10));
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  const { api_key, config, ...rest } = req.body as Record<string, unknown>;
  const secrets = api_key
    ? encrypt(JSON.stringify({ api_key }))
    : existing.secrets;
  const merged: Provider = {
    ...existing,
    ...(rest as Partial<Provider>),
    config: config ? JSON.stringify(config) : existing.config,
    secrets: secrets ?? null,
  };
  const p = upsertProvider(merged);
  res.json(stripSecrets(p));
});

// DELETE /api/providers/:id
router.delete('/:id', (req: Request, res: Response): void => {
  const deleted = deleteProvider(parseInt(String(req.params.id), 10));
  res.json({ deleted });
});

function stripSecrets(p: Provider): Omit<Provider, 'secrets'> {
  const { secrets: _, ...safe } = p;
  return safe;
}

export default router;
