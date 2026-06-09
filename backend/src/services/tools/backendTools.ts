import { getOllamaUrl } from '../appSettings';
import * as comfyui from '../comfyui';
import type { AnthropicTool } from '../../types/anthropic';

export const BACKEND_TOOL_NAMES = ['ping_backends', 'list_models'] as const;

export const backendToolDefs: AnthropicTool[] = [
  {
    name: 'ping_backends',
    description:
      'Check whether the Ollama LLM server and ComfyUI media generation server are reachable. ' +
      'Returns the status of each backend and basic system info.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_models',
    description:
      'List models available on Ollama (LLM models) and ComfyUI (image/video checkpoints).',
    input_schema: {
      type: 'object',
      properties: {
        backend: {
          type: 'string',
          enum: ['ollama', 'comfyui', 'both'],
          description: 'Which backend to list models for. Defaults to "both".',
        },
      },
      required: [],
    },
  },
];

export async function handlePingBackends(): Promise<Record<string, unknown>> {
  const [comfyOk, ollamaResult] = await Promise.allSettled([
    comfyui.isReachable(),
    fetch(`${getOllamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.ok)
      .catch(() => false),
  ]);

  const comfyReachable = comfyOk.status === 'fulfilled' && comfyOk.value;
  const ollamaReachable = ollamaResult.status === 'fulfilled' && ollamaResult.value;

  return {
    ollama: { reachable: ollamaReachable, url: getOllamaUrl() },
    comfyui: { reachable: comfyReachable },
  };
}

export async function handleListModels(
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const backend = (input.backend as string | undefined) ?? 'both';
  const result: Record<string, unknown> = {};

  if (backend === 'ollama' || backend === 'both') {
    try {
      const res = await fetch(`${getOllamaUrl()}/api/tags`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const data = await res.json() as { models: Array<{ name: string }> };
        result.ollama_models = data.models?.map((m) => m.name) ?? [];
      } else {
        result.ollama_models = [];
        result.ollama_error = `HTTP ${res.status}`;
      }
    } catch (e) {
      result.ollama_models = [];
      result.ollama_error = String(e);
    }
  }

  if (backend === 'comfyui' || backend === 'both') {
    const models = await comfyui.listModels();
    result.comfyui_models = models;
  }

  return result;
}
