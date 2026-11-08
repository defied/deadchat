// Builds the image prompt for a storyboard shot and the music prompt for a
// cue, straight from what the writer wrote. Nothing here changes the script.

import { createHash } from 'crypto';
import { presentCharacters, shotSection, visualText } from './script';
import { defaultLens, describeStaging } from './staging';
import type { Character, ScreenplayDoc, Shot } from './types';

export const RATIO_ASPECT: Record<string, number> = { '16:9': 16 / 9, '21:9': 21 / 9, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16 };

export interface ShotPlan {
  /** Why nothing renders yet, e.g. "Pick a shot type". */
  waiting?: string;
  /** Rendering would be refused (shown to the writer). */
  blocked?: string;
  prompt?: string;
  staging?: string;
  hash?: string;
  /** Names visible in the shot. */
  characters: string[];
}

export interface ReferenceNote {
  /** shot id, scene element id, or '' for the whole screenplay */
  target: string;
  caption: string;
}

export function hashOf(...parts: unknown[]): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function shotPhrase(type: string): string {
  const t = type.trim().replace(/\.$/, '');
  return /shot|angle|view|insert|pov|close-?up|two-?shot/i.test(t) ? t : `${t} shot`;
}

function describeCharacter(c: Character | undefined, name: string, manner: string[]): string {
  const bits: string[] = [];
  if (c?.appearance?.trim()) bits.push(c.appearance.trim().replace(/\.$/, ''));
  else {
    const facts = [c?.age && `${c.age}`, c?.gender, c?.species || (c?.kind && c.kind !== 'human' ? c.kind : '')].filter(Boolean);
    if (facts.length) bits.push(facts.join(' '));
  }
  if (c?.wardrobe?.trim()) bits.push(`wearing ${c.wardrobe.trim().replace(/\.$/, '')}`);
  if (manner.length) bits.push(manner.join(', '));
  return bits.length ? `${name}: ${bits.join(', ')}` : name;
}

// Sexual content involving a minor is never rendered, whatever the script says.
const MINOR_RE = /\b(?:child|children|kid|kids|toddler|baby|infant|boy|girl|teen\w*|minor|schoolgirl|schoolboy|underage|(?:1[0-7]|[1-9])[\s-]*(?:years?[\s-]*old|yo))\b/i;
const SEXUAL_RE = /\b(?:nude|naked|topless|sex\w*|erotic\w*|porn\w*|explicit|genital\w*|aroused|orgasm\w*|undress\w*|lingerie|seductive\w*)\b/i;

/** The prompt for one shot, or why it can't render yet. */
export function planShot(
  doc: ScreenplayDoc,
  shot: Shot,
  references: ReferenceNote[] = [],
  imageModel = '',
): ShotPlan {
  const section = shotSection(doc, shot);
  if (!section) return { waiting: 'This shot’s script line was deleted', characters: [] };
  if (!shot.type?.trim()) return { waiting: 'Pick a shot type to render', characters: [] };
  const action = visualText(section.elements);
  const h = section.heading;
  if (!action && !h?.location) return { waiting: 'Describe the scene in the script to render', characters: [] };

  const present = presentCharacters(section.elements, doc.characters);
  const sceneId = section.scene?.id ?? '';
  const plan = doc.plans[sceneId];
  const camera = plan?.items.find((it) => it.kind === 'camera' && it.ref === shot.id);
  const ratio = doc.settings.ratio ?? '21:9';
  const lens = shot.lens ?? camera?.lens ?? defaultLens(shot.type);
  const staging = describeStaging(plan, camera ? { ...camera, lens } : undefined, doc.characters, RATIO_ASPECT[ratio] ?? 16 / 9, lens);

  // With a set plan, only the characters the camera sees are described.
  const visible = staging.text ? present.filter((p) => staging.inFrame.some((n) => n.toLowerCase() === p.name.toLowerCase())) : present;
  const planOnly = staging.inFrame
    .filter((n) => !visible.some((p) => p.name.toLowerCase() === n.toLowerCase()))
    .map((n) => ({ name: n, character: doc.characters.find((c) => c.name.toLowerCase() === n.toLowerCase()), manner: [] as string[] }));
  const cast = [...visible, ...planOnly];

  const where = h ? [h.setting, h.location, h.time].filter(Boolean).join(', ') : '';
  const refs = references
    .filter((r) => r.caption.trim() && (r.target === shot.id || r.target === sceneId || r.target === ''))
    .map((r) => r.caption.trim().replace(/\.$/, ''));

  const parts = [
    `Cinematic film still, ${shotPhrase(shot.type)}${camera ? '' : `, ${lens}mm lens`}`,
    where,
    action.length > 900 ? `${action.slice(0, 900)}…` : action,
    cast.length ? `Characters: ${cast.map((p) => describeCharacter(p.character, p.name, p.manner)).join('; ')}` : '',
    staging.text,
    refs.length ? `Look and feel: ${refs.join('; ')}` : '',
    doc.settings.style?.trim() || 'Photorealistic, natural film lighting, shallow depth of field, film grain',
    'No text, captions, subtitles or watermarks',
  ].filter(Boolean);
  const prompt = parts.map((p) => p.replace(/\s+/g, ' ').trim().replace(/[.;,]$/, '')).join('. ') + '.';

  if (MINOR_RE.test(prompt) && SEXUAL_RE.test(prompt)) {
    return { blocked: 'Not rendered: sexual content in a shot that mentions a child or teenager.', characters: cast.map((c) => c.name) };
  }
  return {
    prompt,
    staging: staging.text,
    hash: hashOf(prompt, imageModel, ratio, shot.take ?? 0),
    characters: cast.map((c) => c.name),
  };
}

export const MUSIC_MIN_S = 5;
export const MUSIC_MAX_S = 120;

export interface MusicPlan {
  prompt?: string;
  seconds?: number;
  hash?: string;
}

/** The music prompt for a shot's cue, if it has one. */
export function planMusic(shot: Shot): MusicPlan {
  const desc = shot.music?.trim();
  if (!desc) return {};
  const seconds = Math.round(Math.min(MUSIC_MAX_S, Math.max(MUSIC_MIN_S, shot.seconds || 20)));
  const prompt = `${desc.replace(/\s+/g, ' ').replace(/\.$/, '')}, film score, instrumental`;
  return { prompt, seconds, hash: hashOf(prompt, seconds, shot.take ?? 0) };
}

/** Prompt for a character reference photo. */
export function characterPrompt(c: Character, view: 'portrait' | 'full' | 'profile' | 'expressions', style?: string): string {
  const who = [
    c.appearance?.trim() || [c.age, c.gender, c.species || c.kind].filter(Boolean).join(' ') || c.name,
    c.wardrobe?.trim() ? `wearing ${c.wardrobe.trim()}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const framing = {
    portrait: 'head-and-shoulders portrait, looking at the camera, neutral expression',
    full: 'full-body shot standing, head to toe visible, neutral pose',
    profile: 'side profile view, head and shoulders',
    expressions: 'character expression sheet: the same face showing four different expressions in a grid',
  }[view];
  return [
    `Character reference photo of ${c.name}: ${who}`,
    framing,
    'plain neutral studio backdrop, even soft lighting',
    style?.trim() || 'photorealistic',
    'No text or watermark',
  ].join('. ');
}
