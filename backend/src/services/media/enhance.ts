// Accuracy helpers backed by the local LLM:
//  * enhancePrompt: expand a short request into the detailed, model-appropriate
//    prompt modern image/video models follow best
//  * verifyImage: vision check of a generated image against the request;
//    returns concrete issues so the worker can retry with a corrected prompt

import { getOllamaUrl } from '../appSettings';
import { getActiveModel, getModelCapabilities } from '../chatModels';
import type { MediaModel } from './catalog';

const TIMEOUT = 180_000;

async function pickModel(needVision: boolean): Promise<string> {
  const active = getActiveModel();
  if (!needVision) return active;
  const caps = await getModelCapabilities(active);
  if (caps.includes('vision')) return active;
  throw new Error(`Active model ${active} has no vision capability`);
}

async function chat(model: string, system: string, user: string, images?: string[], json = false): Promise<string> {
  const r = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      ...(json ? { format: 'json' } : {}),
      options: { temperature: 0.4, num_ctx: 8192 },
      // Short keep-alive: the GPU is needed by ComfyUI right after this.
      keep_alive: '30s',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user, ...(images?.length ? { images } : {}) },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { message?: { content?: string } };
  return (data.message?.content ?? '').trim();
}

function styleGuide(model: MediaModel): string {
  if (model.kind === 'video') {
    return [
      'Write ONE paragraph (60-120 words) describing a single continuous shot, in this order:',
      'subject and action, setting, camera (shot size, movement, lens), lighting, mood/style, and sound if relevant.',
      'Use concrete visual verbs for motion. Describe what changes over time. No lists, no shot numbers.',
      model.needsImage ? 'A start image is provided to the video model: describe the MOTION and camera, do not re-describe everything in the frame.' : '',
    ].join(' ');
  }
  const textHeavy = model.strengths.some((s) => /text|typography/.test(s));
  return [
    'Write ONE paragraph (50-110 words): main subject first with precise attributes (count, colors, materials, pose),',
    'then setting, composition and framing, lighting, and style/medium.',
    textHeavy ? 'If the request includes words to show in the image, quote them exactly in double quotes and say where they appear.' : '',
    'Be literal: every object, number and color the user asked for must be stated explicitly.',
  ].join(' ');
}

/** Returns an improved prompt, or the original if the LLM is unavailable. */
export async function enhancePrompt(userPrompt: string, model: MediaModel): Promise<string> {
  const llm = await pickModel(false);
  const system =
    `You turn short requests into prompts for the ${model.label} ${model.kind} model. ` +
    `${styleGuide(model)} Keep every detail the user specified and never contradict it; add only what is missing ` +
    `(lighting, composition, lens, style) and keep additions consistent with the request. ` +
    `Output ONLY the prompt text — no preface, quotes, or notes.`;
  const out = await chat(llm, system, userPrompt);
  const cleaned = out.replace(/^["'`]+|["'`]+$/g, '').replace(/^prompt:\s*/i, '').trim();
  return cleaned.length >= Math.min(20, userPrompt.length) ? cleaned : userPrompt;
}

export interface Verdict {
  score: number; // 1-10
  pass: boolean;
  issues: string[];
}

/** Ask the vision LLM whether the image satisfies the request. */
export async function verifyImage(userPrompt: string, imageB64: string): Promise<Verdict> {
  const llm = await pickModel(true);
  const system =
    'You are a strict QA reviewer for AI-generated images. Compare the image with the request. ' +
    'Check: requested subjects present, exact counts, colors, spatial relations, any requested text spelled exactly, ' +
    'and obvious defects (extra/missing fingers or limbs, melted faces, garbled text). ' +
    'Respond with JSON: {"score": <1-10>, "issues": ["<specific problem>", ...]}. ' +
    'Score 8+ means the image satisfies the request. Issues must be concrete and fixable; empty list if none.';
  const raw = await chat(llm, system, `Request: ${userPrompt}`, [imageB64], true);
  try {
    const d = JSON.parse(raw) as { score?: number; issues?: unknown };
    const score = Math.max(1, Math.min(10, Number(d.score) || 1));
    const issues = Array.isArray(d.issues) ? d.issues.map(String).filter(Boolean).slice(0, 6) : [];
    return { score, issues, pass: score >= 8 };
  } catch {
    return { score: 10, pass: true, issues: [] }; // unparseable → don't block the user
  }
}

/** Rewrite the prompt so the next attempt fixes the reviewer's issues. */
export async function correctPrompt(userPrompt: string, previous: string, issues: string[], model: MediaModel): Promise<string> {
  const llm = await pickModel(false);
  const system =
    `You fix prompts for the ${model.label} image model. ${styleGuide(model)} ` +
    'Rewrite the previous prompt so the listed problems cannot recur: state the missing or wrong elements more ' +
    'explicitly and earlier in the prompt. Output ONLY the new prompt.';
  const user = `Original request: ${userPrompt}\n\nPrevious prompt: ${previous}\n\nProblems found in the result:\n- ${issues.join('\n- ')}`;
  const out = await chat(llm, system, user);
  return out.replace(/^["'`]+|["'`]+$/g, '').trim() || previous;
}
