// Keeps each shot's example frame and music cue in step with the script.
//
// After every save the shots are re-planned. A shot whose prompt changed is
// re-rendered once its description has been stable for a few seconds (so a
// writer mid-sentence doesn't queue a render per keystroke); an older render
// still waiting in the queue is cancelled. Each shot keeps one seed, so a
// revision changes what the words changed rather than the whole picture.

import { cancel, enqueue, getJob } from '../jobQueue';
import { saveMedia } from '../mediaStore';
import { getMediaModel, type MediaModel, type Ratio } from '../media/catalog';
import { localModels } from '../influencers/media';
import { getMediaSettings } from '../media/settings';
import { describeImage } from '../media/enhance';
import { asString, llmJson, screenplayModel } from './llm';
import { activeAdjustments, adjustKey, appendAdjustments, castingPrompt, characterPrompt, firstMoment, propPrompt, recreatePrompt, hashOf, planMusic, planShot, type ReferenceNote, type ShotPlan } from './prompts';
import db from '../../db/connection';
import * as store from './store';
import type { Character, Prop, Screenplay, ScreenplayMedia, Shot } from './types';
import { presentCharacters, propsInShot, shotSection, visualText } from './script';

export const STABLE_MS = 6000;
export const MUSIC_MODEL = 'ace-step-v1';
const NEGATIVE = 'text, subtitles, captions, watermark, logo, signature, deformed hands, extra limbs, duplicate person, clones, matching outfits, twins';

// ── job → row sync ────────────────────────────────────────────────────────────

function friendlyError(e: string | null, role: ScreenplayMedia['role']): string {
  const msg = e || 'Failed';
  if (role === 'sound' && /ECONNREFUSED|fetch failed|No provider|tts/i.test(msg)) {
    return 'The speech service isn’t running on the GPU box (tts-service on port 8020). Start it with tts-service\\run.ps1.';
  }
  if (role === 'music' && /ace_step|ckpt_name|TextEncodeAceStepAudio|not in list/i.test(msg)) {
    return 'The ACE-Step music model isn’t installed on the GPU box: put ace_step_v1_3.5b.safetensors in ComfyUI/models/checkpoints.';
  }
  return msg;
}

/** Move finished jobs' results onto their rows. */
export function syncJobs(screenplayId: number): void {
  for (const row of store.listMedia(screenplayId)) {
    if (row.status !== 'pending' || row.job_id == null) continue;
    const job = getJob(row.job_id);
    if (!job) store.setStatus(row.id, 'failed', 'The render job no longer exists');
    else if (job.status === 'succeeded') {
      let mediaId: number | null = null;
      try {
        mediaId = (JSON.parse(job.result ?? '{}') as { media_ids?: number[] }).media_ids?.[0] ?? null;
      } catch {
        /* ignore */
      }
      if (mediaId) store.updateMedia(row.id, { status: 'ready', media_id: mediaId, error: null });
      else store.setStatus(row.id, 'failed', 'Nothing was produced');
    } else if (job.status === 'failed' || job.status === 'canceled') {
      store.setStatus(row.id, 'failed', friendlyError(job.error || job.status, row.role));
    }
  }
}

// ── models ───────────────────────────────────────────────────────────────────

export function imageModelFor(sp: Screenplay): MediaModel {
  const chosen = sp.doc.settings.imageModel ? getMediaModel(sp.doc.settings.imageModel) : undefined;
  if (chosen?.kind === 'image') return chosen;
  const def = getMediaModel(getMediaSettings().defaultImageModel);
  if (def?.kind === 'image') return def;
  const local = localModels('image')[0];
  if (!local) throw new Error('No image model is available');
  return local;
}

function ratioFor(model: MediaModel, wanted?: string): Ratio {
  const r = (wanted ?? '21:9') as Ratio;
  if (model.ratios.includes(r)) return r;
  if (r === '21:9' && model.ratios.includes('16:9')) return '16:9';
  return model.defaults.ratio;
}

function seedFor(...parts: unknown[]): number {
  return parseInt(hashOf(...parts).slice(0, 8), 16) % 2_147_483_647;
}

// ── planning ─────────────────────────────────────────────────────────────────

export function referenceNotes(screenplayId: number): ReferenceNote[] {
  return store
    .listMedia(screenplayId, 'reference')
    .filter((r) => r.status === 'ready' && r.caption?.trim())
    .map((r) => ({ target: r.target, caption: r.caption! }));
}

