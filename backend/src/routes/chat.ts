import { Router, Request, Response } from 'express';
import db from '../db/connection';
import { authenticate } from '../middleware/auth';
import type { Session, Message } from '../types/models';

const router = Router();

// All chat routes require authentication
router.use(authenticate);

// GET /api/chat/sessions
router.get('/sessions', (req: Request, res: Response): void => {
  const sessions = db.prepare(
    'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user!.id) as Session[];

  res.json({ sessions });
});

// POST /api/chat/sessions
router.post('/sessions', (req: Request, res: Response): void => {
  const { title, agentSource, agentId } = req.body || {};

  // Resolve the agent (if specified) and snapshot its name + system_prompt
  // onto the session row. If the agent disappears later, the chat is unaffected.
  let resolvedSource: 'library' | 'user' | null = null;
  let resolvedId: number | null = null;
  let agentName: string | null = null;
  let systemPrompt: string | null = null;

  if (agentSource === 'library' && Number.isInteger(agentId)) {
    const row = db.prepare(
      'SELECT name, system_prompt FROM agent_library WHERE id = ?'
    ).get(agentId) as { name: string; system_prompt: string } | undefined;
    if (row) {
      resolvedSource = 'library';
      resolvedId = agentId;
      agentName = row.name;
      systemPrompt = row.system_prompt;
    }
  } else if (agentSource === 'user' && Number.isInteger(agentId)) {
    const row = db.prepare(
      'SELECT name, system_prompt FROM user_agents WHERE id = ? AND user_id = ?'
    ).get(agentId, req.user!.id) as { name: string; system_prompt: string } | undefined;
    if (row) {
      resolvedSource = 'user';
      resolvedId = agentId;
      agentName = row.name;
      systemPrompt = row.system_prompt;
    }
  }

  const result = db.prepare(
    `INSERT INTO sessions (user_id, title, agent_source, agent_id, agent_name, system_prompt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    req.user!.id,
    title || 'New Chat',
    resolvedSource,
    resolvedId,
    agentName,
    systemPrompt,
  );

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid) as Session;

  res.status(201).json({ session });
});

// GET /api/chat/sessions/:id/messages
router.get('/sessions/:id/messages', (req: Request, res: Response): void => {
  const sessionId = parseInt(req.params.id as string);

  // Verify session belongs to user
  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, req.user!.id) as Session | undefined;

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const messages = db.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as Message[];

  res.json({ messages });
});

// DELETE /api/chat/sessions/:id
router.delete('/sessions/:id', (req: Request, res: Response): void => {
  const sessionId = parseInt(req.params.id as string);

  // Verify session belongs to user
  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, req.user!.id) as Session | undefined;

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

  res.json({ message: 'Session deleted' });
});

export default router;
