// Screenplays: the script document (written only by the user), plus the
// example frames, music cues, character photos and reference images DeadChat
// keeps in step with it.

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { ELEMENT_TYPES, emptyDoc, type Character, type Pitch, type PlanItem, type Reel, type ReelItem, type Screenplay, type ScreenplayDoc, type ScreenplayMedia } from '../services/screenplay/types';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import { saveMedia, saveMediaFile } from '../services/mediaStore';
import { createHunt, getHunt, keepCandidate, listHunts } from '../services/screenplay/sounds/gatherer';
import { summarizeShot } from '../services/screenplay/summarize';
import { createFind, findMore, getFind, keepFound, latestFind, ownQueries, propTarget } from '../services/screenplay/finds/finder';
import { queueLines, voiceTarget } from '../services/screenplay/voices';
import { suggestShots } from '../services/screenplay/suggestShots';
import { getLatestCharacterAsset, listCharacters as listStudioCharacters } from '../services/characters';
import { getAsset } from '../services/assetPipeline';
import * as store from '../services/screenplay/store';
import {
  REF_VIEWS,
  addReference,
  planAll,
  refreshShots,
  queueCharacterRefs,
  castCharacter,
  queuePropDrawing,
  recreateCandidates,
  recreateFrame,
  reconcile,
  refineAppearance,
  scheduleReconcile,
  syncJobs,
  type RefView,
} from '../services/screenplay/render';
import { LENS_TYPES, planMusic } from '../services/screenplay/prompts';

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
function cleanPitch(p: any): Pitch | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!p || typeof p !== 'object') return undefined;
  const v = p.vision && typeof p.vision === 'object' ? p.vision : {};
  const r = p.reel && typeof p.reel === 'object' ? p.reel : {};
  const rowId = (x: unknown): number | undefined => (typeof x === "number" && Number.isSafeInteger(x) && x > 0 ? x : undefined);
  const items: ReelItem[] = (Array.isArray(r.items) ? r.items : [])
    .slice(0, 300)
    .map((it: any): ReelItem | null => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const src = it?.source ?? {};
      const source: ReelItem['source'] | null =
        src.kind === 'upload' && rowId(src.mediaRowId) ? { kind: 'upload', mediaRowId: rowId(src.mediaRowId)! } : src.kind === 'frame' && id(src.shotId) ? { kind: 'frame', shotId: id(src.shotId) } : null;
      if (!id(it?.id) || !source) return null;
      const inS = num(it?.in, 0, 36000);
      const outS = num(it?.out, 0, 36000);
      return {
        id: id(it.id),
        source,
        ...(inS !== undefined ? { in: inS } : {}),
        ...(outS !== undefined && (inS === undefined || outS > inS) ? { out: outS } : {}),
        ...(num(it?.hold, 0.5, 60) !== undefined ? { hold: num(it.hold, 0.5, 60) } : {}),
        ...(str(it?.caption, 300) ? { caption: str(it.caption, 300) } : {}),
      };
    })
    .filter((x: ReelItem | null): x is ReelItem => !!x);
  const st = r.soundtrack;
  const soundtrack: Reel['soundtrack'] =
    st?.kind === 'upload' && rowId(st.mediaRowId) ? { kind: 'upload', mediaRowId: rowId(st.mediaRowId)! } : st?.kind === 'cue' && id(st.shotId) ? { kind: 'cue', shotId: id(st.shotId) } : undefined;
  return {
    logline: str(p.logline, 600),
    vision: {
      statement: str(v.statement, 20000),
      tone: str(v.tone, 4000),
      look: str(v.look, 4000),
      sound: str(v.sound, 4000),
      themes: str(v.themes, 4000),
      audience: str(v.audience, 4000),
      whyNow: str(v.whyNow, 4000),
      comps: (Array.isArray(v.comps) ? v.comps : []).map((c: unknown) => str(c, 200)).filter((c: string | undefined): c is string => !!c?.trim()).slice(0, 20),
      moodboard: (Array.isArray(v.moodboard) ? v.moodboard : []).map(rowId).filter((x: number | undefined): x is number => !!x).slice(0, 60),
    },
    treatment: str(p.treatment, 200000),
    reel: {
      items,
      ...(soundtrack ? { soundtrack } : {}),
      ...(r.openCard === false ? { openCard: false } : {}),
      ...(str(r.endCard, 300) ? { endCard: str(r.endCard, 300) } : {}),
    },
  };
}

