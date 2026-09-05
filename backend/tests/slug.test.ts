import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildServer } from '../src/server'
import { openDatabase } from '../src/db/database'
import { migrate } from '../src/db/migrate'
import { backfillSlugs, generateSlug, slugify } from '../src/slug'
import { FileStorage } from '../src/storage/file-storage'

test('slugify normalizes filenames', () => {
  assert.equal(slugify('Balaton 2024.mp4'), 'balaton-2024')
  assert.equal(slugify('  IMG_2841.MOV  '), 'img-2841')
  assert.equal(slugify('café résumé.pdf'), 'cafe-resume')
  assert.equal(slugify('!!@@##'), 'file')
})

test('generateSlug adds entropy and retries on collision', () => {
  const slug = generateSlug('summer trip.mp4', () => false)
  assert.match(slug, /^summer-trip-[a-z0-9]{6}$/)

  let calls = 0
  const first = generateSlug('photo.jpg', () => {
    calls += 1
    return calls === 1 // first candidate collides
  })
  assert.match(first, /^photo-[a-z0-9]{6}$/)
  assert.equal(calls, 2)
})

test('backfillSlugs assigns unique slugs to existing files', () => {
  const root = mkdtempSync(join(tmpdir(), 'slug-'))
  const db = openDatabase(join(root, 'test.db'))
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const now = new Date().toISOString()
  db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run('space-1', 'token-1', 'Test', now, now)
  db.prepare("INSERT INTO files (id, public_id, space_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')")
    .run(randomUUID(), randomUUID(), 'space-1', 'photo.jpg', `objects/${randomUUID()}`, 'image/jpeg', 10, now)
  const count = backfillSlugs(db)
  assert.equal(count, 1)
  const row = db.prepare('SELECT slug FROM files').get() as { slug: string }
  assert.match(row.slug, /^photo-[a-z0-9]{6}$/)
  assert.equal(backfillSlugs(db), 0) // idempotent
  db.close()
})

test('by-slug lookup returns public metadata and honors soft delete', async () => {
  const root = mkdtempSync(join(tmpdir(), 'slug-api-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const now = new Date().toISOString()
  db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run('space-1', 'token-1', 'Test', now, now)
  const storage = new FileStorage(root)
  const fileId = randomUUID()
  const storageKey = `objects/${randomUUID()}`
  storage.writeObject(storageKey, Buffer.from('abc'))
  db.prepare("INSERT INTO files (id, public_id, space_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, status, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)")
    .run(randomUUID(), fileId, 'space-1', 'balaton.mp4', storageKey, 'video/mp4', 3, now, 'balaton-2024-7k3m9x')
  db.close()

  const app = buildServer({ databasePath, storageRoot: root, frontendOrigins: ['https://frontend.example'], logLevel: 'silent', authDisabled: true })
  await app.ready()

  const found = await app.inject({ method: 'GET', url: '/api/v1/files/by-slug/balaton-2024-7k3m9x' })
  assert.equal(found.statusCode, 200)
  const body = found.json()
  assert.equal(body.spaceToken, 'token-1')
  assert.equal(body.file.id, fileId)
  assert.equal(body.file.slug, 'balaton-2024-7k3m9x')
  assert.equal('storage_key' in body.file, false)

  // Soft delete → unavailable.
  const db2 = openDatabase(databasePath)
  db2.prepare('UPDATE files SET deleted_at = ? WHERE public_id = ?').run(new Date().toISOString(), fileId)
  db2.close()
  const missing = await app.inject({ method: 'GET', url: '/api/v1/files/by-slug/balaton-2024-7k3m9x' })
  assert.equal(missing.statusCode, 404)

  await app.close()
})
