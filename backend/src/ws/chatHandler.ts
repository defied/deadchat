import WebSocket from 'ws';
import db from '../db/connection';
import { chatStream, OllamaMessage } from '../services/ollama';
import { runAgentLoop, AgentEvent } from '../services/agentLoop';
import { logUsage } from '../services/usage';
import { recordRequest } from '../services/liveStats';
import { getChatOptions } from '../services/modelSettings';
import { getActiveModel, getModelCapabilities } from '../services/chatModels';
import {
  normalizeAttachments,
  parseStoredAttachments,
  buildModelInput,
} from '../services/attachments';
import type { WsUser } from './auth';
import type { Session } from '../types/models';
import type { AnthropicMessage } from '../types/anthropic';

export interface IncomingChat {
  type: 'chat';
  sessionId: number;
  content: string;
  attachments?: unknown[];
}

// Every outgoing event carries the sessionId so the client can ignore events
// for a chat the user has navigated away from.
type Outgoing =
  | { type: 'start'; sessionId: number; userMessageId: number; model: string; title: string }
  | { type: 'thinking'; sessionId: number; content: string }
  | { type: 'token'; sessionId: number; content: string }
  | { type: 'tool_call'; sessionId: number; step: number; toolName: string; toolCallId: string; toolInput: unknown }
  | { type: 'tool_result'; sessionId: number; step: number; toolCallId: string; result: unknown }
  | { type: 'done'; sessionId: number; messageId: number | null; cancelled?: boolean }
  | { type: 'error'; sessionId?: number; message: string };

function send(ws: WebSocket, data: Outgoing): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/** In-flight generations, keyed by session id. */
const active = new Map<number, { userId: number; controller: AbortController }>();

export function cancelGeneration(user: WsUser, sessionId: number): boolean {
  const entry = active.get(sessionId);
  if (!entry || entry.userId !== user.id) return false;
  entry.controller.abort();
  return true;
}

export function isGenerating(sessionId: number): boolean {
  return active.has(sessionId);
}

interface HistoryRow {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments: string | null;
}

export async function handleChatMessage(ws: WebSocket, user: WsUser, data: IncomingChat): Promise<void> {
  const sessionId = Number(data.sessionId);
  const content = typeof data.content === 'string' ? data.content : '';
  const attachments = normalizeAttachments(data.attachments);

  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, user.id) as Session | undefined;

  if (!session) {
    send(ws, { type: 'error', sessionId, message: 'Chat not found' });
    return;
  }
  if (!content.trim() && attachments.length === 0) {
    send(ws, { type: 'error', sessionId, message: 'Message is empty' });
    return;
  }
  if (active.has(sessionId)) {
    send(ws, { type: 'error', sessionId, message: 'A reply is already being generated for this chat' });
    return;
  }

  const controller = new AbortController();
  active.set(sessionId, { userId: user.id, controller });

  try {
    // Save the user turn and bump the session's activity time.
    const userMsg = db.prepare(
      'INSERT INTO messages (session_id, role, content, attachments) VALUES (?, ?, ?, ?)'
    ).run(sessionId, 'user', content, attachments.length ? JSON.stringify(attachments) : null);
    const title = maybeSetTitle(session, content, attachments.map((a) => a.filename));
    db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);

    const model = session.model || getActiveModel();
    send(ws, { type: 'start', sessionId, userMessageId: Number(userMsg.lastInsertRowid), model, title });

    const history = db.prepare(
      'SELECT role, content, attachments FROM messages WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId) as HistoryRow[];

    const capabilities = await getModelCapabilities(model);
    const vision = capabilities.includes('vision');

    if (session.agent_agentic) {
      await runAgentic(ws, user, session, model, history, controller.signal);
    } else {
      await runStreaming(ws, user, session, model, history, vision, controller.signal);
    }
  } catch (err: any) {
    console.error(`[chat] session ${sessionId} failed:`, err?.message);
    send(ws, { type: 'error', sessionId, message: err?.message || 'Generation failed' });
  } finally {
    active.delete(sessionId);
  }
}

