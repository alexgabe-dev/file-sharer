import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { buildServer } from '../src/server'
import { openDatabase } from '../src/db/database'
import { migrate } from '../src/db/migrate'
import { FileStorage } from '../src/storage/file-storage'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])

async function makePng(width = 64, height = 32) {
  return sharp({ create: { width, height, channels: 3, background: { r: 180, g: 120, b: 60 } } }).png().toBuffer()
}

async function waitForStatus(databasePath: string, publicId: string, status: string, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const row = query<{ status: string }>(databasePath, 'SELECT status FROM files WHERE public_id = ?', publicId)[0]
    if (row?.status === status) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for file to reach status ${status}`)
}

type SetupOptions = { maxUploadBytes?: number; maxFilesPerSpace?: number; maxSpaceStorageBytes?: number }

function setup(options: SetupOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shared-files-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const now = new Date().toISOString()
  const spaceId = randomUUID()
  const token = `space-${randomUUID()}`
  db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run(spaceId, token, 'Test Space', now, now)
  db.close()
  const app = buildServer({ databasePath, storageRoot: root, frontendOrigins: ['https://frontend.example'], logLevel: 'silent', authDisabled: true, ...options })
  return { app, root, databasePath, spaceId, token }
}

function query<T>(databasePath: string, sql: string, ...params: unknown[]): T[] {
  const db = openDatabase(databasePath)
  try { return db.prepare(sql).all(...params) as T[] } finally { db.close() }
}

function tmpFiles(root: string) {
  try { return readdirSync(join(root, 'tmp')) } catch { return [] }
}

function multipart(fields: Array<{ name: string; value: string }>, file: { field: string; filename: string; mimetype: string; data: Buffer }) {
  const boundary = `----boundary${randomUUID().replace(/-/g, '')}`
  const chunks: Buffer[] = []
  for (const field of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`))
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.mimetype}\r\n\r\n`))
  chunks.push(file.data)
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function upload(app: Awaited<ReturnType<typeof buildServer>>, token: string, file: { filename: string; mimetype: string; data: Buffer }, fields: Array<{ name: string; value: string }> = []) {
  const body = multipart(fields, { field: 'file', ...file })
  return app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/files`, headers: { 'content-type': body.contentType, origin: 'https://frontend.example' }, payload: body.payload })
}

