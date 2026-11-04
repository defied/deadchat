-- Per-chat Ollama backend (see services/ollamaBackends.ts).
-- NULL = the primary backend.
ALTER TABLE sessions ADD COLUMN backend TEXT;