export function planAll(sp: Screenplay): Map<string, ShotPlan> {
  const refs = referenceNotes(sp.id);
  let modelId = '';
  try {
    modelId = imageModelFor(sp).id;
  } catch {
    /* no model: plans still show prompts */
  }
  const plans = new Map(sp.doc.shots.map((s) => [s.id, withAdjustments(planShot(sp.doc, s, refs, modelId))]));
  for (const shot of sp.doc.shots) {
    const plan = plans.get(shot.id)!;
    plan.stale = frameGate(sp.id, shot.id, plan, shot.locked) === 'stale';
    plan.musicStale = musicGate(sp.id, shot) === 'stale';
  }
  return plans;
}

// ── what renders by itself ───────────────────────────────────────────────────
// Frames never draw by themselves: a shot's frame is a photo the writer finds
// and picks, or one the AI draws when the writer asks (refresh / "draw with
// AI"). Once drawn, any change waits for refresh. Music cues still render by
// themselves the first time, then wait for refresh.

/** Hashes the writer approved with refresh, per screenplay:shot:role. */
const approved = new Map<string, string>();

type Gate = 'current' | 'auto' | 'approved' | 'stale' | 'none';

function frameGate(spId: number, shotId: string, plan: ShotPlan, locked = false): Gate {
  if (!plan.hash || locked) return 'none';
  const shot = store.getScreenplay(spId)?.doc.shots.find((s) => s.id === shotId);
  // The writer chose an image for this frame: nothing to render.
  if (shot?.frameImage) return 'none';
  const frame = store.latestMedia(spId, 'frame', shotId);
  if (frame?.hash === plan.hash) return 'current';
  if (approved.get(`${spId}:${shotId}:frame`) === plan.hash) return 'approved';
  // Never drawn (or the last try was dropped): only when asked.
  if (!frame || frame.status === 'superseded') return 'none';
  return 'stale';
}

function musicGate(spId: number, shot: Shot): Gate {
  const music = planMusic(shot);
  if (!music.hash || shot.locked) return 'none';
  const cue = store.latestMedia(spId, 'music', shot.id);
  if (cue?.hash === music.hash) return 'current';
  if (approved.get(`${spId}:${shot.id}:music`) === music.hash) return 'approved';
  return cue ? 'stale' : 'auto';
}

/** Approve the current version of `shotIds` (or every shot) and render it now. */
export function refreshShots(spId: number, shotIds: string[] | 'all'): void {
  const sp = store.getScreenplay(spId);
  if (!sp) return;
  const plans = planAll(sp);
  for (const shot of sp.doc.shots) {
    if ((shotIds !== 'all' && !shotIds.includes(shot.id)) || shot.locked) continue;
    const plan = plans.get(shot.id)!;
    // "All" brings drawn frames up to date; it never draws a shot that has none
    // (those get a photo from the finder, or "Draw with AI" one at a time).
    const drawn = store.latestMedia(spId, 'frame', shot.id);
    const hasFrame = !!drawn && drawn.status !== 'superseded';
    if (plan.hash && (shotIds !== 'all' || hasFrame)) approved.set(`${spId}:${shot.id}:frame`, plan.hash);
    const music = planMusic(shot);
    if (music.hash) approved.set(`${spId}:${shot.id}:music`, music.hash);
  }
  reconcile(spId, Date.now(), true);
}

// ── adjustment notes ─────────────────────────────────────────────────────────
// The AI rewrites the script-built prompt so the frame follows the notes
// (notes win where they conflict). Rewrites are cached by base prompt + notes,
// and only start once the notes have stopped changing, like renders do.

interface CachedPrompt {
  prompt: string;
  source: 'llm' | 'fallback';
  error: string | null;
}

function cachedPrompt(key: string): CachedPrompt | null {
  return (db.prepare('SELECT prompt, source, error FROM screenplay_prompt_cache WHERE key = ?').get(key) as CachedPrompt | undefined) ?? null;
}

/** Fill in the final prompt from the cache, or mark the plan as waiting for the rewrite. */
export function withAdjustments(plan: ShotPlan): ShotPlan {
  if (!plan.basePrompt || !plan.adjustments?.length) return plan;
  const hit = cachedPrompt(adjustKey(plan.basePrompt, plan.adjustments));
  if (!hit) return { ...plan, prompt: undefined, adjusting: true };
  return {
    ...plan,
    prompt: hit.prompt,
    adjustNote: hit.source === 'fallback' ? `The AI couldn’t apply the notes (${hit.error ?? 'error'}), so they were added to the prompt as written.` : undefined,
  };
}

