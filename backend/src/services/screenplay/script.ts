// Reading a screenplay: which script elements belong to a shot, the scene
// heading they sit under, and which characters are visible. Pure functions.

import type { Character, ScreenplayDoc, ScriptElement, Shot } from './types';

export interface SceneHeading {
  /** "Interior", "Exterior", "Interior/exterior", or '' */
  setting: string;
  location: string;
  time: string;
}

const PREFIXES: Array<[RegExp, string]> = [
  [/^(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?)\s*/i, 'Interior/exterior'],
  [/^(?:INT\.?|INTERIOR)\s+/i, 'Interior'],
  [/^(?:EXT\.?|EXTERIOR)\s+/i, 'Exterior'],
  [/^(?:EST\.?)\s+/i, 'Establishing'],
];

/** "INT. JANE'S KITCHEN - NIGHT" → { setting: 'Interior', location: "Jane's kitchen", time: 'night' } */
export function parseHeading(text: string): SceneHeading {
  let rest = text.trim().replace(/^\d+[A-Z]?\s+/, '').replace(/\s+#\d+[A-Z]?#?$/, '');
  let setting = '';
  for (const [re, label] of PREFIXES) {
    if (re.test(rest)) {
      setting = label;
      rest = rest.replace(re, '');
      break;
    }
  }
  const parts = rest.split(/\s+[-–—]\s+/);
  const location = parts[0]?.trim() ?? '';
  const time = parts.slice(1).join(', ').trim();
  return { setting, location: sentenceCase(location), time: time.toLowerCase() };
}

function sentenceCase(s: string): string {
  if (!s || s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The character name in a cue, without extensions: "JANE (V.O.)" → "JANE". */
export function cueName(text: string): string {
  return text.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim();
}

/** Voice-over and off-screen cues are heard, not seen. */
export function cueIsOffscreen(text: string): boolean {
  return /\((?:V\.?\s?O\.?|O\.?\s?S\.?|O\.?\s?C\.?|OFF|PRE-?LAP|ON (?:PHONE|RADIO|TV|SCREEN))\)/i.test(text);
}

export interface ShotSection {
  /** The scene heading element this shot sits under, if any. */
  scene: ScriptElement | null;
  heading: SceneHeading | null;
  /** Elements from the anchor up to the next shot anchor or scene heading. */
  elements: ScriptElement[];
}

/** The part of the script a shot covers. */
export function shotSection(doc: ScreenplayDoc, shot: Shot): ShotSection | null {
  const els = doc.elements;
  const start = els.findIndex((e) => e.id === shot.anchorId);
  if (start < 0) return null;
  const otherAnchors = new Set(doc.shots.filter((s) => s.id !== shot.id).map((s) => s.anchorId));
  let end = start + 1;
  while (end < els.length && els[end].type !== 'scene' && !otherAnchors.has(els[end].id)) end++;
  let scene: ScriptElement | null = null;
  for (let i = start; i >= 0; i--) {
    if (els[i].type === 'scene') {
      scene = els[i];
      break;
    }
  }
  return { scene, heading: scene ? parseHeading(scene.text) : null, elements: els.slice(start, end) };
}

/** The scene heading element at or above `elementId`. */
export function sceneOf(doc: ScreenplayDoc, elementId: string): ScriptElement | null {
  const i = doc.elements.findIndex((e) => e.id === elementId);
  for (let j = i; j >= 0; j--) if (doc.elements[j].type === 'scene') return doc.elements[j];
  return null;
}

/** Every element in a scene (heading included). */
export function sceneElements(doc: ScreenplayDoc, sceneId: string): ScriptElement[] {
  const i = doc.elements.findIndex((e) => e.id === sceneId);
  if (i < 0) return [];
  let end = i + 1;
  while (end < doc.elements.length && doc.elements[end].type !== 'scene') end++;
  return doc.elements.slice(i, end);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does `text` mention `name` as a whole word (screenplays capitalise names on first appearance)? */
export function mentions(text: string, name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

export interface PresentCharacter {
  name: string;
  character?: Character;
  /** Parentheticals under their cues in this section, e.g. "smiling". */
  manner: string[];
}

/** Characters visible in a set of elements: on-screen cues plus names mentioned in action. */
export function presentCharacters(elements: ScriptElement[], characters: Character[]): PresentCharacter[] {
  const out = new Map<string, PresentCharacter>();
  const byName = (n: string) => characters.find((c) => c.name.trim().toLowerCase() === n.trim().toLowerCase());
  const add = (name: string): PresentCharacter => {
    const key = name.toLowerCase();
    let p = out.get(key);
    if (!p) {
      const c = byName(name);
      p = { name: c?.name ?? titleCase(name), character: c, manner: [] };
      out.set(key, p);
    }
    return p;
  };
  let speaker: PresentCharacter | null = null;
  for (const e of elements) {
    if (e.type === 'character') {
      const name = cueName(e.text);
      speaker = name && !cueIsOffscreen(e.text) ? add(name) : null;
    } else if (e.type === 'parenthetical') {
      const m = e.text.replace(/^\(|\)$/g, '').trim();
      if (speaker && m) speaker.manner.push(m);
    } else if (e.type === 'action' || e.type === 'shot' || e.type === 'general' || e.type === 'scene') {
      speaker = null;
      for (const c of characters) if (mentions(e.text, c.name)) add(c.name);
    }
  }
  return [...out.values()];
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Visual text of a section: action, shot lines and general text (not dialogue). */
export function visualText(elements: ScriptElement[]): string {
  return elements
    .filter((e) => e.type === 'action' || e.type === 'shot' || e.type === 'general')
    .map((e) => e.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
