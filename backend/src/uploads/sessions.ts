import { randomUUID, createHash } from 'node:crypto'
import { closeSync, createWriteStream, openSync, readSync, rmSync, statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { FileStorage } from '../storage/file-storage'
import type { ProcessingQueue } from '../media/queue'
import { ApiError } from '../errors'
import { detectFileType, MAX_FILENAME_LENGTH } from '../security/upload'
import { finalizeUploadedFile, quotaUsage } from './finalize'
import { availableBytes, hasSufficientSpace } from '../ops/disk'
import type { config } from '../config'

export type UploadSessionContext = {
  db: Database.Database
  storage: FileStorage
  settings: typeof config
  processingQueue: ProcessingQueue
  requireSpace: (token: string) => { id: string }
  fileResponseFor: (publicId: string) => Record<string, unknown>
}

type SessionRow = {
  id: string
  public_id: string
  space_id: string
  folder_id: string | null
  original_name: string
  total_size_bytes: number
  chunk_size_bytes: number
  total_chunks: number
  uploaded_bytes: number
  status: string
  expires_at: string
  updated_at: string
}

function readFirstBytes(path: string, count: number): Buffer {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(count)
    const bytesRead = readSync(fd, buffer, 0, count, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    closeSync(fd)
  }
}

function loadSession(db: Database.Database, spaceId: string, uploadId: string, allowTerminal = false): SessionRow {
  const row = db.prepare('SELECT id, public_id, space_id, folder_id, original_name, total_size_bytes, chunk_size_bytes, total_chunks, uploaded_bytes, status, expires_at, updated_at FROM upload_sessions WHERE public_id = ? AND space_id = ?').get(uploadId, spaceId) as SessionRow | undefined
  if (!row) throw new ApiError(404, 'UPLOAD_NOT_FOUND', 'This upload session does not exist.')
  if (!allowTerminal && new Date(row.expires_at).getTime() < Date.now()) throw new ApiError(410, 'UPLOAD_EXPIRED', 'This upload session has expired.')
  return row
}

export function registerUploadSessionRoutes(app: FastifyInstance, ctx: UploadSessionContext) {
  const { db, storage, settings, processingQueue, requireSpace, fileResponseFor } = ctx

  app.post('/api/v1/spaces/:token/uploads/init', async (request, reply) => {
    const found = requireSpace((request.params as { token: string }).token)
    const body = (request.body ?? {}) as { name?: unknown; sizeBytes?: unknown; mimeType?: unknown; folderId?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const sizeBytes = typeof body.sizeBytes === 'number' ? body.sizeBytes : NaN
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : null
    const folderId = typeof body.folderId === 'string' && body.folderId.length > 0 ? body.folderId : null

    if (!name || name.length > MAX_FILENAME_LENGTH || name.includes('\u0000')) throw new ApiError(400, 'INVALID_FILENAME', 'The filename is missing or too long.')
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new ApiError(400, 'INVALID_REQUEST', 'A valid file size is required.')
    if (sizeBytes > settings.maxUploadBytes) throw new ApiError(413, 'FILE_TOO_LARGE', 'This file exceeds the upload limit.')
    if (!hasSufficientSpace(availableBytes(storage.getRoot()), sizeBytes, settings.minFreeDiskBytes)) throw new ApiError(507, 'INSUFFICIENT_SERVER_STORAGE', 'The server does not have enough free storage for this upload.')

    let folderInternalId: string | null = null
    if (folderId) {
      const folderRow = db.prepare('SELECT id FROM folders WHERE public_id = ? AND space_id = ?').get(folderId, found.id) as { id: string } | undefined
      if (!folderRow) throw new ApiError(400, 'INVALID_FOLDER', 'The target folder does not exist in this space.')
      folderInternalId = folderRow.id
    }

    const chunkSize = settings.uploadChunkSizeBytes
    const totalChunks = Math.ceil(sizeBytes / chunkSize)
    if (totalChunks > settings.maxUploadChunks) throw new ApiError(400, 'INVALID_REQUEST', 'This file would require too many chunks.')

    const sessionId = randomUUID()
    const publicId = randomUUID()
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + settings.uploadSessionTtlMs).toISOString()

    db.transaction(() => {
      const quota = quotaUsage(db, found.id)
      if (quota.filesCount + quota.reservedCount + 1 > settings.maxFilesPerSpace) throw new ApiError(409, 'QUOTA_FILES', 'This space has reached its file limit.')
      if (quota.filesBytes + quota.reservedBytes + sizeBytes > settings.maxSpaceStorageBytes) throw new ApiError(409, 'QUOTA_STORAGE', 'This space has reached its storage limit.')
      db.prepare('INSERT INTO upload_sessions (id, public_id, space_id, folder_id, original_name, declared_mime_type, total_size_bytes, chunk_size_bytes, total_chunks, uploaded_bytes, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)')
        .run(sessionId, publicId, found.id, folderInternalId, name, mimeType, sizeBytes, chunkSize, totalChunks, 'created', now, now, expiresAt)
    })()

    storage.ensureSessionDir(sessionId)
    return reply.code(201).send({ upload: { publicId, chunkSizeBytes: chunkSize, totalChunks, totalSizeBytes: sizeBytes, status: 'created', expiresAt } })
  })

  app.put('/api/v1/spaces/:token/uploads/:uploadId/chunks/:chunkIndex', async (request) => {
    const found = requireSpace((request.params as { token: string }).token)
    const { uploadId, chunkIndex: rawIndex } = request.params as { uploadId: string; chunkIndex: string }
    const chunkIndex = Number(rawIndex)
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new ApiError(400, 'INVALID_CHUNK', 'Invalid chunk index.')

    const session = loadSession(db, found.id, uploadId)
    if (chunkIndex >= session.total_chunks) throw new ApiError(400, 'INVALID_CHUNK', 'Chunk index is out of range.')
    if (session.status !== 'created' && session.status !== 'uploading') throw new ApiError(409, 'UPLOAD_INVALID_STATE', 'This upload is no longer accepting chunks.')

    const data = request.body as Buffer
    const expected = chunkIndex === session.total_chunks - 1
      ? session.total_size_bytes - chunkIndex * session.chunk_size_bytes
      : session.chunk_size_bytes
    if (!Buffer.isBuffer(data) || data.length !== expected) throw new ApiError(400, 'INVALID_CHUNK', 'Chunk size does not match the expected size.')

    const checksumHeader = request.headers['x-checksum-sha256']
    if (typeof checksumHeader === 'string' && checksumHeader.length > 0) {
      const actual = createHash('sha256').update(data).digest('hex')
      if (actual !== checksumHeader.toLowerCase()) throw new ApiError(400, 'CHECKSUM_MISMATCH', 'Chunk checksum does not match.')
    }

    const existing = db.prepare('SELECT size_bytes FROM upload_chunks WHERE upload_session_id = ? AND chunk_index = ?').get(session.id, chunkIndex) as { size_bytes: number } | undefined
    if (existing && existing.size_bytes === data.length) {
      return { chunk: { index: chunkIndex, sizeBytes: data.length, received: true } }
    }

    const checksum = typeof checksumHeader === 'string' && checksumHeader.length > 0 ? checksumHeader.toLowerCase() : null
    storage.writeChunk(session.id, chunkIndex, data)

    const now = new Date().toISOString()
    db.transaction(() => {
      db.prepare('INSERT INTO upload_chunks (upload_session_id, chunk_index, size_bytes, checksum, received_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(upload_session_id, chunk_index) DO UPDATE SET size_bytes = excluded.size_bytes, checksum = excluded.checksum, received_at = excluded.received_at')
        .run(session.id, chunkIndex, data.length, checksum, now)
      db.prepare("UPDATE upload_sessions SET uploaded_bytes = (SELECT COALESCE(SUM(size_bytes), 0) FROM upload_chunks WHERE upload_session_id = ?), status = CASE WHEN status = 'created' THEN 'uploading' ELSE status END, updated_at = ? WHERE id = ?")
        .run(session.id, now, session.id)
    })()

    return { chunk: { index: chunkIndex, sizeBytes: data.length, received: true } }
  })

  app.get('/api/v1/spaces/:token/uploads/:uploadId', async (request) => {
    const found = requireSpace((request.params as { token: string }).token)
    const { uploadId } = request.params as { uploadId: string }
    const session = loadSession(db, found.id, uploadId, true)
    const chunks = db.prepare('SELECT chunk_index FROM upload_chunks WHERE upload_session_id = ? ORDER BY chunk_index').all(session.id) as Array<{ chunk_index: number }>
    return {
      upload: {
        publicId: session.public_id,
        status: session.status,
        totalSizeBytes: session.total_size_bytes,
        uploadedBytes: session.uploaded_bytes,
        chunkSizeBytes: session.chunk_size_bytes,
        totalChunks: session.total_chunks,
        receivedChunks: chunks.map((chunk) => chunk.chunk_index),
        expiresAt: session.expires_at,
      },
    }
  })

  app.post('/api/v1/spaces/:token/uploads/:uploadId/complete', async (request) => {
    const found = requireSpace((request.params as { token: string }).token)
    const { uploadId } = request.params as { uploadId: string }
    const session = loadSession(db, found.id, uploadId)
    const now = new Date().toISOString()

    // Atomically claim finalization; a concurrent complete call is rejected.
    const claimed = db.prepare("UPDATE upload_sessions SET status = 'assembling', updated_at = ? WHERE id = ? AND status IN ('created', 'uploading')").run(now, session.id)
    if (claimed.changes === 0) throw new ApiError(409, 'UPLOAD_INVALID_STATE', 'This upload is already being finalized or is no longer active.')

    const assemblyPath = storage.tempFilePath('assemble')
    try {
      const chunkRows = db.prepare('SELECT chunk_index, size_bytes FROM upload_chunks WHERE upload_session_id = ? ORDER BY chunk_index').all(session.id) as Array<{ chunk_index: number; size_bytes: number }>
      let total = 0
      for (let index = 0; index < session.total_chunks; index += 1) {
        const row = chunkRows[index]
        if (!row || row.chunk_index !== index || !storage.chunkExists(session.id, index) || statSync(storage.chunkPath(session.id, index)).size !== row.size_bytes) {
          throw new ApiError(409, 'UPLOAD_INCOMPLETE', 'Not all chunks have been received.')
        }
        total += row.size_bytes
      }
      if (total !== session.total_size_bytes) throw new ApiError(409, 'UPLOAD_INCOMPLETE', 'Uploaded size does not match the declared size.')

      // Assemble in order by streaming each chunk into one file (no full buffering).
      for (let index = 0; index < session.total_chunks; index += 1) {
        const flags = index === 0 ? 'wx' : 'a'
        await pipeline(createReadStream(storage.chunkPath(session.id, index)), createWriteStream(assemblyPath, { flags }))
      }

      const mimeType = detectFileType(readFirstBytes(assemblyPath, 512))
      if (!mimeType) throw new ApiError(400, 'INVALID_FILE_TYPE', 'This file type is not supported.')

      const { publicId } = finalizeUploadedFile({
        db, storage, settings, processingQueue,
        spaceId: found.id,
        folderInternalId: session.folder_id,
        originalName: session.original_name,
        mimeType,
        sizeBytes: total,
        sourcePath: assemblyPath,
        sessionId: session.id,
      })

      storage.removeSessionDir(session.id)
      return { file: fileResponseFor(publicId) }
    } catch (error) {
      // Preserve the resumable session for transient failures.
      try { rmSync(assemblyPath, { force: true }) } catch { /* ignore */ }
      db.prepare("UPDATE upload_sessions SET status = 'uploading', updated_at = ? WHERE id = ? AND status = 'assembling'").run(new Date().toISOString(), session.id)
      throw error
    }
  })

  app.delete('/api/v1/spaces/:token/uploads/:uploadId', async (request) => {
    const found = requireSpace((request.params as { token: string }).token)
    const { uploadId } = request.params as { uploadId: string }
    const session = loadSession(db, found.id, uploadId, true)
    if (session.status === 'complete') throw new ApiError(409, 'UPLOAD_INVALID_STATE', 'This upload has already completed.')
    const now = new Date().toISOString()
    db.prepare("UPDATE upload_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, session.id)
    storage.removeSessionDir(session.id)
    db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(session.id)
    return { cancelled: true }
  })
}

export function cleanupUploadSessions(ctx: UploadSessionContext) {
  const { db, storage } = ctx
  const nowIso = new Date().toISOString()

  db.prepare("UPDATE upload_sessions SET status = 'expired', updated_at = ? WHERE status IN ('created', 'uploading', 'assembling') AND expires_at < ?").run(nowIso, nowIso)

  const stale = db.prepare("SELECT id FROM upload_sessions WHERE status IN ('expired', 'cancelled', 'complete', 'failed')").all() as Array<{ id: string }>
  for (const row of stale) {
    storage.removeSessionDir(row.id)
    db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(row.id)
  }

  // A session left in 'assembling' after a crash never completed; make it resumable.
  db.prepare("UPDATE upload_sessions SET status = 'uploading', updated_at = ? WHERE status = 'assembling'").run(nowIso)
}