const ADJUST_SYSTEM =
  'You revise image-generation prompts for storyboard frames. You get the prompt built from the screenplay and the ' +
  'director\'s adjustment notes. Rewrite the prompt so the image follows every note: change, add or remove details as ' +
  'the notes say, and where a note conflicts with the prompt, the note wins. Keep everything the notes do not touch: ' +
  'the setting, action, characters and their descriptions, how background extras differ from the named characters, ' +
  'camera and lens, and style. Never give extras a named character\'s face, hair or clothes. Describe the result directly ' +
  '(write "a low camera angle", not "make the camera lower"); image models ignore negation, so for "remove X" or "no X" ' +
  'leave X out and describe what is there instead. Start with "Cinematic film still" and the shot type, end with ' +
  '"No text, captions, subtitles or watermarks." Under 220 words. Return {"prompt": "..."}.';

const rewriting = new Map<string, Promise<void>>();

/** Apply the notes with the AI and cache the result (the notes appended as written if it fails). */
export function rewriteForAdjustments(basePrompt: string, notes: string[]): Promise<void> {
  const key = adjustKey(basePrompt, notes);
  const running = rewriting.get(key);
  if (running) return running;
  const job = (async () => {
    let model = '';
    try {
      model = screenplayModel();
      const out = await llmJson<{ prompt?: string }>(
        ADJUST_SYSTEM,
        `Prompt:\n${basePrompt}\n\nAdjustment notes:\n${notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`,
        { temperature: 0.2 },
      );
      const prompt = asString(out.prompt, 3000).replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
      if (prompt.length < 40) throw new Error('the model returned no prompt');
      db.prepare("INSERT OR REPLACE INTO screenplay_prompt_cache (key, prompt, source, model) VALUES (?, ?, 'llm', ?)").run(key, prompt, model);
    } catch (e) {
      db.prepare("INSERT OR REPLACE INTO screenplay_prompt_cache (key, prompt, source, model, error) VALUES (?, ?, 'fallback', ?, ?)").run(
        key,
        appendAdjustments(basePrompt, notes),
        model || null,
        (e as Error).message.slice(0, 300),
      );
    }
  })().finally(() => rewriting.delete(key));
  rewriting.set(key, job);
  return job;
}

// ── reconcile ────────────────────────────────────────────────────────────────

const firstSeen = new Map<string, { hash: string; since: number }>();
const timers = new Map<number, NodeJS.Timeout>();

/** Re-plan a screenplay after `delayMs` (coalesces repeated calls). */
export function scheduleReconcile(screenplayId: number, delayMs = 500): void {
  const t = timers.get(screenplayId);
  if (t) clearTimeout(t);
  const timer = setTimeout(() => {
    timers.delete(screenplayId);
    try {
      reconcile(screenplayId);
    } catch (e) {
      console.error(`[screenplay] reconcile ${screenplayId} failed:`, e);
    }
  }, delayMs);
  timer.unref();
  timers.set(screenplayId, timer);
}

/** Has this hash been the target for long enough to render? */
function stable(key: string, hash: string, now: number): boolean {
  const seen = firstSeen.get(key);
  if (!seen || seen.hash !== hash) {
    firstSeen.set(key, { hash, since: now });
    return false;
  }
  return now - seen.since >= STABLE_MS;
}

function supersede(row: ScreenplayMedia | null): void {
  if (!row || row.status !== 'pending') return;
  if (row.job_id != null && getJob(row.job_id)?.status === 'queued') cancel(row.job_id);
  store.setStatus(row.id, 'superseded');
}

