// The agent's summary of a highlighted shot: one or two sentences saying what
// the camera sees, from the highlighted text only. The writer can edit it;
// it drives the photo search and anything the AI draws.

import { llmJson, asString } from '../influencers/llm';
import { parseHeading } from './script';

const SYSTEM =
  'You summarise one storyboard shot for a film crew. You get the scene heading and the exact script text the writer highlighted ' +
  'for this shot. In one or two short present-tense sentences, say what the camera sees: who is there, what they are doing, ' +
  'and where (from the heading). Use ONLY what the highlighted text and heading say: add no objects, actions, weather, mood, ' +
  'clothing or details of your own, and leave out dialogue, sounds and thoughts. Keep the characters\' names as written. ' +
  'Return {"summary": "..."}.';

export const deps = { llmJson };

export async function summarizeShot(heading: string, excerpt: string): Promise<string> {
  const text = excerpt.trim();
  if (!text) throw new Error('Highlight some of the script first');
  const h = heading ? parseHeading(heading) : null;
  const where = h ? [h.setting, h.location, h.time].filter(Boolean).join(', ') : '';
  try {
    const out = await deps.llmJson<{ summary?: unknown }>(SYSTEM, `Scene heading: ${where || '(none)'}\nHighlighted text:\n${text}`, { temperature: 0.1 });
    const summary = asString(out.summary, 600).replace(/^["']|["']$/g, '').trim();
    if (summary.length >= 8) return summary;
  } catch {
    /* fall back to the text itself */
  }
  // No model: the highlighted text is the summary.
  return text.replace(/\s+/g, ' ').slice(0, 600);
}
