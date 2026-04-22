import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { generateImage } from '../services/ollama';

const router = Router();

router.use(authenticate);

// POST /api/generate/image
router.post('/image', async (req: Request, res: Response): Promise<void> => {
  const { prompt } = req.body;

  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }

  try {
    const result = await generateImage(prompt);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Image generation failed' });
  }
});

// POST /api/generate/video
router.post('/video', (_req: Request, res: Response): void => {
  res.json({
    success: false,
    message: 'Video generation is coming soon. This feature is not yet available.',
  });
});

export default router;
