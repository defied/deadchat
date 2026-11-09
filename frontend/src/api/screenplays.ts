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
  music?: string;
  notes?: string;
  /** Fine-tuning notes the AI applies to the image prompt (the script is never changed). */
  adjustments?: Adjustment[];
  take?: number;
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
  paused?: boolean;
}

export interface TitlePage {
  title?: string;
  credit?: string;
  author?: string;
  source?: string;
  contact?: string;
  draftDate?: string;
}

export interface ScreenplayDoc {
  elements: ScriptElement[];
  shots: Shot[];
  characters: Character[];
  plans: Record<string, SetPlan>;
  settings: ScreenplaySettings;
  titlePage?: TitlePage;
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

export type MediaRole = 'frame' | 'music' | 'character' | 'reference';

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

export async function deleteMediaRow(id: number, mediaRowId: number): Promise<Detail> {
  const { data } = await client.delete<Detail>(`/api/screenplays/${id}/media/${mediaRowId}`);
  return data;
}
