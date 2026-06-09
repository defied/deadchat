import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import { enqueue, getJob, listJobs, cancel } from '../services/jobQueue';
import type { JobType } from '../types/models';

const router = Router();

router.use(authenticate);

// GET /api/jobs
router.get('/', (req: Request, res: Response): void => {
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const jobs = listJobs(req.user!.id, limit);
  res.json(jobs);
});

// GET /api/jobs/:id
router.get('/:id', (req: Request, res: Response): void => {
  const job = getJob(parseInt(String(req.params.id), 10));
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  if (job.user_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  res.json(job);
});

// POST /api/jobs — admin only
router.post('/', adminOnly, (req: Request, res: Response): void => {
  const { type, params, priority, heavy } = req.body as {
    type: JobType;
    params?: Record<string, unknown>;
    priority?: number;
    heavy?: boolean;
  };
  if (!type) { res.status(400).json({ error: 'type is required' }); return; }

  const jobId = enqueue(type, params ?? {}, {
    userId: req.user!.id,
    priority,
    heavy,
  });
  res.status(201).json({ job_id: jobId });
});

// DELETE /api/jobs/:id
router.delete('/:id', (req: Request, res: Response): void => {
  const job = getJob(parseInt(String(req.params.id), 10));
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  if (job.user_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  const canceled = cancel(job.id);
  res.json({ canceled });
});

export default router;
