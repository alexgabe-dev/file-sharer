-- Add a public identifier to folders so internal primary keys are never
-- exposed to or accepted from the browser. Forward-only, applied after 001.
ALTER TABLE folders ADD COLUMN public_id TEXT;

-- Backfill any existing folders with an opaque public id.
UPDATE folders SET public_id = lower(hex(randomblob(16))) WHERE public_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS folders_public_id_idx ON folders(public_id);
