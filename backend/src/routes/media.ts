import { Router, Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { getMedia, getMediaPath, listMedia, deleteMedia, saveMedia } from '../services/mediaStore';

const router = Router();

router.use(authenticate);

const uploadImage = multer({
  storage: multer.memoryStorage(),
  // 200 MB: imported videos from external sites (Dreamina, Flow, Kling…) can be large.
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|webp)$/.test(file.mimetype) || /^video\/(mp4|webm|quicktime)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Upload a PNG, JPEG or WebP image, or an MP4/WebM/MOV video'));
  },
});

// POST /api/media/upload — add your own image or video to the gallery
// (a start frame for video, or a result imported from another site).
// Form fields: image|file (the file), prompt?, source? (e.g. "Dreamina · Seedance 2.5")
router.post('/upload', uploadImage.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]), (req: Request, res: Response): void => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const file = files?.image?.[0] ?? files?.file?.[0];
  if (!file) { res.status(400).json({ error: 'file is required' }); return; }
  const source = typeof req.body?.source === 'string' ? req.body.source.slice(0, 120) : null;
  const prompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim() ? req.body.prompt.slice(0, 4000) : null;
  const media = saveMedia({
    userId: req.user!.id,
    type: file.mimetype.startsWith('video/') ? 'video' : 'image',
    bytes: file.buffer,
    mime: file.mimetype,
    originalFilename: file.originalname,
    prompt: prompt ?? `Uploaded: ${file.originalname}`,
    meta: { uploaded: true, ...(source ? { source, modelLabel: source } : {}), ...(prompt ? { finalPrompt: prompt } : {}) },
  });
  res.status(201).json(media);
});

// GET /api/media
router.get('/', (req: Request, res: Response): void => {
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const offset = parseInt(String(req.query.offset || '0'), 10);
  const type = ['image', 'video', 'audio'].includes(String(req.query.type)) ? (String(req.query.type) as 'image' | 'video' | 'audio') : undefined;
  res.json(listMedia(req.user!.id, limit, offset, type));
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
