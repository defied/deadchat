-- Human-readable step of a running job (e.g. "Enhancing prompt", "Checking result 2/3").
ALTER TABLE jobs ADD COLUMN stage TEXT;