/** Queue whatever frames and music are out of date. Returns true if more checks are due. */
export function reconcile(screenplayId: number, now = Date.now(), force = false): boolean {
  // force: skip the settle delay for whatever may render (it never overrides a refresh wait).
  syncJobs(screenplayId);
  const sp = store.getScreenplay(screenplayId);
  if (!sp) return false;
  const shotIds = new Set(sp.doc.shots.map((s) => s.id));

  // Shots that were deleted: stop their work.
  for (const row of store.listMedia(sp.id)) {
    if ((row.role === 'frame' || row.role === 'music') && row.status === 'pending' && !shotIds.has(row.target)) supersede(row);
  }
  if (sp.doc.settings.paused) return false;

  let model: MediaModel | null = null;
  try {
    model = imageModelFor(sp);
  } catch {
    /* reported per shot */
  }
  const plans = planAll(sp);
  let again = false;

  for (const shot of sp.doc.shots) {
    const plan = plans.get(shot.id)!;
    const frame = store.latestMedia(sp.id, 'frame', shot.id);
    if (shot.locked) {
      // Locked: keep the frame and cue that are there. Work still queued is
      // dropped, unless there's nothing yet to keep (a first render finishes).
      const has = (role: 'frame' | 'music') => store.listMedia(sp.id, role).some((r) => r.target === shot.id && r.status === 'ready');
      if (has('frame')) supersede(frame);
      if (has('music')) supersede(store.latestMedia(sp.id, 'music', shot.id));
      continue;
    }
    const gate = frameGate(sp.id, shot.id, plan);
    // A refresh renders straight away; script edits wait for typing to settle.
    const now_ = force || gate === 'approved';
    if (gate === 'stale' || gate === 'current' || gate === 'none') {
      // Up to date, or waiting for the writer's refresh: nothing to queue.
    } else if (plan.adjusting) {
      // Notes changed: once they settle, apply them, then come back to render.
      if (!now_ && !stable(`${sp.id}:${shot.id}:frame`, plan.hash!, now)) again = true;
      else {
        supersede(frame);
        void rewriteForAdjustments(plan.basePrompt!, plan.adjustments!).then(() => scheduleReconcile(sp.id, 0));
      }
    } else if (plan.prompt) {
      if (!now_ && !stable(`${sp.id}:${shot.id}:frame`, plan.hash!, now)) again = true;
      else if (model) {
        supersede(frame);
        const jobId = enqueue(
          'image',
          {
            catalogId: model.id,
            prompt: plan.prompt,
            negative: NEGATIVE,
            ratio: ratioFor(model, sp.doc.settings.ratio),
            seed: seedFor(shot.id, shot.take ?? 0),
            enhance: false,
            verifyAttempts: 1,
          },
          { userId: sp.userId, heavy: true },
        );
        store.addMedia(sp.id, 'frame', shot.id, { hash: plan.hash, block_hash: plan.blockHash, prompt: plan.prompt, job_id: jobId });
      } else {
        store.addMedia(sp.id, 'frame', shot.id, { hash: plan.hash, block_hash: plan.blockHash, prompt: plan.prompt, status: 'failed', error: 'No image model is available' });
      }
    }

    const music = planMusic(shot);
    const cue = store.latestMedia(sp.id, 'music', shot.id);
    const mGate = musicGate(sp.id, shot);
    if (music.hash && music.prompt && (mGate === 'auto' || mGate === 'approved')) {
      if (!force && mGate !== 'approved' && !stable(`${sp.id}:${shot.id}:music`, music.hash, now)) again = true;
      else {
        supersede(cue);
        const jobId = enqueue(
          'audio',
          {
            catalogId: MUSIC_MODEL,
            prompt: music.prompt,
            duration: music.seconds,
            seed: seedFor(shot.id, 'music', shot.take ?? 0),
            enhance: false,
          },
          { userId: sp.userId, heavy: true },
        );
        store.addMedia(sp.id, 'music', shot.id, { hash: music.hash, prompt: music.prompt, job_id: jobId });
      }
    } else if (!music.hash && cue?.status === 'pending') {
      supersede(cue);
    }
  }
  if (again) scheduleReconcile(sp.id, STABLE_MS + 250);
  return again;
}

// ── characters ───────────────────────────────────────────────────────────────

export type RefView = 'portrait' | 'full' | 'profile' | 'expressions';
export const REF_VIEWS: RefView[] = ['portrait', 'full', 'profile', 'expressions'];

export function queueCharacterRefs(sp: Screenplay, c: Character, views: RefView[]): ScreenplayMedia[] {
  const model = imageModelFor(sp);
  return views.map((view) => {
    const prompt = characterPrompt(c, view, sp.doc.settings.style);
    const jobId = enqueue(
      'image',
      {
        catalogId: model.id,
        prompt,
        negative: NEGATIVE,
        ratio: ratioFor(model, view === 'full' ? '9:16' : view === 'expressions' ? '1:1' : '3:4'),
        seed: Math.floor(Math.random() * 2_147_483_647),
        enhance: false,
        verifyAttempts: 1,
      },
      { userId: sp.userId, heavy: true },
    );
    return store.addMedia(sp.id, 'character', c.id, { prompt, job_id: jobId, label: view });
  });
}

