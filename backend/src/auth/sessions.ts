import { createHash, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'

export type SessionRow = {
  id: string
  token_hash: string
  created_at: string
  expires_at: string
  last_seen_at: string
  revoked_at: string | null
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

export function createSession(db: Database.Database, tokenHash: string, expiresAt: string, now: string) {
  db.prepare('INSERT INTO access_sessions (id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomBytes(16).toString('hex'), tokenHash, now, expiresAt, now)
}

export function findSessionByHash(db: Database.Database, tokenHash: string): SessionRow | undefined {
  return db.prepare('SELECT id, token_hash, created_at, expires_at, last_seen_at, revoked_at FROM access_sessions WHERE token_hash = ?').get(tokenHash) as SessionRow | undefined
}

export function isSessionValid(row: SessionRow, now: string): boolean {
  return row.revoked_at === null && row.expires_at > now
}

export function revokeSession(db: Database.Database, tokenHash: string, now: string) {
  db.prepare('UPDATE access_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(now, tokenHash)
}

export function touchSession(db: Database.Database, id: string, now: string) {
  db.prepare('UPDATE access_sessions SET last_seen_at = ? WHERE id = ?').run(now, id)
}

export function cleanupSessions(db: Database.Database, now: string) {
  db.prepare('DELETE FROM access_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL').run(now)
}
