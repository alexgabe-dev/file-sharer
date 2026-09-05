import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Open the SQLite database with deliberate production settings.
 * - WAL: better read/write concurrency for gallery reads + upload/processing writes.
 * - busy_timeout: wait briefly instead of failing immediately under contention.
 * - synchronous=NORMAL: safe with WAL (the WAL is fsync'd on commit) while
 *   avoiding a full database sync on every commit. Use FULL if you need
 *   maximum durability at the cost of throughput.
 * - foreign_keys: enforced for referential integrity.
 */
export function openDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('synchronous = NORMAL')
  return db
}
