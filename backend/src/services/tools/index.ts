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
  /** Role of the user the agent acts for. Admin-only tools are hidden otherwise. */
  role?: string;
  agentRunId?: number;
}

/** Tools that change server configuration — only exposed to admins. */
const ADMIN_TOOL_NAMES = new Set<string>([...CONFIG_TOOL_NAMES]);

/** Tool definitions an agent acting for `role` may see. Undefined role = system/scheduler (full set). */
export function toolsForRole(role?: string): AnthropicTool[] {
  if (role === undefined || role === 'admin') return ALL_TOOL_DEFS;
  return ALL_TOOL_DEFS.filter((t) => !ADMIN_TOOL_NAMES.has(t.name));
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
  if (ADMIN_TOOL_NAMES.has(name) && ctx.role !== undefined && ctx.role !== 'admin') {
    return { error: `Tool ${name} requires an admin account` };
  }
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
