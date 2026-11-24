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
  /** The prompt from the script alone, before adjustment notes. */
  basePrompt?: string;
  /** Adjustment notes that are on, in order. */
  adjustments?: string[];
  /** The notes are being applied; `prompt` is not final yet. */
  adjusting?: boolean;
  /** How the notes were applied when the AI couldn't ("added as written"). */
  adjustNote?: string;
  staging?: string;
  hash?: string;
  /** Hash of the shot's script block alone: only a change here re-renders by itself. */
  blockHash?: string;
  /** The frame is out of date for reasons other than the script; waits for a refresh. */
  stale?: boolean;
  /** The music cue is out of date; waits for a refresh. */
  musicStale?: boolean;
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

/**
 * What a shot type looks like, spelled out. Image models mostly ignore a bare
 * label like "over-the-shoulder shot", but follow a description of where the
 * camera is and what fills the frame.
 */
export function composition(type: string, subject: string | null, other: string | null): string {
  const t = type.toLowerCase();
  const who = subject ?? 'the subject';
  if (/over.?the.?shoulder|\bots\b/.test(t)) {
    return other
      ? `over-the-shoulder shot: the camera is behind ${other}, whose shoulder and the back of whose head fill one side of the foreground, large and out of focus; we look past them at ${who}, in focus, facing the camera`
      : `over-the-shoulder shot: the camera is just behind ${who}, ${who}'s shoulder and the back of their head large and out of focus in the foreground; we look past them at what they are looking at, in focus`;
  }
  if (/extreme close/.test(t)) return `extreme close-up: one detail (eyes, hands or an object) fills the whole frame`;
  if (/medium close|mcu/.test(t)) return `medium close-up: ${who} framed from the chest up`;
  if (/close/.test(t)) return `close-up: ${who}'s face fills most of the frame`;
  if (/medium wide|cowboy/.test(t)) return `medium wide shot: ${who} framed from the knees up`;
  if (/medium/.test(t)) return `medium shot: ${who} framed from the waist up`;
  if (/^full/.test(t)) return `full shot: ${who} seen head to toe, filling the height of the frame`;
  if (/two.?shot/.test(t)) return `two-shot: two people together in the frame${subject && other ? `, ${subject} and ${other}` : ''}`;
  if (/pov|point of view/.test(t)) return `point-of-view shot: we see exactly what ${who} sees, through their eyes; ${who} is not visible except perhaps their hands`;
  if (/insert/.test(t)) return 'insert shot: a close view of an object or detail, no faces';
  if (/establish|extreme wide/.test(t)) return 'extreme wide establishing shot: the whole place, any people tiny in the frame';
  if (/aerial/.test(t)) return 'aerial shot from high above';
  if (/bird/.test(t)) return "bird's-eye shot looking straight down from directly overhead";
  if (/low angle/.test(t)) return `low-angle shot: the camera near the ground, looking up at ${who}`;
  if (/high angle/.test(t)) return `high-angle shot: the camera above, looking down at ${who}`;
  if (/dutch/.test(t)) return `Dutch-angle shot: the camera tilted, the horizon at a slant, on ${who}`;
  if (/wide/.test(t)) return `wide shot: the whole setting, ${subject ? `${who} small to mid-size and seen in full` : 'figures small in the frame'}`;
  if (/tracking/.test(t)) return `tracking shot moving alongside ${who}, the background streaked with motion`;
  if (/crane/.test(t)) return `high, sweeping crane shot over ${subject ? who : 'the scene'}`;
  if (/handheld/.test(t)) return `handheld shot, slightly off level, close to ${who}, documentary feel`;
  return shotPhrase(type);
}

/** Lens families: what kind of glass, separate from focal length. */
export const LENS_TYPES = [
  { id: 'spherical', label: 'Spherical (modern cine prime)' },
  { id: 'anamorphic', label: 'Anamorphic' },
  { id: 'vintage-anamorphic', label: 'Vintage anamorphic' },
  { id: 'vintage-prime', label: 'Vintage spherical prime' },
  { id: 'cine-zoom', label: 'Cine zoom' },
  { id: 'still-lens', label: 'Still-photo lens' },
  { id: 'macro', label: 'Macro' },
  { id: 'tilt-shift', label: 'Tilt-shift' },
  { id: 'fisheye', label: 'Fisheye' },
] as const;

