import { chatSync } from '../ollama';
import type { AssetTypeHandler } from './types';

// Proves the draft->approve scaffolding end-to-end using the existing image
// pipeline as-is - no new provider/capability work required. Draft = fast/cheap
// preview, final = full-quality render of the same (possibly revised) prompt.
const DRAFT_SIZE = 512;
const FINAL_SIZE = 1024;
const DRAFT_STEPS = 4;
const FINAL_STEPS = 30;

export const characterPortraitHandler: AssetTypeHandler = {
  assetType: 'character_portrait',
  capability: 'image',

  buildDraftParams(input) {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new Error('character_portrait requires a non-empty "prompt"');
    return {
      prompt,
      width: DRAFT_SIZE,
      height: DRAFT_SIZE,
      steps: DRAFT_STEPS,
      seed: input.seed,
      model: input.model,
    };
  },

  buildFinalParams(approvedParams) {
    return {
      ...approvedParams,
      width: FINAL_SIZE,
      height: FINAL_SIZE,
      steps: FINAL_STEPS,
    };
  },

  async applyRevision(params, note) {
    const currentPrompt = String(params.prompt ?? '');
    const { content } = await chatSync([
      {
        role: 'system',
        content:
          'You rewrite AI image-generation prompts to incorporate user feedback. ' +
          'Given a current prompt and a revision note, output ONLY the revised prompt text ' +
          '- no preamble, no quotes, no explanation.',
      },
      {
        role: 'user',
        content: `Current prompt: ${currentPrompt}\n\nRevision note: ${note}\n\nRevised prompt:`,
      },
    ]);
    const revisedPrompt = content.trim() || currentPrompt;
    return { ...params, prompt: revisedPrompt };
  },

  qualityTier(stage, params) {
    const width = Number(params.width) || (stage === 'final' ? FINAL_SIZE : DRAFT_SIZE);
    const height = Number(params.height) || width;
    return `${stage}:${width}x${height}`;
  },
};
