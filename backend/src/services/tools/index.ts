import type { AnthropicTool } from '../../types/anthropic';
import {
  BACKEND_TOOL_NAMES, backendToolDefs,
  handlePingBackends, handleListModels,
} from './backendTools';
import {
  MEDIA_TOOL_NAMES, mediaToolDefs,
  handleGenerateImage, handleGenerateVideo,
} from './mediaTools';
import {
  CONFIG_TOOL_NAMES, configToolDefs,
  handleSaveProviderConfig,
} from './configTools';

export interface ToolContext {
  userId?: number;
  agentRunId?: number;
}

export const ALL_TOOL_DEFS: AnthropicTool[] = [
  ...backendToolDefs,
  ...mediaToolDefs,
  ...configToolDefs,
];

export const ALL_TOOL_NAMES: string[] = [
  ...BACKEND_TOOL_NAMES,
  ...MEDIA_TOOL_NAMES,
  ...CONFIG_TOOL_NAMES,
];

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'ping_backends':
      return handlePingBackends();
    case 'list_models':
      return handleListModels(input);
    case 'generate_image':
      return handleGenerateImage(input, ctx);
    case 'generate_video':
      return handleGenerateVideo(input, ctx);
    case 'save_provider_config':
      return handleSaveProviderConfig(input);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
