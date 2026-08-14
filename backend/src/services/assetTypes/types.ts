import type { MediaCapability } from '../../types/models';

// Extension point for the draft->approve pipeline: one handler per asset_type.
// assetPipeline.ts only ever talks to assets through this interface - it knows
// nothing about prompts, images, or ComfyUI directly.
export interface AssetTypeHandler {
  assetType: string;
  capability: MediaCapability;

  // Input -> the recipe used for the first (draft-quality) generation.
  buildDraftParams(input: Record<string, unknown>): Record<string, unknown>;

  // Approved draft params -> the recipe used for the final (full-quality) render.
  buildFinalParams(approvedParams: Record<string, unknown>): Record<string, unknown>;

  // Current params + free-text feedback -> new params for a re-draft.
  applyRevision(params: Record<string, unknown>, note: string): Promise<Record<string, unknown>>;

  // Bucket key fragment for duration_estimates, e.g. "1024x1024" or "4k".
  qualityTier(stage: 'draft' | 'final', params: Record<string, unknown>): string;
}
