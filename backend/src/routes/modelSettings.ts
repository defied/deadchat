import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import {
  listModelSettings,
  getModelSettings,
  upsertModelSettings,
  deleteModelSettings,
} from '../services/modelSettings';

const router = Router();

router.use(authenticate, adminOnly);

// GET /api/admin/model-settings
router.get('/', (_req: Request, res: Response): void => {
  res.json({ settings: listModelSettings() });
});

// GET /api/admin/model-settings/:model
router.get('/:model', (req: Request, res: Response): void => {
  const s = getModelSettings(req.params.model as string);
  if (!s) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ settings: s });
});

// PUT /api/admin/model-settings/:model  body: { options, enabled }
router.put('/:model', (req: Request, res: Response): void => {
  const model = req.params.model as string;
  const { options, enabled } = req.body;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    res.status(400).json({ error: 'options must be an object' });
    return;
  }
  const s = upsertModelSettings(model, options, enabled !== false);
  res.json({ settings: s });
});

// DELETE /api/admin/model-settings/:model
router.delete('/:model', (req: Request, res: Response): void => {
  const ok = deleteModelSettings(req.params.model as string);
  if (!ok) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
});

export default router;
