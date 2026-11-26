// The shot mentor. Before any image is searched for or drawn, it reads the
// highlighted script, suggests how the shot could be set up (with the reason,
// in plain words), asks the writer about what's still open, and explains the
// terms as it goes. It never changes the shot list itself: the writer accepts
// a suggestion or answers a question.

import { llmJson, asString } from './llm';
import { SETUP_FIELDS, cleanSetup, type SetupField } from './cinema';
import { presentCharacters, shotSection, visualText } from './script';
import { activeAdjustments } from './prompts';
import { agentPrompt, defineAgent } from './agents';
import type { MentorQuestion, MentorState, Screenplay, Shot } from './types';

const GLOSSARY = `Shot size: Extreme Wide (the whole place, people tiny), Wide (a person head to toe with room around), Medium Wide (knees up), Medium (waist up), Medium Close Up (chest up), Close Up (the face), Extreme Close Up (one detail: eyes, hands, an object).
Framing: Single (one person), Two shot, Group shot, Over the shoulder (camera behind one person's shoulder, looking at what they face), Point of view (what a character sees), Insert (a close detail of an object).
Camera angle: Aerial, Overhead (straight down), High angle (looking down: smaller, weaker), Eye level (neutral), Low angle (looking up: bigger, powerful), Dutch angle (tilted: unease).
Lens: Ultra wide / fisheye (distorted, everything sharp), Wide (deep focus, space), Medium (natural, like the eye), Long lens / telephoto (compressed background, shallow focus, isolates the subject).
Lighting type: Daylight, Overcast, Sunny, Moonlight, Practical light (lamps and screens in the scene), Artificial light, Firelight, Mixed light.
Lighting condition: Soft light, Hard light, High contrast, Low contrast, Backlight, Side light, Top light, Silhouette.
Composition: Centered, Balanced, Symmetrical, Left heavy, Right heavy, Short side (the subject faces the near edge: tension).
Camera movement: Static, Pan, Tilt, Dolly in, Dolly out, Truck, Pedestal, Zoom in, Zoom out, Handheld, Arc, Crane.`;

const SYSTEM_DEFAULT =
  'You are a friendly director of photography mentoring a screenwriter who is planning one storyboard shot. You get the scene heading, ' +
  'the script text they highlighted for this shot, its summary, who is in it, the shot list fields they have set so far, and your ' +
  'conversation. Help them set the shot up so the right reference images can be found, and teach them the craft as you go.\n' +
  'Rules:\n' +
  '- Base suggestions on the highlighted text: what it shows and the feeling it needs. Give the reason in one plain sentence ' +
  '(e.g. "Leaning in to read a phone is intimate: a Medium Close Up keeps his face and the phone together").\n' +
  '- Only suggest values from the lists below, written exactly. Suggest only for fields that are empty or that you would change.\n' +
  '- Ask at most 2 questions, about what matters most and is still open, each with 2 to 5 short answer options ' +
  '(the exact list values when the question is about a field).\n' +
  '- When you use a term the writer may not know, explain it briefly. If they ask something, answer it first.\n' +
  '- Never invent story, props, places or people the script does not mention.\n' +
  '- Set "ready" true when shot size, framing and angle are set and nothing important for this moment is open.\n' +
  '- Keep "reply" under 110 words, warm and practical.\n' +
  `Fields and values:\n${GLOSSARY}\n` +
  'Return {"reply": "...", "suggestions": [{"field": "size|framing|angle|lens|lightType|lightCondition|composition|movement", "value": "...", "why": "..."}], ' +
  '"questions": [{"field": "... or empty", "question": "...", "options": ["..."]}], "ready": false}.';

