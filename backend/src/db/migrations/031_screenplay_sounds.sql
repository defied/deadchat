-- Sounds gathered from free libraries ('sound' role, with source and
-- licence details in meta), and the gathering runs that find them.
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE screenplay_media_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  screenplay_id INTEGER NOT NULL REFERENCES screenplays(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK(role IN ('frame', 'music', 'character', 'reference', 'reel', 'sound')),
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
  block_hash    TEXT,
  meta          TEXT
);

INSERT INTO screenplay_media_new (id, screenplay_id, role, target, status, hash, prompt, caption, label, job_id, media_id, error, created_at, block_hash)
SELECT id, screenplay_id, role, target, status, hash, prompt, caption, label, job_id, media_id, error, created_at, block_hash FROM screenplay_media;

DROP TABLE screenplay_media;
ALTER TABLE screenplay_media_new RENAME TO screenplay_media;
CREATE INDEX IF NOT EXISTS ix_screenplay_media ON screenplay_media(screenplay_id, role, target, id);

CREATE TABLE IF NOT EXISTS screenplay_sound_hunts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  screenplay_id INTEGER NOT NULL REFERENCES screenplays(id) ON DELETE CASCADE,
  -- shot id, scene heading id, or '' for free text / the whole script
  scope         TEXT NOT NULL DEFAULT '',
  request       TEXT NOT NULL DEFAULT '',
  options       TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'planning', 'searching', 'done', 'failed')),
  progress      TEXT NOT NULL DEFAULT '',
  wants         TEXT NOT NULL DEFAULT '[]',
  error         TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_sound_hunts ON screenplay_sound_hunts(screenplay_id, id DESC);

COMMIT;

PRAGMA foreign_keys = ON;
