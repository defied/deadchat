// The framing check: a cinematography model (e.g. ShotVL, trained on film
// shots) says what kind of shot a photo is: size, framing, camera angle. The
// finder compares that with the shot type the writer picked.

import { getOllamaUrl } from '../../appSettings';

import { ANGLES, COMPOSITIONS, FRAMINGS, LENS_SIZES, LIGHT_CONDITIONS, LIGHT_TYPES, SIZES, type ShotSetup } from '../cinema';

export { ANGLES, FRAMINGS, SIZES };

export type Expected = ShotSetup;

/** What the writer's shot type asks for, in the terms the model knows. */
export function expectedFor(type: string | undefined, setup?: ShotSetup): Expected {
  const t = (type ?? '').toLowerCase();
  const out: Expected = {};
  // A shot set up field by field says exactly what it wants.
  if (setup) {
    const { movement: _movement, ...rest } = setup;
    void _movement;
    if (Object.keys(rest).length) return { ...rest };
  }
  if (/over.?the.?shoulder|\bots\b/.test(t)) out.framing = 'Over the shoulder';
  else if (/\bpov\b|point of view/.test(t)) out.framing = 'Point of view';
  else if (/insert/.test(t)) out.framing = 'Insert';
  else if (/two.?shot/.test(t)) out.framing = 'Two shot';
  if (/extreme close|\becu\b/.test(t)) out.size = 'Extreme Close Up';
  else if (/medium close|\bmcu\b/.test(t)) out.size = 'Medium Close Up';
  else if (/close/.test(t)) out.size = 'Close Up';
  else if (/medium wide|cowboy|\bmws\b/.test(t)) out.size = 'Medium Wide';
  else if (/medium|\bms\b/.test(t)) out.size = 'Medium';
  else if (/extreme wide|establish|\bews\b/.test(t)) out.size = 'Extreme Wide';
  else if (/wide|^full|long shot/.test(t)) out.size = 'Wide';
  if (/aerial|drone/.test(t)) out.angle = 'Aerial';
  else if (/bird|overhead|top.?down/.test(t)) out.angle = 'Overhead';
  else if (/high angle/.test(t)) out.angle = 'High angle';
  else if (/low angle/.test(t)) out.angle = 'Low angle';
  else if (/dutch/.test(t)) out.angle = 'Dutch angle';
  return out;
}

export interface Framing {
  /** What the model saw, e.g. "Medium Close Up · Over the shoulder". */
  seen: string;
  match: 'yes' | 'close' | 'no';
}

/** Ask one multiple-choice question about the photo; returns the chosen option, or null. */
async function ask(model: string, imageB64: string, question: string, options: readonly string[]): Promise<string | null> {
  const letters = options.map((_, i) => String.fromCharCode(65 + i));
  const prompt = `${question}\nOptions:\n${options.map((o, i) => `${letters[i]}. ${o}`).join('\n')}\nAnswer with the option's letter only.`;
  const r = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ model, stream: false, keep_alive: '60s', options: { temperature: 0 }, messages: [{ role: 'user', content: prompt, images: [imageB64] }] }),
  });
  if (!r.ok) throw new Error(`${model}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const text = ((await r.json()) as { message?: { content?: string } }).message?.content ?? '';
  return parseChoice(text, options);
}

/** "B", "B.", "(B) Wide", "Wide" → the option. */
export function parseChoice(text: string, options: readonly string[]): string | null {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const letter = /^\(?([A-Z])\)?(?:[.):\s]|$)/.exec(t)?.[1] ?? /answer(?: is)?[:\s]*\(?([A-Z])\)?\b/i.exec(t)?.[1];
  if (letter) {
    const i = letter.toUpperCase().charCodeAt(0) - 65;
    if (options[i]) return options[i];
  }
  const byName = [...options].sort((a, b) => b.length - a.length).find((o) => t.toLowerCase().includes(o.toLowerCase()));
  return byName ?? null;
}

const QUESTIONS: Array<{ field: keyof Expected; question: string; options: readonly string[]; ordered?: boolean }> = [
  { field: 'size', question: 'What is the shot size of this image?', options: SIZES, ordered: true },
  { field: 'framing', question: 'What is the framing of this shot?', options: FRAMINGS },
  { field: 'angle', question: 'What is the camera angle of this shot?', options: ANGLES },
  { field: 'lens', question: 'What lens size was used for this shot?', options: LENS_SIZES, ordered: true },
  { field: 'lightType', question: 'What is the lighting type of this shot?', options: LIGHT_TYPES },
  { field: 'lightCondition', question: 'What is the lighting condition of this shot?', options: LIGHT_CONDITIONS },
  { field: 'composition', question: 'What is the composition of this shot?', options: COMPOSITIONS },
];

/**
 * Compare the photo with what the shot asks for (its setup, else its type),
 * one question per field. Null when nothing is checkable.
 */
export async function checkFraming(model: string, imageB64: string, shotType: string | undefined, setup?: ShotSetup): Promise<Framing | null> {
  const want = expectedFor(shotType, setup);
  const seen: string[] = [];
  const results: Array<'yes' | 'close' | 'no'> = [];
  for (const q of QUESTIONS) {
    const target = want[q.field];
    if (!target) continue;
    const got = await ask(model, imageB64, q.question, q.options);
    if (!got) continue;
    seen.push(got);
    if (got === target) results.push('yes');
    else if (q.ordered && Math.abs(q.options.indexOf(got) - q.options.indexOf(target)) === 1) results.push('close');
    else results.push('no');
  }
  if (!results.length) return null;
  const no = results.filter((r) => r === 'no').length;
  // Most fields right counts as close; the framing check shouldn't sink a photo over one detail.
  const match = no === 0 ? (results.includes('close') ? 'close' : 'yes') : no * 2 <= results.length - 1 ? 'close' : 'no';
  return { seen: seen.join(' · '), match };
}
