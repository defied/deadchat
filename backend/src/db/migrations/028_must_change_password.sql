-- Set when an admin creates a user or resets their password: the user must
-- choose their own password before using anything else.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
