CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE shared_spaces (id TEXT PRIMARY KEY, public_token TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE folders (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(space_id, name));
CREATE TABLE files (id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, original_name TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0), uploaded_at TEXT NOT NULL, uploader_name TEXT, status TEXT NOT NULL CHECK(status IN ('ready','processing','failed')), width INTEGER, height INTEGER, duration_seconds REAL, thumbnail_storage_key TEXT, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS files_space_active_idx ON files(space_id, deleted_at, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS files_folder_idx ON files(folder_id, deleted_at);
CREATE INDEX IF NOT EXISTS files_space_public_idx ON files(space_id, public_id);
