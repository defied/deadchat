// Spoken dialogue for the animatic. Each screenplay character can have a
// voice source: a short sample the writer uploaded or recorded, or the voice
// of one of their Studio characters. Lines are cloned from that sample by the
// local speech service (XTTS-v2) on the GPU box, one job per line, and kept
// as 'sound' rows targeted "line:<element id>", re-made only when the words
// or the voice change.

import { enqueue, getJob, cancel } from '../jobQueue';
import { getMedia } from '../mediaStore';
import * as studio from '../characters';
import { getAsset } from '../assetPipeline';
import * as store from './store';
import { hashOf } from './prompts';
import { shotSection } from './script';
import type { Character, Screenplay, ScreenplayMedia } from './types';

export const voiceTarget = (characterId: string) => `voice:${characterId}`;
export const lineTarget = (elementId: string) => `line:${elementId}`;

/** The cue's name without extensions: "JANE (V.O.)" → "JANE". */
export function cueName(text: string): string {
  return text.replace(/\(.*?\)/g, '').replace(/\^/g, '').trim().toUpperCase();
}

/** The character a cue belongs to: by full name, or first name. */
export function characterFor(characters: Character[], cue: string): Character | undefined {
  const c = cue.toUpperCase();
  return characters.find((x) => x.name.trim().toUpperCase() === c) ?? characters.find((x) => x.name.trim().toUpperCase().split(/\s+/)[0] === c);
}

/** Media id of the sample to clone a character's voice from, or why there isn't one. */
export function voiceReference(sp: Screenplay, c: Character, userId: number): { mediaId: number } | { missing: string } {
  const ref = c.voiceRef;
  if (!ref) return { missing: `${c.name} has no voice yet` };
  if (ref.kind === 'upload') {
    const row = store.getMedia(ref.mediaRowId);
    if (!row || row.screenplay_id !== sp.id || !row.media_id) return { missing: `${c.name}’s voice sample was removed` };
    return { mediaId: row.media_id };
  }
  const sc = studio.getCharacter(ref.characterId);
  if (!sc || sc.user_id !== userId) return { missing: `${c.name}’s Studio character is gone` };
  const link = studio.getLatestCharacterAsset(sc.id, 'voice');
  const asset = link ? getAsset(link.asset_id) : null;
  const mediaId = asset?.final_media_id ?? asset?.draft_media_id;
  if (!mediaId || !getMedia(mediaId)) return { missing: `${sc.name} in Studio has no voice ready` };
  return { mediaId };
}

export interface Line {
  elementId: string;
  shotId: string;
  cue: string;
  text: string;
}

/** Every spoken line in the given shots' blocks (all shots if none given), in order. */
export function dialogueLines(sp: Screenplay, shotIds?: string[]): Line[] {
  const out: Line[] = [];
  const order = new Map(sp.doc.elements.map((e, i) => [e.id, i]));
  const shots = [...sp.doc.shots]
    .filter((s) => !shotIds || shotIds.includes(s.id))
    .sort((a, b) => (order.get(a.anchorId) ?? 0) - (order.get(b.anchorId) ?? 0));
  for (const s of shots) {
    const els = shotSection(sp.doc, s)?.elements ?? [];
    let cue = '';
    for (const e of els) {
      if (e.type === 'character') cue = cueName(e.text);
      else if (e.type === 'dialogue' && cue && e.text.trim()) out.push({ elementId: e.id, shotId: s.id, cue, text: e.text.trim() });
      else if (e.type !== 'parenthetical') cue = '';
    }
  }
  return out;
}

export interface QueueResult {
  queued: number;
  current: number;
  skipped: Array<{ cue: string; reason: string }>;
}

/** Queue speech for every line that isn't already made with these words and this voice. */
export function queueLines(sp: Screenplay, userId: number, shotIds?: string[], language = 'en'): QueueResult {
  const res: QueueResult = { queued: 0, current: 0, skipped: [] };
  const why = new Map<string, string>();
  for (const line of dialogueLines(sp, shotIds)) {
    const c = characterFor(sp.doc.characters, line.cue);
    const ref = c ? voiceReference(sp, c, userId) : { missing: `${line.cue} has no character profile` };
    if ('missing' in ref) {
      why.set(line.cue, ref.missing);
      continue;
    }
    const hash = hashOf('line', line.text, ref.mediaId, language);
    const prev = latestLine(sp.id, line.elementId);
    if (prev?.hash === hash && (prev.status === 'ready' || prev.status === 'pending')) {
      res.current++;
      continue;
    }
    // A pending or failed take is replaced (a finished one stays until the new one is ready).
    if (prev && prev.status !== 'ready') {
      if (prev.job_id != null && getJob(prev.job_id)?.status === 'queued') cancel(prev.job_id);
      store.setStatus(prev.id, 'superseded');
    }
    const jobId = enqueue('tts', { referenceMediaId: ref.mediaId, prompt: line.text.slice(0, 1000), language }, { userId, heavy: true });
    const row = store.addMedia(sp.id, 'sound', lineTarget(line.elementId), { hash, job_id: jobId, label: `${line.cue}: ${line.text.slice(0, 160)}` });
    store.updateMedia(row.id, { meta: JSON.stringify({ line: true, shotId: line.shotId, cue: line.cue }) });
    res.queued++;
  }
  res.skipped = [...why].map(([cue, reason]) => ({ cue, reason }));
  return res;
}

function latestLine(spId: number, elementId: string): ScreenplayMedia | undefined {
  return store
    .listMedia(spId, 'sound')
    .filter((m) => m.target === lineTarget(elementId) && m.status !== 'superseded')
    .sort((a, b) => b.id - a.id)[0];
}
