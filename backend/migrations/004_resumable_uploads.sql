-- Resumable/chunked upload sessions. Forward-only, applied after 003.
-- No physical filesystem paths are stored; chunk data lives under
-- FILE_STORAGE_ROOT/upload-sessions/<internal-id>/ derived from the internal id.
CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  declared_mime_type TEXT,
  total_size_bytes INTEGER NOT NULL CHECK(total_size_bytes >= 0),
  chunk_size_bytes INTEGER NOT NULL CHECK(chunk_size_bytes > 0),
  total_chunks INTEGER NOT NULL CHECK(total_chunks > 0),
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('created','uploading','assembling','complete','cancelled','expired','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX upload_sessions_space_idx ON upload_sessions(space_id, status);
CREATE INDEX upload_sessions_expires_idx ON upload_sessions(expires_at);

CREATE TABLE upload_chunks (
  upload_session_id TEXT NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum TEXT,
  received_at TEXT NOT NULL,
  PRIMARY KEY (upload_session_id, chunk_index)
);