// ── recreate a picked photo with the cast and props ──────────────────────────

/** The model that recreates frames: FLUX.2 [dev] on the GPU box (it takes several reference images). */
export const RECREATE_MODEL = 'flux2-dev';

/** The photo that stands for a character or prop: its main one, else the newest that's ready. */
function mainPhoto(spId: number, role: 'character' | 'prop', target: string, primaryId?: number): ScreenplayMedia | null {
  const rows = store.listMedia(spId, role).filter((m) => m.target === target && m.status === 'ready' && m.media_id);
  return rows.find((m) => m.id === primaryId) ?? rows.filter((m) => m.label !== 'expressions').at(-1) ?? null;
}

export interface RecreateChoice {
  characterIds?: string[];
  propIds?: string[];
}

/** Who and what a recreate would put in, with whether each has a photo (for the UI). */
export function recreateCandidates(sp: Screenplay, shot: Shot) {
  const sec = shotSection(sp.doc, shot);
  const present = sec ? presentCharacters(sec.elements, sp.doc.characters) : [];
  const characters = present
    .filter((p) => p.character)
    .map((p) => ({ id: p.character!.id, name: p.character!.name, photo: mainPhoto(sp.id, 'character', p.character!.id, p.character!.primaryRefId)?.media_id ?? null }));
  const props = propsInShot(sp.doc, shot).map((p) => ({ id: p.id, name: p.name, photo: mainPhoto(sp.id, 'prop', p.id, p.primaryRefId)?.media_id ?? null }));
  return { characters, props };
}

/**
 * Queue the AI recreating `baseRowId` (a photo of this shot) with the chosen
 * characters and props in it. The result is a new image of the shot that
 * keeps the photo's credit.
 */
