// Agent loop: plan → tool → observe → repeat.
// Drives Ollama via anthropicToOllamaRequest / ollamaToAnthropicResponse,
// getting tool-call parsing + salvage for free from anthropicTranslate.ts.

import { chatSyncRaw } from './ollama';
import {
  anthropicToOllamaRequest,
  ollamaToAnthropicResponse,
} from './anthropicTranslate';
import { ALL_TOOL_DEFS, ALL_TOOL_NAMES, dispatchTool, ToolContext } from './tools/index';
import type { AnthropicMessage, AnthropicContentBlock } from '../types/anthropic';

export type AgentEventType = 'tool_call' | 'tool_result' | 'agent_step';

export interface AgentEvent {
  type: AgentEventType;
  step: number;
  toolName?: string;
  toolCallId?: string;
  toolInput?: unknown;
  result?: unknown;
  text?: string;
}

export interface AgentLoopOptions {
  model: string;
  systemPrompt: string;
  userGoal: string;
  /** Prior conversation turns (user/assistant only, no system). When provided,
   *  used as the starting message history instead of a bare userGoal message. */
  history?: AnthropicMessage[];
  maxSteps?: number;
  maxTokens?: number;
  tools?: typeof ALL_TOOL_DEFS;
  ctx: ToolContext;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentLoopResult {
  finalText: string;
  steps: number;
  stopReason: string;
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    model,
    systemPrompt,
    userGoal,
    history,
    maxSteps = 20,
    maxTokens = 4096,
    tools = ALL_TOOL_DEFS,
    ctx,
    onEvent,
  } = opts;

  const toolNames = tools.map((t) => t.name);
  const messages: AnthropicMessage[] = history
    ? [...history]
    : [{ role: 'user', content: userGoal }];

  let steps = 0;
  let lastText = '';
  let stopReason = 'end_turn';

  while (steps < maxSteps) {
    steps++;

    const anthropicReq = {
      model,
      max_tokens: maxTokens,
      messages,
      system: systemPrompt,
      tools,
      stream: false as const,
    };

    const ollamaReq = anthropicToOllamaRequest(anthropicReq);
    const ollamaResp = await chatSyncRaw(ollamaReq);
    const anthResp = ollamaToAnthropicResponse(ollamaResp, model, undefined, toolNames);

    stopReason = anthResp.stop_reason;
    lastText = '';

    // Collect the assistant turn
    const assistantContent: AnthropicContentBlock[] = [...anthResp.content];
    messages.push({ role: 'assistant', content: assistantContent });

    // Extract and emit text blocks
    for (const block of anthResp.content) {
      if (block.type === 'text') {
        lastText = block.text;
        if (block.text.trim()) {
          onEvent?.({ type: 'agent_step', step: steps, text: block.text });
        }
      }
    }

    // If no tool use, we're done
    if (anthResp.stop_reason !== 'tool_use') break;

    // Dispatch all tool calls in sequence (GPU jobs serialize via the job queue)
    const toolResultBlocks: AnthropicContentBlock[] = [];
    for (const block of anthResp.content) {
      if (block.type !== 'tool_use') continue;

      onEvent?.({
        type: 'tool_call',
        step: steps,
        toolName: block.name,
        toolCallId: block.id,
        toolInput: block.input,
      });

      let resultContent: string;
      let parsedResult: unknown;
      try {
        const result = await dispatchTool(block.name, block.input, ctx);
        parsedResult = result;
        resultContent = JSON.stringify(result);
      } catch (e) {
        parsedResult = { error: String(e) };
        resultContent = JSON.stringify(parsedResult);
      }

      onEvent?.({
        type: 'tool_result',
        step: steps,
        toolCallId: block.id,
        result: parsedResult,
      });

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: resultContent,
      });
    }

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  if (steps >= maxSteps && stopReason === 'tool_use') {
    lastText = lastText || 'Reached maximum steps without a final answer.';
    stopReason = 'max_steps';
  }

  return { finalText: lastText, steps, stopReason };
}
