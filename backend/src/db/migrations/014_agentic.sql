-- Agentic flag on agents — marks agents that run the plan→tool→observe loop
-- instead of plain chatStream. Snapshotted onto sessions at creation time.

ALTER TABLE agent_library ADD COLUMN agentic INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_agents  ADD COLUMN agentic INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions     ADD COLUMN agent_agentic INTEGER NOT NULL DEFAULT 0;
