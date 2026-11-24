// Suggest a shot breakdown for one scene. The local model reads the scene and
// proposes where shots start, their type, length and lens; the script itself
// is never changed. If the model isn't available, a simple rule-based
// breakdown is used instead.

import { llmJson } from '../influencers/llm';
import type { Screenplay, ScriptElement } from './types';

export const SHOT_TYPES = [
  'Establishing', 'Extreme wide', 'Wide', 'Full', 'Medium wide', 'Medium', 'Medium close-up', 'Close-up', 'Extreme close-up',
  'Over-the-shoulder', 'Two-shot', 'POV', 'Insert', 'Low angle', 'High angle', "Bird's-eye", 'Dutch angle', 'Aerial', 'Tracking', 'Crane', 'Handheld',
];
const LENSES = [14, 18, 24, 35, 50, 85, 100, 135];

export type Density = 'fewer' | 'normal' | 'more';

export interface SuggestedShot {
  anchorId: string;
  type: string;
  seconds: number;
  lens?: number;
  notes?: string;
}

/** The scene heading and everything up to the next heading. */
export function sceneElements(sp: Screenplay, sceneId: string): ScriptElement[] {
  const els = sp.doc.elements;
  const i = els.findIndex((e) => e.id === sceneId && e.type === 'scene');
  if (i < 0) return [];
  const out = [els[i]];
  for (let j = i + 1; j < els.length && els[j].type !== 'scene'; j++) out.push(els[j]);
  return out;
}

function nearestType(t: string): string {
  const s = t.trim().toLowerCase();
  return SHOT_TYPES.find((x) => x.toLowerCase() === s) ?? SHOT_TYPES.find((x) => s.includes(x.toLowerCase())) ?? (t.trim().slice(0, 40) || 'Medium');
}
const nearestLens = (n: number) => LENSES.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
const defaultSeconds = (type: string) => (/establish|extreme wide|aerial|crane/i.test(type) ? 5 : /wide|full|tracking/i.test(type) ? 4 : 3);

/** One shot per moment that changes: rules for when the model can't help. */
export function ruleShots(els: ScriptElement[], density: Density): SuggestedShot[] {
  const out: SuggestedShot[] = [];
  const add = (e: ScriptElement, type: string, seconds = defaultSeconds(type)) => {
    if (!out.some((s) => s.anchorId === e.id)) out.push({ anchorId: e.id, type, seconds });
  };
  const body = els.filter((e) => e.type !== 'scene');
  const firstAction = body.find((e) => e.type === 'action');
  add(firstAction ?? els[0], 'Wide', 5);
  let talk = 0;
  for (const e of body) {
    if (e === firstAction) continue;
    if (e.type === 'action' && density !== 'fewer') add(e, 'Medium', 4);
    else if (e.type === 'character') {
      if (density === 'fewer' && talk > 0) continue;
      add(e, talk % 2 === 0 ? 'Medium close-up' : 'Over-the-shoulder', 3);
      talk++;
    } else if (density === 'more' && (e.type === 'shot' || e.type === 'transition')) add(e, 'Insert', 2);
  }
  return out;
}

const SYSTEM =
  'You are a director breaking a screenplay scene into storyboard shots. You get the scene as numbered lines. ' +
  'Choose where each shot starts (the line number it begins on; a shot runs until the next shot or the end of the scene) ' +
  'and give it a shot type, a length in seconds and a lens in mm. Start with a shot that sets the space. Cut on new action, ' +
  'reactions and changes of speaker; cover dialogue with singles, over-the-shoulders or a two-shot. Never change or add to the script. ' +
  `Shot types: ${SHOT_TYPES.join(', ')}. Lenses: ${LENSES.join(', ')}. ` +
  'Return {"shots":[{"line":1,"type":"Wide","seconds":5,"lens":24,"note":"what the shot shows, one short phrase"}]} in script order, at most one shot per line.';

const DENSITY: Record<Density, string> = {
  fewer: 'Use as few shots as tell the scene clearly (often 1 to 3).',
  normal: 'Use a shot for each beat: new action, a reaction, or a change of speaker.',
  more: 'Give full coverage: singles, reverses, inserts and reactions.',
};

export async function suggestShots(sp: Screenplay, sceneId: string, density: Density): Promise<{ shots: SuggestedShot[]; source: 'ai' | 'rules' }> {
  const els = sceneElements(sp, sceneId);
  if (!els.length) throw new Error('That scene no longer exists');
  const numbered = els.map((e, i) => `${i + 1}. ${e.type.toUpperCase()}: ${e.text.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
  try {
    const out = await llmJson<{ shots?: Array<{ line?: number; type?: string; seconds?: number; lens?: number; note?: string }> }>(
      SYSTEM,
      `${DENSITY[density]}\n\nScene:\n${numbered.slice(0, 12000)}`,
      { temperature: 0.3 },
    );
    const seen = new Set<string>();
    const shots: SuggestedShot[] = [];
    for (const s of out.shots ?? []) {
      const el = els[Math.round(Number(s.line)) - 1];
      if (!el || seen.has(el.id)) continue;
      seen.add(el.id);
      const type = nearestType(String(s.type ?? ''));
      const secs = Number(s.seconds);
      shots.push({
        anchorId: el.id,
        type,
        seconds: Number.isFinite(secs) ? Math.min(30, Math.max(1, Math.round(secs * 2) / 2)) : defaultSeconds(type),
        ...(Number.isFinite(Number(s.lens)) && Number(s.lens) > 0 ? { lens: nearestLens(Number(s.lens)) } : {}),
        ...(s.note ? { notes: String(s.note).trim().slice(0, 200) } : {}),
      });
    }
    if (shots.length) return { shots: shots.sort((a, b) => els.findIndex((e) => e.id === a.anchorId) - els.findIndex((e) => e.id === b.anchorId)), source: 'ai' };
  } catch {
    /* fall back to rules */
  }
  return { shots: ruleShots(els, density), source: 'rules' };
}
