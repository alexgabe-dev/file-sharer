import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { buildServer } from '../src/server'
import { openDatabase } from '../src/db/database'
import { migrate } from '../src/db/migrate'

type Overrides = { uploadChunkSizeBytes?: number; maxFilesPerSpace?: number; maxSpaceStorageBytes?: number; maxUploadBytes?: number }

function setup(overrides: Overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'resumable-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const now = new Date().toISOString()
  const spaceId = randomUUID()
  const token = `space-${randomUUID()}`
  db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run(spaceId, token, 'Test', now, now)
  db.close()
  const app = buildServer({ databasePath, storageRoot: root, frontendOrigins: ['https://frontend.example'], uploadChunkSizeBytes: 1024, logLevel: 'silent', authDisabled: true, ...overrides })
  return { app, root, databasePath, token, spaceId }
}

function query<T>(databasePath: string, sql: string, ...params: unknown[]): T[] {
  const db = openDatabase(databasePath)
  try { return db.prepare(sql).all(...params) as T[] } finally { db.close() }
}

async function makePng(_sizeHint?: number) {
  // Generate a valid, incompressible PNG larger than a 1 KiB test chunk so
  // multi-chunk assembly is exercised without committing any binary fixtures.
  const width = 128
  const height = 96
  const raw = randomBytes(width * height * 3)
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

async function initUpload(app: ReturnType<typeof buildServer>, token: string, data: Buffer, name = 'photo.png') {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${token}/uploads/init`,
    headers: { origin: 'https://frontend.example' },
    payload: { name, sizeBytes: data.length, mimeType: 'image/png' },
  })
  assert.equal(response.statusCode, 201)
  return response.json().upload as { publicId: string; chunkSizeBytes: number; totalChunks: number; totalSizeBytes: number; status: string }
}

async function putChunk(app: ReturnType<typeof buildServer>, token: string, uploadId: string, index: number, chunk: Buffer, checksum?: string) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/spaces/${token}/uploads/${uploadId}/chunks/${index}`,
    headers: { 'content-type': 'application/octet-stream', 'x-checksum-sha256': checksum ?? createHash('sha256').update(chunk).digest('hex') },
    payload: chunk,
  })
}

function chunkOf(data: Buffer, index: number, chunkSize: number) {
  return data.subarray(index * chunkSize, Math.min((index + 1) * chunkSize, data.length))
}

test('init creates a session with public metadata', async () => {
  const { app, token } = setup()
  await app.ready()
  const data = await makePng()
  const upload = await initUpload(app, token, data)
  assert.ok(upload.publicId)
  assert.equal(upload.chunkSizeBytes, 1024)
  assert.equal(upload.totalChunks, Math.ceil(data.length / 1024))
  assert.equal(upload.totalSizeBytes, data.length)
  assert.equal(upload.status, 'created')
  await app.close()
})

test('init validates space, size, and quota reservation', async () => {
  const { app, token } = setup({ maxFilesPerSpace: 1 })
  await app.ready()
  const data = await makePng()

  const missing = await app.inject({ method: 'POST', url: '/api/v1/spaces/nope/uploads/init', headers: { origin: 'https://frontend.example' }, payload: { name: 'x', sizeBytes: 100 } })
  assert.equal(missing.statusCode, 404)

  const zero = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/uploads/init`, headers: { origin: 'https://frontend.example' }, payload: { name: 'x', sizeBytes: 0 } })
  assert.equal(zero.statusCode, 400)

  const huge = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/uploads/init`, headers: { origin: 'https://frontend.example' }, payload: { name: 'x', sizeBytes: 2 * 1024 * 1024 * 1024 } })
  assert.equal(huge.statusCode, 413)

  await initUpload(app, token, data)
  const second = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/uploads/init`, headers: { origin: 'https://frontend.example' }, payload: { name: 'y', sizeBytes: 100 } })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error.code, 'QUOTA_FILES')
  await app.close()
})

test('chunk upload is idempotent and validates index, size, checksum, and ownership', async () => {
  const { app, token } = setup()
  await app.ready()
  const data = await makePng()
  const upload = await initUpload(app, token, data)
  const chunk = chunkOf(data, 0, 1024)

  const ok = await putChunk(app, token, upload.publicId, 0, chunk)
  assert.equal(ok.statusCode, 200)

  const dup = await putChunk(app, token, upload.publicId, 0, chunk)
  assert.equal(dup.statusCode, 200)

  const badIndex = await putChunk(app, token, upload.publicId, upload.totalChunks, chunk)
  assert.equal(badIndex.statusCode, 400)

  const wrongSize = await putChunk(app, token, upload.publicId, 1, Buffer.alloc(5, 1))
  assert.equal(wrongSize.statusCode, 400)

  const mismatch = await putChunk(app, token, upload.publicId, 1, chunkOf(data, 1, 1024), '0'.repeat(64))
  assert.equal(mismatch.statusCode, 400)

  const other = setup()
  await other.app.ready()
  const cross = await putChunk(other.app, other.token, upload.publicId, 0, chunk)
  assert.equal(cross.statusCode, 404)
  await app.close()
  await other.app.close()
})

test('status reports received chunks', async () => {
  const { app, token } = setup()
  await app.ready()
  const data = await makePng(2048)
  const upload = await initUpload(app, token, data)
  await putChunk(app, token, upload.publicId, 0, chunkOf(data, 0, 1024))
  await putChunk(app, token, upload.publicId, 1, chunkOf(data, 1, 1024))
  const status = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/uploads/${upload.publicId}` })
  assert.equal(status.statusCode, 200)
  const body = status.json().upload
  assert.equal(body.status, 'uploading')
  assert.equal(body.uploadedBytes, 2048)
  assert.deepEqual(body.receivedChunks, [0, 1])
  await app.close()
})

