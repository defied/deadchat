CREATE TABLE IF NOT EXISTS media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK(type IN ('image', 'video')),
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  duration_s  REAL,
  prompt      TEXT,
  provider_id INTEGER,
  meta        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_media_user ON media(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_media_job  ON media(job_id);
