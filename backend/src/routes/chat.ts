import { Router, Request, Response } from 'express';
import db from '../db/connection';
import { authenticate } from '../middleware/auth';
import { listChatModels, isAllowedChatModel } from '../services/chatModels';
import {
  getBackend,
  getBackendDefaultModel,
  listBackends,
  primaryBackendId,
  runWithBackendUrl,
} from '../services/ollamaBackends';
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

/** Models on one backend, using that backend's default model. */
function modelsOn(backendId: string) {
  const b = getBackend(backendId)!;
  return runWithBackendUrl(b.url, () => listChatModels(getBackendDefaultModel(b.id)));
}

/** Validate a model against a backend; returns an error message or null. */
async function checkModel(backendId: string, model: string): Promise<string | null> {
  const b = getBackend(backendId)!;
  const ok = await runWithBackendUrl(b.url, () => isAllowedChatModel(model));
  return ok ? null : `Model "${model}" is not available on ${b.id}`;
}

/** Parse a `backend` body field: undefined = not given, null = primary, else a known id. */
function parseBackendField(raw: unknown): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw === 'string' && getBackend(raw)) return { ok: true, value: raw };
  return { ok: false, error: `Unknown backend "${String(raw)}"` };
}

// GET /api/chat/backends — Ollama backends a chat can use (no URLs for non-admins).
router.get('/backends', (req: Request, res: Response): void => {
  const isAdmin = req.user!.role === 'admin';
  res.json({
    primary: primaryBackendId(),
    backends: listBackends().map((b) => ({
      id: b.id,
      primary: b.primary,
      available: b.available,
      defaultModel: b.defaultModel,
      ...(isAdmin ? { url: b.url, error: b.error } : {}),
    })),
  });
});

// GET /api/chat/models?backend=<id> — models the user can pick on a backend, with capabilities.
router.get('/models', async (req: Request, res: Response): Promise<void> => {
  const requested = typeof req.query.backend === 'string' ? req.query.backend : '';
  const backendId = getBackend(requested)?.id ?? primaryBackendId();
  res.json({ ...(await modelsOn(backendId)), backend: backendId });
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
// Body: { title?, agentSource?, agentId?, model?, backend? }
router.post('/sessions', async (req: Request, res: Response): Promise<void> => {
  const { title, agentSource, agentId, model } = req.body || {};
  const backendField = parseBackendField(req.body?.backend);
  if (!backendField.ok) {
    res.status(400).json({ error: backendField.error });
    return;
  }
  const sessionBackend = backendField.value ?? null;

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
    const err = await checkModel(sessionBackend ?? primaryBackendId(), model.trim());
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    sessionModel = model.trim();
  }

  const result = db.prepare(
    `INSERT INTO sessions (user_id, title, agent_source, agent_id, agent_name, system_prompt, agent_agentic, model, backend, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    req.user!.id,
    typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'New Chat',
    resolvedSource,
    resolvedId,
    agentName,
    systemPrompt,
    agentAgentic,
    sessionModel,
    sessionBackend,
  );

  const session = db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(result.lastInsertRowid) as Session;

  res.status(201).json({ session });
});

// PATCH /api/chat/sessions/:id — rename, switch backend and/or switch model
// Body: { title?: string, backend?: string | null, model?: string | null }
// (backend null = primary; model null = the backend's default)
router.patch('/sessions/:id', async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params.id as string);
  const existing = getOwnedSession(sessionId, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { title, model } = req.body || {};
  const backendField = parseBackendField(req.body?.backend);
  if (!backendField.ok) {
    res.status(400).json({ error: backendField.error });
    return;
  }
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
    res.status(400).json({ error: 'title must be a non-empty string' });
    return;
  }
  if (model !== undefined && model !== null && model !== '' && typeof model !== 'string') {
    res.status(400).json({ error: 'model must be a string or null' });
    return;
  }

  // Validate everything before writing anything.
  const targetBackend = backendField.value !== undefined ? backendField.value : existing.backend;
  if (typeof model === 'string' && model) {
    const err = await checkModel(targetBackend ?? primaryBackendId(), model);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
  }

  if (title !== undefined) {
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title.trim().slice(0, 120), sessionId);
  }
  if (backendField.value !== undefined) {
    db.prepare('UPDATE sessions SET backend = ? WHERE id = ?').run(backendField.value, sessionId);
  }
  if (model !== undefined) {
    db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(model || null, sessionId);
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
