import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import { enqueue } from '../services/jobQueue';
import { getMedia } from '../services/mediaStore';
import { MEDIA_MODELS, getMediaModel, type Ratio } from '../services/media/catalog';
import { availabilityFor, invalidateAvailability } from '../services/media/runner';
import { getMediaSettings, updateMediaSettings } from '../services/media/settings';
import { describeModel, type CatalogJobParams } from '../services/media/process';

const router = Router();

router.use(authenticate);

// GET /api/generate/models — catalog + live availability + defaults
router.get('/models', async (_req: Request, res: Response): Promise<void> => {
  const availability = await availabilityFor();
  const settings = getMediaSettings();
  res.json({
    models: MEDIA_MODELS.map((m) => ({ ...describeModel(m), ...availability[m.id] })),
    defaults: { image: settings.defaultImageModel, video: settings.defaultVideoModel },
    enhanceByDefault: settings.enhanceByDefault,
    hostedEnabled: settings.apiKeySet,
  });
});

// POST /api/generate/jobs — enqueue a catalog image/video job.
// (Not POST /api/generate: that path is the Ollama-compatible API in publicApi.ts.)
router.post('/jobs', (req: Request, res: Response): void => {
  const b = (req.body || {}) as Partial<CatalogJobParams>;
  const model = typeof b.catalogId === 'string' ? getMediaModel(b.catalogId) : undefined;
  if (!model) { res.status(400).json({ error: 'Unknown model' }); return; }
  if (typeof b.prompt !== 'string' || !b.prompt.trim()) { res.status(400).json({ error: 'prompt is required' }); return; }
  if (b.imageMediaId != null) {
    const media = getMedia(Number(b.imageMediaId));
    if (!media || media.type !== 'image' || (media.user_id !== req.user!.id && req.user!.role !== 'admin')) {
      res.status(400).json({ error: 'Start image not found' }); return;
    }
  }
  if (model.needsImage && b.imageMediaId == null) {
    res.status(400).json({ error: `${model.label} needs a start image` }); return;
  }

  const params: CatalogJobParams = {
    catalogId: model.id,
    prompt: b.prompt.trim().slice(0, 4000),
    negative: typeof b.negative === 'string' ? b.negative.slice(0, 2000) : undefined,
    ratio: b.ratio as Ratio | undefined,
    resolution: typeof b.resolution === 'string' ? b.resolution : undefined,
    duration: b.duration != null ? Number(b.duration) : undefined,
    seed: b.seed != null && Number.isFinite(Number(b.seed)) ? Number(b.seed) : undefined,
    fast: !!b.fast,
    audio: b.audio !== false,
    enhance: b.enhance !== false,
    verifyAttempts: model.kind === 'image' ? Math.min(3, Math.max(1, Number(b.verifyAttempts) || 1)) : 1,
    imageMediaId: b.imageMediaId != null ? Number(b.imageMediaId) : undefined,
  };

  const jobId = enqueue(model.kind, params as unknown as Record<string, unknown>, {
    userId: req.user!.id,
    // Hosted jobs don't use the local GPU, but they still run one at a time
    // through the worker so ComfyUI's queue stays simple.
    heavy: true,
  });
  res.status(202).json({ job_id: jobId, status: 'queued' });
});

// Legacy endpoints (agents, older clients): mapped onto the catalog defaults by the worker.
router.post('/image', (req: Request, res: Response): void => {
  const { prompt, width, height, steps, cfg, seed, model } = req.body as Record<string, unknown>;
  if (!prompt) { res.status(400).json({ error: 'prompt is required' }); return; }
  const jobId = enqueue('image', { prompt, width, height, steps, cfg, seed, model }, { userId: req.user!.id, heavy: true });
  res.status(202).json({ job_id: jobId, status: 'queued' });
});

router.post('/video', (req: Request, res: Response): void => {
  const { prompt, width, height, steps, cfg, seed, model, frames, fps } = req.body as Record<string, unknown>;
  if (!prompt) { res.status(400).json({ error: 'prompt is required' }); return; }
  const jobId = enqueue('video', { prompt, width, height, steps, cfg, seed, model, frames, fps }, { userId: req.user!.id, heavy: true });
  res.status(202).json({ job_id: jobId, status: 'queued' });
});

// Admin: media settings (comfy.org key for hosted models, defaults).
router.get('/settings', adminOnly, (_req: Request, res: Response): void => {
  res.json(getMediaSettings());
});

router.put('/settings', adminOnly, (req: Request, res: Response): void => {
  const b = (req.body || {}) as Record<string, unknown>;
  for (const k of ['defaultImageModel', 'defaultVideoModel'] as const) {
    if (b[k] !== undefined) {
      const m = getMediaModel(String(b[k]));
      const want = k === 'defaultImageModel' ? 'image' : 'video';
      if (!m || m.kind !== want) { res.status(400).json({ error: `${k} must be a ${want} model id` }); return; }
    }
  }
  if (b.apiKey !== undefined && b.apiKey !== null && (typeof b.apiKey !== 'string' || b.apiKey.trim().length < 10)) {
    res.status(400).json({ error: 'apiKey looks invalid' }); return;
  }
  const s = updateMediaSettings({
    apiKey: b.apiKey === undefined ? undefined : (b.apiKey as string | null) || null,
    defaultImageModel: b.defaultImageModel as string | undefined,
    defaultVideoModel: b.defaultVideoModel as string | undefined,
    enhanceByDefault: typeof b.enhanceByDefault === 'boolean' ? b.enhanceByDefault : undefined,
  });
  invalidateAvailability();
  res.json(s);
});

export default router;
