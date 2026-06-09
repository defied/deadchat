// Generic HTTP provider — entirely data-driven, no per-vendor code.
// Configuration lives in the providers.config DB column (JSON):
//   endpoint:         POST URL for generation
//   auth:             { type: 'bearer'|'header'|'query'|'none', key_name?, key_value_env? }
//   request_template: JSON string with %PROMPT%, %SEED%, etc. placeholders
//   response_type:    'url' | 'base64'
//   response_path:    dot-separated path to the URL/base64 in the response JSON
//   poll:             { url_template, interval_ms, status_path, done_value, output_path }
//   mime:             MIME type of the output (e.g. 'image/png')

import { decryptObject } from '../secrets';
import type { MediaProvider, GenerateRequest, GenerateResult } from './types';
import type { MediaCapability } from '../../types/models';

interface AuthConfig {
  type: 'bearer' | 'header' | 'query' | 'none';
  key_name?: string;
}

interface PollConfig {
  url_template: string;
  interval_ms?: number;
  status_path: string;
  done_value: string;
  output_path: string;
}

interface GenericHttpConfig {
  endpoint: string;
  auth: AuthConfig;
  request_template: string;
  response_type: 'url' | 'base64';
  response_path: string;
  poll?: PollConfig;
  mime: string;
}

function getPath(obj: unknown, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((cur, key) => {
    if (cur && typeof cur === 'object') return (cur as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function fillTemplate(template: string, req: GenerateRequest): string {
  let out = template;
  out = out.replace(/%PROMPT%/g, req.prompt);
  out = out.replace(/%SEED%/g, String(req.seed ?? Math.floor(Math.random() * 1e9)));
  out = out.replace(/%WIDTH%/g, String(req.width ?? 1024));
  out = out.replace(/%HEIGHT%/g, String(req.height ?? 1024));
  out = out.replace(/%STEPS%/g, String(req.steps ?? 20));
  out = out.replace(/%CFG%/g, String(req.cfg ?? 7));
  for (const [k, v] of Object.entries(req.extra ?? {})) {
    out = out.replace(new RegExp(`%${k}%`, 'g'), v);
  }
  return out;
}

export class GenericHttpProvider implements MediaProvider {
  readonly capability: MediaCapability;
  private cfg: GenericHttpConfig;
  private apiKey: string;

  constructor(
    capability: MediaCapability,
    providerConfig: Record<string, unknown>,
    encryptedSecrets: string | null
  ) {
    this.capability = capability;
    this.cfg = providerConfig as unknown as GenericHttpConfig;
    const secrets = encryptedSecrets ? decryptObject(encryptedSecrets) : {};
    this.apiKey = (secrets.api_key as string | undefined) ?? '';
  }

  get id(): string {
    return `generic_http_${this.capability}`;
  }

  async isReachable(): Promise<boolean> {
    // Can't cheaply probe without a real request — assume reachable if configured
    return Boolean(this.cfg.endpoint && this.cfg.endpoint.length > 0);
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async generate(
    req: GenerateRequest,
    onProgress?: (p: number) => void
  ): Promise<GenerateResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = this.cfg.auth;
    if (auth.type === 'bearer') {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    } else if (auth.type === 'header' && auth.key_name) {
      headers[auth.key_name] = this.apiKey;
    }

    let url = this.cfg.endpoint;
    if (auth.type === 'query' && auth.key_name) {
      url += `${url.includes('?') ? '&' : '?'}${auth.key_name}=${encodeURIComponent(this.apiKey)}`;
    }

    const body = fillTemplate(this.cfg.request_template, req);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GenericHttp provider error (${res.status}): ${text}`);
    }

    let responseJson = await res.json();

    // Poll if configured
    if (this.cfg.poll) {
      responseJson = await this.poll(responseJson, onProgress);
    } else {
      onProgress?.(1);
    }

    const outputValue = getPath(responseJson, this.cfg.response_path) as string;
    if (!outputValue) {
      throw new Error(`GenericHttp: could not find output at path '${this.cfg.response_path}'`);
    }

    let bytes: Buffer;
    let filename: string;
    if (this.cfg.response_type === 'url') {
      const fileRes = await fetch(outputValue);
      if (!fileRes.ok) throw new Error(`Failed to fetch output file from ${outputValue}`);
      bytes = Buffer.from(await fileRes.arrayBuffer());
      filename = outputValue.split('/').pop() ?? 'output';
    } else {
      bytes = Buffer.from(outputValue, 'base64');
      filename = `output.${this.cfg.mime.split('/')[1] ?? 'bin'}`;
    }

    return {
      files: [{ bytes, mime: this.cfg.mime, filename }],
      meta: { provider: 'generic_http' },
    };
  }

  private async poll(
    initialResponse: unknown,
    onProgress?: (p: number) => void
  ): Promise<unknown> {
    const poll = this.cfg.poll!;
    const intervalMs = poll.interval_ms ?? 3000;
    let response = initialResponse;
    let attempt = 0;
    const maxAttempts = Math.ceil(300_000 / intervalMs);

    while (attempt++ < maxAttempts) {
      const status = getPath(response, poll.status_path) as string;
      if (status === poll.done_value) {
        onProgress?.(1);
        return response;
      }

      const progress = attempt / maxAttempts;
      onProgress?.(progress * 0.9);

      await sleep(intervalMs);

      const pollUrl = poll.url_template.replace('%JOB_ID%', String(getPath(response, 'id') ?? ''));
      const res = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (res.ok) response = await res.json();
    }

    throw new Error('GenericHttp provider polling timed out');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
