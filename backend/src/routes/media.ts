import { Router, Request, Response } from 'express';
import fs from 'fs';
import { authenticate } from '../middleware/auth';
import { getMedia, getMediaPath, listMedia, deleteMedia } from '../services/mediaStore';

const router = Router();

router.use(authenticate);

// GET /api/media
router.get('/', (req: Request, res: Response): void => {
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const offset = parseInt(String(req.query.offset || '0'), 10);
  res.json(listMedia(req.user!.id, limit, offset));
});

// GET /api/media/:id — Range-aware streaming (required for video scrubbing)
router.get('/:id', (req: Request, res: Response): void => {
  const media = getMedia(parseInt(String(req.params.id), 10));
  if (!media) { res.status(404).json({ error: 'Not found' }); return; }
  if (media.user_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const filePath = getMediaPath(media.filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found on disk' }); return;
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const rangeHeader = req.headers.range;

  res.setHeader('Content-Type', media.mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=86400');

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : total - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': chunkSize,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', total);
    res.writeHead(200);
    fs.createReadStream(filePath).pipe(res);
  }
});

// DELETE /api/media/:id — delete media item + file from disk
router.delete('/:id', (req: Request, res: Response): void => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const ok = deleteMedia(id, req.user!.id, req.user!.role === 'admin');
  if (!ok) { res.status(404).json({ error: 'Not found or forbidden' }); return; }
  res.json({ deleted: true });
});

export default router;
