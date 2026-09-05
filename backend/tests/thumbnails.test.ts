import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildServer } from '../src/server'
import { openDatabase } from '../src/db/database'
import { migrate } from '../src/db/migrate'
import { FileStorage } from '../src/storage/file-storage'

function setup(hasThumbnail: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'thumb-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const now = new Date().toISOString()
  const spaceId = randomUUID()
  const token = `space-${randomUUID()}`
  db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run(spaceId, token, 'Test', now, now)
  const fileId = randomUUID()
  const storage = new FileStorage(root)
  const storageKey = `objects/${randomUUID()}`
  storage.writeObject(storageKey, Buffer.from('original-bytes'))
  let thumbnailKey: string | null = null
  if (hasThumbnail) {
    thumbnailKey = `thumbs/${randomUUID()}`
    storage.writeObject(thumbnailKey, Buffer.from('webp-poster-bytes'))
  }
  db.prepare('INSERT INTO files (id, public_id, space_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, status, thumbnail_storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), fileId, spaceId, 'pic.png', storageKey, 'image/png', 4, now, 'ready', thumbnailKey)
  db.close()
  const app = buildServer({ databasePath, storageRoot: root, frontendOrigins: ['https://frontend.example'], logLevel: 'silent', authDisabled: true })
  return { app, token, fileId }
}

test('thumbnail endpoint serves a generated poster', async () => {
  const { app, token, fileId } = setup(true)
  await app.ready()
  const response = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/files/${fileId}/thumbnail`, headers: { origin: 'https://frontend.example' } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'image/webp')
  assert.match(response.headers['cache-control'] ?? '', /immutable/)
  assert.equal(response.body, 'webp-poster-bytes')
  await app.close()
})

test('thumbnail endpoint returns 404 when no thumbnail exists', async () => {
  const { app, token, fileId } = setup(false)
  await app.ready()
  const response = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/files/${fileId}/thumbnail` })
  assert.equal(response.statusCode, 404)
  assert.equal(response.json().error.code, 'THUMBNAIL_NOT_FOUND')
  await app.close()
})

test('thumbnail endpoint validates token and ownership', async () => {
  const first = setup(true)
  const second = setup(true)
  await first.app.ready()
  await second.app.ready()

  const badToken = await first.app.inject({ method: 'GET', url: `/api/v1/spaces/nope/files/${first.fileId}/thumbnail` })
  assert.equal(badToken.statusCode, 404)
  assert.equal(badToken.json().error.code, 'SPACE_NOT_FOUND')

  const crossSpace = await second.app.inject({ method: 'GET', url: `/api/v1/spaces/${second.token}/files/${first.fileId}/thumbnail` })
  assert.equal(crossSpace.statusCode, 404)
  assert.equal(crossSpace.json().error.code, 'FILE_NOT_FOUND')

  await first.app.close()
  await second.app.close()
})
