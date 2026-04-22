import WebSocket from 'ws';
import db from '../db/connection';
import { chatStream, OllamaMessage } from '../services/ollama';
import { logUsage } from '../services/usage';
import { recordRequest } from '../services/liveStats';
import { config } from '../config';
import type { WsUser } from './auth';
import type { Message, Session } from '../types/models';

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

function send(ws: WebSocket, data: OutgoingToken | OutgoingDone | OutgoingError): void {
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

  // Load session history
  const history = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as Pick<Message, 'role' | 'content'>[];

  const ollamaMessages: OllamaMessage[] = history.map(msg => ({
    role: msg.role as OllamaMessage['role'],
    content: msg.content,
  }));

  // Get active model from settings
  const settingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_model') as { value: string } | undefined;
  const activeModel = settingRow?.value || undefined;

  // Stream response from Ollama
  const startTime = Date.now();
  let firstTokenAt: number | undefined;
  let fullResponse = '';
  let promptTokens = 0;
  let evalTokens = 0;
  let reportedModel = activeModel || config.ollamaModel;
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

  // Update session title if it's the first exchange
  const messageCount = db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE session_id = ?'
  ).get(sessionId) as { count: number };

  if (messageCount.count <= 2 && session.title === 'New Chat') {
    // Use first 50 chars of user message as title
    const title = content.length > 50 ? content.substring(0, 50) + '...' : content;
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId);
  }

  // Log usage
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
