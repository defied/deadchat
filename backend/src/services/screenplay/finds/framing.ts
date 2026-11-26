// The framing check: a cinematography model (e.g. ShotVL, trained on film
// shots) says what kind of shot a photo is: size, framing, camera angle. The
// finder compares that with the shot type the writer picked.

import { getOllamaUrl } from '../../appSettings';

export const SIZES = ['Extreme Wide', 'Wide', 'Medium Wide', 'Medium', 'Medium Close Up', 'Close Up', 'Extreme Close Up'] as const;
export const FRAMINGS = ['Single', 'Two shot', 'Group shot', 'Over the shoulder', 'Point of view', 'Insert'] as const;
export const ANGLES = ['Aerial', 'Overhead', 'High angle', 'Eye level', 'Low angle', 'Dutch angle'] as const;

export interface Expected {
  size?: (typeof SIZES)[number];
  framing?: (typeof FRAMINGS)[number];
  angle?: (typeof ANGLES)[number];
}

/** What the writer's shot type asks for, in the terms the model knows. */
export function expectedFor(type: string | undefined): Expected {
  const t = (type ?? '').toLowerCase();
  const out: Expected = {};
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

/** Compare the photo's framing with what the shot type asks for. Null when the shot type asks for nothing checkable. */
export async function checkFraming(model: string, imageB64: string, shotType: string | undefined): Promise<Framing | null> {
  const want = expectedFor(shotType);
  if (!want.size && !want.framing && !want.angle) return null;
  const seen: string[] = [];
  const results: Array<'yes' | 'close' | 'no'> = [];
  if (want.size) {
    const got = await ask(model, imageB64, 'What is the shot size of this image?', SIZES);
    if (got) {
      seen.push(got);
      const d = Math.abs(SIZES.indexOf(got as (typeof SIZES)[number]) - SIZES.indexOf(want.size));
      results.push(d === 0 ? 'yes' : d === 1 ? 'close' : 'no');
    }
  }
  if (want.framing) {
    const got = await ask(model, imageB64, 'What is the framing of this shot?', FRAMINGS);
    if (got) {
      seen.push(got);
      results.push(got === want.framing ? 'yes' : 'no');
    }
  }
  if (want.angle) {
    const got = await ask(model, imageB64, 'What is the camera angle of this shot?', ANGLES);
    if (got) {
      seen.push(got);
      results.push(got === want.angle ? 'yes' : 'no');
    }
  }
  if (!results.length) return null;
  const match = results.includes('no') ? 'no' : results.includes('close') ? 'close' : 'yes';
  return { seen: seen.join(' · '), match };
}
