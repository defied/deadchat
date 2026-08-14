-- Phase 2: characters with cloned voices, ad-hoc dialogue.
-- Rebuilds jobs/media/providers to widen their CHECK constraints (SQLite has
-- no ALTER TABLE ... ALTER CHECK; the documented workaround is create-new /
-- copy-with-explicit-id / drop-old / rename). jobs.asset_id -> creative_assets.id
-- and creative_assets.latest_job_id -> jobs.id are mutually circular, which is
-- why foreign_keys must be OFF for the whole rebuild rather than done per-table.

-- New tables first (only reference unchanged tables, no FK-off needed).
CREATE TABLE IF NOT EXISTS characters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_characters_user ON characters(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS character_assets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  asset_id     INTEGER NOT NULL REFERENCES creative_assets(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK(role IN ('portrait', 'voice')),
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_character_assets_character ON character_assets(character_id, role, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_character_assets_asset ON character_assets(asset_id);

-- ===== Rebuild jobs / media / providers to widen CHECK constraints =====
-- PRAGMA foreign_keys is a documented no-op if executed inside a transaction -
-- must be toggled OUTSIDE the BEGIN/COMMIT below, not inside it.
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE jobs_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK(type IN ('image', 'video', 'agent', 'tts')),
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
  asset_stage   TEXT
);

-- `id` MUST be listed and copied explicitly - every other table's FK to jobs
-- (media.job_id, creative_assets.latest_job_id, asset_revisions.job_id) is a
-- plain numeric reference; letting AUTOINCREMENT reassign ids here would
-- silently point them all at the wrong (or nonexistent) rows.
INSERT INTO jobs_new (
  id, user_id, type, status, priority, heavy, provider_id, params, progress,
  result, error, attempts, agent_run_id, external_ref, created_at, started_at,
  finished_at, asset_id, asset_stage
)
SELECT
  id, user_id, type, status, priority, heavy, provider_id, params, progress,
  result, error, attempts, agent_run_id, external_ref, created_at, started_at,
  finished_at, asset_id, asset_stage
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;  -- sqlite_sequence follows the table rename

CREATE INDEX IF NOT EXISTS ix_jobs_status   ON jobs(status, priority DESC, id ASC);
CREATE INDEX IF NOT EXISTS ix_jobs_user     ON jobs(user_id);
CREATE INDEX IF NOT EXISTS ix_jobs_agentrun ON jobs(agent_run_id);
CREATE INDEX IF NOT EXISTS ix_jobs_asset    ON jobs(asset_id);

CREATE TABLE media_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK(type IN ('image', 'video', 'audio')),
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

INSERT INTO media_new (
  id, user_id, job_id, type, filename, mime, size_bytes, width, height,
  duration_s, prompt, provider_id, meta, created_at
)
SELECT
  id, user_id, job_id, type, filename, mime, size_bytes, width, height,
  duration_s, prompt, provider_id, meta, created_at
FROM media;

DROP TABLE media;
ALTER TABLE media_new RENAME TO media;

CREATE INDEX IF NOT EXISTS ix_media_user ON media(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_media_job  ON media(job_id);

-- providers: widen BOTH capability and kind (kind gates registry.ts's
-- buildProvider() switch - a local_tts row is useless without this too).
CREATE TABLE providers_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN ('local_comfyui', 'generic_http', 'local_tts')),
  capability  TEXT NOT NULL CHECK(capability IN ('image', 'video', 'tts')),
  enabled     INTEGER NOT NULL DEFAULT 1,
  is_default  INTEGER NOT NULL DEFAULT 0,
  priority    INTEGER NOT NULL DEFAULT 0,
  base_url    TEXT,
  config      TEXT NOT NULL DEFAULT '{}',
  secrets     TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

INSERT INTO providers_new (
  id, name, kind, capability, enabled, is_default, priority, base_url,
  config, secrets, created_at, updated_at
)
SELECT
  id, name, kind, capability, enabled, is_default, priority, base_url,
  config, secrets, created_at, updated_at
FROM providers;

DROP TABLE providers;
ALTER TABLE providers_new RENAME TO providers;

CREATE INDEX IF NOT EXISTS ix_providers_cap ON providers(capability, enabled, priority DESC);

-- NOTE: the default "Local TTS" provider row is seeded from migrate.ts's
-- seedDefaultTtsProvider(), not here. seedDefaultProviders() in migrate.ts
-- only inserts the image/video providers when the WHOLE table is empty - if
-- this migration inserted a providers row directly, that check would see a
-- non-empty table on a truly fresh DB and skip seeding image/video entirely.
-- Keeping seeding in migrate.ts (which runs seedDefaultProviders() first,
-- then the TTS seed after) avoids that ordering collision.

COMMIT;

PRAGMA foreign_keys = ON;
