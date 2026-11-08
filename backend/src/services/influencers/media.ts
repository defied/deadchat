// Images and clips for influencers, generated through the normal media job
// queue (so they serialize with everything else on the GPU and land in the
// gallery too).

import { enqueue, getJob, awaitJob } from '../jobQueue';
import { MEDIA_MODELS, getMediaModel, type MediaModel } from '../media/catalog';
import { getMediaSettings } from '../media/settings';
import { ADULT_RULES, MIN_EXPLICIT_AGE, coverageRules, isMale, buildImagePrompt, checkImagePrompt, contentLevel, imageNegative } from './compliance';
import { asString, asStringArray, llmJson } from './llm';
import * as store from './store';
import type { Influencer, InfluencerMedia, Look } from './types';

const PORTRAIT_SCENE = 'head-and-shoulders portrait, looking at the camera, soft daylight, plain background';

export function localModels(kind: 'image' | 'video'): MediaModel[] {
  return MEDIA_MODELS.filter((m) => m.kind === kind && m.backend === 'local');
}

function imageModel(look: Look): MediaModel {
  const chosen = look.imageModel ? getMediaModel(look.imageModel) : undefined;
  if (chosen && chosen.kind === 'image') return chosen;
  const def = getMediaModel(getMediaSettings().defaultImageModel);
  if (def && def.kind === 'image' && def.backend === 'local') return def;
  const local = localModels('image')[0];
  if (!local) throw new Error('No local image model is available');
  return local;
}

function videoModel(look: Look): MediaModel {
  const chosen = look.videoModel ? getMediaModel(look.videoModel) : undefined;
  if (chosen && chosen.kind === 'video' && chosen.needsImage) return chosen;
  const i2v = localModels('video').find((m) => m.needsImage);
  if (!i2v) throw new Error('No local image-to-video model is available');
  return i2v;
}

