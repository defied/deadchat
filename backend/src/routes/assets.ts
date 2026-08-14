import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import * as assetPipeline from '../services/assetPipeline';
import { listAssetTypes } from '../services/assetTypes/registry';

const router = Router();

router.use(authenticate);

function parseId(req: Request): number {
  return parseInt(String(req.params.id), 10);
}

function ownedAsset(req: Request, res: Response): ReturnType<typeof assetPipeline.getAsset> {
  const asset = assetPipeline.getAsset(parseId(req));
  if (!asset) { res.status(404).json({ error: 'Asset not found' }); return null; }
  if (asset.user_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return asset;
}

// GET /api/assets/types
router.get('/types', (_req: Request, res: Response): void => {
  res.json({ types: listAssetTypes() });
});

// GET /api/assets
router.get('/', (req: Request, res: Response): void => {
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  res.json(assetPipeline.listAssets(req.user!.id, limit));
});

// POST /api/assets  { asset_type, name?, input }
router.post('/', (req: Request, res: Response): void => {
  const { asset_type, name, input } = req.body as {
    asset_type?: string; name?: string; input?: Record<string, unknown>;
  };
  if (!asset_type) { res.status(400).json({ error: 'asset_type is required' }); return; }

  try {
    const asset = assetPipeline.createAsset(asset_type, input ?? {}, { userId: req.user!.id, name });
    res.status(201).json(asset);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/assets/:id
router.get('/:id', (req: Request, res: Response): void => {
  const asset = ownedAsset(req, res);
  if (!asset) return;
  res.json({ ...asset, revisions: assetPipeline.listRevisions(asset.id) });
});

// GET /api/assets/:id/estimate
router.get('/:id/estimate', (req: Request, res: Response): void => {
  const asset = ownedAsset(req, res);
  if (!asset) return;
  res.json(assetPipeline.getEstimate(asset.id));
});

// POST /api/assets/:id/revise  { note }
router.post('/:id/revise', async (req: Request, res: Response): Promise<void> => {
  const asset = ownedAsset(req, res);
  if (!asset) return;
  const { note } = req.body as { note?: string };
  if (!note || !note.trim()) { res.status(400).json({ error: 'note is required' }); return; }

  try {
    const updated = await assetPipeline.requestRevision(asset.id, req.user!.id, note.trim());
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/assets/:id/approve  { holdFinal? }
router.post('/:id/approve', (req: Request, res: Response): void => {
  const asset = ownedAsset(req, res);
  if (!asset) return;
  const { holdFinal } = req.body as { holdFinal?: boolean };

  try {
    const updated = assetPipeline.approve(asset.id, { holdFinal });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/assets/:id/render-final
router.post('/:id/render-final', (req: Request, res: Response): void => {
  const asset = ownedAsset(req, res);
  if (!asset) return;

  try {
    const updated = assetPipeline.requestFinal(asset.id);
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /api/assets/:id
router.delete('/:id', (req: Request, res: Response): void => {
  const asset = ownedAsset(req, res);
  if (!asset) return;
  res.json(assetPipeline.cancelAsset(asset.id));
});

export default router;
