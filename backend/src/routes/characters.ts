import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import * as characters from '../services/characters';
import * as assetPipeline from '../services/assetPipeline';
import { enqueue } from '../services/jobQueue';
import { saveMedia } from '../services/mediaStore';
import type { Character } from '../types/models';

const router = Router();

router.use(authenticate);

// Scoped to this route (not the generic /api/upload path, whose allowlist has
// no audio MIME types and whose response shape doesn't match FileUpload.tsx's
// expectations anyway - out of scope to fix here). Memory storage since
// reference clips are small and we write them straight to mediaStore.
const AUDIO_MIMETYPES = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];
const uploadVoice = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (AUDIO_MIMETYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`File type ${file.mimetype} is not allowed - expected an audio clip`));
  },
});

function ownedCharacter(req: Request, res: Response): Character | null {
  const character = characters.getCharacter(parseInt(String(req.params.id), 10));
  if (!character) { res.status(404).json({ error: 'Character not found' }); return null; }
  if (character.user_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return character;
}

function characterDetail(character: Character) {
  const portrait = characters.getLatestCharacterAsset(character.id, 'portrait');
  const voice = characters.getLatestCharacterAsset(character.id, 'voice');
  return {
    ...character,
    portrait: portrait ? assetPipeline.getAsset(portrait.asset_id) : null,
    voice: voice ? assetPipeline.getAsset(voice.asset_id) : null,
  };
}

// GET /api/characters
router.get('/', (req: Request, res: Response): void => {
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  res.json(characters.listCharacters(req.user!.id, limit).map(characterDetail));
});

// POST /api/characters  { name, description? }
router.post('/', (req: Request, res: Response): void => {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name || !name.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const character = characters.createCharacter(req.user!.id, name.trim(), description);
  res.status(201).json(character);
});

// GET /api/characters/:id
router.get('/:id', (req: Request, res: Response): void => {
  const character = ownedCharacter(req, res);
  if (!character) return;
  res.json(characterDetail(character));
});

// DELETE /api/characters/:id
router.delete('/:id', (req: Request, res: Response): void => {
  const character = ownedCharacter(req, res);
  if (!character) return;
  res.json({ deleted: characters.deleteCharacter(character.id) });
});

// POST /api/characters/:id/portrait  { input: { prompt, ... } }
router.post('/:id/portrait', (req: Request, res: Response): void => {
  const character = ownedCharacter(req, res);
  if (!character) return;
  const { input } = req.body as { input?: Record<string, unknown> };

  try {
    const asset = assetPipeline.createAsset('character_portrait', input ?? {}, { userId: req.user!.id });
    characters.linkCharacterAsset(character.id, asset.id, 'portrait');
    res.status(201).json(asset);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/characters/:id/voice  multipart: reference_audio file + sampleText/language fields
router.post('/:id/voice', uploadVoice.single('reference_audio'), (req: Request, res: Response): void => {
  const character = ownedCharacter(req, res);
  if (!character) return;
  if (!req.file) { res.status(400).json({ error: 'reference_audio file is required' }); return; }

  const { sampleText, language } = req.body as { sampleText?: string; language?: string };

  try {
    const media = saveMedia({
      userId: req.user!.id,
      type: 'audio',
      bytes: req.file.buffer,
      mime: req.file.mimetype,
      originalFilename: req.file.originalname,
    });
    const asset = assetPipeline.createAsset(
      'character_voice',
      { referenceMediaId: media.id, sampleText, language },
      { userId: req.user!.id }
    );
    characters.linkCharacterAsset(character.id, asset.id, 'voice');
    res.status(201).json(asset);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/characters/:id/speak  { text, language? }
// Ad-hoc dialogue line - NOT wrapped in the draft/approve pipeline (a per-line
// review step would be tedious for arbitrary dialogue). Enqueues directly and
// returns 202 immediately; the frontend polls GET /api/jobs/:id, same as
// every other job in this codebase - awaiting synchronously here would risk
// nginx's default 60s proxy_read_timeout on a job that may need to wait for
// the queue, evict Ollama, and synthesize.
router.post('/:id/speak', (req: Request, res: Response): void => {
  const character = ownedCharacter(req, res);
  if (!character) return;
  const { text, language } = req.body as { text?: string; language?: string };
  if (!text || !text.trim()) { res.status(400).json({ error: 'text is required' }); return; }

  const voiceLink = characters.getLatestCharacterAsset(character.id, 'voice');
  if (!voiceLink) { res.status(400).json({ error: 'Character has no voice set up yet' }); return; }
  const voiceAsset = assetPipeline.getAsset(voiceLink.asset_id);
  const referenceMediaId = voiceAsset?.final_media_id ?? voiceAsset?.draft_media_id;
  if (!voiceAsset || !referenceMediaId) {
    res.status(400).json({ error: `Character's voice is not ready yet (stage: ${voiceAsset?.stage ?? 'unknown'})` });
    return;
  }

  const jobId = enqueue('tts', { referenceMediaId, prompt: text.trim(), language: language ?? 'en' }, {
    userId: req.user!.id,
    heavy: true,
  });
  res.status(202).json({ job_id: jobId, status: 'queued' });
});

export default router;
