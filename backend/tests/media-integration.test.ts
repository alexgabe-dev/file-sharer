import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { MediaProcessor } from '../src/media/processor'
import { FileStorage } from '../src/storage/file-storage'
import { openDatabase } from '../src/db/database'
import { migrate } from '../src/db/migrate'
import { binaryAvailable, runBinary } from '../src/media/exec'

test('video poster and metadata (requires system ffmpeg/ffprobe)', async (t) => {
  if (!(await binaryAvailable('ffmpeg')) || !(await binaryAvailable('ffprobe'))) {
    t.skip('ffmpeg/ffprobe not installed')
    return
  }

  const root = mkdtempSync(join(tmpdir(), 'media-int-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const now = new Date().toISOString()
  db.prepare('INSERT INTO shared_spaces (id, public_token, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('space-1', 'token-1', 'Test', now, now)
  const storage = new FileStorage(root)

  const srcPath = storage.tempFilePath('src')
  const gen = await runBinary('ffmpeg', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', '-pix_fmt', 'yuv420p', '-f', 'mp4', '-y', srcPath], { timeoutMs: 20000 })
  assert.equal(gen.code, 0)
  const data = readFileSync(srcPath)
  rmSync(srcPath, { force: true })

  const storageKey = `objects/${randomUUID()}`
  storage.writeObject(storageKey, data)
  const publicId = randomUUID()
  db.prepare("INSERT INTO files (id, public_id, space_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing')")
    .run(randomUUID(), publicId, 'space-1', 'clip.mp4', storageKey, 'video/mp4', data.length, now)

  const processor = new MediaProcessor(db, storage, {
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    mediaProcessingTimeoutMs: 30000,
    processingMaxAttempts: 2,
    thumbnailMaxDimension: 512,
    maxProcessableImagePixels: 50_000_000,
    maxProcessableVideoDurationSeconds: 86_400,
  })

  const retryable = await processor.process(publicId)
  assert.equal(retryable, false)

  const row = db.prepare('SELECT status, width, height, duration_seconds, thumbnail_storage_key FROM files WHERE public_id = ?').get(publicId) as { status: string; width: number | null; height: number | null; duration_seconds: number | null; thumbnail_storage_key: string | null }
  assert.equal(row.status, 'ready')
  assert.equal(row.width, 320)
  assert.equal(row.height, 240)
  assert.ok(row.duration_seconds !== null && row.duration_seconds > 0)
  assert.ok(row.thumbnail_storage_key)
  const thumbMeta = await sharp(storage.resolveInternalPath(row.thumbnail_storage_key)).metadata()
  assert.equal(thumbMeta.format, 'webp')
  db.close()
})
