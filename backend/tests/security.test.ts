import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { contentDisposition, canPreviewInline } from '../src/security/media'
import { parseRange } from '../src/security/range'
import { detectFileType } from '../src/security/upload'
import { FileStorage } from '../src/storage/file-storage'
import { buildServer } from '../src/server'
import { openDatabase } from '../src/db/database'
import { migrate } from '../src/db/migrate'

test('range parser handles valid, suffix, and invalid ranges', () => {
  assert.deepEqual(parseRange('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.throws(() => parseRange('bytes=12-20', 10), RangeError)
})

test('storage rejects traversal and disposition removes header controls', () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-files-')); const storage = new FileStorage(root)
  assert.throws(() => storage.resolveInternalPath('../secret'), /Invalid storage key/)
  assert.equal(contentDisposition('bad\r\nname.jpg', true), 'inline; filename="bad__name.jpg"')
  assert.equal(canPreviewInline('image/svg+xml'), false)
})

test('signature detection identifies supported file families', () => {
  assert.equal(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(detectFileType(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex')])), 'image/png')
  assert.equal(detectFileType(Buffer.from('GIF89a')), 'image/gif')
  assert.equal(detectFileType(Buffer.from('\u0000\u0000\u0000\u0000ftypisom')), 'video/mp4')
  assert.equal(detectFileType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBP')), 'image/webp')
  assert.equal(detectFileType(Buffer.from('hello world')), null)
})

test('API enforces token, ownership, CORS, and byte ranges', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-files-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  mkdirSync(join(root, 'objects'))
  writeFileSync(join(root, 'objects/testbin'), 'abcdefghij')
  const now = new Date().toISOString(); const spaceId = randomUUID(); const fileId = randomUUID()
  db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run(spaceId, 'test-token', 'Test', now, now)
  db.prepare('INSERT INTO files (id, public_id, space_id, folder_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, status) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)').run(randomUUID(), fileId, spaceId, 'test.bin', 'objects/testbin', 'video/mp4', 10, now, 'ready')
  db.close()
  const app = buildServer({ databasePath, storageRoot: root, frontendOrigins: ['https://frontend.example'], logLevel: 'silent', authDisabled: true }); await app.ready()
  assert.equal((await app.inject('/api/v1/spaces/nope')).statusCode, 404)
  const response = await app.inject({ url: `/api/v1/spaces/test-token/files/${fileId}/content`, headers: { range: 'bytes=2-5', origin: 'https://frontend.example' } })
  assert.equal(response.statusCode, 206); assert.equal(response.body, 'cdef'); assert.equal(response.headers['access-control-allow-origin'], 'https://frontend.example')
  assert.equal((await app.inject({ url: `/api/v1/spaces/test-token/files/${randomUUID()}/content` })).statusCode, 404)
  assert.equal((await app.inject({ url: `/api/v1/spaces/test-token/files/${fileId}/content`, headers: { range: 'bytes=99-100' } })).statusCode, 416)
  await app.close()
})
