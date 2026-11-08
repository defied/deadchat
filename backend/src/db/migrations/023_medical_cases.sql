-- Medical case presentations (see services/cases/).
--
-- medical_cases   one case: an optional profile (JSON, de-identified by the
--                 user), a presentation summary, and the order of evidence
-- case_items      every piece of evidence: DICOM (single images, cine loops,
--                 slice stacks), photos, videos, documents and data files

CREATE TABLE IF NOT EXISTS medical_cases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  profile         TEXT NOT NULL DEFAULT '{}',
  summary         TEXT,
  summary_source  TEXT CHECK(summary_source IN ('ai', 'user')),
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_medical_cases_user ON medical_cases(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS case_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id        INTEGER NOT NULL REFERENCES medical_cases(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK(kind IN ('dicom', 'image', 'video', 'document', 'data', 'other')),
  category       TEXT NOT NULL DEFAULT 'other',
  title          TEXT NOT NULL,
  notes          TEXT,
  taken_at       TEXT,
  original_name  TEXT,
  mime           TEXT,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  meta           TEXT NOT NULL DEFAULT '{}',
  frames         INTEGER NOT NULL DEFAULT 0,
  series_uid     TEXT,
  status         TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing', 'ready', 'failed')),
  pending        INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  ai_notes       TEXT,
  ai_status      TEXT CHECK(ai_status IN ('running', 'done', 'failed')),
  ai_error       TEXT,
  mask_top       REAL NOT NULL DEFAULT 0,
  include        INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_case_items ON case_items(case_id, sort, id);
CREATE INDEX IF NOT EXISTS ix_case_items_series ON case_items(case_id, series_uid);
