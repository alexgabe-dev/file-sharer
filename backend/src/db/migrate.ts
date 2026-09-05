import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

export function migrate(db: Database.Database, migrationsDir: string) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => (row as { version: string }).version))
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) if (!applied.has(file)) db.transaction(() => { db.exec(readFileSync(join(migrationsDir, file), 'utf8')); db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString()) })()
}
