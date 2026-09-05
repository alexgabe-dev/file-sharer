import { join, parse, resolve, sep } from 'node:path'
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { config } from './config'
import { validateConfig } from './config-validation'
import { openDatabase } from './db/database'
import { migrate } from './db/migrate'
import { pruneExpiredBackups } from './ops/backup'

function fileCount(dir: string): number {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).length
}

function totalBytes(dir: string): number {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).reduce((sum, name) => {
    try { return sum + statSync(join(dir, name)).size } catch { return sum }
  }, 0)
}

async function main() {
  validateConfig(config)

  const backupRoot = resolve(config.backupRoot)
  if (backupRoot === parse(backupRoot).root || backupRoot === sep) throw new Error('BACKUP_ROOT must be a dedicated directory')
  mkdirSync(backupRoot, { recursive: true })

  const db = openDatabase(config.databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const latest = db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as { version: string } | undefined

  const timestamp = new Date().toISOString()
  const destDir = join(backupRoot, timestamp.replace(/[:.]/g, '-'))
  mkdirSync(destDir, { recursive: true })

  // Safe online SQLite backup (handles WAL correctly, unlike a raw file copy).
  const dbDest = join(destDir, 'database.sqlite')
  await db.backup(dbDest)

  const storageRoot = resolve(config.storageRoot)
  const objectsDir = join(storageRoot, 'objects')
  const thumbsDir = join(storageRoot, 'thumbs')
  if (existsSync(objectsDir)) cpSync(objectsDir, join(destDir, 'objects'), { recursive: true })
  if (existsSync(thumbsDir)) cpSync(thumbsDir, join(destDir, 'thumbs'), { recursive: true })

  const manifest = {
    timestamp,
    migrationVersion: latest?.version ?? null,
    appVersion: config.appVersion,
    databaseFile: 'database.sqlite',
    objects: { files: fileCount(objectsDir), bytes: totalBytes(objectsDir) },
    thumbs: { files: fileCount(thumbsDir), bytes: totalBytes(thumbsDir) },
  }
  writeFileSync(join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  db.close()

  console.log(`Backup written to ${destDir}`)

  for (const removed of pruneExpiredBackups(backupRoot, config.backupRetentionDays, Date.now(), destDir)) {
    console.log(`Removed expired backup ${removed}`)
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
