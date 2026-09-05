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

test('bulk download streams a zip of the selected files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'download-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const now = new Date().toISOString()
  db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run('space-1', 'token-1', 'Test', now, now)

  const storage = new FileStorage(root)
  const ids: string[] = []
  for (const [name, data] of [['a.jpg', 'image-a'], ['b.jpg', 'image-b']] as const) {
    const id = randomUUID()
    const key = `objects/${randomUUID()}`
    storage.writeObject(key, Buffer.from(data))
    db.prepare("INSERT INTO files (id, public_id, space_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, status) VALUES (?, ?, ?, ?, ?, 'image/jpeg', ?, ?, 'ready')")
      .run(randomUUID(), id, 'space-1', name, key, data.length, now)
    ids.push(id)
  }
  db.close()

  const app = buildServer({ databasePath, storageRoot: root, frontendOrigins: ['https://frontend.example'], logLevel: 'silent', authDisabled: true })
  await app.ready()

  const response = await app.inject({ method: 'GET', url: `/api/v1/spaces/token-1/download?ids=${ids.join(',')}` })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'application/zip')
  assert.equal(response.rawPayload.subarray(0, 2).toString('latin1'), 'PK')

  const missing = await app.inject({ method: 'GET', url: '/api/v1/spaces/token-1/download?ids=does-not-exist' })
  assert.equal(missing.statusCode, 404)
  await app.close()
})
