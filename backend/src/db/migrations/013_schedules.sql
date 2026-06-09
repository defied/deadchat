CREATE TABLE IF NOT EXISTS schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  cron        TEXT NOT NULL,
  agent_source TEXT,
  agent_id    INTEGER,
  goal        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_schedules_user    ON schedules(user_id);
CREATE INDEX IF NOT EXISTS ix_schedules_enabled ON schedules(enabled);