async function runStreaming(
  ws: WebSocket,
  user: WsUser,
  session: Session,
  model: string,
  history: HistoryRow[],
  vision: boolean,
  signal: AbortSignal,
): Promise<void> {
  const sessionId = session.id;
  const ollamaMessages: OllamaMessage[] = [];
  if (session.system_prompt) {
    ollamaMessages.push({ role: 'system', content: session.system_prompt });
  }
  for (const msg of history) {
    const atts = parseStoredAttachments(msg.attachments);
    if (msg.role === 'user' && atts.length > 0) {
      const input = buildModelInput(msg.content, atts, vision);
      ollamaMessages.push({ role: 'user', content: input.content, ...(input.images.length ? { images: input.images } : {}) });
    } else {
      ollamaMessages.push({ role: msg.role, content: msg.content });
    }
  }

  const startTime = Date.now();
  let firstTokenAt: number | undefined;
  let fullResponse = '';
  let thinking = '';
  let promptTokens = 0;
  let evalTokens = 0;
  let reportedModel = model;
  let totals: { total?: number; load?: number; promptEval?: number; evalDur?: number } = {};
  let cancelled = false;

  try {
    for await (const chunk of chatStream(ollamaMessages, model, { options: getChatOptions(model), signal })) {
      if (!firstTokenAt && (chunk.content || chunk.thinking)) firstTokenAt = Date.now();
      if (chunk.thinking) {
        thinking += chunk.thinking;
        send(ws, { type: 'thinking', sessionId, content: chunk.thinking });
      }
      if (chunk.content) {
        fullResponse += chunk.content;
        send(ws, { type: 'token', sessionId, content: chunk.content });
      }
      if (chunk.done) {
        promptTokens = chunk.promptTokens || 0;
        evalTokens = chunk.evalTokens || 0;
        if (chunk.model) reportedModel = chunk.model;
        totals = {
          total: chunk.totalDurationNs,
          load: chunk.loadDurationNs,
          promptEval: chunk.promptEvalDurationNs,
          evalDur: chunk.evalDurationNs,
        };
      }
    }
  } catch (err: any) {
    if (signal.aborted) {
      cancelled = true;
    } else {
      recordRequest({
        userId: user.id,
        username: user.username,
        model: reportedModel,
        endpoint: 'chat',
        startedAt: startTime,
        firstTokenAt,
        finishedAt: Date.now(),
        promptTokens,
        evalTokens,
        error: err.message,
      });
      throw new Error(`Ollama error: ${err.message}`);
    }
  }

  const finishedAt = Date.now();

  // Persist whatever we have — including a partial reply when the user hit Stop.
  let messageId: number | null = null;
  if (fullResponse || thinking) {
    const result = db.prepare(
      'INSERT INTO messages (session_id, role, content, thinking) VALUES (?, ?, ?, ?)'
    ).run(sessionId, 'assistant', fullResponse, thinking || null);
    messageId = Number(result.lastInsertRowid);
    db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
  }

  logUsage(user.id, sessionId, 'chat', reportedModel, promptTokens, evalTokens, finishedAt - startTime);
  recordRequest({
    userId: user.id,
    username: user.username,
    model: reportedModel,
    endpoint: 'chat',
    startedAt: startTime,
    firstTokenAt,
    finishedAt,
    promptTokens,
    evalTokens,
    totalDurationNs: totals.total,
    loadDurationNs: totals.load,
    promptEvalDurationNs: totals.promptEval,
    evalDurationNs: totals.evalDur,
  });

  send(ws, { type: 'done', sessionId, messageId, ...(cancelled ? { cancelled: true } : {}) });
}

async function runAgentic(
  ws: WebSocket,
  user: WsUser,
  session: Session,
  model: string,
  history: HistoryRow[],
  signal: AbortSignal,
): Promise<void> {
  const sessionId = session.id;
  // Anthropic-format history; attachments are inlined as text (the agent
  // loop's translator does not forward images).
  const anthropicHistory: AnthropicMessage[] = history
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const atts = parseStoredAttachments(m.attachments);
      const text = m.role === 'user' && atts.length ? buildModelInput(m.content, atts, false).content : m.content;
      return { role: m.role as 'user' | 'assistant', content: text || '(empty)' };
    });

  const startTime = Date.now();
  let fullResponse = '';
  let cancelled = false;

  try {
    const result = await runAgentLoop({
      model,
      systemPrompt: session.system_prompt || '',
      userGoal: anthropicHistory[anthropicHistory.length - 1]?.content as string,
      history: anthropicHistory,
      ctx: { userId: user.id, role: user.role },
      signal,
      onEvent(evt: AgentEvent) {
        if (evt.type === 'tool_call') {
          send(ws, {
            type: 'tool_call',
            sessionId,
            step: evt.step,
            toolName: evt.toolName!,
            toolCallId: evt.toolCallId!,
            toolInput: evt.toolInput,
          });
        } else if (evt.type === 'tool_result') {
          send(ws, { type: 'tool_result', sessionId, step: evt.step, toolCallId: evt.toolCallId!, result: evt.result });
        } else if (evt.type === 'agent_step' && evt.text) {
          const chunk = fullResponse ? `\n\n${evt.text}` : evt.text;
          fullResponse += chunk;
          send(ws, { type: 'token', sessionId, content: chunk });
        }
      },
    });
    cancelled = result.stopReason === 'cancelled';
    if (!fullResponse && result.finalText) {
      fullResponse = result.finalText;
      send(ws, { type: 'token', sessionId, content: result.finalText });
    }
  } catch (err: any) {
    if (!signal.aborted) throw new Error(`Agent error: ${err.message}`);
    cancelled = true;
  }

  let messageId: number | null = null;
  if (fullResponse || !cancelled) {
    const msgResult = db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'assistant', fullResponse || '(no response)');
    messageId = Number(msgResult.lastInsertRowid);
    db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
  }

  logUsage(user.id, sessionId, 'chat', model, 0, 0, Date.now() - startTime);
  send(ws, { type: 'done', sessionId, messageId, ...(cancelled ? { cancelled: true } : {}) });
}

/** Title a fresh chat from its first message. Returns the (possibly new) title. */
function maybeSetTitle(session: Session, userContent: string, filenames: string[]): string {
  if (session.title !== 'New Chat') return session.title;
  const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(session.id) as { count: number };
  if (count.count > 1) return session.title;

  const source = userContent.trim().replace(/\s+/g, ' ') || (filenames.length ? `Attachment: ${filenames[0]}` : '');
  if (!source) return session.title;
  const title = source.length > 60 ? `${source.slice(0, 57).trimEnd()}…` : source;
  db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, session.id);
  return title;
}
