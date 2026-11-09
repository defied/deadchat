// Screenplays: the script document (written only by the user), plus the
// example frames, music cues, character photos and reference images DeadChat
// keeps in step with it.

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { ELEMENT_TYPES, emptyDoc, type Character, type PlanItem, type Screenplay, type ScreenplayDoc, type ScreenplayMedia } from '../services/screenplay/types';
import * as store from '../services/screenplay/store';
import {
  REF_VIEWS,
  addReference,
  planAll,
  queueCharacterRefs,
  reconcile,
  refineAppearance,
  scheduleReconcile,
  syncJobs,
  type RefView,
} from '../services/screenplay/render';
import { planMusic } from '../services/screenplay/prompts';

const router = Router();
router.use(authenticate);

async function wrap(res: Response, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    const out = await fn();
    if (!res.headersSent) res.json(out);
  } catch (e) {
    if (e instanceof store.VersionConflict) {
      res.status(409).json({ error: e.message, current: e.current });
      return;
    }
    if (!res.headersSent) res.status(400).json({ error: (e as Error).message });
  }
}

function owned(req: Request, res: Response, next: NextFunction): void {
  const sp = store.getScreenplay(Number(req.params.id));
  if (!sp || (sp.userId !== req.user!.id && req.user!.role !== 'admin')) {
    res.status(404).json({ error: 'Screenplay not found' });
    return;
  }
  res.locals.sp = sp;
  next();
}

const sp = (res: Response): Screenplay => res.locals.sp as Screenplay;

// ── validation ───────────────────────────────────────────────────────────────

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
const id = (v: unknown): string => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : '');

function oneOf<T extends string>(v: unknown, opts: readonly T[]): T | undefined {
  return opts.includes(v as T) ? (v as T) : undefined;
}

/** Keep only well-formed fields, with sane sizes. */
export function cleanDoc(raw: unknown): ScreenplayDoc {
  const d = (raw ?? {}) as Partial<ScreenplayDoc>;
  const base = emptyDoc();
  const elements = (Array.isArray(d.elements) ? d.elements : [])
    .slice(0, 20000)
    .map((e) => ({ id: id(e?.id), type: oneOf(e?.type, ELEMENT_TYPES) ?? 'action', text: str(e?.text, 20000) ?? '' }))
    .filter((e) => e.id);
  const shots = (Array.isArray(d.shots) ? d.shots : []).slice(0, 5000).map((s) => ({
    id: id(s?.id),
    anchorId: id(s?.anchorId),
    type: str(s?.type, 120),
    seconds: num(s?.seconds, 0, 3600),
    lens: num(s?.lens, 8, 800),
    music: str(s?.music, 600),
    notes: str(s?.notes, 2000),
    adjustments: (Array.isArray(s?.adjustments) ? s.adjustments : [])
      .slice(0, 40)
      .map((a) => ({ id: id(a?.id), text: str(a?.text, 600) ?? '', ...(a?.off === true ? { off: true } : {}) }))
      .filter((a) => a.id),
    take: num(s?.take, 0, 1e6),
  })).filter((s) => s.id && s.anchorId);
  const characters: Character[] = (Array.isArray(d.characters) ? d.characters : []).slice(0, 500).map((c) => ({
    id: id(c?.id),
    name: str(c?.name, 120) ?? '',
    kind: oneOf(c?.kind, ['human', 'animal', 'creature', 'robot', 'alien', 'spirit', 'other'] as const),
    species: str(c?.species, 120),
    age: str(c?.age, 40),
    gender: str(c?.gender, 60),
    role: str(c?.role, 120),
    appearance: str(c?.appearance, 3000),
    wardrobe: str(c?.wardrobe, 1500),
    personality: str(c?.personality, 3000),
    backstory: str(c?.backstory, 8000),
    voice: str(c?.voice, 1000),
    notes: str(c?.notes, 4000),
    primaryRefId: num(c?.primaryRefId, 1, Number.MAX_SAFE_INTEGER),
  })).filter((c) => c.id);
  const plans: ScreenplayDoc['plans'] = {};
  for (const [k, p] of Object.entries(d.plans && typeof d.plans === 'object' ? d.plans : {}).slice(0, 2000)) {
    if (!id(k)) continue;
    const items: PlanItem[] = (Array.isArray(p?.items) ? p.items : []).slice(0, 300).map((it) => ({
      id: id(it?.id),
      kind: oneOf(it?.kind, ['character', 'camera', 'light', 'prop'] as const) ?? 'prop',
      x: num(it?.x, -500, 500) ?? 0,
      y: num(it?.y, -500, 500) ?? 0,
      rot: num(it?.rot, -720, 720) ?? 0,
      ref: it?.ref ? id(it.ref) || undefined : undefined,
      label: str(it?.label, 80),
      lens: num(it?.lens, 8, 800),
      height: oneOf(it?.height, ['ground', 'low', 'eye', 'high', 'overhead'] as const),
      color: oneOf(it?.color, ['warm', 'neutral', 'cool', 'moonlight', 'red', 'green', 'blue'] as const),
      quality: oneOf(it?.quality, ['soft', 'hard'] as const),
      practical: it?.practical === true ? true : undefined,
      w: num(it?.w, 0.1, 50),
      h: num(it?.h, 0.1, 50),
    })).filter((it) => it.id);
    plans[k] = { items };
  }
  const s = d.settings ?? {};
  const t = d.titlePage ?? {};
  return {
    elements: elements.length ? elements : base.elements,
    shots,
    characters,
    plans,
    settings: {
      imageModel: str(s.imageModel, 80),
      ratio: oneOf(s.ratio, ['16:9', '21:9', '4:3', '1:1', '9:16'] as const) ?? base.settings.ratio,
      style: str(s.style, 600),
      paused: s.paused === true ? true : undefined,
    },
    titlePage: {
      title: str(t.title, 200),
      credit: str(t.credit, 100),
      author: str(t.author, 300),
      source: str(t.source, 300),
      contact: str(t.contact, 600),
      draftDate: str(t.draftDate, 60),
    },
  };
}

