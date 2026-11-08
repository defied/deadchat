// Medical cases: a profile, evidence of any kind (DICOM cine and stacks,
// images, video, documents, data), AI notes and a presentation summary.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { authenticate } from '../middleware/auth';
import * as store from '../services/cases/store';
import { CATEGORIES, type CaseItem, type CaseProfile, type Category, type MedicalCase } from '../services/cases/store';
import { ingest, setThumb } from '../services/cases/ingest';
import { describeItem, summarizeCase } from '../services/cases/ai';
import { stacksBySeries } from '../services/cases/dicom';

const router = Router();
router.use(authenticate);

const tmp = path.join(os.tmpdir(), 'deadchat-case-uploads');
fs.mkdirSync(tmp, { recursive: true });
const upload = multer({ dest: tmp, limits: { fileSize: 1024 * 1024 * 1024, files: 1 } });
const thumbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

async function wrap(res: Response, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    const out = await fn();
    if (!res.headersSent) res.json(out);
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ error: (e as Error).message });
  }
}

function owned(req: Request, res: Response, next: NextFunction): void {
  const c = store.getCase(Number(req.params.id));
  if (!c || (c.userId !== req.user!.id && req.user!.role !== 'admin')) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  res.locals.case = c;
  if (req.params.itemId) {
    const item = store.getItem(Number(req.params.itemId));
    if (!item || item.case_id !== c.id) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.locals.item = item;
  }
  next();
}

const theCase = (res: Response): MedicalCase => res.locals.case as MedicalCase;
const theItem = (res: Response): CaseItem => res.locals.item as CaseItem;

// ── validation ───────────────────────────────────────────────────────────────

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
const rid = (v: unknown): string => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : Math.random().toString(36).slice(2, 10));

export function cleanProfile(raw: unknown): CaseProfile {
  const p = (raw ?? {}) as Record<string, unknown>;
  const t = (k: string, max = 6000) => str(p[k], max);
  const v = (p.vitals ?? {}) as Record<string, unknown>;
  return {
    age: t('age', 40),
    sex: t('sex', 40),
    weightKg: num(p.weightKg, 0.1, 500),
    heightCm: num(p.heightCm, 10, 260),
    specialty: t('specialty', 120),
    chiefComplaint: t('chiefComplaint', 600),
    hpi: t('hpi'),
    pmh: t('pmh'),
    diagnoses: t('diagnoses'),
    procedures: t('procedures'),
    medications: t('medications'),
    allergies: t('allergies', 1500),
    familyHistory: t('familyHistory'),
    socialHistory: t('socialHistory'),
    exam: t('exam'),
    vitals: { hr: str(v.hr, 20), bp: str(v.bp, 20), rr: str(v.rr, 20), spo2: str(v.spo2, 20), temp: str(v.temp, 20) },
    question: t('question', 2000),
    teachingPoints: t('teachingPoints'),
    labs: (Array.isArray(p.labs) ? p.labs : []).slice(0, 2000).map((l: Record<string, unknown>) => ({
      id: rid(l?.id),
      date: str(l?.date, 30),
      test: str(l?.test, 120) ?? '',
      value: str(l?.value, 60) ?? '',
      unit: str(l?.unit, 40),
      low: str(l?.low, 30),
      high: str(l?.high, 30),
    })),
    events: (Array.isArray(p.events) ? p.events : []).slice(0, 500).map((e: Record<string, unknown>) => ({
      id: rid(e?.id),
      date: str(e?.date, 30),
      title: str(e?.title, 300) ?? '',
      detail: str(e?.detail, 2000),
    })),
  };
}

// ── views ────────────────────────────────────────────────────────────────────

/** What the browser gets for an item (no file paths beyond what it fetches by index). */
function itemView(i: CaseItem) {
  const { meta } = i;
  return {
    id: i.id,
    kind: i.kind,
    category: i.category,
    title: i.title,
    notes: i.notes,
    takenAt: i.taken_at,
    originalName: i.original_name,
    mime: i.mime,
    sizeBytes: i.size_bytes,
    frames: i.frames,
    status: i.status,
    error: i.error,
    aiNotes: i.ai_notes,
    aiStatus: i.ai_status,
    aiError: i.ai_error,
    maskTop: i.mask_top,
    include: !!i.include,
    sort: i.sort,
    createdAt: i.created_at,
    hasThumb: !!meta.hasThumb,
    hasDisplay: !!meta.display,
    displayMime: meta.displayMime ?? null,
    playable: meta.playable ?? null,
    fps: meta.fps ?? null,
    width: meta.width ?? null,
    height: meta.height ?? null,
    table: meta.table ?? null,
    originals: meta.originals?.length ?? 0,
    stack: !!meta.dicom && stacksBySeries(meta.dicom),
    dicom: meta.dicom ?? null,
  };
}

function detail(c: MedicalCase) {
  return { case: c, items: store.listItems(c.id).map(itemView) };
}

// ── cases ────────────────────────────────────────────────────────────────────

router.get('/', (req, res) =>
  wrap(res, () => ({
    cases: store.listCases(req.user!.id).map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      items: c.items,
      thumbItem: c.thumbItem,
      age: c.profile.age,
      sex: c.profile.sex,
      specialty: c.profile.specialty,
      chiefComplaint: c.profile.chiefComplaint,
    })),
  })),
);

router.post('/', (req, res) =>
  wrap(res, () => {
    const title = (str(req.body?.title, 200) ?? '').trim() || 'Untitled case';
    return detail(store.createCase(req.user!.id, title));
  }),
);

