import { initUpload, getUploadSession, completeUpload, cancelUpload, uploadChunkXhr, sha256Blob, ApiError } from '@/lib/api/client'
import type { SharedFile, UploadStatus } from '@/lib/files/types'
import { backoffBaseMs, chunkRange, isRetryableStatus, missingChunkIndexes } from './math'
import type { PersistedUpload } from './idb'

export type ResumableCallbacks = {
  onStatus: (status: UploadStatus) => void
  onProgress: (confirmedBytes: number) => void
  onFile: () => void
  onError: (message: string, retryable: boolean) => void
  onPersist: (record: PersistedUpload) => void
  onDeletePersist: () => void
  onDone: () => void
}

const MAX_CHUNK_RETRIES = 4
const BASE_RETRY_DELAY_MS = 750

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return isRetryableStatus(error.status)
}

/**
 * Drives a single file's resumable upload: create/reconcile a session, upload
 * missing chunks with bounded concurrency and exponential backoff, then
 * finalize. Pause stops scheduling (and aborts in-flight chunks); resume
 * continues only the missing chunks.
 */
export class ResumableUpload {
  private cancelled = false
  private paused = false
  private cancelController = new AbortController()
  private pauseController = new AbortController()
  private resumeWaiters: Array<() => void> = []

  private uploadId: string | null = null
  private chunkSizeBytes = 0
  private totalChunks = 0
  private totalBytes = 0
  private received = new Set<number>()
  private confirmedBytes = 0

  constructor(
    private readonly token: string,
    private readonly file: Blob,
    private readonly name: string,
    private readonly folderId: string | null,
    private readonly kind: SharedFile['kind'],
    private readonly chunkConcurrency: number,
    private readonly callbacks: ResumableCallbacks,
    private readonly record?: PersistedUpload,
  ) {}

  async start() {
    try {
      await this.resolveSession()
      while (!this.cancelled) {
        if (this.paused) {
          await this.waitForResume()
          continue
        }
        await this.runAllMissing()
        if (this.missingChunks().length === 0) break
      }
      if (this.cancelled) return
      this.callbacks.onStatus('finalizing')
      await completeUpload(this.token, this.uploadId!)
      this.callbacks.onDeletePersist()
      this.callbacks.onFile()
    } catch (error) {
      if (this.cancelled) return
      const message = error instanceof Error ? error.message : 'Upload failed'
      const terminal = error instanceof ApiError && !isRetryableStatus(error.status)
      if (terminal) {
        // Permanently rejected (unsupported type, too large, quota, etc.):
        // clean the server session and local recovery record so it is never
        // restored as a recoverable "paused" upload.
        this.cancelled = true
        if (this.uploadId) void cancelUpload(this.token, this.uploadId).catch(() => {})
        this.callbacks.onDeletePersist()
      }
      this.callbacks.onError(message, !terminal)
      this.callbacks.onStatus('failed')
    } finally {
      this.callbacks.onDone()
    }
  }

  pause() {
    if (this.paused || this.cancelled) return
    this.paused = true
    this.pauseController.abort()
    this.callbacks.onStatus('paused')
  }

  resume() {
    if (!this.paused || this.cancelled) return
    this.paused = false
    this.pauseController = new AbortController()
    this.callbacks.onStatus('uploading')
    const waiters = this.resumeWaiters.splice(0)
    waiters.forEach((resolve) => resolve())
  }

  cancel() {
    if (this.cancelled) return
    this.cancelled = true
    this.cancelController.abort()
    this.callbacks.onStatus('cancelled')
    if (this.uploadId) void cancelUpload(this.token, this.uploadId).catch(() => {})
    this.callbacks.onDeletePersist()
  }

  private waitForResume() {
    return new Promise<void>((resolve) => { this.resumeWaiters.push(resolve) })
  }

  private async resolveSession() {
    if (this.record?.uploadId) {
      try {
        const { upload } = await getUploadSession(this.token, this.record.uploadId)
        this.uploadId = upload.publicId
        this.chunkSizeBytes = upload.chunkSizeBytes
        this.totalChunks = upload.totalChunks
        this.totalBytes = upload.totalSizeBytes
        this.received = new Set(upload.receivedChunks)
        this.confirmedBytes = upload.uploadedBytes
        this.callbacks.onProgress(this.confirmedBytes)
        return
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
          // Session no longer exists on the server; start a fresh one.
        } else {
          throw error
        }
      }
    }
    const { upload } = await initUpload(this.token, { name: this.name, sizeBytes: this.file.size, mimeType: this.file.type, folderId: this.folderId })
    this.uploadId = upload.publicId
    this.chunkSizeBytes = upload.chunkSizeBytes
    this.totalChunks = upload.totalChunks
    this.totalBytes = upload.totalSizeBytes
    this.received = new Set()
    this.confirmedBytes = 0
    this.persist()
  }

  private async runAllMissing() {
    const missing = this.missingChunks()
    let cursor = 0
    const worker = async () => {
      while (true) {
        if (this.cancelled || this.paused) return
        if (cursor >= missing.length) return
        const index = missing[cursor]
        cursor += 1
        await this.uploadOne(index)
      }
    }
    await Promise.all(Array.from({ length: this.chunkConcurrency }, worker))
  }

  private missingChunks(): number[] {
    return missingChunkIndexes([...this.received], this.totalChunks)
  }

  private async uploadOne(index: number) {
    const { start, end } = chunkRange(index, this.chunkSizeBytes, this.totalBytes)
    const blob = this.file.slice(start, end)
    const checksum = await sha256Blob(blob)

    let attempt = 0
    while (true) {
      if (this.cancelled || this.paused) return
      const signal = typeof AbortSignal.any === 'function'
        ? AbortSignal.any([this.cancelController.signal, this.pauseController.signal])
        : this.cancelController.signal
      try {
        await uploadChunkXhr(this.token, this.uploadId!, index, blob, checksum, (loaded) => {
          this.callbacks.onProgress(this.confirmedBytes + Math.min(loaded, blob.size))
        }, signal)
        this.received.add(index)
        this.confirmedBytes += blob.size
        this.callbacks.onProgress(this.confirmedBytes)
        this.persist()
        return
      } catch (error) {
        if (this.cancelled || this.paused) return
        if (!isRetryable(error) || attempt >= MAX_CHUNK_RETRIES) throw error
        attempt += 1
        await new Promise((resolve) => setTimeout(resolve, backoffBaseMs(attempt, BASE_RETRY_DELAY_MS) + Math.random() * 250))
      }
    }
  }

  private persist() {
    if (!this.uploadId || !this.record) return
    this.callbacks.onPersist({
      localId: this.record.localId,
      uploadId: this.uploadId,
      token: this.token,
      name: this.name,
      sizeBytes: this.totalBytes,
      kind: this.kind,
      folderId: this.folderId,
      lastModified: this.record.lastModified,
      chunkSizeBytes: this.chunkSizeBytes,
      totalChunks: this.totalChunks,
      receivedChunks: [...this.received].sort((a, b) => a - b),
      createdAt: this.record.createdAt,
    })
  }
}
