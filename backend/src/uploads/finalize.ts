import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { FileStorage } from '../storage/file-storage'
import type { ProcessingQueue } from '../media/queue'
import { isImageMime, isVideoMime } from '../media/processor'
import { ApiError } from '../errors'
import { generateSlug } from '../slug'
import type { config } from '../config'

const ACTIVE_SESSION_STATES = "('created', 'uploading', 'assembling')"

export type QuotaUsage = { filesBytes: number; filesCount: number; reservedBytes: number; reservedCount: number }

export function quotaUsage(db: Database.Database, spaceId: string, excludeSessionId?: string): QuotaUsage {
  const files = db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(*) AS count FROM files WHERE space_id = ? AND deleted_at IS NULL').get(spaceId) as { bytes: number; count: number }
  const reserved = db.prepare(`SELECT COALESCE(SUM(total_size_bytes), 0) AS bytes, COUNT(*) AS count FROM upload_sessions WHERE space_id = ? AND status IN ${ACTIVE_SESSION_STATES} AND id != ?`).get(spaceId, excludeSessionId ?? '') as { bytes: number; count: number }
  return { filesBytes: files.bytes, filesCount: files.count, reservedBytes: reserved.bytes, reservedCount: reserved.count }
}

export type FinalizeInput = {
  db: Database.Database
  storage: FileStorage
  settings: typeof config
  processingQueue: ProcessingQueue
  spaceId: string
  folderInternalId: string | null
  originalName: string
  mimeType: string
  sizeBytes: number
  sourcePath: string
  /** Set when finalizing a resumable session; its reservation is excluded and it is marked complete. */
  sessionId?: string
}

/**
 * Turn a fully-written binary (currently at `sourcePath`) into a committed file
 * record. The binary is moved into object storage first, so a ready DB row is
 * never created before its binary exists. Used by both the legacy upload and
 * the resumable-session finalize.
 */
export function finalizeUploadedFile(input: FinalizeInput): { publicId: string } {
  const { db, storage, settings, processingQueue } = input
  const publicId = randomUUID()
  const internalId = randomUUID()
  const storageKey = `objects/${randomUUID()}`
  const now = new Date().toISOString()
  const status = isImageMime(input.mimeType) || isVideoMime(input.mimeType) ? 'processing' : 'ready'

  // Move first; a committed file never exists without its binary.
  try {
    storage.moveToObject(input.sourcePath, storageKey)
  } catch {
    throw new ApiError(500, 'STORAGE_ERROR', 'The file could not be stored.')
  }

  try {
    db.transaction(() => {
      const quota = quotaUsage(db, input.spaceId, input.sessionId)
      if (quota.filesCount + quota.reservedCount + 1 > settings.maxFilesPerSpace) throw new ApiError(409, 'QUOTA_FILES', 'This space has reached its file limit.')
      if (quota.filesBytes + quota.reservedBytes + input.sizeBytes > settings.maxSpaceStorageBytes) throw new ApiError(409, 'QUOTA_STORAGE', 'This space has reached its storage limit.')
      const slug = generateSlug(input.originalName, (candidate) => Boolean(db.prepare('SELECT 1 FROM files WHERE slug = ?').get(candidate)))
      db.prepare('INSERT INTO files (id, public_id, space_id, folder_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, uploader_name, status, width, height, duration_seconds, thumbnail_storage_key, deleted_at, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?)')
        .run(internalId, publicId, input.spaceId, input.folderInternalId, input.originalName, storageKey, input.mimeType, input.sizeBytes, now, status, slug)
      if (input.sessionId) db.prepare("UPDATE upload_sessions SET status = 'complete', updated_at = ? WHERE id = ?").run(now, input.sessionId)
    })()
  } catch (error) {
    storage.remove(storageKey) // clean the orphan binary on quota/insert failure
    throw error
  }

  if (status === 'processing') processingQueue.enqueue(publicId)
  return { publicId }
}
