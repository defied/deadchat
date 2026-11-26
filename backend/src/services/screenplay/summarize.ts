// The agent's summary of a highlighted shot: one or two sentences saying what
// the camera sees, from the highlighted text only. The writer can edit it;
// it drives the photo search and anything the AI draws.

import { llmJson, asString } from './llm';
import { parseHeading } from './script';
import { agentPrompt, defineAgent } from './agents';

const SYSTEM_DEFAULT =
  'You summarise one storyboard shot for a film crew. You get the scene heading and the exact script text the writer highlighted ' +
  'for this shot. In one or two short present-tense sentences, say what the camera sees: who is there, what they are doing, ' +
  'and where (from the heading). Use ONLY what the highlighted text and heading say: add no objects, actions, weather, mood, ' +
  'clothing or details of your own, and leave out dialogue, sounds and thoughts. Keep the characters\' names as written. ' +
  'Return {"summary": "..."}.';

defineAgent({
  id: 'summarizer',
  name: 'Shot summarizer',
  role: 'Writes "In this shot" from the text you highlight: who is there, what they do, where.',
  model: 'screenplay',
  prompt: SYSTEM_DEFAULT,
});

export const deps = { llmJson };

/** Common words that start a sentence; anything else capitalised must come from the script. */
const COMMON = new Set(
  'the a an he she they it his her their its we you i in on at with as while then there this that these those one two three outside inside behind near above below under across through during after before camera wide close medium'.split(
    ' ',
  ),
);

/**
 * Names the summary uses that the script doesn't (a model that "tidies" an
 * odd character name into "John"). Empty when every capitalised word is from
 * the highlight, the heading or the cast.
 */
export function inventedNames(summary: string, source: string): string[] {
  const known = new Set(source.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
  const caps = summary.match(/\b\p{Lu}[\p{L}\p{N}']*/gu) ?? [];
  return [...new Set(caps.filter((w) => !COMMON.has(w.toLowerCase()) && !known.has(w.toLowerCase()) && !known.has(w.toLowerCase().replace(/'s$/, ''))))];
}

export async function summarizeShot(heading: string, excerpt: string, names: string[] = []): Promise<string> {
  const text = excerpt.trim();
  if (!text) throw new Error('Highlight some of the script first');
  const h = heading ? parseHeading(heading) : null;
  const where = h ? [h.setting, h.location, h.time].filter(Boolean).join(', ') : '';
  // Odd names ("Ferklnerkle69") get rewritten by models: they travel as
  // placeholders and come back exactly as written.
  const cast = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 1))].sort((a, b) => b.length - a.length);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tags = cast.map((_, i) => `Person${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`);
  let masked = text;
  cast.forEach((n, i) => (masked = masked.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])`, 'giu'), tags[i])));
  try {
    const out = await deps.llmJson<{ summary?: unknown }>(agentPrompt('summarizer'), `Scene heading: ${where || '(none)'}\nHighlighted text:\n${masked}`, { temperature: 0.1 });
    let summary = asString(out.summary, 600).replace(/^["']|["']$/g, '').trim();
    tags.forEach((t, i) => (summary = summary.replace(new RegExp(`\\b${t}\\b`, 'g'), cast[i])));
    // Anything named that the script didn't name means the model made it up: use the highlight instead.
    if (summary.length >= 8 && !/\bPerson[A-Z]\d*\b/.test(summary) && !inventedNames(summary, `${text} ${where} ${cast.join(' ')}`).length) return summary;
  } catch {
    /* fall back to the text itself */
  }
  // No model (or it invented something): the highlighted text is the summary.
  return text.replace(/\s+/g, ' ').slice(0, 600);
}
