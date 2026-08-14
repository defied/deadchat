-- Generic draft->approve creative-asset pipeline. Wraps (does not replace) the
-- existing `jobs` execution engine: each draft/revision/final generation attempt
-- is still one `jobs` row; `creative_assets` tracks the lifecycle of the thing
-- being created (character portrait, scene, 3D asset, shot render, ...).

CREATE TABLE IF NOT EXISTS creative_assets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  asset_type      TEXT NOT NULL,        -- open-ended, app-level validated (not a DB CHECK —
                                         -- this set grows with every future phase)
  name            TEXT,
  stage           TEXT NOT NULL DEFAULT 'draft_queued'
                  CHECK(stage IN ('draft_queued','draft_running','awaiting_review',
                                   'revision_requested','approved','final_queued',
                                   'final_running','final_ready','failed','canceled')),
  quality_tier    TEXT,                 -- e.g. '1024x1024' / '4k' - key into duration_estimates
  params          TEXT NOT NULL DEFAULT '{}',  -- canonical current recipe (JSON)
  draft_media_id  INTEGER REFERENCES media(id) ON DELETE SET NULL,
  final_media_id  INTEGER REFERENCES media(id) ON DELETE SET NULL,
  parent_asset_id INTEGER REFERENCES creative_assets(id) ON DELETE SET NULL,
  latest_job_id   INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  error           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_assets_user       ON creative_assets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_assets_type_stage ON creative_assets(asset_type, stage);

CREATE TABLE IF NOT EXISTS asset_revisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      INTEGER NOT NULL REFERENCES creative_assets(id) ON DELETE CASCADE,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,  -- the resulting re-draft job
  note          TEXT NOT NULL,          -- free-text feedback, e.g. "make the jacket blue"
  params_before TEXT NOT NULL,
  params_after  TEXT,                   -- filled once handler.applyRevision() resolves
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_revisions_asset ON asset_revisions(asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS duration_estimates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_key      TEXT NOT NULL UNIQUE, -- "character_portrait:draft:1024x1024"
  sample_count    INTEGER NOT NULL DEFAULT 0,
  avg_duration_s  REAL,
  last_duration_s REAL,
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- Link jobs back to the asset pipeline. Nullable - existing job types (plain
-- image/video/agent jobs outside the asset pipeline) are completely unaffected.
ALTER TABLE jobs ADD COLUMN asset_id INTEGER REFERENCES creative_assets(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN asset_stage TEXT;  -- 'draft' | 'final'
CREATE INDEX IF NOT EXISTS ix_jobs_asset ON jobs(asset_id);
