-- The script text of a shot's block when its frame was queued. A frame re-renders
-- by itself only when this changes; other changes wait for the writer's refresh.
ALTER TABLE screenplay_media ADD COLUMN block_hash TEXT;
