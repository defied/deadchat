import WebSocket from 'ws';
import db from '../db/connection';
import { chatStream, OllamaMessage } from '../services/ollama';
import { runAgentLoop, AgentEvent } from '../services/agentLoop';
import { logUsage } from '../services/usage';
import { recordRequest } from '../services/liveStats';
import { config } from '../config';
import type { WsUser } from './auth';
import type { Message, Session } from '../types/models';
import type { AnthropicMessage } from '../types/anthropic';

interface ChatMessage {
  type: 'chat';
  sessionId: number;
  content: string;
  attachments?: string[];
}

interface OutgoingToken {
  type: 'token';
  content: string;
}

interface OutgoingDone {
  type: 'done';
  messageId: number;
}

interface OutgoingError {
  type: 'error';
  message: string;
}

interface OutgoingToolCall {
  type: 'tool_call';
  step: number;
  toolName: string;
  toolCallId: string;
  toolInput: unknown;
}

interface OutgoingToolResult {
  type: 'tool_result';
  step: number;
  toolCallId: string;
  result: unknown;
}

type OutgoingMessage =
  | OutgoingToken
  | OutgoingDone
  | OutgoingError
  | OutgoingToolCall
  | OutgoingToolResult;

function send(ws: WebSocket, data: OutgoingMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export async function handleChatMessage(
  ws: WebSocket,
  user: WsUser,
  data: ChatMessage
): Promise<void> {
  const { sessionId, content, attachments } = data;

  // Verify session belongs to user
  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, user.id) as Session | undefined;

  if (!session) {
    send(ws, { type: 'error', message: 'Session not found' });
    return;
  }

  // Save user message
  const attachmentsJson = attachments && attachments.length > 0
    ? JSON.stringify(attachments)
    : null;

  db.prepare(
    'INSERT INTO messages (session_id, role, content, attachments) VALUES (?, ?, ?, ?)'
  ).run(sessionId, 'user', content, attachmentsJson);

  // Load session history (includes the just-inserted user message)
  const history = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as Pick<Message, 'role' | 'content'>[];

  // Get active model from settings
  const settingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_model') as { value: string } | undefined;
  const activeModel = settingRow?.value || config.ollamaModel;

  // ─── Agentic session: route through the plan→tool→observe loop ──────────────
  if (session.agent_agentic) {
    // Build Anthropic-format history (filter out system messages — those go in systemPrompt)
    const anthropicHistory: AnthropicMessage[] = history
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const startTime = Date.now();
    let fullResponse = '';

    try {
      const result = await runAgentLoop({
        model: activeModel,
        systemPrompt: session.system_prompt || '',
        userGoal: content,
        history: anthropicHistory,
        ctx: { userId: user.id },
        onEvent(evt: AgentEvent) {
          if (evt.type === 'tool_call') {
            send(ws, {
              type: 'tool_call',
              step: evt.step,
              toolName: evt.toolName!,
              toolCallId: evt.toolCallId!,
              toolInput: evt.toolInput,
            });
          } else if (evt.type === 'tool_result') {
            send(ws, {
              type: 'tool_result',
              step: evt.step,
              toolCallId: evt.toolCallId!,
              result: evt.result,
            });
          } else if (evt.type === 'agent_step' && evt.text) {
            fullResponse += evt.text;
            send(ws, { type: 'token', content: evt.text });
          }
        },
      });

      // Use the finalText from the loop result (last text block seen)
      if (!fullResponse && result.finalText) {
        fullResponse = result.finalText;
        send(ws, { type: 'token', content: result.finalText });
      }
    } catch (err: any) {
      send(ws, { type: 'error', message: `Agent error: ${err.message}` });
      return;
    }

    // Save assistant message
    const msgResult = db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'assistant', fullResponse || '(no response)');

    const messageId = Number(msgResult.lastInsertRowid);

    updateSessionTitle(sessionId, content, session.title);
    logUsage(user.id, sessionId, 'chat', activeModel, 0, 0, Date.now() - startTime);

    send(ws, { type: 'done', messageId });
    return;
  }

  // ─── Standard streaming chat ─────────────────────────────────────────────────
  const ollamaMessages: OllamaMessage[] = [];
  if (session.system_prompt) {
    ollamaMessages.push({ role: 'system', content: session.system_prompt });
  }
  for (const msg of history) {
    ollamaMessages.push({
      role: msg.role as OllamaMessage['role'],
      content: msg.content,
    });
  }

  const startTime = Date.now();
  let firstTokenAt: number | undefined;
  let fullResponse = '';
  let promptTokens = 0;
  let evalTokens = 0;
  let reportedModel = activeModel;
  let totalDurationNs: number | undefined;
  let loadDurationNs: number | undefined;
  let promptEvalDurationNs: number | undefined;
  let evalDurationNs: number | undefined;

  try {
    for await (const chunk of chatStream(ollamaMessages, activeModel)) {
      if (!firstTokenAt && chunk.content) firstTokenAt = Date.now();
      fullResponse += chunk.content;
      send(ws, { type: 'token', content: chunk.content });

      if (chunk.done) {
        promptTokens = chunk.promptTokens || 0;
        evalTokens = chunk.evalTokens || 0;
        if (chunk.model) reportedModel = chunk.model;
        totalDurationNs = chunk.totalDurationNs;
        loadDurationNs = chunk.loadDurationNs;
        promptEvalDurationNs = chunk.promptEvalDurationNs;
        evalDurationNs = chunk.evalDurationNs;
      }
    }
  } catch (err: any) {
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
    send(ws, { type: 'error', message: `Ollama error: ${err.message}` });
    return;
  }

  const finishedAt = Date.now();
  const durationMs = finishedAt - startTime;

  // Save assistant message
  const result = db.prepare(
    'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
  ).run(sessionId, 'assistant', fullResponse);

  const messageId = Number(result.lastInsertRowid);

  updateSessionTitle(sessionId, content, session.title);

  logUsage(user.id, sessionId, 'chat', reportedModel, promptTokens, evalTokens, durationMs);
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
    totalDurationNs,
    loadDurationNs,
    promptEvalDurationNs,
    evalDurationNs,
  });

  send(ws, { type: 'done', messageId });
}

function updateSessionTitle(sessionId: number, userContent: string, currentTitle: string): void {
  const messageCount = db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE session_id = ?'
  ).get(sessionId) as { count: number };

  if (messageCount.count <= 2 && currentTitle === 'New Chat') {
    const title = userContent.length > 50 ? userContent.substring(0, 50) + '...' : userContent;
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId);
  }
}
