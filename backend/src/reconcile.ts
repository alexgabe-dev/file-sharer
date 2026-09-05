import { join } from 'node:path'
import { config } from './config'
import { openDatabase } from './db/database'
import { migrate } from './db/migrate'
import { FileStorage } from './storage/file-storage'

const repair = process.argv.includes('--repair')
const db = openDatabase(config.databasePath)
migrate(db, join(process.cwd(), 'backend/migrations'))
const storage = new FileStorage(config.storageRoot)

type Row = { public_id: string; original_name: string; storage_key: string; thumbnail_storage_key: string | null; mime_type: string; status: string; processing_attempts: number }

const rows = db.prepare('SELECT public_id, original_name, storage_key, thumbnail_storage_key, mime_type, status, processing_attempts FROM files').all() as Row[]
const objectKeys = new Set(storage.listKeys('objects'))
const thumbKeys = new Set(storage.listKeys('thumbs'))
const referencedThumbs = new Set(rows.filter((row) => row.thumbnail_storage_key).map((row) => row.thumbnail_storage_key))

const report = (line: string) => console.log(line)

// 1. DB rows whose original binary is missing.
for (const row of rows) {
  if (!objectKeys.has(row.storage_key)) report(`[missing original] file ${row.public_id} (${row.original_name})`)
}

// 1b. Orphan object binaries (no DB row references them).
const referencedObjects = new Set(rows.map((row) => row.storage_key))
for (const key of objectKeys) {
  if (!referencedObjects.has(key)) {
    report(`[orphan object] ${key}`)
    if (repair) { storage.remove(key); report(`  removed ${key}`) }
  }
}

// 2. DB rows whose thumbnail key points at a missing file.
for (const row of rows) {
  if (row.thumbnail_storage_key && !thumbKeys.has(row.thumbnail_storage_key)) {
    report(`[dangling thumbnail] file ${row.public_id} key=${row.thumbnail_storage_key}`)
    if (repair) {
      db.prepare("UPDATE files SET thumbnail_storage_key = NULL, width = NULL, height = NULL, duration_seconds = NULL, status = 'processing', processing_attempts = 0 WHERE public_id = ?").run(row.public_id)
      report(`  repaired: queued ${row.public_id} for re-processing on next startup`)
    }
  }
}

// 3. Orphan thumbnails (no DB row references them).
for (const key of thumbKeys) {
  if (!referencedThumbs.has(key)) {
    report(`[orphan thumbnail] ${key}`)
    if (repair) { storage.remove(key); report(`  removed ${key}`) }
  }
}

// 4. Stale temporary files.
const staleTemps = storage.listStaleTemps(config.tempFileMaxAgeMs)
for (const name of staleTemps) report(`[stale temp] ${name}`)
if (repair && staleTemps.length > 0) { storage.cleanupStaleTemps(config.tempFileMaxAgeMs, new Set()); report(`  removed ${staleTemps.length} stale temp file(s)`) }

// 5. Stuck or failed-but-retryable processing jobs.
for (const row of rows) {
  if (row.status === 'processing') report(`[stuck processing] file ${row.public_id} (${row.original_name}) — requeued automatically on next startup`)
  if (row.status === 'failed' && row.processing_attempts < config.processingMaxAttempts) report(`[failed (retryable)] file ${row.public_id} (${row.original_name})`)
}

// 6. Ready media files missing a thumbnail (e.g. uploaded before Phase 4).
for (const row of rows) {
  if (row.status === 'ready' && !row.thumbnail_storage_key && (row.mime_type.startsWith('image/') || row.mime_type.startsWith('video/'))) {
    report(`[media without thumbnail] file ${row.public_id} (${row.original_name})`)
    if (repair) {
      db.prepare("UPDATE files SET status = 'processing', processing_attempts = 0 WHERE public_id = ?").run(row.public_id)
      report(`  repaired: queued ${row.public_id} for thumbnail generation on next startup`)
    }
  }
}

// 7. Resumable upload sessions.
const sessionIds = new Set((db.prepare('SELECT id FROM upload_sessions').all() as Array<{ id: string }>).map((row) => row.id))
for (const dir of storage.listKeys('upload-sessions')) {
  const id = dir.slice('upload-sessions/'.length)
  if (!sessionIds.has(id)) {
    report(`[orphan upload session dir] ${id}`)
    if (repair) { storage.removeSessionDir(id); report(`  removed ${id}`) }
  }
}
const expiredSessions = db.prepare("SELECT id, public_id FROM upload_sessions WHERE status IN ('created', 'uploading', 'assembling') AND expires_at < ?").all(new Date().toISOString()) as Array<{ id: string; public_id: string }>
for (const session of expiredSessions) {
  report(`[expired upload session] ${session.public_id}`)
  if (repair) {
    storage.removeSessionDir(session.id)
    db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(session.id)
    report(`  removed ${session.public_id}`)
  }
}

// 8. Expired/revoked access sessions.
const deadAccess = db.prepare('SELECT COUNT(*) AS n FROM access_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL').get(new Date().toISOString()) as { n: number }
if (deadAccess.n > 0) {
  report(`[expired/revoked access sessions] ${deadAccess.n}`)
  if (repair) {
    db.prepare('DELETE FROM access_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL').run(new Date().toISOString())
    report(`  removed ${deadAccess.n} session(s)`)
  }
}

console.log(`Reconciliation complete${repair ? ' (--repair applied safe fixes)' : ''}. Run with --repair to apply safe repairs.`)
db.close()
