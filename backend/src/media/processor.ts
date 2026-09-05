import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type { FileStorage } from '../storage/file-storage'
import { runBinary } from './exec'

export type MediaSettings = {
  ffmpegPath: string
  ffprobePath: string
  mediaProcessingTimeoutMs: number
  processingMaxAttempts: number
  thumbnailMaxDimension: number
  maxProcessableImagePixels: number
  maxProcessableVideoDurationSeconds: number
}

type ProcessingRow = {
  id: string
  public_id: string
  mime_type: string
  storage_key: string
  thumbnail_storage_key: string | null
  processing_attempts: number
  deleted_at: string | null
}

export const isImageMime = (mime: string) => mime.startsWith('image/')
export const isVideoMime = (mime: string) => mime.startsWith('video/')

export type VideoProbe = { duration: number; width: number | null; height: number | null; hasVideo: boolean }

export function parseFfprobeOutput(stdout: string): VideoProbe {
  const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }> }
  const video = data.streams?.find((stream) => stream.codec_type === 'video')
  const rawDuration = Number(data.format?.duration ?? video?.duration ?? 0)
  return {
    duration: Number.isFinite(rawDuration) ? rawDuration : 0,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasVideo: Boolean(video),
  }
}

/**
 * Pick a representative frame time, avoiding frame 0 (often black). Short
 * clips sample ~15% of their duration; longer clips are capped at a few
 * seconds so seeking stays cheap.
 */
export function posterTimestamp(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  if (durationSeconds <= 20) return durationSeconds * 0.15
  return Math.min(durationSeconds * 0.1, 4)
}

export class MediaProcessor {
  constructor(
    private readonly db: Database.Database,
    private readonly storage: FileStorage,
    private readonly settings: MediaSettings,
  ) {}

  /** Process a file. Resolves `true` when the job should be retried later. */
  async process(publicId: string): Promise<boolean> {
    const row = this.db.prepare('SELECT id, public_id, mime_type, storage_key, thumbnail_storage_key, processing_attempts, deleted_at FROM files WHERE public_id = ?').get(publicId) as ProcessingRow | undefined
    if (!row || row.deleted_at) return false

    if (!isImageMime(row.mime_type) && !isVideoMime(row.mime_type)) {
      this.db.prepare("UPDATE files SET status = 'ready', processed_at = ?, processing_error = NULL WHERE id = ?").run(new Date().toISOString(), row.id)
      return false
    }

    if (row.processing_attempts >= this.settings.processingMaxAttempts) {
      this.db.prepare("UPDATE files SET status = 'failed' WHERE id = ?").run(row.id)
      return false
    }

    const attempts = row.processing_attempts + 1
    this.db.prepare("UPDATE files SET status = 'processing', processing_attempts = ?, processed_at = NULL, processing_error = NULL WHERE id = ?").run(attempts, row.id)

    try {
      if (isImageMime(row.mime_type)) await this.processImage(row)
      else await this.processVideo(row)
      this.db.prepare("UPDATE files SET status = 'ready', processed_at = ?, processing_error = NULL WHERE id = ?").run(new Date().toISOString(), row.id)
      return false
    } catch (error) {
      const message = error instanceof Error ? error.message : 'processing failed'
      this.db.prepare("UPDATE files SET status = 'failed', processing_error = ? WHERE id = ?").run(message.slice(0, 2000), row.id)
      return attempts < this.settings.processingMaxAttempts
    }
  }

  findReconcileableIds(): string[] {
    const rows = this.db.prepare("SELECT public_id FROM files WHERE deleted_at IS NULL AND status IN ('processing', 'failed') AND processing_attempts < ?").all(this.settings.processingMaxAttempts) as Array<{ public_id: string }>
    return rows.map((row) => row.public_id)
  }

  private async processImage(row: ProcessingRow) {
    const input = this.storage.resolveInternalPath(row.storage_key)
    const metadata = await sharp(input, { limitInputPixels: this.settings.maxProcessableImagePixels }).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    const orientation = metadata.orientation ?? 1
    const swapped = orientation >= 5 && orientation <= 8
    const finalWidth = swapped ? height : width
    const finalHeight = swapped ? width : height

    const thumbnail = await sharp(input, { limitInputPixels: this.settings.maxProcessableImagePixels })
      .rotate()
      .resize({ width: this.settings.thumbnailMaxDimension, height: this.settings.thumbnailMaxDimension, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()

    const thumbnailKey = `thumbs/${randomUUID()}`
    this.storage.writeObject(thumbnailKey, thumbnail)
    if (row.thumbnail_storage_key && row.thumbnail_storage_key !== thumbnailKey) this.storage.remove(row.thumbnail_storage_key)
    this.db.prepare('UPDATE files SET width = ?, height = ?, thumbnail_storage_key = ? WHERE id = ?').run(finalWidth, finalHeight, thumbnailKey, row.id)
  }

  private async processVideo(row: ProcessingRow) {
    const input = this.storage.resolveInternalPath(row.storage_key)
    const probe = await runBinary(this.settings.ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input], { timeoutMs: this.settings.mediaProcessingTimeoutMs })
    if (probe.code !== 0) throw new Error('ffprobe failed to read the video')
    const info = parseFfprobeOutput(probe.stdout)
    if (!info.hasVideo) throw new Error('no video stream found')
    if (info.duration > this.settings.maxProcessableVideoDurationSeconds) throw new Error('video is too long to process')

    const posterPath = `${this.storage.tempFilePath('poster')}.png`
    try {
      const timestamp = posterTimestamp(info.duration)
      const dimension = this.settings.thumbnailMaxDimension
      // Extract a single full-size frame as PNG, then let Sharp resize/convert.
      // Avoids shell/quoting pitfalls of inline ffmpeg filter graphs.
      const args = ['-ss', timestamp.toFixed(2), '-i', input, '-frames:v', '1', '-y', posterPath]
      const frame = await runBinary(this.settings.ffmpegPath, args, { timeoutMs: this.settings.mediaProcessingTimeoutMs })
      if (frame.code !== 0) throw new Error('ffmpeg failed to create a poster')

      const thumbnail = await sharp(posterPath)
        .resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()

      const thumbnailKey = `thumbs/${randomUUID()}`
      this.storage.writeObject(thumbnailKey, thumbnail)
      if (row.thumbnail_storage_key && row.thumbnail_storage_key !== thumbnailKey) this.storage.remove(row.thumbnail_storage_key)
      this.db.prepare('UPDATE files SET width = ?, height = ?, duration_seconds = ?, thumbnail_storage_key = ? WHERE id = ?').run(info.width, info.height, info.duration, thumbnailKey, row.id)
    } finally {
      rmSync(posterPath, { force: true })
    }
  }
}
