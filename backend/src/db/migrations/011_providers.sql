CREATE TABLE IF NOT EXISTS providers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN ('local_comfyui', 'generic_http')),
  capability  TEXT NOT NULL CHECK(capability IN ('image', 'video')),
  enabled     INTEGER NOT NULL DEFAULT 1,
  is_default  INTEGER NOT NULL DEFAULT 0,
  priority    INTEGER NOT NULL DEFAULT 0,
  base_url    TEXT,
  config      TEXT NOT NULL DEFAULT '{}',
  secrets     TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_providers_cap ON providers(capability, enabled, priority DESC);
