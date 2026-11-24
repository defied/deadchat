-- Screenplay media can also be rip-reel clips, stills and soundtrack ('reel').
-- SQLite can't change a CHECK, so the table is rebuilt with every id kept.
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE screenplay_media_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  screenplay_id INTEGER NOT NULL REFERENCES screenplays(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK(role IN ('frame', 'music', 'character', 'reference', 'reel')),
  target        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'ready', 'failed', 'superseded')),
  hash          TEXT,
  prompt        TEXT,
  caption       TEXT,
  label         TEXT,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  media_id      INTEGER REFERENCES media(id) ON DELETE SET NULL,
  error         TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  block_hash    TEXT
);

INSERT INTO screenplay_media_new (id, screenplay_id, role, target, status, hash, prompt, caption, label, job_id, media_id, error, created_at, block_hash)
SELECT id, screenplay_id, role, target, status, hash, prompt, caption, label, job_id, media_id, error, created_at, block_hash FROM screenplay_media;

DROP TABLE screenplay_media;
ALTER TABLE screenplay_media_new RENAME TO screenplay_media;
CREATE INDEX IF NOT EXISTS ix_screenplay_media ON screenplay_media(screenplay_id, role, target, id);

COMMIT;

PRAGMA foreign_keys = ON;