test('successful upload persists immediately then processes to ready with a thumbnail', async () => {
  const { app, token, databasePath, root } = setup()
  await app.ready()
  const png = await makePng(64, 32)
  const response = await upload(app, token, { filename: 'photo.png', mimetype: 'image/png', data: png })
  assert.equal(response.statusCode, 201)
  const body = response.json()
  assert.ok(body.file.id)
  assert.equal(body.file.name, 'photo.png')
  assert.equal(body.file.mimeType, 'image/png')
  assert.equal(body.file.status, 'processing')
  assert.equal(body.file.folderId, null)
  assert.equal('storage_key' in body.file, false)
  assert.equal('space_id' in body.file, false)

  const rows = query<{ storage_key: string; deleted_at: string | null }>(databasePath, 'SELECT storage_key, deleted_at FROM files')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].deleted_at, null)
  assert.ok(rows[0].storage_key.startsWith('objects/'))
  assert.ok(!rows[0].storage_key.includes('photo.png'))

  await waitForStatus(databasePath, body.file.id, 'ready')

  const ready = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/files/${body.file.id}` })
  assert.equal(ready.statusCode, 200)
  const readyBody = ready.json()
  assert.equal(readyBody.status, 'ready')
  assert.equal(readyBody.hasThumbnail, true)
  assert.equal(readyBody.width, 64)
  assert.equal(readyBody.height, 32)

  const thumbs = readdirSync(join(root, 'thumbs'))
  assert.equal(thumbs.length, 1)
  await app.close()
})

test('duplicate filenames are stored independently', async () => {
  const { app, token } = setup()
  await app.ready()
  const first = await upload(app, token, { filename: 'dup.jpg', mimetype: 'image/jpeg', data: JPEG })
  const second = await upload(app, token, { filename: 'dup.jpg', mimetype: 'image/jpeg', data: JPEG })
  assert.equal(first.statusCode, 201)
  assert.equal(second.statusCode, 201)
  assert.notEqual(first.json().file.id, second.json().file.id)
  await app.close()
})

test('oversized upload is rejected and leaves no temp files or DB rows', async () => {
  const { app, token, databasePath, root } = setup({ maxUploadBytes: 64 })
  await app.ready()
  const big = Buffer.concat([JPEG, Buffer.alloc(256, 1)])
  const response = await upload(app, token, { filename: 'big.jpg', mimetype: 'image/jpeg', data: big })
  assert.equal(response.statusCode, 413)
  assert.equal(response.json().error.code, 'FILE_TOO_LARGE')
  assert.deepEqual(tmpFiles(root), [])
  assert.equal((query(databasePath, 'SELECT COUNT(*) AS n FROM files')[0] as { n: number }).n, 0)
  await app.close()
})

test('invalid space, folder, and file type return typed errors', async () => {
  const { app, token } = setup()
  await app.ready()

  const missing = await upload(app, 'nope', { filename: 'x.jpg', mimetype: 'image/jpeg', data: JPEG })
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.json().error.code, 'SPACE_NOT_FOUND')

  const badFolder = await upload(app, token, { filename: 'x.jpg', mimetype: 'image/jpeg', data: JPEG }, [{ name: 'folderId', value: 'missing-folder' }])
  assert.equal(badFolder.statusCode, 400)
  assert.equal(badFolder.json().error.code, 'INVALID_FOLDER')

  const badType = await upload(app, token, { filename: 'x.bin', mimetype: 'application/octet-stream', data: Buffer.from('hello world') })
  assert.equal(badType.statusCode, 400)
  assert.equal(badType.json().error.code, 'INVALID_FILE_TYPE')

  const empty = await upload(app, token, { filename: 'empty.jpg', mimetype: 'image/jpeg', data: Buffer.alloc(0) })
  assert.equal(empty.statusCode, 400)
  assert.equal(empty.json().error.code, 'FILE_EMPTY')

  const notFound = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/files/nope` })
  assert.equal(notFound.statusCode, 404)
  assert.deepEqual(notFound.json().error.code, 'FILE_NOT_FOUND')
  await app.close()
})

test('file-count quota is enforced', async () => {
  const { app, token } = setup({ maxFilesPerSpace: 1 })
  await app.ready()
  const first = await upload(app, token, { filename: 'one.jpg', mimetype: 'image/jpeg', data: JPEG })
  assert.equal(first.statusCode, 201)
  const second = await upload(app, token, { filename: 'two.jpg', mimetype: 'image/jpeg', data: JPEG })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error.code, 'QUOTA_FILES')
  await app.close()
})

test('storage quota is enforced', async () => {
  const { app, token } = setup({ maxSpaceStorageBytes: 20 })
  await app.ready()
  const first = await upload(app, token, { filename: 'one.jpg', mimetype: 'image/jpeg', data: JPEG })
  assert.equal(first.statusCode, 201)
  const second = await upload(app, token, { filename: 'two.jpg', mimetype: 'image/jpeg', data: JPEG })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error.code, 'QUOTA_STORAGE')
  await app.close()
})