// ── views ────────────────────────────────────────────────────────────────────

function mediaView(rows: ScreenplayMedia[]) {
  // Frames and music: the newest row (maybe still rendering) and the newest finished one.
  const latest: Record<string, ScreenplayMedia> = {};
  const lastReady: Record<string, ScreenplayMedia> = {};
  const other: ScreenplayMedia[] = [];
  for (const r of rows) {
    if (r.role === 'frame' || r.role === 'music') {
      const k = `${r.role}:${r.target}`;
      if (r.status !== 'superseded') latest[k] = r;
      if (r.status === 'ready') lastReady[k] = r;
    } else if (r.status !== 'superseded') other.push(r);
  }
  return { latest, lastReady, other };
}

function detail(s: Screenplay) {
  syncJobs(s.id);
  const plans = planAll(s);
  return {
    screenplay: s,
    plans: Object.fromEntries(
      s.doc.shots.map((shot) => {
        const p = plans.get(shot.id)!;
        return [
          shot.id,
          {
            waiting: p.waiting,
            blocked: p.blocked,
            prompt: p.prompt,
            basePrompt: p.basePrompt,
            adjusting: p.adjusting,
            adjustNote: p.adjustNote,
            staging: p.staging,
            characters: p.characters,
            music: planMusic(shot).prompt,
          },
        ];
      }),
    ),
    media: mediaView(store.listMedia(s.id)),
  };
}

// ── routes ───────────────────────────────────────────────────────────────────

router.get('/', (req, res) => wrap(res, () => ({ screenplays: store.listScreenplays(req.user!.id) })));

router.post('/', (req, res) =>
  wrap(res, () => {
    const title = (str(req.body?.title, 200) ?? '').trim() || 'Untitled screenplay';
    const doc = req.body?.doc ? cleanDoc(req.body.doc) : emptyDoc();
    if (!doc.titlePage?.title) doc.titlePage = { ...doc.titlePage, title };
    return { screenplay: store.createScreenplay(req.user!.id, title, doc) };
  }),
);

