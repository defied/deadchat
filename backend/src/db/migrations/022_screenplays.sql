-- Screenplays (see services/screenplay/).
--
-- screenplays        one script per row; `doc` is JSON: elements, shots,
--                    characters, set plans and settings (all written by the user)
-- screenplay_media   everything generated or uploaded for a screenplay: shot
--                    frames, music cues, character reference photos, and the
--                    user's own reference images

CREATE TABLE IF NOT EXISTS screenplays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  doc         TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_screenplays_user ON screenplays(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS screenplay_media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  screenplay_id INTEGER NOT NULL REFERENCES screenplays(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK(role IN ('frame', 'music', 'character', 'reference')),
  -- shot id (frame, music, reference), character id (character), or '' for the whole script
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
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_screenplay_media ON screenplay_media(screenplay_id, role, target, id);

-- ===== Rebuild jobs to allow 'audio' (music) jobs =====
-- Same pattern as 017: foreign_keys must be toggled outside the transaction,
-- and ids are copied explicitly so every reference to a job stays valid.
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE jobs_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK(type IN ('image', 'video', 'agent', 'tts', 'audio')),
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
  finished_at   TEXT,
  asset_id      INTEGER REFERENCES creative_assets(id) ON DELETE SET NULL,
  asset_stage   TEXT,
  stage         TEXT
);

INSERT INTO jobs_new (
  id, user_id, type, status, priority, heavy, provider_id, params, progress,
  result, error, attempts, agent_run_id, external_ref, created_at, started_at,
  finished_at, asset_id, asset_stage, stage
)
SELECT
  id, user_id, type, status, priority, heavy, provider_id, params, progress,
  result, error, attempts, agent_run_id, external_ref, created_at, started_at,
  finished_at, asset_id, asset_stage, stage
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

CREATE INDEX IF NOT EXISTS ix_jobs_status   ON jobs(status, priority DESC, id ASC);
CREATE INDEX IF NOT EXISTS ix_jobs_user     ON jobs(user_id);
CREATE INDEX IF NOT EXISTS ix_jobs_agentrun ON jobs(agent_run_id);
CREATE INDEX IF NOT EXISTS ix_jobs_asset    ON jobs(asset_id);

COMMIT;

PRAGMA foreign_keys = ON;
