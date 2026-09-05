-- Password-gate access sessions. Only a SHA-256 hash of the session token is
-- stored; the raw token lives solely in the HttpOnly cookie.
CREATE TABLE access_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX access_sessions_expires_idx ON access_sessions(expires_at);