router.get('/:id', owned, (_req, res) =>
  wrap(res, () => {
    scheduleReconcile(sp(res).id, 250);
    return detail(sp(res));
  }),
);

router.put('/:id', owned, (req, res) =>
  wrap(res, () => {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version)) throw new Error('version is required');
    const saved = store.saveScreenplay(sp(res).id, version, {
      title: str(req.body?.title, 200)?.trim() || undefined,
      doc: req.body?.doc ? cleanDoc(req.body.doc) : undefined,
    });
    scheduleReconcile(saved.id, 300);
    return { version: saved.version, updatedAt: saved.updatedAt };
  }),
);

router.delete('/:id', owned, (_req, res) =>
  wrap(res, () => {
    store.deleteScreenplay(sp(res).id);
    return { ok: true };
  }),
);

/** Render out-of-date shots now, without waiting for the description to settle. */
router.post('/:id/render-now', owned, (_req, res) =>
  wrap(res, () => {
    reconcile(sp(res).id, Date.now(), true);
    return detail(store.getScreenplay(sp(res).id)!);
  }),
);

function characterOf(s: Screenplay, cid: string): Character {
  const c = s.doc.characters.find((x) => x.id === cid);
  if (!c) throw new Error('Save the character first');
  return c;
}

router.post('/:id/characters/:cid/refs', owned, (req, res) =>
  wrap(res, () => {
    const c = characterOf(sp(res), String(req.params.cid));
    if (!c.appearance?.trim() && !c.species && !c.kind) throw new Error('Describe how the character looks first');
    const views = (Array.isArray(req.body?.views) ? req.body.views : ['portrait', 'full'])
      .filter((v: unknown): v is RefView => REF_VIEWS.includes(v as RefView))
      .slice(0, 8);
    if (!views.length) throw new Error('Pick at least one view');
    queueCharacterRefs(sp(res), c, views);
    return detail(sp(res));
  }),
);

router.post('/:id/characters/:cid/refine', owned, (req, res) =>
  wrap(res, async () => {
    const c = characterOf(sp(res), String(req.params.cid));
    const notes = (str(req.body?.notes, 3000) ?? '').trim();
    if (!notes && !c.appearance?.trim()) throw new Error('Write some notes about how the character looks');
    return { appearance: await refineAppearance(c, notes || 'Tighten this into a clear visual description.') };
  }),
);

router.post('/:id/references', owned, (req, res) =>
  wrap(res, () => {
    const data = str(req.body?.data, 30 * 1024 * 1024) ?? '';
    const mime = str(req.body?.mime, 60) ?? '';
    if (!data) throw new Error('No image');
    const target = req.body?.target ? id(req.body.target) : '';
    addReference(sp(res), target, { bytes: Buffer.from(data, 'base64'), mime, filename: str(req.body?.filename, 200) });
    return detail(sp(res));
  }),
);

router.patch('/:id/media/:mid', owned, (req, res) =>
  wrap(res, () => {
    const row = store.getMedia(Number(req.params.mid));
    if (!row || row.screenplay_id !== sp(res).id) throw new Error('Not found');
    if (row.role === 'reference') {
      store.updateMedia(row.id, {
        ...(req.body?.target !== undefined ? { target: req.body.target ? id(req.body.target) : '' } : {}),
        ...(req.body?.caption !== undefined ? { caption: (str(req.body.caption, 800) ?? '').trim() || null, error: null } : {}),
      });
      scheduleReconcile(sp(res).id, 0);
    }
    return detail(sp(res));
  }),
);

router.delete('/:id/media/:mid', owned, (req, res) =>
  wrap(res, () => {
    const row = store.getMedia(Number(req.params.mid));
    if (!row || row.screenplay_id !== sp(res).id) throw new Error('Not found');
    if (row.role !== 'reference' && row.role !== 'character') throw new Error('Only reference and character photos can be removed');
    store.deleteMedia(row.id);
    if (row.role === 'reference') scheduleReconcile(sp(res).id, 0);
    return detail(sp(res));
  }),
);

export default router;
