import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { enqueue } from '../services/jobQueue';

const router = Router();

router.use(authenticate);

// POST /api/generate/image — enqueue an image generation job
router.post('/image', (req: Request, res: Response): void => {
  const { prompt, width, height, steps, cfg, seed, model } = req.body as {
    prompt?: string; width?: number; height?: number;
    steps?: number; cfg?: number; seed?: number; model?: string;
  };
  if (!prompt) { res.status(400).json({ error: 'prompt is required' }); return; }

  const jobId = enqueue('image', { prompt, width, height, steps, cfg, seed, model }, {
    userId: req.user!.id,
    heavy: true,
  });
  res.status(202).json({ job_id: jobId, status: 'queued' });
});

// POST /api/generate/video — enqueue a video generation job
router.post('/video', (req: Request, res: Response): void => {
  const { prompt, width, height, steps, cfg, seed, model, frames, fps } = req.body as {
    prompt?: string; width?: number; height?: number;
    steps?: number; cfg?: number; seed?: number; model?: string;
    frames?: number; fps?: number;
  };
  if (!prompt) { res.status(400).json({ error: 'prompt is required' }); return; }

  const jobId = enqueue('video', {
    prompt, width: width ?? 512, height: height ?? 512,
    steps, cfg, seed, model, frames, fps,
  }, {
    userId: req.user!.id,
    heavy: true,
  });
  res.status(202).json({ job_id: jobId, status: 'queued' });
});

export default router;
