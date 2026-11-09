-- Image prompts rewritten by the LLM to apply a shot's adjustment notes, keyed
-- by hash(base prompt, notes), so the same notes never cost a second rewrite.
CREATE TABLE IF NOT EXISTS screenplay_prompt_cache (
  key TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'llm' CHECK(source IN ('llm', 'fallback')),
  model TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