test('folder create returns a public id and rejects duplicates', async () => {
  const { app, token } = setup()
  await app.ready()
  const created = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/folders`, headers: { origin: 'https://frontend.example' }, payload: { name: 'Projects' } })
  assert.equal(created.statusCode, 201)
  const folder = created.json().folder
  assert.ok(folder.id)
  assert.equal(folder.name, 'Projects')

  const duplicate = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/folders`, headers: { origin: 'https://frontend.example' }, payload: { name: 'Projects' } })
  assert.equal(duplicate.statusCode, 409)
  assert.equal(duplicate.json().error.code, 'FOLDER_EXISTS')

  const list = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/folders` })
  assert.equal(list.json().length, 1)
  assert.equal(list.json()[0].id, folder.id)
  await app.close()
})

test('soft delete, restore, and permanent delete lifecycle removes thumbnail on permanent delete', async () => {
  const { app, token, databasePath, root } = setup()
  await app.ready()
  const png = await makePng(48, 48)
  const uploaded = await upload(app, token, { filename: 'life.png', mimetype: 'image/png', data: png })
  const fileId = uploaded.json().file.id
  await waitForStatus(databasePath, fileId, 'ready')
  assert.equal(readdirSync(join(root, 'thumbs')).length, 1)

  const trash = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/trash`, headers: { origin: 'https://frontend.example' }, payload: { ids: [fileId] } })
  assert.equal(trash.statusCode, 200)
  assert.equal(trash.json().files.length, 1)
  assert.equal((query(databasePath, 'SELECT deleted_at FROM files WHERE public_id = ?', fileId)[0] as { deleted_at: string | null }).deleted_at !== null, true)
  assert.ok(readdirSync(join(root, 'objects')).length >= 1)
  assert.equal(readdirSync(join(root, 'thumbs')).length, 1)

  const trashList = await app.inject({ method: 'GET', url: `/api/v1/spaces/${token}/trash` })
  assert.equal(trashList.json().length, 1)

  const restore = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/restore`, headers: { origin: 'https://frontend.example' }, payload: { ids: [fileId] } })
  assert.equal(restore.statusCode, 200)
  assert.equal((query(databasePath, 'SELECT deleted_at FROM files WHERE public_id = ?', fileId)[0] as { deleted_at: string | null }).deleted_at, null)

  const trashAgain = await app.inject({ method: 'POST', url: `/api/v1/spaces/${token}/trash`, headers: { origin: 'https://frontend.example' }, payload: { ids: [fileId] } })
  assert.equal(trashAgain.statusCode, 200)

  const permanent = await app.inject({ method: 'DELETE', url: `/api/v1/spaces/${token}/trash`, headers: { origin: 'https://frontend.example' }, payload: { ids: [fileId] } })
  assert.equal(permanent.statusCode, 200)
  assert.equal((query(databasePath, 'SELECT COUNT(*) AS n FROM files WHERE public_id = ?', fileId)[0] as { n: number }).n, 0)
  assert.equal(readdirSync(join(root, 'objects')).length, 0)
  assert.equal(readdirSync(join(root, 'thumbs')).length, 0)
  await app.close()
})

test('permanent delete rejects files that are not in trash', async () => {
  const { app, token } = setup()
  await app.ready()
  const uploaded = await upload(app, token, { filename: 'active.jpg', mimetype: 'image/jpeg', data: JPEG })
  const fileId = uploaded.json().file.id
  const response = await app.inject({ method: 'DELETE', url: `/api/v1/spaces/${token}/trash`, headers: { origin: 'https://frontend.example' }, payload: { ids: [fileId] } })
  assert.equal(response.statusCode, 409)
  assert.equal(response.json().error.code, 'NOT_IN_TRASH')
  await app.close()
})

test('cross-space mutation is rejected', async () => {
  const first = setup()
  const second = setup()
  await first.app.ready()
  await second.app.ready()
  const uploaded = await upload(first.app, first.token, { filename: 'x.jpg', mimetype: 'image/jpeg', data: JPEG })
  const fileId = uploaded.json().file.id
  const response = await second.app.inject({ method: 'POST', url: `/api/v1/spaces/${second.token}/trash`, headers: { origin: 'https://frontend.example' }, payload: { ids: [fileId] } })
  assert.equal(response.statusCode, 404)
  assert.equal(response.json().error.code, 'FILE_NOT_FOUND')
  await first.app.close()
  await second.app.close()
})

test('storage path traversal is rejected', () => {
  const { root } = setup()
  const storage = new FileStorage(root)
  assert.throws(() => storage.resolveInternalPath('../secret'), /Invalid storage key/)
  assert.throws(() => storage.resolveInternalPath('objects/../../secret'), /Invalid storage key/)
})

test('error responses never expose storage keys or internal ids', async () => {
  const { app, token, root } = setup({ maxUploadBytes: 64 })
  await app.ready()
  const response = await upload(app, token, { filename: 'big.jpg', mimetype: 'image/jpeg', data: Buffer.concat([JPEG, Buffer.alloc(256)]) })
  const text = response.body
  assert.equal(response.json().error.code, 'FILE_TOO_LARGE')
  assert.ok(!text.includes(root))
  assert.ok(!text.includes('objects/'))
  await app.close()
})


