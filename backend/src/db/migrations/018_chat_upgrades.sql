-- Chat upgrades:
--   * per-session model override (NULL = use the admin-selected active model)
--   * updated_at on sessions so the sidebar can sort by recent activity
--   * persisted model reasoning ("thinking") for thinking-capable models

ALTER TABLE sessions ADD COLUMN model TEXT;
ALTER TABLE sessions ADD COLUMN updated_at TEXT;
ALTER TABLE messages ADD COLUMN thinking TEXT;

UPDATE sessions
SET updated_at = COALESCE(
  (SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = sessions.id),
  created_at
);

CREATE INDEX IF NOT EXISTS ix_messages_session ON messages(session_id, id);
CREATE INDEX IF NOT EXISTS ix_sessions_user_updated ON sessions(user_id, updated_at);
