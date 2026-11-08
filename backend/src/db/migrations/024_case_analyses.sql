-- Multi-model analysis of a piece of case evidence (see services/cases/analysis.ts).
-- One row per run: the chosen pipeline, the models used, per-stage progress and
-- timing (for estimates), and the results (frame timeline, specialist findings,
-- combined report).

CREATE TABLE IF NOT EXISTS case_analyses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      INTEGER NOT NULL REFERENCES medical_cases(id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES case_items(id) ON DELETE CASCADE,
  pipeline     TEXT NOT NULL,
  frame_model  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'done', 'failed', 'canceled')),
  stages       TEXT NOT NULL DEFAULT '[]',
  results      TEXT NOT NULL DEFAULT '{}',
  error        TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_case_analyses_item ON case_analyses(item_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_case_analyses_status ON case_analyses(status, id);
