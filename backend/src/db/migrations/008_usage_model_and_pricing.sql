ALTER TABLE usage ADD COLUMN model TEXT;
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage(model);

CREATE TABLE IF NOT EXISTS model_pricing (
  model TEXT PRIMARY KEY,
  input_per_mtok REAL NOT NULL DEFAULT 0,
  output_per_mtok REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO model_pricing (model, input_per_mtok, output_per_mtok, notes) VALUES
  ('*',                    0.00, 0.00, 'Fallback rate for any model without explicit pricing'),
  ('gpt-4o',               2.50, 10.00, 'OpenAI GPT-4o equivalent pricing (reference)'),
  ('gpt-4o-mini',          0.15,  0.60, 'OpenAI GPT-4o-mini equivalent pricing (reference)'),
  ('claude-sonnet-4-6',    3.00, 15.00, 'Anthropic Sonnet equivalent pricing (reference)'),
  ('claude-haiku-4-5',     1.00,  5.00, 'Anthropic Haiku equivalent pricing (reference)');
