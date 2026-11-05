-- Social Media: AI influencer projects (see services/influencers/).
--
-- influencers         one project per persona; JSON columns hold the wizard state
-- influencer_media    look candidates, portfolio images and clips (via the job queue)
-- influencer_accounts per-platform connection (credentials encrypted with SECRETS_KEY)
-- influencer_posts    generated posts and their review / fact-check / publish trail

CREATE TABLE IF NOT EXISTS influencers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN ('visual', 'text')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'paused')),
  step        TEXT NOT NULL DEFAULT 'rules',
  persona     TEXT NOT NULL DEFAULT '{}',
  look        TEXT NOT NULL DEFAULT '{}',
  research    TEXT NOT NULL DEFAULT '{}',
  plan        TEXT NOT NULL DEFAULT '{}',
  attestation TEXT NOT NULL DEFAULT '{}',
  last_post_at TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_influencers_user ON influencers(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS influencer_media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK(role IN ('look', 'portfolio', 'clip', 'post')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'ready', 'approved', 'rejected', 'failed')),
  job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  media_id      INTEGER REFERENCES media(id) ON DELETE SET NULL,
  prompt        TEXT,
  scene         TEXT,
  error         TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_influencer_media ON influencer_media(influencer_id, role, id);

CREATE TABLE IF NOT EXISTS influencer_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  handle        TEXT,
  credentials   TEXT,
  checklist     TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'connected', 'manual', 'error')),
  last_error    TEXT,
  updated_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(influencer_id, platform)
);

CREATE TABLE IF NOT EXISTS influencer_posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'review'
                  CHECK(status IN ('review', 'approved', 'publishing', 'published', 'rejected', 'blocked', 'failed')),
  origin        TEXT NOT NULL DEFAULT 'auto' CHECK(origin IN ('auto', 'manual')),
  topic         TEXT,
  topic_key     TEXT,
  text          TEXT NOT NULL DEFAULT '',
  media_ids     TEXT NOT NULL DEFAULT '[]',
  sources       TEXT NOT NULL DEFAULT '[]',
  fact_check    TEXT,
  compliance    TEXT,
  checked_text  TEXT,
  scheduled_for TEXT,
  results       TEXT NOT NULL DEFAULT '{}',
  error         TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_influencer_posts ON influencer_posts(influencer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_influencer_posts_status ON influencer_posts(status, scheduled_for);
