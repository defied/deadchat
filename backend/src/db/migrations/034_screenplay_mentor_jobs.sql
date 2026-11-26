-- Shot mentor turns run in the background (the writer can keep working, and
-- a turn waits for the GPU when its model isn't loaded). The writer's page
-- applies a finished turn to the shot and marks it applied.
CREATE TABLE IF NOT EXISTS screenplay_mentor_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  screenplay_id INTEGER NOT NULL REFERENCES screenplays(id) ON DELETE CASCADE,
  shot_id       TEXT NOT NULL,
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'done', 'failed')),
  progress      TEXT NOT NULL DEFAULT '',
  result        TEXT,
  error         TEXT,
  applied       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_mentor_jobs ON screenplay_mentor_jobs(screenplay_id, applied, id);