const LENS_TYPE_IDS = LENS_TYPES.map((l) => l.id);

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
    excerpt: str(s?.excerpt, 4000),
    summary: str(s?.summary, 1000),
    seconds: num(s?.seconds, 0, 3600),
    lens: num(s?.lens, 8, 800),
    lensType: oneOf(s?.lensType, LENS_TYPE_IDS),
    music: str(s?.music, 600),
    notes: str(s?.notes, 2000),
    adjustments: (Array.isArray(s?.adjustments) ? s.adjustments : [])
      .slice(0, 40)
      .map((a) => ({ id: id(a?.id), text: str(a?.text, 600) ?? '', ...(a?.off === true ? { off: true } : {}) }))
      .filter((a) => a.id),
    take: num(s?.take, 0, 1e6),
    ...(s?.locked === true ? { locked: true } : {}),
    ...(Number.isSafeInteger(s?.frameImage) && (s?.frameImage ?? 0) > 0 ? { frameImage: s.frameImage } : {}),
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
    ...(c?.placeholder === true ? { placeholder: true } : {}),
    ...(c?.voiceRef?.kind === 'upload' && Number.isSafeInteger(c.voiceRef.mediaRowId) && c.voiceRef.mediaRowId > 0
      ? { voiceRef: { kind: 'upload' as const, mediaRowId: c.voiceRef.mediaRowId } }
      : c?.voiceRef?.kind === 'studio' && Number.isSafeInteger(c.voiceRef.characterId) && c.voiceRef.characterId > 0
        ? { voiceRef: { kind: 'studio' as const, characterId: c.voiceRef.characterId } }
        : {}),
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
  const pitch = cleanPitch(d.pitch);
  const props = (Array.isArray(d.props) ? d.props : []).slice(0, 500).map((p) => ({
    id: id(p?.id),
    name: str(p?.name, 120) ?? '',
    aliases: str(p?.aliases, 300),
    description: str(p?.description, 1500),
    primaryRefId: num(p?.primaryRefId, 1, Number.MAX_SAFE_INTEGER),
  })).filter((p) => p.id);
  return {
    ...(pitch ? { pitch } : {}),
    elements: elements.length ? elements : base.elements,
    shots,
    characters,
    ...(props.length ? { props } : {}),
    plans,
    settings: {
      imageModel: str(s.imageModel, 80),
      ratio: oneOf(s.ratio, ['16:9', '21:9', '4:3', '1:1', '9:16'] as const) ?? base.settings.ratio,
      style: str(s.style, 600),
      lensType: oneOf(s.lensType, LENS_TYPE_IDS),
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
            stale: p.stale,
            musicStale: p.musicStale,
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
// Render everything out of date now, including shots waiting for a refresh.
router.post('/:id/render-now', owned, (_req, res) =>
  wrap(res, () => {
    refreshShots(sp(res).id, 'all');
    return detail(store.getScreenplay(sp(res).id)!);
  }),
);

// Refresh one shot: apply its shot-box changes (and anything else waiting) and render now.
router.post('/:id/shots/:shotId/refresh', owned, (req, res) =>
  wrap(res, () => {
    const s = sp(res);
    const shot = s.doc.shots.find((x) => x.id === req.params.shotId);
    if (!shot) throw new Error('Shot not found');
    if (shot.locked) throw new Error('This shot is locked. Unlock it to re-render.');
    refreshShots(s.id, [String(req.params.shotId)]);
    return detail(store.getScreenplay(s.id)!);
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

router.post('/:id/characters/:cid/casting', owned, (req, res) =>
  wrap(res, async () => {
    const c = characterOf(sp(res), String(req.params.cid));
    if (!c.name.trim()) throw new Error('Name the character first');
    await castCharacter(sp(res), c, 4);
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

// Rip reel: clips, stills and soundtrack files, kept with the screenplay.
const reelUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 500 * 1024 * 1024, files: 1 } });
router.post('/:id/reel', owned, reelUpload.single('file'), (req, res) =>
  wrap(res, () => {
    const f = req.file;
    if (!f) throw new Error('No file');
    const kind = f.mimetype.startsWith('video/') ? 'video' : f.mimetype.startsWith('image/') ? 'image' : f.mimetype.startsWith('audio/') ? 'audio' : null;
    if (!kind || !/^(video\/(mp4|webm|quicktime)|image\/(png|jpe?g|webp|gif)|audio\/(mpeg|mp4|x-m4a|wav|x-wav|webm|ogg|aac))$/.test(f.mimetype)) {
      fs.rmSync(f.path, { force: true });
      throw new Error('Upload an MP4, WebM or MOV clip, an image, or an MP3, M4A, WAV or OGG soundtrack');
    }
    const media = saveMediaFile({ userId: sp(res).userId, type: kind, tmpPath: f.path, mime: f.mimetype, originalFilename: f.originalname, prompt: 'Screenplay rip reel' });
    const row = store.addMedia(sp(res).id, 'reel', kind, { status: 'ready', media_id: media.id, label: f.originalname.slice(0, 200) });
    return { ...detail(sp(res)), added: row.id };
  }),
);

// Suggest shots for one scene (the client adds them to the document, so they can be undone).
router.post('/:id/shots/suggest', owned, (req, res) =>
  wrap(res, async () => {
    const density = oneOf(req.body?.density, ['fewer', 'normal', 'more'] as const) ?? 'normal';
    return suggestShots(sp(res), id(req.body?.sceneId), density);
  }),
);

// ── voices: spoken dialogue for the animatic ─────────────────────────────────

// Your Studio characters that have a voice ready (before /:id).
router.get('/voices/studio', (req, res) =>
  wrap(res, () => ({
    characters: listStudioCharacters(req.user!.id, 200)
      .map((c) => {
        const link = getLatestCharacterAsset(c.id, 'voice');
        const asset = link ? getAsset(link.asset_id) : null;
        const mediaId = asset?.final_media_id ?? asset?.draft_media_id ?? null;
        return mediaId ? { id: c.id, name: c.name, sampleMediaId: mediaId } : null;
      })
      .filter(Boolean),
  })),
);

// A voice sample (6–30 seconds of one person speaking) for a screenplay character.
const voiceUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
router.post('/:id/characters/:cid/voice', owned, voiceUpload.single('file'), (req, res) =>
  wrap(res, () => {
    const f = req.file;
    if (!f) throw new Error('No recording');
    if (!/^audio\//.test(f.mimetype)) {
      fs.rmSync(f.path, { force: true });
      throw new Error('Upload or record audio (WAV, MP3, M4A, WebM or OGG)');
    }
    const s = sp(res);
    const cid = id(req.params.cid);
    const media = saveMediaFile({ userId: s.userId, type: 'audio', tmpPath: f.path, mime: f.mimetype, originalFilename: f.originalname || 'voice.webm', prompt: 'Screenplay voice sample' });
    const row = store.addMedia(s.id, 'sound', voiceTarget(cid), { status: 'ready', media_id: media.id, label: f.originalname || 'Voice sample' });
    store.updateMedia(row.id, { meta: JSON.stringify({ voiceSample: true, characterId: cid }) });
    return { ...detail(s), added: row.id };
  }),
);

// Speak the dialogue of some shots (or all) in each character's voice.
router.post('/:id/lines', owned, (req, res) =>
  wrap(res, () => {
    const s = sp(res);
    const shotIds = Array.isArray(req.body?.shotIds) ? req.body.shotIds.map((x: unknown) => id(x)).filter(Boolean) : undefined;
    const result = queueLines(s, req.user!.id, shotIds, oneOf(req.body?.language, ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh-cn', 'ja', 'hu', 'ko', 'hi'] as const) ?? 'en');
    return { ...detail(store.getScreenplay(s.id)!), lines: result };
  }),
);

// ── shot finder: photos from free libraries ──────────────────────────────────

function findOf(s: Screenplay, fid: unknown) {
  const f = getFind(Number(fid));
  if (!f || f.screenplay_id !== s.id) throw new Error('Search not found');
  return f;
}

router.post('/:id/shots/:shotId/finds', owned, (req, res) =>
  wrap(res, () => {
    const s = sp(res);
    const shotId = id(req.params.shotId);
    if (!s.doc.shots.some((x) => x.id === shotId)) throw new Error('That shot no longer exists. Save and try again.');
    return { find: createFind(s, shotId, ownQueries(req.body?.queries)) };
  }),
);

router.get('/:id/shots/:shotId/finds/latest', owned, (req, res) => wrap(res, () => ({ find: latestFind(sp(res).id, id(req.params.shotId)) })));

// The agent's summary of a highlighted shot (the writer can edit it).
router.post('/:id/shots/summary', owned, (req, res) =>
  wrap(res, async () => {
    const excerpt = (str(req.body?.excerpt, 4000) ?? '').trim();
    const heading = (str(req.body?.heading, 400) ?? '').trim();
    return { summary: await summarizeShot(heading, excerpt) };
  }),
);

// Recreate a shot's picked photo with the film's characters and props (FLUX.2 multi-reference).
router.get('/:id/shots/:shotId/recreate', owned, (req, res) =>
  wrap(res, () => {
    const s = sp(res);
    const shot = s.doc.shots.find((x) => x.id === id(req.params.shotId));
    if (!shot) throw new Error('That shot no longer exists');
    return recreateCandidates(s, shot);
  }),
);

router.post('/:id/shots/:shotId/recreate', owned, (req, res) =>
  wrap(res, () => {
    const s = sp(res);
    const shot = s.doc.shots.find((x) => x.id === id(req.params.shotId));
    if (!shot) throw new Error('That shot no longer exists. Save and try again.');
    const ids = (v: unknown) => (Array.isArray(v) ? v.map((x) => id(x)).filter(Boolean).slice(0, 20) : undefined);
    const row = recreateFrame(s, shot, Number(req.body?.from), { characterIds: ids(req.body?.characterIds), propIds: ids(req.body?.propIds) });
    return { ...detail(store.getScreenplay(s.id)!), added: row.id };
  }),
);

// Props: reference photos from uploads, the finder, or drawn with AI.
function propOf(s: Screenplay, pid: unknown) {
  const p = (s.doc.props ?? []).find((x) => x.id === String(pid));
  if (!p) throw new Error('Save the prop first');
  return p;
}

router.post('/:id/props/:pid/finds', owned, (req, res) =>
  wrap(res, () => {
    const s = sp(res);
    const p = propOf(s, req.params.pid);
    if (!p.name.trim()) throw new Error('Name the prop first');
    return { find: createFind(s, propTarget(p.id), ownQueries(req.body?.queries)) };
  }),
);

router.get('/:id/props/:pid/finds/latest', owned, (req, res) => wrap(res, () => ({ find: latestFind(sp(res).id, propTarget(id(req.params.pid))) })));

router.post('/:id/props/:pid/images', owned, (req, res) =>
  wrap(res, () => {
    const s = sp(res);
    const p = propOf(s, req.params.pid);
    const data = str(req.body?.data, 30 * 1024 * 1024) ?? '';
    const mime = str(req.body?.mime, 60) ?? '';
    if (!data) throw new Error('No image');
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(mime)) throw new Error('Upload a PNG, JPEG, WebP or GIF image');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Images must be under 20 MB');
    const filename = str(req.body?.filename, 200);
    const media = saveMedia({ userId: s.userId, type: 'image', bytes, mime, originalFilename: filename, prompt: 'Screenplay prop' });
    store.addMedia(s.id, 'prop', p.id, { status: 'ready', media_id: media.id, label: filename ?? 'Uploaded' });
    return detail(store.getScreenplay(s.id)!);
  }),
);

router.post('/:id/props/:pid/draw', owned, (req, res) =>
  wrap(res, () => {
    const s = sp(res);
    const p = propOf(s, req.params.pid);
    if (!p.name.trim()) throw new Error('Name the prop first');
    queuePropDrawing(s, p);
    return detail(s);
  }),
);

router.get('/:id/finds/:fid', owned, (req, res) => wrap(res, () => ({ find: findOf(sp(res), req.params.fid) })));

router.post('/:id/finds/:fid/more', owned, (req, res) => wrap(res, () => ({ find: findMore(findOf(sp(res), req.params.fid)) })));

// Keep a photo the finder proposed, as an image of the shot it was found for.
router.post('/:id/finds/:fid/keep', owned, (req, res) =>
  wrap(res, async () => {
    const s = sp(res);
    const f = findOf(s, req.params.fid);
    const rowId = await keepFound(s, f, String(req.body?.key ?? ''), (bytes, mime, filename) =>
      saveMedia({ userId: s.userId, type: 'image', bytes, mime, originalFilename: filename, prompt: 'Screenplay shot photo' }).id,
    );
    return { ...detail(store.getScreenplay(s.id)!), added: rowId };
  }),
);

// ── sounds: gathered from free libraries ─────────────────────────────────────

router.post('/:id/sounds/hunts', owned, (req, res) =>
  wrap(res, () => {
    const s = sp(res);
    const scope = req.body?.scope === 'script' ? 'script' : req.body?.scope ? id(req.body.scope) : '';
    const request = (str(req.body?.request, 2000) ?? '').trim();
    if (!request && !scope) throw new Error('Describe the sounds you want, or pick a shot or scene');
    if (scope && scope !== 'script' && !s.doc.shots.some((x) => x.id === scope) && !s.doc.elements.some((e) => e.id === scope && e.type === 'scene')) {
      throw new Error('That shot or scene no longer exists');
    }
    return { hunt: createHunt(s, scope, request, { allowNonCommercial: req.body?.allowNonCommercial === true }) };
  }),
);

router.get('/:id/sounds/hunts', owned, (_req, res) => wrap(res, () => ({ hunts: listHunts(sp(res).id) })));

router.get('/:id/sounds/hunts/:hid', owned, (req, res) =>
  wrap(res, () => {
    const h = getHunt(Number(req.params.hid));
    if (!h || h.screenplay_id !== sp(res).id) throw new Error('Not found');
    return { hunt: h };
  }),
);

// Keep a sound the gatherer found (by its key in that search), for a shot or the library.
router.post('/:id/sounds', owned, (req, res) =>
  wrap(res, async () => {
    const s = sp(res);
    const h = getHunt(Number(req.body?.huntId));
    if (!h || h.screenplay_id !== s.id) throw new Error('Search not found');
    const target = req.body?.target ? id(req.body.target) : '';
    if (target && !s.doc.shots.some((x) => x.id === target)) throw new Error('That shot no longer exists');
    const rowId = await keepCandidate(s, h, String(req.body?.key ?? ''), target, (bytes, mime, filename) =>
      saveMedia({ userId: s.userId, type: 'audio', bytes, mime, originalFilename: filename, prompt: 'Screenplay sound' }).id,
    );
    return { ...detail(store.getScreenplay(s.id)!), added: rowId };
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
    } else if (row.role === 'reel' && req.body?.label !== undefined) {
      store.updateMedia(row.id, { label: (str(req.body.label, 200) ?? '').trim() || null });
    } else if (row.role === 'sound') {
      const target = req.body?.target !== undefined ? (req.body.target ? id(req.body.target) : '') : undefined;
      if (target && !sp(res).doc.shots.some((x) => x.id === target)) throw new Error('That shot no longer exists');
      const meta = (() => { try { return JSON.parse(row.meta ?? '{}'); } catch { return {}; } })();
      const volume = num(req.body?.volume, 0, 1);
      store.updateMedia(row.id, {
        ...(target !== undefined ? { target } : {}),
        ...(volume !== undefined ? { meta: JSON.stringify({ ...meta, volume }) } : {}),
      });
    }
    return detail(sp(res));
  }),
);

router.delete('/:id/media/:mid', owned, (req, res) =>
  wrap(res, () => {
    const row = store.getMedia(Number(req.params.mid));
    if (!row || row.screenplay_id !== sp(res).id) throw new Error('Not found');
    if (!['reference', 'character', 'reel', 'sound', 'prop'].includes(row.role)) throw new Error('Only reference, character, prop, reel and sound files can be removed');
    store.deleteMedia(row.id);
    if (row.role === 'reference') scheduleReconcile(sp(res).id, 0);
    return detail(sp(res));
  }),
);

export default router;
