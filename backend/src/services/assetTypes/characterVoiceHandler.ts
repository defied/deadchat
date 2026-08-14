import { getMedia } from '../mediaStore';
import type { AssetTypeHandler } from './types';

const DEFAULT_SAMPLE_TEXT = 'Hello, this is a test of my voice.';

// Captures/reviews the reference voice clip itself (one-time setup per
// character). Ad-hoc dialogue lines after that go through the lightweight
// POST /api/characters/:id/speak path instead - see routes/characters.ts -
// which does NOT go through this draft/approve pipeline, since arbitrary
// lines don't need per-line review.
export const characterVoiceHandler: AssetTypeHandler = {
  assetType: 'character_voice',
  capability: 'tts',

  buildDraftParams(input) {
    const referenceMediaId = Number(input.referenceMediaId);
    if (!referenceMediaId || !getMedia(referenceMediaId)) {
      throw new Error('character_voice requires a valid "referenceMediaId"');
    }
    return {
      referenceMediaId,
      prompt: (input.sampleText as string | undefined)?.trim() || DEFAULT_SAMPLE_TEXT,
      language: (input.language as string | undefined) ?? 'en',
    };
  },

  buildFinalParams(approvedParams) {
    // No quality-tier axis for TTS the way image steps/resolution has -
    // "final" is just a repeat generation. The frontend passes
    // holdFinal:true on approve() for this asset type to skip the redundant
    // render rather than special-casing that here.
    return { ...approvedParams };
  },

  async applyRevision(params, note) {
    // Intentionally scope-limited: XTTS-v2 zero-shot cloning has no
    // prompt-style-control axis the way image generation does, so a
    // revision here can only change what's said, not the voice itself. A
    // real timbre change requires uploading a new reference clip via a
    // fresh POST /api/characters/:id/voice call, not a revise.
    return { ...params, prompt: note.trim() || params.prompt };
  },

  qualityTier(stage) {
    return stage;
  },
};
