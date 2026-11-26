import client from './client';

export type ElementType =
  | 'scene'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'shot'
  | 'general'
  | 'centered';

export interface ScriptElement {
  id: string;
  type: ElementType;
  text: string;
}

export interface Shot {
  id: string;
  anchorId: string;
  type?: string;
  seconds?: number;
  lens?: number;
  lensType?: string;
  music?: string;
  notes?: string;
  /** Fine-tuning notes the AI applies to the image prompt (the script is never changed). */
  adjustments?: Adjustment[];
  take?: number;
  /** Keep the current frame and music: nothing re-renders, whatever changes. */
  locked?: boolean;
  /** Use this reference image (media row id) as the frame instead of rendering one. */
  frameImage?: number;
}

export interface Adjustment {
  id: string;
  text: string;
  /** Kept but not applied. */
  off?: boolean;
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
  appearance?: string;
  wardrobe?: string;
  personality?: string;
  backstory?: string;
  voice?: string;
  notes?: string;
  primaryRefId?: number;
  /** Made automatically for a name that speaks in the script; cleared once edited. */
  placeholder?: boolean;
  /** Where the spoken voice comes from: a sample kept with the screenplay, or a Studio character's voice. */
  voiceRef?: { kind: 'upload'; mediaRowId: number } | { kind: 'studio'; characterId: number };
}

export type PlanItemKind = 'character' | 'camera' | 'light' | 'prop';

export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  x: number;
  y: number;
  rot: number;
  ref?: string;
  label?: string;
  lens?: number;
  height?: 'ground' | 'low' | 'eye' | 'high' | 'overhead';
  color?: 'warm' | 'neutral' | 'cool' | 'moonlight' | 'red' | 'green' | 'blue';
  quality?: 'soft' | 'hard';
  practical?: boolean;
  w?: number;
  h?: number;
}

export interface SetPlan {
  items: PlanItem[];
}

