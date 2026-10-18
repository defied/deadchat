import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { UPLOAD_URL_PREFIX } from '../services/attachments';

const router = Router();

router.use(authenticate);

// POST /api/upload
router.post('/', upload.single('file'), (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const url = `${UPLOAD_URL_PREFIX}${req.file.filename}`;
  res.json({
    // Shape the chat composer sends back on the WebSocket `chat` message.
    attachment: {
      id: req.file.filename,
      filename: req.file.originalname,
      url,
      type: req.file.mimetype,
      size: req.file.size,
    },
    // Legacy shape (kept for API clients).
    file: {
      originalName: req.file.originalname,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: url,
    },
  });
});

export default router;
