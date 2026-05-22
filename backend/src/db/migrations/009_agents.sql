-- Agents feature.
--
-- Two-table model:
--   agent_library  — admin-curated, visible to every authenticated user. Acts as
--                    a starter set; users can clone entries into their own list.
--   user_agents    — user-private. CRUD scoped by user_id.
--
-- A chat session "captures" an agent at creation time: we snapshot the agent
-- name + system_prompt onto the session row so the conversation stays
-- self-consistent even if the source agent is later edited or deleted.
-- The agent_source + agent_id columns remain only as a display/grouping link.

CREATE TABLE IF NOT EXISTS agent_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL,
  source_library_id INTEGER REFERENCES agent_library(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Snapshot columns on sessions. NULLs mean "no agent" (plain chat).
ALTER TABLE sessions ADD COLUMN agent_source TEXT
  CHECK(agent_source IN ('library', 'user') OR agent_source IS NULL);
ALTER TABLE sessions ADD COLUMN agent_id INTEGER;
ALTER TABLE sessions ADD COLUMN agent_name TEXT;
ALTER TABLE sessions ADD COLUMN system_prompt TEXT;

CREATE INDEX IF NOT EXISTS ix_user_agents_user ON user_agents(user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_agent ON sessions(agent_source, agent_id);
