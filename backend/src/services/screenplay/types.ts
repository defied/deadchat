// Screenplay documents. Everything in a `ScreenplayDoc` is written by the user;
// DeadChat only reads it to render example shots and music cues.

/** The industry-standard screenplay elements (Final Draft / Fountain). */
export type ElementType =
  | 'scene' // Scene heading (slugline): INT. KITCHEN - NIGHT
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition' // CUT TO:
  | 'shot' // A shot line inside the script: CLOSE ON THE KNIFE
  | 'general'
  | 'centered'; // THE END, titles

export const ELEMENT_TYPES: ElementType[] = [
  'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'general', 'centered',
];

export interface ScriptElement {
  id: string;
  type: ElementType;
  text: string;
}

/** A storyboard shot pinned to a script element (its "anchor"). */
export interface Shot {
  id: string;
  anchorId: string;
  /** e.g. "Wide establishing", "Close-up", "Over-the-shoulder". Rendering starts once this is set. */
  type?: string;
  /** Duration in seconds. */
  seconds?: number;
  /** Lens in mm; falls back to the set-plan camera, then to the shot type. */
  lens?: number;
  /** Music cue for this shot ("sparse piano, melancholy, slow"). */
  music?: string;
  notes?: string;
  /** Bumped by "Re-roll" to get a different take of the same description. */
  take?: number;
}

export type CharacterKind = 'human' | 'animal' | 'creature' | 'robot' | 'alien' | 'spirit' | 'other';

export interface Character {
  id: string;
  name: string;
  kind?: CharacterKind;
  species?: string;
  age?: string;
  gender?: string;
  role?: string;
  /** Visual description used in every shot the character appears in. */
  appearance?: string;
  wardrobe?: string;
  personality?: string;
  backstory?: string;
  voice?: string;
  notes?: string;
  /** screenplay_media id of the chosen reference photo. */
  primaryRefId?: number;
}

export type PlanItemKind = 'character' | 'camera' | 'light' | 'prop';

/** One object on a scene's top-down set plan. Units are metres; y grows downward (screen space). */
export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  x: number;
  y: number;
  /** Facing direction in degrees: 0 = +x (east), 90 = +y (south / down the screen). */
  rot: number;
  /** character id (character) or shot id (camera). */
  ref?: string;
  label?: string;
  /** camera: lens in mm. */
  lens?: number;
  /** camera: height. */
  height?: 'ground' | 'low' | 'eye' | 'high' | 'overhead';
  /** light: colour temperature. */
  color?: 'warm' | 'neutral' | 'cool' | 'moonlight' | 'red' | 'green' | 'blue';
  /** light: quality. */
  quality?: 'soft' | 'hard';
  /** light: practical (a lamp in shot) vs a film light. */
  practical?: boolean;
  /** prop: footprint in metres. */
  w?: number;
  h?: number;
}

export interface SetPlan {
  items: PlanItem[];
}

export interface ScreenplaySettings {
  imageModel?: string;
  ratio?: '16:9' | '21:9' | '4:3' | '1:1' | '9:16';
  /** Visual style for every frame: "35mm film, muted teal and orange grade". */
  style?: string;
  /** Pause rendering (the writer keeps working; nothing is queued). */
  paused?: boolean;
}

export interface ScreenplayDoc {
  elements: ScriptElement[];
  shots: Shot[];
  characters: Character[];
  /** Set plans keyed by scene-heading element id. */
  plans: Record<string, SetPlan>;
  settings: ScreenplaySettings;
  /** Title page fields. */
  titlePage?: { title?: string; credit?: string; author?: string; source?: string; contact?: string; draftDate?: string };
}

export interface Screenplay {
  id: number;
  userId: number;
  title: string;
  doc: ScreenplayDoc;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type MediaRole = 'frame' | 'music' | 'character' | 'reference';
export type MediaStatus = 'pending' | 'ready' | 'failed' | 'superseded';

export interface ScreenplayMedia {
  id: number;
  screenplay_id: number;
  role: MediaRole;
  target: string;
  status: MediaStatus;
  hash: string | null;
  prompt: string | null;
  caption: string | null;
  label: string | null;
  job_id: number | null;
  media_id: number | null;
  error: string | null;
  created_at: string;
}

export function emptyDoc(): ScreenplayDoc {
  return {
    elements: [{ id: 'e1', type: 'scene', text: '' }],
    shots: [],
    characters: [],
    plans: {},
    settings: { ratio: '21:9' },
  };
}
