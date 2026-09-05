-- Media processing bookkeeping. Forward-only, applied after 002.
-- The lifecycle is expressed via the existing `status` column
-- ('processing' | 'ready' | 'failed'); these columns track diagnostics,
-- completion time, and retry budget.
ALTER TABLE files ADD COLUMN processing_error TEXT;
ALTER TABLE files ADD COLUMN processed_at TEXT;
ALTER TABLE files ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0;

-- Speeds up startup reconciliation of unfinished media jobs.
CREATE INDEX IF NOT EXISTS files_status_idx ON files(status, deleted_at);