test('complete rejects incomplete uploads then assembles chunks in order', async () => {
  const { app, token, root } = setup()
  await app.ready()
  const data = await makePng(2560)
  const upload = await initUpload(app, token, data)

  const incomplete = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/uploads/${upload.publicId}/complete`, headers: { origin: 'https://frontend.example' }, payload: {} })
  assert.equal(incomplete.statusCode, 409)
  assert.equal(incomplete.json().error.code, 'UPLOAD_INCOMPLETE')

  // Upload a few chunks out of order, then the rest, then finalize.
  for (const index of [2, 0, 1]) await putChunk(app, token, upload.publicId, index, chunkOf(data, index, 1024))
  for (let index = 3; index < upload.totalChunks; index += 1) await putChunk(app, token, upload.publicId, index, chunkOf(data, index, 1024))

  const complete = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/uploads/${upload.publicId}/complete`, headers: { origin: 'https://frontend.example' }, payload: {} })
  assert.equal(complete.statusCode, 200)
  const file = complete.json().file
  assert.ok(file.id)
  assert.equal(file.sizeBytes, data.length)
  assert.equal('storage_key' in file, false)

  const content = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/files/${file.id}/content` })
  assert.equal(content.statusCode, 200)
  assert.deepEqual(content.rawPayload, data)
  assert.equal(readdirSync(join(root, 'upload-sessions')).length, 0)
  await app.close()
})

test('double finalization is rejected', async () => {
  const { app, token } = setup()
  await app.ready()
  const data = await makePng(2048)
  const upload = await initUpload(app, token, data)
  for (let i = 0; i < upload.totalChunks; i += 1) await putChunk(app, token, upload.publicId, i, chunkOf(data, i, 1024))
  const first = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/uploads/${upload.publicId}/complete`, headers: { origin: 'https://frontend.example' }, payload: {} })
  assert.equal(first.statusCode, 200)
  const second = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/uploads/${upload.publicId}/complete`, headers: { origin: 'https://frontend.example' }, payload: {} })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error.code, 'UPLOAD_INVALID_STATE')
  await app.close()
})

test('cancel removes the session and its chunks', async () => {
  const { app, token, root } = setup()
  await app.ready()
  const data = await makePng(2048)
  const upload = await initUpload(app, token, data)
  await putChunk(app, token, upload.publicId, 0, chunkOf(data, 0, 1024))
  const cancel = await app.inject({ method: 'DELETE', url: `/api/v1/spaces/${token}/uploads/${upload.publicId}` })
  assert.equal(cancel.statusCode, 200)
  const status = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/uploads/${upload.publicId}` })
  assert.equal(status.statusCode, 404)
  assert.equal(readdirSync(join(root, 'upload-sessions')).length, 0)
  await app.close()
})

test('resumable media handoff produces a processed file', async () => {
  const { app, token, databasePath } = setup()
  await app.ready()
  const data = await makePng(2048)
  const upload = await initUpload(app, token, data)
  for (let i = 0; i < upload.totalChunks; i += 1) await putChunk(app, token, upload.publicId, i, chunkOf(data, i, 1024))
  const complete = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/uploads/${upload.publicId}/complete`, headers: { origin: 'https://frontend.example' }, payload: {} })
  assert.equal(complete.statusCode, 200)
  const fileId = complete.json().file.id

  const start = Date.now()
  let status = 'processing'
  while (Date.now() - start < 5000) {
    status = (query<{ status: string }>(databasePath, 'SELECT status FROM files WHERE public_id = ?', fileId)[0] as { status: string }).status
    if (status === 'ready') break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(status, 'ready')
  const file = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/files/${fileId}` })
  assert.equal(file.json().hasThumbnail, true)
  await app.close()
})


