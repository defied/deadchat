-- Which app sections (tabs) a user may use. NULL = all of them (existing users keep access).
-- JSON array of tab ids, e.g. ["chat","cases"]. Admins always have every tab.
ALTER TABLE users ADD COLUMN tabs TEXT;
