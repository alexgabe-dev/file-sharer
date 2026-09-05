import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { MediaProcessor, parseFfprobeOutput, posterTimestamp } from '../src/media/processor'
import { ProcessingQueue } from '../src/media/queue'
import { FileStorage } from '../src/storage/file-storage'
import { openDatabase } from '../src/db/database'
import { migrate } from '../src/db/migrate'

function makeProcessor() {
  const root = mkdtempSync(join(tmpdir(), 'media-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const storage = new FileStorage(root)
  const now = new Date().toISOString()
  db.prepare('INSERT INTO shared_spaces (id, public_token, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('space-1', 'token-1', 'Test', now, now)
  const processor = new MediaProcessor(db, storage, {
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    mediaProcessingTimeoutMs: 5000,
    processingMaxAttempts: 2,
    thumbnailMaxDimension: 512,
    maxProcessableImagePixels: 50_000_000,
    maxProcessableVideoDurationSeconds: 86_400,
  })
  return { db, storage, processor, root }
}

function insertFile(db: ReturnType<typeof openDatabase>, storage: FileStorage, mimeType: string, data: Buffer) {
  const publicId = randomUUID()
  const internalId = randomUUID()
  const storageKey = `objects/${randomUUID()}`
  storage.writeObject(storageKey, data)
  db.prepare("INSERT INTO files (id, public_id, space_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing')")
    .run(internalId, publicId, 'space-1', 'file', storageKey, mimeType, data.length, new Date().toISOString())
  return { publicId, storageKey }
}

test('poster timestamp samples short clips and caps long ones', () => {
  assert.equal(posterTimestamp(10), 1.5)
  assert.equal(posterTimestamp(100), 4)
  assert.equal(posterTimestamp(0), 0)
  assert.equal(posterTimestamp(-5), 0)
})

test('ffprobe output parser extracts duration and dimensions', () => {
  const json = JSON.stringify({ format: { duration: '12.5' }, streams: [{ codec_type: 'video', width: 1920, height: 1080 }, { codec_type: 'audio' }] })
  const probe = parseFfprobeOutput(json)
  assert.equal(probe.duration, 12.5)
  assert.equal(probe.width, 1920)
  assert.equal(probe.height, 1080)
  assert.equal(probe.hasVideo, true)
})

test('image processing generates a webp thumbnail preserving aspect ratio', async () => {
  const { db, storage, processor } = makeProcessor()
  const png = await sharp({ create: { width: 640, height: 320, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer()
  const { publicId } = insertFile(db, storage, 'image/png', png)

  const retryable = await processor.process(publicId)
  assert.equal(retryable, false)

  const row = db.prepare('SELECT status, width, height, thumbnail_storage_key FROM files WHERE public_id = ?').get(publicId) as { status: string; width: number; height: number; thumbnail_storage_key: string }
  assert.equal(row.status, 'ready')
  assert.equal(row.width, 640)
  assert.equal(row.height, 320)
  assert.ok(row.thumbnail_storage_key.startsWith('thumbs/'))

  const thumbMeta = await sharp(storage.resolveInternalPath(row.thumbnail_storage_key)).metadata()
  assert.ok(thumbMeta.width !== undefined && thumbMeta.width <= 512)
  assert.ok(thumbMeta.height !== undefined && thumbMeta.height <= 512)
  assert.equal(thumbMeta.format, 'webp')
  assert.equal(thumbMeta.width! / thumbMeta.height!, 2) // aspect ratio preserved
  db.close()
})

test('corrupt image fails gracefully and is marked retryable', async () => {
  const { db, storage, processor } = makeProcessor()
  const { publicId } = insertFile(db, storage, 'image/png', Buffer.from('not a real image'))

  const retryable = await processor.process(publicId)
  assert.equal(retryable, true)

  const row = db.prepare('SELECT status, processing_attempts, processing_error, thumbnail_storage_key FROM files WHERE public_id = ?').get(publicId) as { status: string; processing_attempts: number; processing_error: string | null; thumbnail_storage_key: string | null }
  assert.equal(row.status, 'failed')
  assert.equal(row.processing_attempts, 1)
  assert.ok(row.processing_error)
  assert.equal(row.thumbnail_storage_key, null)
  db.close()
})

test('video processing fails gracefully when ffmpeg binaries are missing', async () => {
  const { db, storage } = makeProcessor()
  const processor = new MediaProcessor(db, storage, {
    ffmpegPath: '/definitely/missing/ffmpeg',
    ffprobePath: '/definitely/missing/ffprobe',
    mediaProcessingTimeoutMs: 3000,
    processingMaxAttempts: 2,
    thumbnailMaxDimension: 512,
    maxProcessableImagePixels: 50_000_000,
    maxProcessableVideoDurationSeconds: 86_400,
  })
  const { publicId } = insertFile(db, storage, 'video/mp4', Buffer.from('fake video'))
  const retryable = await processor.process(publicId)
  assert.equal(retryable, true)
  const row = db.prepare('SELECT status, processing_error FROM files WHERE public_id = ?').get(publicId) as { status: string; processing_error: string | null }
  assert.equal(row.status, 'failed')
  assert.ok(row.processing_error)
  db.close()
})

test('processing queue bounds concurrency and deduplicates', async () => {
  let active = 0
  let maxActive = 0
  let processed = 0
  const queue = new ProcessingQueue({
    concurrency: 2,
    retryDelayMs: 1,
    run: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      processed += 1
      await new Promise((resolve) => setTimeout(resolve, 15))
      active -= 1
      return false
    },
  })
  for (let i = 0; i < 5; i += 1) queue.enqueue(`id-${i}`)
  queue.enqueue('id-0') // duplicate should be ignored
  await queue.waitUntilIdle()
  assert.equal(processed, 5)
  assert.ok(maxActive <= 2)
})

test('findReconcileableIds returns unfinished retryable files only', () => {
  const { db, processor } = makeProcessor()
  const now = new Date().toISOString()
  const seed = (publicId: string, status: string, attempts: number) => db.prepare('INSERT INTO files (id, public_id, space_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, status, processing_attempts, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), publicId, 'space-1', 'f', `objects/${randomUUID()}`, 'image/png', 10, now, status, attempts, null)
  seed('p-processing', 'processing', 0)
  seed('p-failed-retryable', 'failed', 1)
  seed('p-failed-terminal', 'failed', 2)
  seed('p-ready', 'ready', 0)

  const ids = processor.findReconcileableIds()
  assert.deepEqual([...ids].sort(), ['p-failed-retryable', 'p-processing'].sort())
  db.close()
})

