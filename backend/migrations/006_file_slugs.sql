-- Permanent public-safe file slugs for canonical /f/:slug URLs.
-- Nullable column + unique index so the slug can be backfilled by application
-- logic; slugs never expose internal IDs and are immutable once set.
ALTER TABLE files ADD COLUMN slug TEXT;

CREATE UNIQUE INDEX files_slug_idx ON files(slug);