export function recreateFrame(sp: Screenplay, shot: Shot, baseRowId: number, choice: RecreateChoice): ScreenplayMedia {
  const base = store.getMedia(baseRowId);
  if (!base || base.screenplay_id !== sp.id || base.role !== 'reference' || base.status !== 'ready' || !base.media_id) throw new Error('Pick a photo for this shot first');
  const model = getMediaModel(RECREATE_MODEL);
  if (!model) throw new Error('FLUX.2 [dev] is not available');
  const sec = shotSection(sp.doc, shot);
  const present = sec ? presentCharacters(sec.elements, sp.doc.characters) : [];
  const wantChars = new Set(choice.characterIds ?? present.map((p) => p.character?.id).filter(Boolean));
  const wantProps = new Set(choice.propIds ?? propsInShot(sp.doc, shot).map((p) => p.id));
  const refs: number[] = [base.media_id];
  const castRows = sp.doc.characters.filter((c) => wantChars.has(c.id));
  const cast = castRows.map((c) => {
    const photo = refs.length < (model.maxRefs ?? 1) ? mainPhoto(sp.id, 'character', c.id, c.primaryRefId) : null;
    if (photo?.media_id) refs.push(photo.media_id);
    const look = c.appearance?.trim() || [c.age, c.gender, c.species || c.kind].filter(Boolean).join(' ') || 'as in the script';
    return { name: c.name, look, wardrobe: c.wardrobe?.trim() || undefined, image: photo?.media_id ? refs.length : null };
  });
  const props = (sp.doc.props ?? [])
    .filter((p) => wantProps.has(p.id))
    .map((p) => {
      const photo = refs.length < (model.maxRefs ?? 1) ? mainPhoto(sp.id, 'prop', p.id, p.primaryRefId) : null;
      if (photo?.media_id) refs.push(photo.media_id);
      return { name: p.name, look: p.description?.trim() || undefined, image: photo?.media_id ? refs.length : null };
    });
  const action = sec ? visualText(sec.elements) : '';
  // No lens wording: the photo already has its own camera and depth, and
  // asking for a different one makes the model redraw the background.
  const prompt = recreatePrompt({
    cast,
    props,
    moment: action ? firstMoment(action) : undefined,
    notes: activeAdjustments(shot),
    style: sp.doc.settings.style,
  });
  const jobId = enqueue(
    'image',
    {
      catalogId: model.id,
      prompt,
      negative: NEGATIVE,
      ratio: ratioFor(model, sp.doc.settings.ratio),
      seed: Math.floor(Math.random() * 2_147_483_647),
      enhance: false,
      verifyAttempts: 1,
      refMediaIds: refs,
    },
    { userId: sp.userId, heavy: true },
  );
  const row = store.addMedia(sp.id, 'reference', shot.id, { prompt, job_id: jobId, label: 'Recreated with AI' });
  const meta = (() => {
    try {
      return JSON.parse(base.meta ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const recreated = { from: base.id, characters: cast.map((c) => c.name), props: props.map((p) => p.name) };
  store.updateMedia(row.id, { meta: JSON.stringify({ ...(meta.found ? { found: meta.found } : {}), recreated }) });
  return { ...row, meta: JSON.stringify({ ...(meta.found ? { found: meta.found } : {}), recreated }) };
}

// ── props ──────────────────────────────────────────────────────────────────────

/** Draw a reference photo of a prop with the image model. */
export function queuePropDrawing(sp: Screenplay, p: Prop): ScreenplayMedia {
  const model = imageModelFor(sp);
  const prompt = propPrompt(p, sp.doc.settings.style);
  const jobId = enqueue(
    'image',
    { catalogId: model.id, prompt, negative: NEGATIVE, ratio: ratioFor(model, '1:1'), seed: Math.floor(Math.random() * 2_147_483_647), enhance: false, verifyAttempts: 1 },
    { userId: sp.userId, heavy: true },
  );
  return store.addMedia(sp.id, 'prop', p.id, { prompt, job_id: jobId, label: 'Drawn with AI' });
}

// ── casting ──────────────────────────────────────────────────────────────────

export interface CastingLook {
  /** Two to five words: "wiry, freckled redhead". */
  label: string;
  /** A full appearance paragraph; casting this look copies it into the character. */
  appearance: string;
}

/** What the writer has told us about the character, for the casting call. */
export function castingBrief(c: Character): string {
  return [
    `Name: ${c.name}`,
    c.kind && c.kind !== 'human' ? `Kind: ${c.kind}${c.species ? ` (${c.species})` : ''}` : '',
    c.age ? `Age: ${c.age}` : '',
    c.gender ? `Gender: ${c.gender}` : '',
    c.role ? `Role: ${c.role}` : '',
    c.appearance?.trim() ? `Appearance so far: ${c.appearance.trim()}` : '',
    c.personality?.trim() ? `Personality: ${c.personality.trim()}` : '',
    c.backstory?.trim() ? `Backstory: ${c.backstory.trim().slice(0, 800)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const castingDeps = { llmJson };

/**
 * Four distinctly different looks that all fit the writer's brief, like a
 * casting call. Anything the writer fixed stays; everything else varies.
 * Without a model, the current description is used four times (the renders
 * still differ by seed).
 */
export async function castingLooks(c: Character, count = 4): Promise<CastingLook[]> {
  const base = c.appearance?.trim() || [c.age, c.gender, c.species || c.kind].filter(Boolean).join(' ') || c.name;
  const brief = castingBrief(c);
  const name = c.name.trim();
  const looks: CastingLook[] = [];
  // One look per call, in turn, each told what has already been proposed:
  // small local models return one look (or a copy of the brief) when asked for a list.
  for (const angle of CASTING_ANGLES.slice(0, count)) {
    let look: CastingLook | null = null;
    for (let attempt = 0; attempt < 2 && !look; attempt++) {
      try {
        const out = await castingDeps.llmJson<{ label?: unknown; appearance?: unknown }>(
          'You are a casting director for an invented film character. Propose ONE look for the character as ' +
            '{"label": "a few words about the face, e.g. narrow fox-like face, freckles", "appearance": "one paragraph"}. ' +
            'Every trait the brief states is fixed: keep the same hair colour, eye colour, height, age, gender, species and named features, word for word. ' +
            'Invent concrete details only for what it leaves open: face shape, features, skin, hairstyle within the stated hair, build within the stated build, distinguishing marks. ' +
            `This look: ${angle}.` +
            (looks.length ? ` It must look clearly different from these already proposed: ${looks.map((l) => l.label).join('; ')}.` : '') +
            ' Physical traits only: no wardrobe, personality or story, and do not use the character\'s name. Never describe or resemble a real person.',
          brief,
          { temperature: 0.9 },
        );
        const appearance = asString(out.appearance, 1500);
        if (!appearance || appearance.length < 40 || base.startsWith(appearance)) continue;
        let label = asString(out.label, 80).replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s:–—-]*`, 'gi'), '').trim();
        if (!label || /\bword|summary|label\b/i.test(label)) label = appearance.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(has|is)\\s+`, 'i'), '').split(/[,.;]/)[0].slice(0, 40);
        look = { label, appearance };
      } catch {
        // try again, then fall back
      }
    }
    looks.push(look ?? { label: `Take ${looks.length + 1}`, appearance: base });
  }
  return looks;
}

const CASTING_ANGLES = [
  'the most natural fit for the brief',
  'a sharper, more angular face',
  'a softer, rounder, younger-looking face',
  'one distinctive facial feature, such as a scar, a crooked nose, heavy brows or a gap tooth',
  'a weathered, lived-in face',
  'a clean-cut, polished face',
];

/** Queue a headshot for each look; rows are 'character' media labelled 'casting'. */
export async function castCharacter(sp: Screenplay, c: Character, count = 4): Promise<ScreenplayMedia[]> {
  const looks = await castingLooks(c, count);
  const model = imageModelFor(sp);
  const round = Date.now();
  return looks.map((look) => {
    const prompt = castingPrompt({ ...c, appearance: look.appearance }, sp.doc.settings.style);
    const jobId = enqueue(
      'image',
      {
        catalogId: model.id,
        prompt,
        negative: NEGATIVE,
        ratio: ratioFor(model, '3:4'),
        seed: Math.floor(Math.random() * 2_147_483_647),
        enhance: false,
        verifyAttempts: 1,
      },
      { userId: sp.userId, heavy: true },
    );
    const row = store.addMedia(sp.id, 'character', c.id, { prompt, job_id: jobId, label: 'casting', caption: look.appearance });
    store.updateMedia(row.id, { meta: JSON.stringify({ look: look.label, round }) });
    return { ...row, meta: JSON.stringify({ look: look.label, round }) };
  });
}

/** Turn rough notes into a concise visual description for the image model. */
export async function refineAppearance(c: Character, notes: string): Promise<string> {
  const out = await llmJson<{ appearance?: string }>(
    'You write the visual description of an invented film character for an image model. Return {"appearance": "..."}: ' +
      'one paragraph of concrete physical traits only (species or body, face, hair, skin or surface, build, height, ' +
      'distinguishing features). No wardrobe, no personality, no story. Never describe or resemble a real person.',
    `Character: ${c.name}${c.kind ? ` (${c.kind}${c.species ? `, ${c.species}` : ''})` : ''}${c.age ? `, age ${c.age}` : ''}` +
      `${c.gender ? `, ${c.gender}` : ''}\nCurrent description: ${c.appearance || '(none)'}\nWriter's notes: ${notes}`,
  );
  const appearance = asString(out.appearance, 1500);
  if (!appearance) throw new Error('The model did not return a description');
  return appearance;
}

// ── references ───────────────────────────────────────────────────────────────

export function addReference(
  sp: Screenplay,
  target: string,
  file: { bytes: Buffer; mime: string; filename?: string },
): ScreenplayMedia {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.mime)) throw new Error('Upload a PNG, JPEG, WebP or GIF image');
  if (file.bytes.length > 20 * 1024 * 1024) throw new Error('Images must be under 20 MB');
  const media = saveMedia({ userId: sp.userId, type: 'image', bytes: file.bytes, mime: file.mime, originalFilename: file.filename, prompt: 'Screenplay reference' });
  const row = store.addMedia(sp.id, 'reference', target, { status: 'ready', media_id: media.id, label: file.filename ?? null });
  void captionReference(sp.id, row.id, file.bytes);
  return row;
}

/** Describe a reference photo's look so shots can borrow it. */
export async function captionReference(screenplayId: number, rowId: number, bytes: Buffer): Promise<void> {
  try {
    const caption = await describeImage(
      bytes.toString('base64'),
      'This is a mood/reference photo for a film storyboard. In one or two sentences, describe only its visual ' +
        'look: lighting, colour palette and grade, lens and framing, composition, atmosphere, setting and production ' +
        'design. Do not identify any person.',
    );
    store.updateMedia(rowId, { caption, error: null });
  } catch (e) {
    store.updateMedia(rowId, { error: `Couldn’t describe the photo: ${(e as Error).message}. Type a description instead.` });
  }
  scheduleReconcile(screenplayId, 0);
}
