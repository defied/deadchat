-- Medical cases shared with other members. viewer: read everything;
-- editor: also change the profile, evidence and analyses. Only the owner
-- (or an admin) deletes the case or changes who it's shared with.
CREATE TABLE IF NOT EXISTS case_shares (
  case_id INTEGER NOT NULL REFERENCES medical_cases(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer', 'editor')),
  shared_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (case_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_case_shares_user ON case_shares(user_id);
