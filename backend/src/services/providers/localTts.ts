import type { MediaProvider, GenerateRequest, GenerateResult } from './types';
import type { MediaCapability } from '../../types/models';
import { getTtsUrl } from '../ttsSettings';

// Calls the local XTTS-v2 sidecar (tts-service/) for zero-shot voice cloning.
// Hand-rolled multipart client rather than GenericHttpProvider - that class is
// hard-wired to JSON-template substitution with no binary-input path, and
// shoehorning a reference-audio file into it would mean bolting a second
// request mode onto a class whose whole contract assumes JSON.
export class LocalTtsProvider implements MediaProvider {
  readonly capability: MediaCapability = 'tts';
  private baseUrl?: string;

  constructor(config: Record<string, unknown> = {}) {
    this.baseUrl = config.baseUrl as string | undefined;
  }

  get id(): string {
    return 'local_tts';
  }

  private url(): string {
    return (this.baseUrl ?? getTtsUrl()).replace(/\/$/, '');
  }

  async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url()}/health`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return ['xtts-v2'];
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const referenceFile = req.inputFiles?.find((f) => f.field === 'reference_audio');
    if (!referenceFile) {
      throw new Error('LocalTtsProvider.generate requires a reference_audio inputFile');
    }

    const form = new FormData();
    form.append('reference_audio', new Blob([new Uint8Array(referenceFile.bytes)], { type: referenceFile.mime }), referenceFile.filename ?? 'reference.wav');
    form.append('text', req.prompt);
    form.append('language', req.extra?.LANGUAGE ?? 'en');

    const res = await fetch(`${this.url()}/clone`, {
      method: 'POST',
      body: form,
      // Model load + synth can take a while, especially cold (model download
      // on first-ever call). No per-attempt retry here - the job queue's own
      // failure handling covers that.
      signal: AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TTS sidecar /clone error (${res.status}): ${text}`);
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    return {
      files: [{ bytes, mime: 'audio/wav', filename: 'voice.wav' }],
      meta: { model: 'xtts-v2', language: req.extra?.LANGUAGE ?? 'en' },
    };
  }
}