/** What the mentor reads about the shot. */
export function mentorBrief(sp: Screenplay, shot: Shot): string {
  const sec = shotSection(sp.doc, shot);
  const people = sec
    ? presentCharacters(sec.elements, sp.doc.characters).map((p) => `${p.name}${p.character?.gender ? ` (${p.character.gender})` : ''}`)
    : [];
  const set = Object.entries(shot.setup ?? {}).map(([k, v]) => `${SETUP_FIELDS[k as SetupField].label}: ${v}`);
  const open = (Object.keys(SETUP_FIELDS) as SetupField[]).filter((k) => !shot.setup?.[k]).map((k) => SETUP_FIELDS[k].label);
  const notes = activeAdjustments(shot);
  return [
    `Scene heading: ${sec?.scene?.text ?? '(none)'}`,
    `Highlighted text: ${shot.excerpt?.trim() || (sec ? visualText(sec.elements) : '') || '(none)'}`,
    shot.summary?.trim() ? `Summary: ${shot.summary.trim()}` : '',
    people.length ? `In the shot: ${people.join(', ')}` : '',
    shot.peopleOptional ? 'The writer is happy with reference photos that have no people in them.' : '',
    notes.length ? `Adjustment notes: ${notes.join('; ')}` : '',
    `Set so far: ${set.length ? set.join('; ') : 'nothing'}`,
    `Still open: ${open.join(', ') || 'nothing'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

defineAgent({
  id: 'mentor',
  name: 'Shot mentor',
  role: 'Helps you set up each shot: suggests size, framing, angle, lens and light with reasons, asks about what is open, and explains the terms.',
  model: 'screenplay',
  prompt: SYSTEM_DEFAULT,
});

export const deps = { llmJson };

/** One mentor turn: the writer's message (if any) and the mentor's answer, added to the conversation. */
export async function mentorTurn(sp: Screenplay, shot: Shot, message?: string): Promise<MentorState> {
  const prev = shot.mentor?.messages ?? [];
  const said = message?.trim().slice(0, 1000);
  const messages = [...prev, ...(said ? [{ from: 'writer' as const, text: said }] : [])];
  const history = messages
    .slice(-12)
    .map((m) => `${m.from === 'writer' ? 'Writer' : 'You'}: ${m.text}`)
    .join('\n');
  const out = await deps.llmJson<{ reply?: unknown; suggestions?: unknown; questions?: unknown; ready?: unknown }>(
    agentPrompt('mentor'),
    `${mentorBrief(sp, shot)}\n\nConversation so far:\n${history || '(none: open the conversation)'}`,
    { temperature: 0.4 },
  );
  let reply = asString(out.reply, 1200).trim();
  const fields = Object.keys(SETUP_FIELDS) as SetupField[];
  const suggestions = (Array.isArray(out.suggestions) ? out.suggestions : [])
    .map((x) => x as { field?: unknown; value?: unknown; why?: unknown })
    .filter((x) => typeof x.field === 'string' && fields.includes(x.field as SetupField))
    .map((x) => {
      const value = cleanSetup({ [x.field as string]: x.value })?.[x.field as SetupField];
      return value ? { field: x.field as SetupField, value, why: asString(x.why, 300) } : null;
    })
    .filter((x): x is { field: SetupField; value: string; why: string } => !!x && shot.setup?.[x.field] !== x.value)
    .slice(0, 6);
  const questions: MentorQuestion[] = (Array.isArray(out.questions) ? out.questions : [])
    .map((x) => x as { field?: unknown; question?: unknown; options?: unknown })
    .map((x) => {
      const rawOptions = (Array.isArray(x.options) ? x.options : []).map((o) => asString(o, 80).trim()).filter(Boolean);
      // A question whose answers are all values of one field is about that field.
      const field =
        typeof x.field === 'string' && fields.includes(x.field as SetupField)
          ? (x.field as SetupField)
          : fields.find((f) => rawOptions.length >= 2 && rawOptions.every((o) => cleanSetup({ [f]: o })?.[f]));
      let options = (Array.isArray(x.options) ? x.options : []).map((o) => asString(o, 80).trim()).filter(Boolean);
      // A question about a field answers with that field's values.
      if (field) options = options.map((o) => cleanSetup({ [field]: o })?.[field]).filter((o): o is string => !!o);
      return { ...(field ? { field } : {}), question: asString(x.question, 300).trim(), options: [...new Set(options)].slice(0, 5) };
    })
    .filter((q) => q.question && q.options.length >= 2 && !(q.field && shot.setup?.[q.field]))
    .slice(0, 2);
  // A bare answer ("Medium Close Up") isn't mentoring: say the suggestions with their reasons.
  if (reply.split(/\s+/).length < 8) {
    const said = suggestions.map((sg) => `${SETUP_FIELDS[sg.field].label}: ${sg.value}. ${sg.why}`.trim());
    reply = [reply && !suggestions.some((sg) => reply.toLowerCase().includes(sg.value.toLowerCase())) ? reply : '', ...said].filter(Boolean).join('\n') || 'Tell me how you picture this moment: what should the audience notice first?';
  }
  const core = !!(shot.setup?.size && shot.setup.framing && shot.setup.angle);
  return {
    messages: [...messages, { from: 'mentor' as const, text: reply }].slice(-40),
    ...(suggestions.length ? { suggestions } : {}),
    ...(questions.length ? { questions } : {}),
    ...(out.ready === true && core ? { ready: true } : {}),
  };
}
