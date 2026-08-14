import type { MediaCapability } from '../../types/models';

export interface GenerateRequest {
  prompt: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  model?: string;
  extra?: Record<string, string>;
  // Binary input (e.g. a reference voice clip for TTS cloning). Only
  // LocalTtsProvider reads this today; other providers ignore it.
  inputFiles?: Array<{ field: string; bytes: Buffer; mime: string; filename?: string }>;
}

export interface GenerateFile {
  bytes: Buffer;
  mime: string;
  filename: string;
}

export interface GenerateResult {
  files: GenerateFile[];
  meta: Record<string, unknown>;
}

export interface MediaProvider {
  id: string;
  capability: MediaCapability;
  isReachable(): Promise<boolean>;
  listModels(): Promise<string[]>;
  generate(
    req: GenerateRequest,
    onProgress?: (p: number) => void
  ): Promise<GenerateResult>;
}
