// The film agents: every AI helper the screenplay tools use, with its
// instructions. Writers can rewrite an agent's instructions per screenplay
// (Film agents tab); the output-format part stays fixed so the app can still
// read the answers.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface AgentDef {
  id: string;
  name: string;
  /** What it does, for the writer. */
  role: string;
  /** Which model runs it. */
  model: 'screenplay' | 'vision';
  /** The full default prompt; the "Return {…" part at the end is the fixed output format. */
  prompt: string;
}

const registry = new Map<string, AgentDef>();
const overrides = new AsyncLocalStorage<Record<string, string>>();

export function defineAgent(def: AgentDef): AgentDef {
  registry.set(def.id, def);
  return def;
}

/** Split a prompt into the editable instructions and the fixed output format. */
export function splitPrompt(prompt: string): { instructions: string; format: string } {
  const i = prompt.search(/\s*(?:Return|Propose ONE look[^.]*as) \{/);
  return i < 0 ? { instructions: prompt.trim(), format: '' } : { instructions: prompt.slice(0, i).trim(), format: prompt.slice(i).trim() };
}

/** The agent's instructions for the screenplay being worked on (the writer's version, if they changed it). */
export function agentParts(id: string): { instructions: string; format: string } {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown agent ${id}`);
  const parts = splitPrompt(def.prompt);
  const own = overrides.getStore()?.[id]?.trim();
  return own ? { instructions: own, format: parts.format } : parts;
}

/** The whole system prompt: instructions (+ extra lines) + output format. */
export function agentPrompt(id: string, extra = ''): string {
  const { instructions, format } = agentParts(id);
  return [instructions + extra, format].filter(Boolean).join('\n');
}

/** Run with a screenplay's own agent instructions in effect. */
export function withAgentPrompts<T>(own: Record<string, string> | undefined, fn: () => T): T {
  return overrides.run(own ?? {}, fn);
}

/** For a request handler: this screenplay's instructions for the rest of the request. */
export function enterAgentPrompts(own: Record<string, string> | undefined): void {
  overrides.enterWith(own ?? {});
}

export function listAgents(): Array<Omit<AgentDef, 'prompt'> & { instructions: string; format: string }> {
  return [...registry.values()].map(({ prompt, ...d }) => ({ ...d, ...splitPrompt(prompt) }));
}

export const AGENT_IDS = () => [...registry.keys()];
