CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK(type IN ('image', 'video', 'agent')),
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  priority      INTEGER NOT NULL DEFAULT 0,
  heavy         INTEGER NOT NULL DEFAULT 1,
  provider_id   INTEGER,
  params        TEXT NOT NULL DEFAULT '{}',
  progress      REAL NOT NULL DEFAULT 0,
  result        TEXT,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  agent_run_id  INTEGER,
  external_ref  TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  started_at    TEXT,
  finished_at   TEXT
);

CREATE INDEX IF NOT EXISTS ix_jobs_status   ON jobs(status, priority DESC, id ASC);
CREATE INDEX IF NOT EXISTS ix_jobs_user     ON jobs(user_id);
CREATE INDEX IF NOT EXISTS ix_jobs_agentrun ON jobs(agent_run_id);
