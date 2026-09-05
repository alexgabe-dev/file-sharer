import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildServer } from '../src/server'
import { openDatabase } from '../src/db/database'
import { migrate } from '../src/db/migrate'
import { redactUrl } from '../src/ops/redact'
import { hasSufficientSpace } from '../src/ops/disk'
import { pruneExpiredBackups } from '../src/ops/backup'
import { validateConfig } from '../src/config-validation'
import { config } from '../src/config'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ops-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  db.close()
  const app = buildServer({ databasePath, storageRoot: root, frontendOrigins: ['https://frontend.example'], logLevel: 'silent', authDisabled: true })
  return { app, root, databasePath }
}

test('redactUrl removes share tokens from paths', () => {
  assert.equal(redactUrl('/api/v1/spaces/secret-token/files'), '/api/v1/spaces/[redacted]/files')
  assert.equal(redactUrl('/health/live'), '/health/live')
  assert.equal(redactUrl('/api/v1/spaces/a/uploads/b/chunks/0'), '/api/v1/spaces/[redacted]/uploads/b/chunks/0')
})

test('hasSufficientSpace enforces a safety reserve', () => {
  assert.equal(hasSufficientSpace(1000, 100, 500), true)   // 1000 - 100 = 900 >= 500
  assert.equal(hasSufficientSpace(1000, 900, 500), false)  // 1000 - 900 = 100 < 500
  assert.equal(hasSufficientSpace(Number.POSITIVE_INFINITY, 999999, 1), true)
})

test('validateConfig rejects unsafe storage roots', () => {
  assert.throws(() => validateConfig({ ...config, storageRoot: '/' }), /dedicated directory/)
  assert.throws(() => validateConfig({ ...config, port: 0 }), /PORT/)
  assert.throws(() => validateConfig({ ...config, frontendOrigins: [] }), /FRONTEND_ORIGIN/)
  assert.doesNotThrow(() => validateConfig(config))
})

test('health endpoints report liveness and readiness', async () => {
  const { app } = setup()
  await app.ready()
  const live = await app.inject({ method: 'GET', url: '/health/live' })
  assert.equal(live.statusCode, 200)
  assert.equal(live.json().status, 'ok')

  const ready = await app.inject({ method: 'GET', url: '/health/ready' })
  assert.equal(ready.statusCode, 200)
  assert.equal(ready.json().status, 'ready')
  await app.close()
})

test('CORS allows exact origin and rejects unknown origins', async () => {
  const { app } = setup()
  await app.ready()
  const allowed = await app.inject({ method: 'GET', url: '/health/live', headers: { origin: 'https://frontend.example' } })
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://frontend.example')

  const denied = await app.inject({ method: 'GET', url: '/health/live', headers: { origin: 'https://evil.example' } })
  assert.equal(denied.headers['access-control-allow-origin'], undefined)
  await app.close()
})

test('online backup produces a valid database copy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'backup-'))
  const databasePath = join(root, 'live.sqlite')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const now = new Date().toISOString()
  db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run(randomUUID(), 'backup-token', 'Backup Space', now, now)

  const backupDir = join(root, 'backups', 'run')
  mkdirSync(backupDir, { recursive: true })
  const backupDb = join(backupDir, 'database.sqlite')
  await db.backup(backupDb)
  db.close()

  const copy = openDatabase(backupDb)
  const row = copy.prepare('SELECT public_token FROM shared_spaces WHERE public_token = ?').get('backup-token') as { public_token: string } | undefined
  assert.ok(row)
  copy.close()
})

test('pruneExpiredBackups only removes old dirs inside the backup root', () => {
  const root = mkdtempSync(join(tmpdir(), 'prune-'))
  const backupRoot = join(root, 'backups')
  mkdirSync(backupRoot, { recursive: true })
  const old = join(backupRoot, 'old-run')
  const fresh = join(backupRoot, 'fresh-run')
  mkdirSync(old); mkdirSync(fresh)
  const epoch = new Date(0)
  utimesSync(old, epoch, epoch)

  const sentinel = join(root, 'sentinel.txt')
  writeFileSync(sentinel, 'do-not-touch')

  const removed = pruneExpiredBackups(backupRoot, 7, Date.now(), fresh)
  assert.deepEqual(removed, [old])
  assert.equal(existsSync(old), false)
  assert.equal(existsSync(fresh), true)
  assert.equal(existsSync(sentinel), true)
})