export interface ScreenplaySettings {
  imageModel?: string;
  ratio?: '16:9' | '21:9' | '4:3' | '1:1' | '9:16';
  style?: string;
  lensType?: string;
  paused?: boolean;
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


export interface TitlePage {
  title?: string;
  credit?: string;
  author?: string;
  source?: string;
  contact?: string;
  draftDate?: string;
}

/** A prop with reference photos, so it looks the same in every frame it's put into. */
export interface Prop {
  id: string;
  name: string;
  /** Other words the script uses for it, comma-separated. */
  aliases?: string;
  description?: string;
  primaryRefId?: number;
}

export interface ScreenplayDoc {
  elements: ScriptElement[];
  shots: Shot[];
  characters: Character[];
  props?: Prop[];
  plans: Record<string, SetPlan>;
  settings: ScreenplaySettings;
  titlePage?: TitlePage;
  /** Rip reel, director's vision and treatment: all written by the user. */
  pitch?: Pitch;
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

export interface ScreenplaySummary {
  id: number;
  title: string;
  updatedAt: string;
  scenes: number;
  shots: number;
  characters: number;
}

export interface Pitch {
  logline?: string;
  vision?: {
    statement?: string;
    tone?: string;
    look?: string;
    sound?: string;
    themes?: string;
    audience?: string;
    whyNow?: string;
    comps?: string[];
    /** Reference image rows (screenplay_media ids), in order. */
    moodboard?: number[];
  };
  treatment?: string;
  reel?: Reel;
}

export interface Reel {
  items: ReelItem[];
  soundtrack?: { kind: 'upload'; mediaRowId: number } | { kind: 'cue'; shotId: string };
  openCard?: boolean;
  endCard?: string;
}

export interface ReelItem {
  id: string;
  source: { kind: 'upload'; mediaRowId: number } | { kind: 'frame'; shotId: string };
  in?: number;
  out?: number;
  hold?: number;
  caption?: string;
}

export type MediaRole = 'frame' | 'music' | 'character' | 'reference' | 'reel' | 'sound' | 'prop';

export interface ScreenplayMedia {
  id: number;
  screenplay_id: number;
  role: MediaRole;
  target: string;
  status: 'pending' | 'ready' | 'failed' | 'superseded';
  hash: string | null;
  prompt: string | null;
  caption: string | null;
  label: string | null;
  job_id: number | null;
  media_id: number | null;
  error: string | null;
  created_at: string;
  /** JSON for gathered sounds: see SoundMeta. */
  meta?: string | null;
}

export interface ShotPlanView {
  waiting?: string;
  blocked?: string;
  prompt?: string;
  /** The prompt from the script alone, before adjustment notes. */
  basePrompt?: string;
  /** Adjustment notes are being applied by the AI. */
  adjusting?: boolean;
  /** The frame is out of date for a reason other than its script block; waits for refresh. */
  stale?: boolean;
  /** The music cue is out of date; waits for refresh. */
  musicStale?: boolean;
  /** Set when the AI couldn't apply the notes and they were added as written. */
  adjustNote?: string;
  staging?: string;
  characters: string[];
  music?: string;
}

export interface Detail {
  screenplay: Screenplay;
  plans: Record<string, ShotPlanView>;
  media: {
    /** keyed "frame:<shotId>" / "music:<shotId>" */
    latest: Record<string, ScreenplayMedia>;
    lastReady: Record<string, ScreenplayMedia>;
    other: ScreenplayMedia[];
  };
}

export async function listScreenplays(): Promise<ScreenplaySummary[]> {
  const { data } = await client.get<{ screenplays: ScreenplaySummary[] }>('/api/screenplays');
  return data.screenplays;
}

export async function createScreenplay(title: string, doc?: ScreenplayDoc): Promise<Screenplay> {
  const { data } = await client.post<{ screenplay: Screenplay }>('/api/screenplays', { title, doc });
  return data.screenplay;
}

export async function getScreenplay(id: number): Promise<Detail> {
  const { data } = await client.get<Detail>(`/api/screenplays/${id}`);
  return data;
}

export async function saveScreenplay(
  id: number,
  version: number,
  patch: { title?: string; doc?: ScreenplayDoc },
): Promise<{ version: number; updatedAt: string }> {
  const { data } = await client.put<{ version: number; updatedAt: string }>(`/api/screenplays/${id}`, { version, ...patch });
  return data;
}

export async function deleteScreenplay(id: number): Promise<void> {
  await client.delete(`/api/screenplays/${id}`);
}

export async function renderNow(id: number): Promise<Detail> {
  const { data } = await client.post<Detail>(`/api/screenplays/${id}/render-now`);
  return data;
}

/** Apply a shot's changes and render it now. */
export async function refreshShot(id: number, shotId: string): Promise<Detail> {
  const { data } = await client.post<Detail>(`/api/screenplays/${id}/shots/${encodeURIComponent(shotId)}/refresh`);
  return data;
}

export async function characterRefs(id: number, characterId: string, views: string[]): Promise<Detail> {
  const { data } = await client.post<Detail>(`/api/screenplays/${id}/characters/${characterId}/refs`, { views });
  return data;
}

/** Four different looks for a character, rendered as headshots (character media labelled 'casting'). */
export async function castCharacter(id: number, characterId: string): Promise<Detail> {
  const { data } = await client.post<Detail>(`/api/screenplays/${id}/characters/${characterId}/casting`, {});
  return data;
}

export function castingLook(m: ScreenplayMedia): string | null {
  try {
    const v = m.meta ? (JSON.parse(m.meta) as { look?: unknown }).look : null;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export async function refineCharacter(id: number, characterId: string, notes: string): Promise<string> {
  const { data } = await client.post<{ appearance: string }>(`/api/screenplays/${id}/characters/${characterId}/refine`, { notes });
  return data.appearance;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function uploadReference(id: number, file: File, target: string): Promise<Detail> {
  const data64 = await fileToBase64(file);
  const { data } = await client.post<Detail>(`/api/screenplays/${id}/references`, {
    data: data64,
    mime: file.type,
    filename: file.name,
    target,
  });
  return data;
}

export async function updateMedia(id: number, mediaRowId: number, patch: { target?: string; caption?: string }): Promise<Detail> {
  const { data } = await client.patch<Detail>(`/api/screenplays/${id}/media/${mediaRowId}`, patch);
  return data;
}

/** Upload a rip-reel clip, still or soundtrack. `added` is the new row's id. */
export async function uploadReelFile(id: number, file: File, onProgress?: (f: number) => void): Promise<Detail & { added: number }> {
  const form = new FormData();
  form.append('file', file, file.name);
  const { data } = await client.post<Detail & { added: number }>(`/api/screenplays/${id}/reel`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
  });
  return data;
}

export async function deleteMediaRow(id: number, mediaRowId: number): Promise<Detail> {
  const { data } = await client.delete<Detail>(`/api/screenplays/${id}/media/${mediaRowId}`);
  return data;
}

// ── sounds gathered from free libraries ──

export interface SoundLicense {
  code: 'cc0' | 'pdm' | 'by' | 'by-sa' | 'by-nc' | 'by-nc-sa' | 'by-nd' | 'by-nc-nd' | 'unknown';
  name: string;
  url: string | null;
  commercial: boolean;
  derivatives: boolean;
  attribution: boolean;
}

export interface SoundCandidate {
  key: string;
  source: 'archive' | 'openverse';
  sourceName: string;
  title: string;
  creator: string | null;
  license: SoundLicense;
  landingUrl: string;
  audioUrl: string;
  durationS: number | null;
  tags: string[];
  category: string | null;
}

export interface SoundWant {
  id: string;
  want: string;
  kind: 'ambience' | 'effect' | 'foley' | 'music';
  queries: string[];
  candidates: SoundCandidate[];
  errors: string[];
}

export interface SoundHunt {
  id: number;
  scope: string;
  request: string;
  options: { allowNonCommercial?: boolean };
  status: 'queued' | 'planning' | 'searching' | 'done' | 'failed';
  progress: string;
  wants: SoundWant[];
  error: string | null;
  created_at: string;
}

export interface SoundMeta {
  key: string;
  want: string;
  kind: SoundWant['kind'];
  sourceName: string;
  creator: string | null;
  landingUrl: string;
  durationS: number | null;
  license: SoundLicense;
  volume?: number;
}

export function soundMeta(m: ScreenplayMedia): SoundMeta | null {
  try {
    return m.meta ? (JSON.parse(m.meta) as SoundMeta) : null;
  } catch {
    return null;
  }
}

/** "“Rain” by Ann (Freesound), CC BY 4.0". */
export function soundCredit(title: string, m: Pick<SoundMeta, 'creator' | 'sourceName' | 'license'>): string {
  return `“${title}”${m.creator ? ` by ${m.creator}` : ''} (${m.sourceName}), ${m.license.name}`;
}

export async function startSoundHunt(id: number, body: { scope: string; request: string; allowNonCommercial: boolean }): Promise<SoundHunt> {
  const { data } = await client.post<{ hunt: SoundHunt }>(`/api/screenplays/${id}/sounds/hunts`, body);
  return data.hunt;
}

export async function listSoundHunts(id: number): Promise<SoundHunt[]> {
  const { data } = await client.get<{ hunts: SoundHunt[] }>(`/api/screenplays/${id}/sounds/hunts`);
  return data.hunts;
}

export async function getSoundHunt(id: number, huntId: number): Promise<SoundHunt> {
  const { data } = await client.get<{ hunt: SoundHunt }>(`/api/screenplays/${id}/sounds/hunts/${huntId}`);
  return data.hunt;
}

export async function keepSound(id: number, huntId: number, key: string, target: string): Promise<Detail & { added: number }> {
  const { data } = await client.post<Detail & { added: number }>(`/api/screenplays/${id}/sounds`, { huntId, key, target }, { timeout: 180_000 });
  return data;
}

export async function updateSound(id: number, rowId: number, patch: { target?: string; volume?: number }): Promise<Detail> {
  const { data } = await client.patch<Detail>(`/api/screenplays/${id}/media/${rowId}`, patch);
  return data;
}

// ── voices ──

export async function listStudioVoices(): Promise<Array<{ id: number; name: string; sampleMediaId: number }>> {
  const { data } = await client.get<{ characters: Array<{ id: number; name: string; sampleMediaId: number }> }>('/api/screenplays/voices/studio');
  return data.characters;
}

export async function uploadVoiceSample(id: number, characterId: string, file: Blob, name: string): Promise<Detail & { added: number }> {
  const form = new FormData();
  form.append('file', file, name);
  const { data } = await client.post<Detail & { added: number }>(`/api/screenplays/${id}/characters/${encodeURIComponent(characterId)}/voice`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
  });
  return data;
}

export interface LinesResult {
  queued: number;
  current: number;
  skipped: Array<{ cue: string; reason: string }>;
}

export async function speakLines(id: number, shotIds?: string[]): Promise<Detail & { lines: LinesResult }> {
  const { data } = await client.post<Detail & { lines: LinesResult }>(`/api/screenplays/${id}/lines`, { shotIds });
  return data;
}

/** Rows that are voice samples or spoken lines rather than gathered sounds. */
export const isVoiceRow = (m: ScreenplayMedia) => m.target.startsWith('voice:') || m.target.startsWith('line:');

// ── shot suggestions ──

export interface SuggestedShot {
  anchorId: string;
  type: string;
  seconds: number;
  lens?: number;
  notes?: string;
}

export async function suggestShots(id: number, sceneId: string, density: 'fewer' | 'normal' | 'more'): Promise<{ shots: SuggestedShot[]; source: 'ai' | 'rules' }> {
  const { data } = await client.post<{ shots: SuggestedShot[]; source: 'ai' | 'rules' }>(`/api/screenplays/${id}/shots/suggest`, { sceneId, density }, { timeout: 200_000 });
  return data;
}

// ── shot finder ──────────────────────────────────────────────────────────────

export interface FoundLicense {
  code: string;
  name: string;
  url: string | null;
  commercial: boolean;
  derivatives: boolean;
  attribution: boolean;
}

export interface ImageCandidate {
  key: string;
  source: 'openverse' | 'pexels' | 'unsplash';
  sourceName: string;
  title: string;
  creator: string | null;
  license: FoundLicense;
  landingUrl: string;
  imageUrl: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  query: string;
}

export interface ShotFind {
  id: number;
  shot_id: string;
  status: 'queued' | 'planning' | 'searching' | 'done' | 'failed';
  progress: string;
  plan: { look: string; queries: string[]; notes: string[] };
  candidates: ImageCandidate[];
  error: string | null;
}

export async function startFind(id: number, shotId: string): Promise<ShotFind> {
  const { data } = await client.post<{ find: ShotFind }>(`/api/screenplays/${id}/shots/${shotId}/finds`, {});
  return data.find;
}

export async function latestFind(id: number, shotId: string): Promise<ShotFind | null> {
  const { data } = await client.get<{ find: ShotFind | null }>(`/api/screenplays/${id}/shots/${shotId}/finds/latest`);
  return data.find;
}

export async function getFind(id: number, findId: number): Promise<ShotFind> {
  const { data } = await client.get<{ find: ShotFind }>(`/api/screenplays/${id}/finds/${findId}`);
  return data.find;
}

export async function findMore(id: number, findId: number): Promise<ShotFind> {
  const { data } = await client.post<{ find: ShotFind }>(`/api/screenplays/${id}/finds/${findId}/more`, {});
  return data.find;
}

export async function keepFound(id: number, findId: number, key: string): Promise<Detail & { added: number }> {
  const { data } = await client.post<Detail & { added: number }>(`/api/screenplays/${id}/finds/${findId}/keep`, { key });
  return data;
}

/** Source details of a photo kept from the shot finder. */
export interface FoundMeta {
  key: string;
  sourceName: string;
  title: string;
  creator: string | null;
  landingUrl: string;
  license: FoundLicense;
}

export function foundMeta(m: ScreenplayMedia | undefined | null): FoundMeta | null {
  if (!m?.meta) return null;
  try {
    return (JSON.parse(m.meta) as { found?: FoundMeta }).found ?? null;
  } catch {
    return null;
  }
}

// ── props ────────────────────────────────────────────────────────────────────

export async function uploadPropImage(id: number, propId: string, file: File): Promise<Detail> {
  const data64 = await fileToBase64(file);
  const { data } = await client.post<Detail>(`/api/screenplays/${id}/props/${propId}/images`, { data: data64, mime: file.type, filename: file.name });
  return data;
}

export async function drawProp(id: number, propId: string): Promise<Detail> {
  const { data } = await client.post<Detail>(`/api/screenplays/${id}/props/${propId}/draw`, {});
  return data;
}

export async function startPropFind(id: number, propId: string): Promise<ShotFind> {
  const { data } = await client.post<{ find: ShotFind }>(`/api/screenplays/${id}/props/${propId}/finds`, {});
  return data.find;
}

export async function latestPropFind(id: number, propId: string): Promise<ShotFind | null> {
  const { data } = await client.get<{ find: ShotFind | null }>(`/api/screenplays/${id}/props/${propId}/finds/latest`);
  return data.find;
}