/** What each lens family does to the picture, beyond its focal length. */
const LENS_TRAITS: Record<string, { name: string; traits: string; flare?: string }> = {
  spherical: { name: 'spherical cine prime', traits: 'clean, sharp and neutral rendering, round bokeh, straight lines stay straight' },
  anamorphic: {
    name: 'anamorphic',
    traits: 'shot on anamorphic lenses: oval vertically stretched bokeh, gentle barrel distortion and softer edges, wide cinemascope feel',
    flare: 'a thin horizontal blue anamorphic streak',
  },
  'vintage-anamorphic': {
    name: 'vintage anamorphic',
    traits: '1970s vintage anamorphic lenses: oval bokeh, lower contrast, soft blooming highlights, focus falloff and mild distortion at the frame edges',
    flare: 'a warm amber horizontal streak',
  },
  'vintage-prime': {
    name: 'vintage spherical prime',
    traits: 'vintage cine prime, soft lower contrast, gentle halation and glow around highlights, creamy round bokeh',
    flare: 'a soft warm veiling glow',
  },
  'cine-zoom': { name: 'cine zoom', traits: 'cinema zoom lens, slightly softer and lower contrast than a prime, even, natural rendering' },
  'still-lens': { name: 'still-photo', traits: 'still-photography lens, crisp and clinical, high contrast, busy bokeh' },
  macro: { name: 'macro', traits: 'macro lens, extreme close focus, tiny details large and razor sharp, a wafer-thin plane of focus' },
  'tilt-shift': { name: 'tilt-shift', traits: 'tilt-shift lens, a slanted plane of focus with strong blur above and below, a miniature-model look' },
  fisheye: { name: 'fisheye', traits: 'fisheye lens, a circular, strongly curved barrel-distorted image, extreme field of view' },
};

/** Bright light sources the scene puts in view; flares only make sense from these. */
const LIGHTS: [RegExp, string][] = [
  [/\b(?:sunset|sunrise|dawn|dusk|golden hour|low sun|setting sun|rising sun)\b/i, 'the low sun'],
  [/\bsun(?:light|lit|shine|beams?)?\b|\bbacklit\b/i, 'the sun'],
  [/\blightning\b/i, 'the lightning'],
  [/\bhead ?lights?\b|\bhigh ?beams?\b|\btail ?lights?\b/i, 'the headlights'],
  [/\bstreet ?lights?\b|\bstreet ?lamps?\b|\blamp ?posts?\b/i, 'the streetlights'],
  [/\bneon\b/i, 'the neon signs'],
  [/\bspot ?lights?\b|\bsearch ?lights?\b|\bstage lights?\b|\bfloodlights?\b/i, 'the spotlights'],
  [/\bflash ?lights?\b|\btorch(?:es)?\b/i, 'the flashlight beam'],
  [/\bcandles?\b|\bcandlelit\b/i, 'the candle flames'],
  [/\bfire\b|\bflames?\b|\bbonfire\b|\bexplosion\b|\bmuzzle flash\b/i, 'the flames'],
  [/\blamps?\b|\bchandelier\b|\bbare bulb\b|\blight ?bulbs?\b/i, 'the lamps'],
  [/\bsirens?\b|\bpolice lights\b|\bemergency lights\b/i, 'the emergency lights'],
];

const FAR_LIGHTS = new Set(['the low sun', 'the sun', 'the lightning']);

export function lightSources(text: string): string[] {
  const found = LIGHTS.filter(([re]) => re.test(text)).map(([, name]) => name);
  return found.includes('the low sun') ? found.filter((f) => f !== 'the sun') : found;
}

/** Flares come from a light that is in the shot, or there are none. */
export function flareLine(type: string | undefined, sceneText: string): string {
  const flare = type ? LENS_TRAITS[type]?.flare : undefined;
  if (!flare) return '';
  // Far lights (sun, lightning) get placed anywhere by image models, so they
  // never flare; only lights close to the camera do.
  const lights = lightSources(sceneText).filter((l) => !FAR_LIGHTS.has(l));
  if (!lights.length) return 'No lens flares, no light streaks';
  const list = lights.length === 1 ? lights[0] : `${lights.slice(0, -1).join(', ')} or ${lights[lights.length - 1]}`;
  return `Lens flare only where ${list} ${lights.length === 1 ? 'is' : 'are'} visible in the frame: ${flare} through that light, matching its colour and position; no flares anywhere else`;
}

