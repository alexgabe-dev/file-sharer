import 'dotenv/config'

function required(name: string, fallback?: string) { const value = process.env[name] ?? fallback; if (!value) throw new Error(`Missing ${name}`); return value }

function numberFrom(name: string, fallback: number) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`)
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databasePath: required('DATABASE_PATH', './data/shared-files.db'),
  storageRoot: required('FILE_STORAGE_ROOT', './data/storage'),
  frontendOrigins: required('FRONTEND_ORIGIN', 'http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean),
  publicApiBaseUrl: required('PUBLIC_API_BASE_URL', 'http://localhost:3001').replace(/\/$/, ''),

  // Operational safety.
  logLevel: process.env.LOG_LEVEL ?? 'info',
  shutdownGracePeriodMs: numberFrom('SHUTDOWN_GRACE_PERIOD_MS', 15 * 1000),
  minFreeDiskBytes: numberFrom('MIN_FREE_DISK_BYTES', 1024 * 1024 * 1024),
  backupRoot: required('BACKUP_ROOT', './backups'),
  backupRetentionDays: numberFrom('BACKUP_RETENTION_DAYS', 7),
  appVersion: process.env.npm_package_version ?? 'unknown',

  // Password gate / sessions.
  accessPasswordHash: process.env.ACCESS_PASSWORD_HASH ?? '',
  accessPassword: process.env.ACCESS_PASSWORD ?? '',
  sessionTtlDays: numberFrom('SESSION_TTL_DAYS', 30),
  sessionCookieName: required('SESSION_COOKIE_NAME', 'barnus_session'),
  sessionCookieDomain: process.env.SESSION_COOKIE_DOMAIN ?? '',
  authRateLimitMax: numberFrom('AUTH_RATE_LIMIT_MAX', 5),
  authRateLimitWindowMs: numberFrom('AUTH_RATE_LIMIT_WINDOW_MS', 60 * 1000),
  // Internal test/dev switch; production always enforces auth.
  authDisabled: false,

  // Upload and quota limits.
  maxUploadBytes: numberFrom('MAX_UPLOAD_BYTES', 1024 * 1024 * 1024),
  maxFilesPerSpace: numberFrom('MAX_FILES_PER_SPACE', 10000),
  maxSpaceStorageBytes: numberFrom('MAX_SPACE_STORAGE_BYTES', 10 * 1024 * 1024 * 1024),
  uploadConcurrency: numberFrom('UPLOAD_CONCURRENCY', 3),

  // Resumable/chunked uploads.
  uploadChunkSizeBytes: numberFrom('UPLOAD_CHUNK_SIZE_BYTES', 8 * 1024 * 1024),
  maxUploadChunks: numberFrom('MAX_UPLOAD_CHUNKS', 8192),
  uploadSessionTtlMs: numberFrom('UPLOAD_SESSION_TTL_MS', 24 * 60 * 60 * 1000),
  uploadSessionCleanupIntervalMs: numberFrom('UPLOAD_SESSION_CLEANUP_INTERVAL_MS', 15 * 60 * 1000),

  // Abuse protection (single process, in-memory).
  rateLimitMax: numberFrom('RATE_LIMIT_MAX', 300),
  rateLimitWindowMs: numberFrom('RATE_LIMIT_WINDOW_MS', 60 * 1000),

  // Temporary upload cleanup.
  tempFileMaxAgeMs: numberFrom('TEMP_FILE_MAX_AGE_MS', 60 * 60 * 1000),
  tempCleanupIntervalMs: numberFrom('TEMP_CLEANUP_INTERVAL_MS', 15 * 60 * 1000),

  // Media processing (FFmpeg/ffprobe + Sharp).
  ffmpegPath: required('FFMPEG_PATH', 'ffmpeg'),
  ffprobePath: required('FFPROBE_PATH', 'ffprobe'),
  mediaProcessingConcurrency: numberFrom('MEDIA_PROCESSING_CONCURRENCY', 1),
  mediaProcessingTimeoutMs: numberFrom('MEDIA_PROCESSING_TIMEOUT_MS', 120 * 1000),
  mediaRetryDelayMs: numberFrom('MEDIA_RETRY_DELAY_MS', 15 * 1000),
  processingMaxAttempts: numberFrom('PROCESSING_MAX_ATTEMPTS', 3),
  thumbnailMaxDimension: numberFrom('THUMBNAIL_MAX_DIMENSION', 512),
  maxProcessableImagePixels: numberFrom('MAX_PROCESSABLE_IMAGE_PIXELS', 50 * 1000 * 1000),
  maxProcessableVideoDurationSeconds: numberFrom('MAX_PROCESSABLE_VIDEO_DURATION_SECONDS', 24 * 60 * 60),
}
