import { Router, Request, Response } from 'express';
import db from '../db/connection';
import { authenticate } from '../middleware/auth';
import { listChatModels, isAllowedChatModel } from '../services/chatModels';
import { parseStoredAttachments } from '../services/attachments';
import { isGenerating } from '../ws/chatHandler';
import type { Session, Message } from '../types/models';

const router = Router();

// All chat routes require authentication
router.use(authenticate);

const SESSION_SELECT = `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
  FROM sessions s`;

function getOwnedSession(id: number, userId: number): Session | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, userId) as Session | undefined;
}

// GET /api/chat/models — models the user can pick for a chat, with capabilities.
router.get('/models', async (_req: Request, res: Response): Promise<void> => {
  res.json(await listChatModels());
});

// GET /api/chat/sessions — most recently active first
router.get('/sessions', (req: Request, res: Response): void => {
  const sessions = db.prepare(
    `${SESSION_SELECT}
     WHERE s.user_id = ?
     ORDER BY COALESCE(s.updated_at, s.created_at) DESC, s.id DESC`
  ).all(req.user!.id) as Session[];

  res.json({ sessions });
});

// POST /api/chat/sessions
// Body: { title?, agentSource?, agentId?, model? }
router.post('/sessions', async (req: Request, res: Response): Promise<void> => {
  const { title, agentSource, agentId, model } = req.body || {};

  // Resolve the agent (if specified) and snapshot its name + system_prompt
  // onto the session row. If the agent disappears later, the chat is unaffected.
  let resolvedSource: 'library' | 'user' | null = null;
  let resolvedId: number | null = null;
  let agentName: string | null = null;
  let systemPrompt: string | null = null;
  let agentAgentic = 0;

  if (agentSource === 'library' && Number.isInteger(agentId)) {
    const row = db.prepare(
      'SELECT name, system_prompt, agentic FROM agent_library WHERE id = ?'
    ).get(agentId) as { name: string; system_prompt: string; agentic: number } | undefined;
    if (row) {
      resolvedSource = 'library';
      resolvedId = agentId;
      agentName = row.name;
      systemPrompt = row.system_prompt;
      agentAgentic = row.agentic || 0;
    }
  } else if (agentSource === 'user' && Number.isInteger(agentId)) {
    const row = db.prepare(
      'SELECT name, system_prompt, agentic FROM user_agents WHERE id = ? AND user_id = ?'
    ).get(agentId, req.user!.id) as { name: string; system_prompt: string; agentic: number } | undefined;
    if (row) {
      resolvedSource = 'user';
      resolvedId = agentId;
      agentName = row.name;
      systemPrompt = row.system_prompt;
      agentAgentic = row.agentic || 0;
    }
  }

  let sessionModel: string | null = null;
  if (typeof model === 'string' && model.trim()) {
    if (!(await isAllowedChatModel(model.trim()))) {
      res.status(400).json({ error: `Model "${model}" is not available` });
      return;
    }
    sessionModel = model.trim();
  }

  const result = db.prepare(
    `INSERT INTO sessions (user_id, title, agent_source, agent_id, agent_name, system_prompt, agent_agentic, model, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    req.user!.id,
    typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'New Chat',
    resolvedSource,
    resolvedId,
    agentName,
    systemPrompt,
    agentAgentic,
    sessionModel,
  );

  const session = db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(result.lastInsertRowid) as Session;

  res.status(201).json({ session });
});

// PATCH /api/chat/sessions/:id — rename and/or switch model
// Body: { title?: string, model?: string | null }  (model null = use the default)
router.patch('/sessions/:id', async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params.id as string);
  if (!getOwnedSession(sessionId, req.user!.id)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { title, model } = req.body || {};
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'title must be a non-empty string' });
      return;
    }
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title.trim().slice(0, 120), sessionId);
  }
  if (model !== undefined) {
    if (model === null || model === '') {
      db.prepare('UPDATE sessions SET model = NULL WHERE id = ?').run(sessionId);
    } else if (typeof model === 'string' && (await isAllowedChatModel(model))) {
      db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(model, sessionId);
    } else {
      res.status(400).json({ error: `Model "${model}" is not available` });
      return;
    }
  }

  const session = db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(sessionId) as Session;
  res.json({ session });
});

// GET /api/chat/sessions/:id/messages
router.get('/sessions/:id/messages', (req: Request, res: Response): void => {
  const sessionId = parseInt(req.params.id as string);

  if (!getOwnedSession(sessionId, req.user!.id)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Order by id: created_at only has 1-second resolution, so a fast reply
  // could otherwise sort ahead of the question that produced it.
  const rows = db.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC'
  ).all(sessionId) as Message[];

  const messages = rows.map((m) => ({
    ...m,
    attachments: parseStoredAttachments(m.attachments),
  }));

  // `generating` lets a client that reconnected mid-reply know to poll.
  res.json({ messages, generating: isGenerating(sessionId) });
});

// DELETE /api/chat/sessions/:id
router.delete('/sessions/:id', (req: Request, res: Response): void => {
  const sessionId = parseInt(req.params.id as string);

  if (!getOwnedSession(sessionId, req.user!.id)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

  res.json({ message: 'Session deleted' });
});

export default router;
