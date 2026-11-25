-- Shot finder: photo searches for a shot's frame. Each run proposes ten
-- candidates; "find more" runs the next page and adds ten more.
CREATE TABLE IF NOT EXISTS screenplay_shot_finds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  screenplay_id INTEGER NOT NULL REFERENCES screenplays(id) ON DELETE CASCADE,
  shot_id       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'planning', 'searching', 'done', 'failed')),
  progress      TEXT NOT NULL DEFAULT '',
  -- what the search was for: {"look": "...", "queries": [...], "notes": [...]}
  plan          TEXT NOT NULL DEFAULT '{}',
  candidates    TEXT NOT NULL DEFAULT '[]',
  page          INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_shot_finds ON screenplay_shot_finds(screenplay_id, shot_id, id DESC);