/** What a focal length and lens family do to the picture, in words image models follow. */
export function lensLook(mm: number, type?: string): string {
  const kind = type ? LENS_TRAITS[type] : undefined;
  const glass = kind && type !== 'spherical' ? `${mm}mm ${kind.name}` : `${mm}mm`;
  let focal: string;
  if (type === 'fisheye') focal = `${glass} lens`;
  else if (mm <= 18) focal = `${glass} ultra-wide-angle lens, exaggerated perspective, stretched edges, everything in sharp focus`;
  else if (mm <= 28) focal = `${glass} wide-angle lens, deep focus, wide field of view`;
  else if (mm <= 40) focal = `${glass} lens, natural perspective, moderate depth of field`;
  else if (mm <= 60) focal = `${glass} lens, natural perspective, background softly out of focus`;
  else if (mm <= 90) focal = `${glass} portrait lens, compressed background, strong background blur`;
  else focal = `${glass} telephoto lens, flattened compressed perspective, very shallow depth of field, background a soft blur`;
  return kind ? `${focal}; ${kind.traits}` : focal;
}

/**
 * A frame is one moment: the start of the shot's action, not the whole
 * paragraph (several actions in one prompt get drawn as several people).
 */
export function firstMoment(action: string, maxWords = 28): string {
  const sentences = action.match(/[^.!?]+[.!?]+(?:["”’)]+)?|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  const out: string[] = [];
  let words = 0;
  for (const x of sentences) {
    const n = x.split(/\s+/).length;
    if (out.length && (out.length >= 2 || words + n > maxWords)) break;
    out.push(x);
    words += n;
  }
  return out.join(' ') || action;
}

/** "a man" / "a woman" from pronouns in the shot, when the profile doesn't say. */
export function genderFromText(text: string): 'man' | 'woman' | null {
  const he = (text.match(/\b(he|him|his|himself)\b/gi) ?? []).length;
  const she = (text.match(/\b(she|her|hers|herself)\b/gi) ?? []).length;
  return he && !she ? 'man' : she && !he ? 'woman' : null;
}

function describeCharacter(c: Character | undefined, name: string, manner: string[], inferred: 'man' | 'woman' | null = null): string {
  const bits: string[] = [];
  const kind = c?.species || (c?.kind && c.kind !== 'human' ? c.kind : '');
  const person = [c?.age, c?.gender || (!kind ? inferred : null), kind].filter(Boolean).join(' ');
  if (person) bits.push(person);
  if (c?.appearance?.trim()) bits.push(c.appearance.trim().replace(/\.$/, ''));
  const ward = c?.wardrobe?.trim().replace(/\.$/, '').replace(/^(?:is\s+)?(?:dressed(?:\s+up)?\s+in|wearing|wears)\s+/i, '');
  if (ward) bits.push(`wearing ${ward}`);
  if (manner.length) bits.push(manner.join(', '));
  return bits.length ? `${name} (${bits.join(', ')})` : name;
}

// Unnamed people in the shot: crowds, staff, passers-by.
const EXTRAS_RE =
  /\b(?:crowds?|extras?|people|passers?-?by|pedestrians?|onlookers?|bystanders?|strangers?|patrons?|customers?|diners?|guests?|shoppers?|commuters?|tourists?|travell?ers?|passengers?|spectators?|audience|fans|students|workers|staff|waiters?|waitress(?:es)?|bartenders?|guards?|soldiers?|officers?|nurses?|doctors?|men|women|kids|children|families|couples?|someone|somebody|others|figures?|townsfolk|villagers?|locals?|partygoers?|dancers?|mourners?|congregation|commuters)\b/i;

/**
 * Keeps background people from borrowing the named characters' looks. Image
 * models tend to copy a described face or outfit onto everyone in frame, and
 * ignore "not", so this describes the extras positively as different people.
 */
/** Exterior public places where an image model will add passers-by unasked. */
const PUBLIC_RE = /\b(?:street|avenue|sidewalk|pavement|city|downtown|plaza|square|station|platform|market|mall|park|boardwalk|beach|harbou?r|pier|airport|stadium|campus|parking|subway|bus stop|crosswalk|intersection|skyline|times square|new york|nyc)\b/i;

export function extrasLine(text: string, cast: string[], exterior = false): string {
  if (!cast.length || !(EXTRAS_RE.test(text) || (exterior && PUBLIC_RE.test(text)))) return '';
  const names = cast.length === 1 ? cast[0] : `${cast.slice(0, -1).join(', ')} and ${cast[cast.length - 1]}`;
  return (
    `Background extras are unrelated strangers with their own distinct faces, hairstyles, ages, builds and skin tones, ` +
    `in their own everyday clothing of different colours and styles; only ${names} ${cast.length === 1 ? 'has' : 'have'} the looks and outfits described above, ` +
    `and each appears once`
  );
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
  const blockHash = hashOf(section.scene?.text ?? '', section.elements.map((e) => [e.type, e.text]));
  if (!shot.type?.trim()) return { waiting: 'Pick a shot type to render', characters: [], blockHash };
  const action = visualText(section.elements);
  const h = section.heading;
  if (!action && !h?.location) return { waiting: 'Describe the scene in the script to render', characters: [], blockHash };

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

  const blockText = section.elements.map((e) => e.text).join(' ');
  const inferred = cast.length === 1 ? genderFromText(blockText) : null;
  const moment = firstMoment(action);
  const parts = [
    `Cinematic film still, ${composition(shot.type, cast[0]?.name ?? null, cast[1]?.name ?? null)}`,
    lensLook(lens, shot.lensType || doc.settings.lensType),
    flareLine(shot.lensType || doc.settings.lensType, `${where} ${moment}`),
    where,
    moment ? `A single moment: ${moment}` : '',
    cast.length ? `${cast.map((p) => describeCharacter(p.character, p.name, p.manner, inferred)).join('; ')}` : '',
    cast.length ? `${cast.length === 1 ? `${cast[0].name} appears exactly once in the frame` : 'Each named person appears exactly once in the frame'}` : '',
    extrasLine(`${action} ${where}`, cast.map((c) => c.name), h?.setting?.startsWith('Exterior') ?? false),
    staging.text,
    refs.length ? `Look and feel: ${refs.join('; ')}` : '',
    doc.settings.style?.trim() || 'Photorealistic, natural film lighting, film grain',
    cast.length
      ? `No text, captions, subtitles or watermarks; ${cast.length === 1 ? `the name "${cast[0].name}" is` : `the names ${cast.map((c) => `"${c.name}"`).join(', ')} are`} never written anywhere in the picture, not on clothing, signs or screens`
      : 'No text, captions, subtitles or watermarks',
  ].filter(Boolean);
  const prompt = parts.map((p) => p.replace(/\s+/g, ' ').trim().replace(/[.;,]$/, '')).join('. ') + '.';
  const adjustments = activeAdjustments(shot);

  if (MINOR_RE.test(`${prompt} ${adjustments.join(' ')}`) && SEXUAL_RE.test(`${prompt} ${adjustments.join(' ')}`)) {
    return { blocked: 'Not rendered: sexual content in a shot that mentions a child or teenager.', characters: cast.map((c) => c.name), blockHash };
  }
  return {
    prompt,
    basePrompt: prompt,
    adjustments,
    staging: staging.text,
    blockHash,
    // Adding, editing, removing or switching a note changes the hash, so the frame re-renders.
    hash: adjustments.length ? hashOf(prompt, imageModel, ratio, shot.take ?? 0, adjustments) : hashOf(prompt, imageModel, ratio, shot.take ?? 0),
    characters: cast.map((c) => c.name),
  };
}

/** Notes that are on and not blank. */
export function activeAdjustments(shot: Shot): string[] {
  return (shot.adjustments ?? []).filter((a) => !a.off && a.text.trim()).map((a) => a.text.trim().replace(/\s+/g, ' '));
}

/** Cache key for a rewrite of `basePrompt` with `notes`. */
export const adjustKey = (basePrompt: string, notes: string[]) => hashOf('adjust', basePrompt, notes);

/** Used when the AI can't rewrite: the notes appended as instructions. */
export function appendAdjustments(basePrompt: string, notes: string[]): string {
  const tail = 'No text, captions, subtitles or watermarks.';
  const body = basePrompt.endsWith(tail) ? basePrompt.slice(0, -tail.length).trim() : basePrompt;
  return `${body} Adjustments: ${notes.map((n) => n.replace(/[.;]$/, '')).join('; ')}. ${tail}`.replace(/\s+/g, ' ');
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
