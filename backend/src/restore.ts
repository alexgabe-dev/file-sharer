import { join, resolve } from 'node:path'
import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { config } from './config'
import { validateConfig } from './config-validation'

function fail(message: string): never { console.error(message); process.exit(1) }

const args = process.argv.slice(2)
const backupPath = args.find((arg) => !arg.startsWith('--'))
const force = args.includes('--force')

if (!backupPath) fail('Usage: npm run backend:restore -- <backup-dir> --force')
if (!force) fail('Restore is destructive; re-run with --force to confirm.')

validateConfig(config)

const backup = resolve(backupPath)
const manifestPath = join(backup, 'manifest.json')
const dbFile = join(backup, 'database.sqlite')
if (!existsSync(manifestPath)) fail('Backup is missing manifest.json')
if (!existsSync(dbFile)) fail('Backup is missing database.sqlite')

let manifest: { migrationVersion?: string | null; appVersion?: string }
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { fail('Backup manifest.json is malformed.') }

const migrationFiles = readdirSync(join(process.cwd(), 'backend/migrations')).filter((name) => name.endsWith('.sql')).sort()
const latestMigration = migrationFiles[migrationFiles.length - 1] ?? null
if (manifest.migrationVersion && latestMigration && manifest.migrationVersion > latestMigration) {
  fail(`Backup schema (${manifest.migrationVersion}) is newer than this code (${latestMigration}); refusing to restore.`)
}

// Replace the database, clearing any WAL/SHM so the restored file wins.
const targetDb = resolve(config.databasePath)
copyFileSync(dbFile, targetDb)
for (const suffix of ['-wal', '-shm']) { try { rmSync(`${targetDb}${suffix}`, { force: true }) } catch { /* ignore */ } }

// Replace objects and thumbnails. upload-sessions and tmp are intentionally not restored.
const storageRoot = resolve(config.storageRoot)
const objectsDest = join(storageRoot, 'objects')
const thumbsDest = join(storageRoot, 'thumbs')
rmSync(objectsDest, { recursive: true, force: true })
rmSync(thumbsDest, { recursive: true, force: true })
if (existsSync(join(backup, 'objects'))) cpSync(join(backup, 'objects'), objectsDest, { recursive: true })
if (existsSync(join(backup, 'thumbs'))) cpSync(join(backup, 'thumbs'), thumbsDest, { recursive: true })

console.log(`Restored from ${backup} (schema ${manifest.migrationVersion ?? 'unknown'})`)
console.log('Next: fix permissions if needed, run backend:reconcile, start the backend, and check /health/ready.')
