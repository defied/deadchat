import db from '../../db/connection';
import { encrypt } from '../secrets';
import { upsertProvider } from '../providers/registry';
import type { AnthropicTool } from '../../types/anthropic';
import type { ProviderKind, MediaCapability } from '../../types/models';

export const CONFIG_TOOL_NAMES = ['save_provider_config'] as const;

export const configToolDefs: AnthropicTool[] = [
  {
    name: 'save_provider_config',
    description:
      'Save or update a media generation provider (local ComfyUI or generic cloud HTTP). ' +
      'Use this after verifying that the provider is reachable and configured correctly.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable provider name.' },
        kind: {
          type: 'string',
          enum: ['local_comfyui', 'generic_http'],
          description: 'Provider implementation type.',
        },
        capability: {
          type: 'string',
          enum: ['image', 'video'],
          description: 'What this provider generates.',
        },
        base_url: {
          type: 'string',
          description: 'Base URL for the provider API (e.g. http://192.168.0.106:8188).',
        },
        priority: {
          type: 'number',
          description: 'Higher priority = tried first. Use 100 for local, 10 for cloud.',
        },
        config: {
          type: 'object',
          description: 'Provider-specific config (workflow templates, request mapping, etc.).',
        },
        api_key: {
          type: 'string',
          description: 'API key for cloud providers (stored encrypted).',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether this provider is active.',
        },
      },
      required: ['name', 'kind', 'capability'],
    },
  },
];

export function handleSaveProviderConfig(
  input: Record<string, unknown>
): Record<string, unknown> {
  const apiKey = input.api_key as string | undefined;
  const secrets = apiKey ? encrypt(JSON.stringify({ api_key: apiKey })) : null;
  const configObj = (input.config as Record<string, unknown> | undefined) ?? {};

  const provider = upsertProvider({
    name: input.name as string,
    kind: input.kind as ProviderKind,
    capability: input.capability as MediaCapability,
    enabled: input.enabled !== false ? 1 : 0,
    is_default: 0,
    priority: (input.priority as number | undefined) ?? (input.kind === 'local_comfyui' ? 100 : 10),
    base_url: (input.base_url as string | undefined) ?? null,
    config: JSON.stringify(configObj),
    secrets,
  });

  return {
    success: true,
    provider_id: provider.id,
    name: provider.name,
    capability: provider.capability,
    kind: provider.kind,
    enabled: provider.enabled === 1,
  };
}

export function getComfyuiUrl(): string | null {
  const row = db.prepare(
    "SELECT base_url FROM providers WHERE kind='local_comfyui' AND enabled=1 ORDER BY priority DESC LIMIT 1"
  ).get() as { base_url: string } | undefined;
  return row?.base_url ?? null;
}