function ratioFor(model: MediaModel, wanted?: string): string {
  const r = (wanted ?? '3:4') as MediaModel['ratios'][number];
  return model.ratios.includes(r) ? r : model.defaults.ratio;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

/** What scenes may show, for the scene-planning prompts. */
export function sceneRule(inf: Influencer): string {
  const level = contentLevel(inf.look);
  if (level === 'explicit') {
    return 'may include nude and sexual scenes. Everyone shown is a consenting adult who clearly looks 21 or ' +
      'older; never anyone young-looking, no school or childhood settings, no non-consent, no family roles, no ' +
      'animals, no real or famous people.';
  }
  if (level === 'implied' && isMale(inf.persona)) {
    return 'may include a few tasteful, flirtatious implied-nudity scenes: shirtless after a workout or swim, ' +
      'stepping out of the shower with a towel wrapped low around the hips, in the bath or tangled in bedsheets. A ' +
      'bare chest is fine; keep everything below the waist covered by the towel, water, sheets or the frame. Nothing explicit.';
  }
  return level === 'implied'
    ? 'may include a few tasteful, flirtatious implied-nudity scenes. Image models draw the body under foam or thin ' +
        'fabric, so frame each one so the chest is out of shot or turned away: a close-up in the bath cropped at the ' +
        'collarbones, sitting in the tub with knees hugged to the chest and arms wrapped around them, back to the ' +
        'camera looking over the shoulder, or stepping out of the shower in a thick towel wrapped high. Nothing ' +
        'explicit or sexual. Never name breasts, nipples or other private body parts, even to say they are covered: ' +
        'image models draw whatever is named. Describe the framing and what covers the body.'
    : 'are safe for work.';
}

/** Queue one image of the persona. Throws if the prompt breaks the rules. */
export function queuePersonaImage(inf: Influencer, scene: string, role: 'look' | 'portfolio' | 'post', seed?: number): InfluencerMedia {
  const appearance = inf.look.appearance?.trim();
  if (!appearance) throw new Error('Describe the look first');
  // The look portrait is always clothed; only scenes may use implied nudity.
  const level = role === 'look' ? 'sfw' : contentLevel(inf.look);
  if (level === 'explicit' && (inf.persona.age ?? 0) < MIN_EXPLICIT_AGE) {
    throw new Error(`Explicit images need a persona aged ${MIN_EXPLICIT_AGE} or older.`);
  }
  const check = checkImagePrompt('The scene', scene, level);
  if (!check.passed) throw new Error(check.issues.join(' '));
  const model = imageModel(inf.look);
  const prompt = buildImagePrompt(inf.persona, appearance, scene, inf.look.style, level);
  const jobId = enqueue(
    'image',
    {
      catalogId: model.id,
      prompt,
      negative: imageNegative(level),
      ratio: ratioFor(model, inf.look.ratio),
      seed: seed ?? randomSeed(),
      // The locked appearance must reach the model verbatim.
      enhance: false,
      // Implied nudity: a vision check rejects any exposure and retries; if
      // every attempt fails, the job fails and nothing is saved.
      // Explicit: every image must pass a vision check that everyone looks clearly adult.
      ...(level === 'implied'
        ? { verifyAttempts: 4, verifyRules: coverageRules(inf.persona), requireVerified: true }
        : level === 'explicit'
          ? { verifyAttempts: 3, verifyRules: ADULT_RULES, requireVerified: true }
          : { verifyAttempts: 1 }),
    },
    { userId: inf.userId, heavy: true },
  );
  return store.addMedia(inf.id, role, { jobId, prompt, scene });
}

export function queueClip(inf: Influencer, fromMediaId: number, motion: string, role: 'clip' | 'post' = 'clip'): InfluencerMedia {
  const check = checkImagePrompt('The motion prompt', motion, contentLevel(inf.look));
  if (!check.passed) throw new Error(check.issues.join(' '));
  const model = videoModel(inf.look);
  const prompt = `${motion.trim()}. Natural, subtle movement; the same adult person throughout.`;
  const jobId = enqueue(
    'video',
    { catalogId: model.id, prompt, imageMediaId: fromMediaId, ratio: ratioFor(model, inf.look.ratio), enhance: false },
    { userId: inf.userId, heavy: true },
  );
  return store.addMedia(inf.id, role, { jobId, prompt, scene: motion });
}

/** Rewrite the appearance from user feedback ("shorter hair, warmer smile"). */
export async function refineAppearance(inf: Influencer, feedback: string): Promise<string> {
  const out = await llmJson<{ appearance?: string }>(
    'You maintain the visual description of an invented, adult social media persona for an image model. ' +
      'Apply the requested changes and return {"appearance": "..."}: one paragraph of concrete, physical, ' +
      'non-sexual traits (face, hair, skin, build, signature style). Never describe or resemble a real person. ' +
      'Never make the persona look younger than an adult.',
    `Current description: ${inf.look.appearance || '(none yet)'}\nPersona: ${inf.persona.age}-year-old ${inf.persona.gender ?? 'adult'}, ` +
      `${inf.persona.niche ?? ''}\nRequested changes: ${feedback}`,
  );
  const appearance = asString(out.appearance, 1200);
  if (!appearance) throw new Error('The model did not return a description');
  const check = checkImagePrompt('The new description', appearance);
  if (!check.passed) throw new Error(check.issues.join(' '));
  return appearance;
}

/** Queue `count` look candidates (portraits) for the user to pick from. */
export function generateLookCandidates(inf: Influencer, count: number): InfluencerMedia[] {
  return Array.from({ length: Math.max(1, Math.min(6, count)) }, () => queuePersonaImage(inf, PORTRAIT_SCENE, 'look'));
}

/** Varied scenes for the portfolio, from the persona's niche and themes. */
export async function portfolioScenes(inf: Influencer, count: number): Promise<string[]> {
  const out = await llmJson<{ scenes?: unknown }>(
    'You plan photos for an invented adult social media persona. Return {"scenes": [..]}: short, concrete scene ' +
      'descriptions (setting, activity, outfit, framing, light) that fit the persona, vary location and framing, ' +
      `and ${sceneRule(inf)} Never include other identifiable people, children, brands or logos.`,
    `Persona: ${inf.persona.displayName}, ${inf.persona.niche}. Audience: ${inf.persona.audience ?? 'adults'}. ` +
      `Themes: ${(inf.plan.themes ?? []).join(', ') || 'their everyday life'}. Number of scenes: ${count}.`,
    { temperature: 0.8 },
  );
  return asStringArray(out.scenes, count, 400).filter((s) => checkImagePrompt('Scene', s, contentLevel(inf.look)).passed);
}

export async function generatePortfolio(inf: Influencer, count: number): Promise<InfluencerMedia[]> {
  const n = Math.max(1, Math.min(12, count));
  const scenes = await portfolioScenes(inf, n);
  if (!scenes.length) throw new Error('No usable scenes came back; try again or add themes');
  return scenes.map((s) => queuePersonaImage(inf, s, 'portfolio', inf.look.seed));
}

/** Resolve pending rows whose jobs have finished. */
export function syncPending(influencerId: number): void {
  for (const row of store.listMediaRows(influencerId)) {
    if (row.status !== 'pending' || row.job_id == null) continue;
    const job = getJob(row.job_id);
    if (!job) {
      store.updateMediaRow(row.id, { status: 'failed', error: 'Job no longer exists' });
    } else if (job.status === 'succeeded') {
      let mediaId: number | null = null;
      try {
        mediaId = (JSON.parse(job.result ?? '{}') as { media_ids?: number[] }).media_ids?.[0] ?? null;
      } catch { /* ignore */ }
      store.updateMediaRow(row.id, mediaId ? { status: 'ready', mediaId } : { status: 'failed', error: 'No media produced' });
    } else if (job.status === 'failed' || job.status === 'canceled') {
      store.updateMediaRow(row.id, { status: 'failed', error: job.error || job.status });
    }
  }
}

/** Wait for a queued row's job and return its media id. */
export async function awaitMedia(row: InfluencerMedia, timeoutMs = 45 * 60_000): Promise<number> {
  if (row.job_id == null) throw new Error('No job to wait for');
  const job = await awaitJob(row.job_id, timeoutMs, 3000);
  syncPending(row.influencer_id);
  if (job.status !== 'succeeded') throw new Error(job.error || `Media job ${job.status}`);
  const fresh = store.getMediaRow(row.id);
  if (!fresh?.media_id) throw new Error('No media produced');
  return fresh.media_id;
}
