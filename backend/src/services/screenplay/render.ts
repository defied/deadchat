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
import { asString, llmJson } from '../influencers/llm';
import { adjustKey, appendAdjustments, characterPrompt, hashOf, planMusic, planShot, type ReferenceNote, type ShotPlan } from './prompts';
import db from '../../db/connection';
import { getActiveModel } from '../chatModels';
import * as store from './store';
import type { Character, Screenplay, ScreenplayMedia } from './types';

export const STABLE_MS = 6000;
export const MUSIC_MODEL = 'ace-step-v1';
const NEGATIVE = 'text, subtitles, captions, watermark, logo, signature, deformed hands, extra limbs';

// ── job → row sync ────────────────────────────────────────────────────────────

function friendlyError(e: string | null, role: ScreenplayMedia['role']): string {
  const msg = e || 'Failed';
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
  return new Map(sp.doc.shots.map((s) => [s.id, withAdjustments(planShot(sp.doc, s, refs, modelId))]));
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
  'the setting, action, characters and their descriptions, camera and lens, and style. Describe the result directly ' +
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
      model = getActiveModel();
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
    if (plan.hash && plan.adjusting && frame?.hash !== plan.hash) {
      // Notes changed: once they settle, apply them, then come back to render.
      if (!force && !stable(`${sp.id}:${shot.id}:frame`, plan.hash, now)) again = true;
      else {
        supersede(frame);
        void rewriteForAdjustments(plan.basePrompt!, plan.adjustments!).then(() => scheduleReconcile(sp.id, 0));
      }
    } else if (plan.hash && plan.prompt && frame?.hash !== plan.hash) {
      if (!force && !stable(`${sp.id}:${shot.id}:frame`, plan.hash, now)) again = true;
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
        store.addMedia(sp.id, 'frame', shot.id, { hash: plan.hash, prompt: plan.prompt, job_id: jobId });
      } else {
        store.addMedia(sp.id, 'frame', shot.id, { hash: plan.hash, prompt: plan.prompt, status: 'failed', error: 'No image model is available' });
      }
    }

    const music = planMusic(shot);
    const cue = store.latestMedia(sp.id, 'music', shot.id);
    if (music.hash && music.prompt && cue?.hash !== music.hash) {
      if (!force && !stable(`${sp.id}:${shot.id}:music`, music.hash, now)) again = true;
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