router.get('/:id', owned, (_req, res) => wrap(res, () => detail(theCase(res))));

router.put('/:id', owned, (req, res) =>
  wrap(res, () => {
    const b = req.body ?? {};
    const c = store.updateCase(theCase(res).id, {
      title: str(b.title, 200)?.trim() || undefined,
      profile: b.profile !== undefined ? cleanProfile(b.profile) : undefined,
      ...(b.summary !== undefined ? { summary: str(b.summary, 20000) || null, summarySource: b.summary ? 'user' : null } : {}),
    });
    return detail(c);
  }),
);

router.delete('/:id', owned, (_req, res) =>
  wrap(res, () => {
    store.deleteCase(theCase(res).id);
    return { ok: true };
  }),
);

router.post('/:id/summary', owned, (_req, res) =>
  wrap(res, async () => {
    const c = theCase(res);
    const text = await summarizeCase(c, store.listItems(c.id));
    return detail(store.updateCase(c.id, { summary: text, summarySource: 'ai' }));
  }),
);

router.post('/:id/reorder', owned, (req, res) =>
  wrap(res, () => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);
    store.reorder(theCase(res).id, ids);
    return detail(theCase(res));
  }),
);

// ── items ────────────────────────────────────────────────────────────────────

router.post('/:id/items', owned, upload.single('file'), (req, res) =>
  wrap(res, () => {
    const f = req.file;
    if (!f) throw new Error('No file');
    try {
      const category = CATEGORIES.includes(req.body?.category as Category) ? (req.body.category as Category) : undefined;
      const item = ingest(theCase(res).id, { path: f.path, originalName: f.originalname, mime: f.mimetype, size: f.size }, { category });
      return { item: itemView(item) };
    } catch (e) {
      fs.rmSync(f.path, { force: true });
      throw e;
    }
  }),
);

router.patch('/:id/items/:itemId', owned, (req, res) =>
  wrap(res, () => {
    const b = req.body ?? {};
    store.updateItem(theItem(res).id, {
      ...(b.title !== undefined ? { title: (str(b.title, 300) ?? '').trim() || theItem(res).title } : {}),
      ...(b.category !== undefined && CATEGORIES.includes(b.category) ? { category: b.category as Category } : {}),
      ...(b.notes !== undefined ? { notes: str(b.notes, 8000) || null } : {}),
      ...(b.aiNotes !== undefined ? { ai_notes: str(b.aiNotes, 8000) || null } : {}),
      ...(b.takenAt !== undefined ? { taken_at: str(b.takenAt, 30) || null } : {}),
      ...(b.maskTop !== undefined ? { mask_top: num(b.maskTop, 0, 0.5) ?? 0 } : {}),
      ...(b.include !== undefined ? { include: b.include ? 1 : 0 } : {}),
    });
    store.touchCase(theCase(res).id);
    return { item: itemView(store.getItem(theItem(res).id)!) };
  }),
);

router.delete('/:id/items/:itemId', owned, (_req, res) =>
  wrap(res, () => {
    store.deleteItem(theItem(res));
    return { ok: true };
  }),
);

router.post('/:id/items/:itemId/describe', owned, (_req, res) =>
  wrap(res, () => {
    const item = theItem(res);
    if (item.ai_status === 'running') throw new Error('Already writing notes for this item');
    void describeItem(item, theCase(res));
    return { item: itemView(store.getItem(item.id)!) };
  }),
);

/** Poster frame captured in the browser (videos). */
router.post('/:id/items/:itemId/thumb', owned, thumbUpload.single('thumb'), (req, res) =>
  wrap(res, async () => {
    if (!req.file) throw new Error('No image');
    await setThumb(theItem(res), req.file.buffer);
    const durationS = Number(req.body?.duration);
    if (Number.isFinite(durationS) && durationS > 0) store.mutateItem(theItem(res).id, (it) => ({ meta: { ...it.meta, durationS } }));
    return { item: itemView(store.getItem(theItem(res).id)!) };
  }),
);

// ── files ────────────────────────────────────────────────────────────────────

function send(res: Response, file: string, mime: string, download?: string): void {
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (download) res.setHeader('Content-Disposition', `attachment; filename="${download.replace(/[^\w.\- ]+/g, '_')}"`);
  res.type(mime).sendFile(file);
}

router.get('/:id/items/:itemId/thumb', owned, (_req, res) => send(res, store.itemPath(theItem(res), 'thumb.jpg'), 'image/jpeg'));

router.get('/:id/items/:itemId/frames/:n', owned, (req, res) => {
  const item = theItem(res);
  const f = item.meta.frameFiles?.[Number(req.params.n)];
  if (!f) {
    res.status(404).json({ error: 'No such frame' });
    return;
  }
  send(res, store.itemPath(item, f.file), 'image/jpeg');
});

router.get('/:id/items/:itemId/display', owned, (_req, res) => {
  const item = theItem(res);
  if (!item.meta.display) {
    res.status(404).json({ error: 'Nothing to show for this item' });
    return;
  }
  send(res, store.itemPath(item, item.meta.display), item.meta.displayMime ?? 'application/octet-stream');
});

router.get('/:id/items/:itemId/original/:n', owned, (req, res) => {
  const item = theItem(res);
  const rel = item.meta.originals?.[Number(req.params.n)];
  if (!rel) {
    res.status(404).json({ error: 'No such file' });
    return;
  }
  const name = item.original_name ?? path.basename(rel).replace(/^[a-z0-9]+-/, '');
  send(res, store.itemPath(item, rel), item.mime ?? 'application/octet-stream', name);
});

export default router;
