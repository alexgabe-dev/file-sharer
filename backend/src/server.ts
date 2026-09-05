import Fastify, { type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from './config'
import { openDatabase } from './db/database'
import { migrate } from './db/migrate'
import { FileStorage } from './storage/file-storage'
import { canPreviewInline, contentDisposition } from './security/media'
import { parseRange } from './security/range'
import { ApiError } from './errors'
import { detectFileType, MAX_FILENAME_LENGTH } from './security/upload'
import { createRateLimiter } from './rate-limit'
import { MediaProcessor } from './media/processor'
import { ProcessingQueue } from './media/queue'
import { finalizeUploadedFile } from './uploads/finalize'
import { registerUploadSessionRoutes, cleanupUploadSessions } from './uploads/sessions'
import { validateConfig } from './config-validation'
import { redactUrl } from './ops/redact'
import { binaryAvailable } from './media/exec'
import { createPasswordVerifier } from './auth/password'
import { cleanupSessions, createSession, findSessionByHash, hashToken, isSessionValid, newCsrfToken, newSessionToken, revokeSession, touchSession } from './auth/sessions'
import { backfillSlugs } from './slug'
import archiver from 'archiver'

type SpaceRow = { id: string; public_token: string; name: string; created_at: string; updated_at: string }
type FileRow = {
  id: string; public_id: string; space_id: string; folder_id: string | null
  original_name: string; storage_key: string; mime_type: string; size_bytes: number
  uploaded_at: string; status: string; width: number | null; height: number | null
  duration_seconds: number | null; thumbnail_storage_key: string | null
  deleted_at: string | null; folder_public_id: string | null; slug: string | null
}

const FILE_SELECT = `SELECT f.id, f.public_id, f.space_id, f.folder_id, f.original_name, f.storage_key, f.mime_type, f.size_bytes, f.uploaded_at, f.status, f.width, f.height, f.duration_seconds, f.thumbnail_storage_key, f.deleted_at, f.slug, fol.public_id AS folder_public_id FROM files f LEFT JOIN folders fol ON fol.id = f.folder_id`

/** Strip path separators and leading dots from a ZIP entry name. */
const zipEntryName = (name: string) => (name.replace(/[\\/]/g, '_').replace(/^\.+/, '').trim() || 'file').slice(0, 200)

export function buildServer(overrides: Partial<typeof config> = {}) {
  const settings = { ...config, ...overrides }
  validateConfig(settings)
  const db = openDatabase(settings.databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  backfillSlugs(db)
  const storage = new FileStorage(settings.storageRoot)
  const mediaProcessor = new MediaProcessor(db, storage, settings)
  const processingQueue = new ProcessingQueue({ concurrency: settings.mediaProcessingConcurrency, retryDelayMs: settings.mediaRetryDelayMs, run: (id) => mediaProcessor.process(id) })
  const app = Fastify({
    logger: {
      level: settings.logLevel,
      serializers: {
        req(request) {
          return {
            id: request.id,
            method: request.method,
            url: redactUrl(request.url),
            remoteAddress: request.ip,
          }
        },
      },
    },
    requestIdHeader: 'x-request-id',
    trustProxy: true,
    bodyLimit: settings.uploadChunkSizeBytes + 1024 * 1024,
  })

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
  })

  app.decorate('processingQueue', processingQueue)
  app.decorate('db', db)
  app.decorate('storage', storage)

  app.get('/health/live', async () => ({ status: 'ok', version: settings.appVersion }))

  app.get('/health/ready', async (_request, reply) => {
    let dbOk = true
    try { db.prepare('SELECT 1 AS ok').get() } catch { dbOk = false }
    const storageOk = storage.probeWritable()
    if (dbOk && storageOk) return { status: 'ready', version: settings.appVersion }
    return reply.code(503).send({ status: 'unavailable', version: settings.appVersion })
  })

  app.register(cors, {
    origin: (origin, callback) => callback(null, !origin || settings.frontendOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'X-Checksum-Sha256', 'X-CSRF-Token'],
    credentials: true,
    maxAge: 86400,
  })
  app.register(cookie)
  app.register(multipart, { limits: { files: 1, fields: 10, fieldSize: 1024 * 1024, parts: 20 } })
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))

  const rateLimit = createRateLimiter(settings.rateLimitMax, settings.rateLimitWindowMs)
  app.addHook('onRequest', async (request) => {
    if (request.method === 'OPTIONS') return
    if (!rateLimit(request)) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.')
  })

  const passwordVerifier = createPasswordVerifier({ hash: settings.accessPasswordHash, plaintext: settings.accessPassword })
  const authRateLimit = createRateLimiter(settings.authRateLimitMax, settings.authRateLimitWindowMs)
  const CSRF_COOKIE = 'barnus_csrf'
  const PUBLIC_PATHS = new Set(['/health/live', '/health/ready', '/api/v1/auth/login', '/api/v1/auth/session', '/api/v1/auth/logout'])
  const isPublic = (request: FastifyRequest) => PUBLIC_PATHS.has(request.url.split('?')[0])

  app.addHook('onRequest', async (request) => {
    if (settings.authDisabled || request.method === 'OPTIONS' || isPublic(request)) return
    const token = request.cookies[settings.sessionCookieName] as string | undefined
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.')
    const row = findSessionByHash(db, hashToken(token))
    const now = new Date().toISOString()
    if (!row || !isSessionValid(row, now)) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.')
    if (Date.parse(row.last_seen_at) < Date.now() - 60_000) touchSession(db, row.id, now)
  })

  app.addHook('preHandler', async (request) => {
    if (settings.authDisabled || isPublic(request)) return
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) return
    const header = request.headers['x-csrf-token']
    const cookieToken = request.cookies[CSRF_COOKIE] as string | undefined
    if (typeof header !== 'string' || header.length === 0 || header !== cookieToken) {
      throw new ApiError(403, 'CSRF_MISMATCH', 'Invalid CSRF token.')
    }
  })

  let activeUploads = 0
  const activeTempIds = new Set<string>()
  const tempCleanup = () => storage.cleanupStaleTemps(settings.tempFileMaxAgeMs, activeTempIds)
  tempCleanup()
  const cleanupInterval = setInterval(tempCleanup, settings.tempCleanupIntervalMs)
  cleanupInterval.unref()
  app.addHook('onClose', () => clearInterval(cleanupInterval))

  const sessionCleanup = () => cleanupSessions(db, new Date().toISOString())
  sessionCleanup()
  const authSessionInterval = setInterval(sessionCleanup, settings.uploadSessionCleanupIntervalMs)
  authSessionInterval.unref()
  app.addHook('onClose', () => clearInterval(authSessionInterval))

  // Requeue media jobs interrupted by a previous shutdown/restart.
  for (const id of mediaProcessor.findReconcileableIds()) processingQueue.enqueue(id)

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } })
    }
    const statusCode = (error as { statusCode?: number }).statusCode
    const code = (error as { code?: string }).code
    if (code === 'FST_ERR_VALIDATION') {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'The request is invalid.' } })
    }
    if (statusCode === 413) {
      return reply.code(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'This file exceeds the upload limit.' } })
    }
    if (statusCode === 415 || code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply.code(415).send({ error: { code: 'INVALID_REQUEST', message: 'This content type is not supported.' } })
    }
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } })
  })

  const space = (token: string) => db.prepare('SELECT id, public_token, name, created_at, updated_at FROM shared_spaces WHERE public_token = ?').get(token) as SpaceRow | undefined
  const requireSpace = (token: string) => {
    const found = space(token)
    if (!found) throw new ApiError(404, 'SPACE_NOT_FOUND', 'This shared space does not exist.')
    return found
  }

  const fileResponse = (row: FileRow) => ({
    id: row.public_id,
    name: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
    folderId: row.folder_public_id ?? null,
    status: row.status,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    hasThumbnail: Boolean(row.thumbnail_storage_key),
    slug: row.slug,
  })

  const cookieOptions = (request: FastifyRequest) => ({
    path: '/',
    domain: settings.sessionCookieDomain || undefined,
    httpOnly: true,
    secure: request.protocol === 'https',
    sameSite: 'lax' as const,
    maxAge: settings.sessionTtlDays * 86400,
  })

  app.post('/api/v1/auth/login', async (request, reply) => {
    if (!authRateLimit(request)) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please try again shortly.')
    const password = (request.body as { password?: unknown } | undefined)?.password
    if (typeof password !== 'string') throw new ApiError(400, 'INVALID_REQUEST', 'A password is required.')
    const ok = await passwordVerifier.verify(password)
    if (!ok) throw new ApiError(401, 'INVALID_PASSWORD', 'Invalid password.')
    const token = newSessionToken()
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + settings.sessionTtlDays * 86400000).toISOString()
    createSession(db, hashToken(token), expiresAt, now)
    const csrf = newCsrfToken()
    reply.setCookie(settings.sessionCookieName, token, cookieOptions(request))
    reply.setCookie(CSRF_COOKIE, csrf, { ...cookieOptions(request), httpOnly: false })
    return { authenticated: true }
  })

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[settings.sessionCookieName] as string | undefined
    if (token) revokeSession(db, hashToken(token), new Date().toISOString())
    reply.clearCookie(settings.sessionCookieName, { path: '/', domain: settings.sessionCookieDomain || undefined })
    reply.clearCookie(CSRF_COOKIE, { path: '/', domain: settings.sessionCookieDomain || undefined })
    return { authenticated: false }
  })

  app.get('/api/v1/auth/session', async (request) => {
    const token = request.cookies[settings.sessionCookieName] as string | undefined
    if (token) {
      const row = findSessionByHash(db, hashToken(token))
      if (row && isSessionValid(row, new Date().toISOString())) return { authenticated: true }
    }
    return { authenticated: false }
  })

  app.get('/api/v1/files/by-slug/:slug', async (request) => {
    const { slug } = request.params as { slug: string }
    const row = db.prepare(`${FILE_SELECT} WHERE f.slug = ? AND f.deleted_at IS NULL`).get(slug) as FileRow | undefined
    if (!row) throw new ApiError(404, 'FILE_NOT_FOUND', 'This file is not available.')
    const spaceRow = db.prepare('SELECT public_token FROM shared_spaces WHERE id = ?').get(row.space_id) as { public_token: string }
    return { spaceToken: spaceRow.public_token, file: fileResponse(row) }
  })

  const normalizeIds = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
      throw new ApiError(400, 'INVALID_REQUEST', 'A valid list of file ids is required.')
    }
    const ids = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    if (ids.length === 0) throw new ApiError(400, 'INVALID_REQUEST', 'A valid list of file ids is required.')
    return [...new Set(ids)]
  }

  const uploadCtx = {
    db, storage, settings, processingQueue, requireSpace,
    fileResponseFor: (publicId: string) => fileResponse(db.prepare(`${FILE_SELECT} WHERE f.public_id = ?`).get(publicId) as FileRow),
  }
  registerUploadSessionRoutes(app, uploadCtx)
  cleanupUploadSessions(uploadCtx)
  const sessionCleanupInterval = setInterval(() => cleanupUploadSessions(uploadCtx), settings.uploadSessionCleanupIntervalMs)
  sessionCleanupInterval.unref()
  app.addHook('onClose', () => clearInterval(sessionCleanupInterval))

  app.get('/api/v1/spaces/:token', async (request) => {
    const found = requireSpace((request.params as { token: string }).token)
    return { token: found.public_token, name: found.name, createdAt: found.created_at, updatedAt: found.updated_at }
  })

  app.get('/api/v1/spaces/:token/folders', async (request) => {
    const found = requireSpace((request.params as { token: string }).token)
    const rows = db.prepare('SELECT id, public_id, name, created_at FROM folders WHERE space_id = ? ORDER BY name').all(found.id) as Array<{ public_id: string; name: string; created_at: string }>
    return rows.map((row) => ({ id: row.public_id, name: row.name, createdAt: row.created_at }))
  })

  const listFiles = (trash: boolean) => async (request: FastifyRequest<{ Params: { token: string } }>) => {
    const found = requireSpace(request.params.token)
    const rows = db.prepare(`${FILE_SELECT} WHERE f.space_id = ? AND f.deleted_at IS ${trash ? 'NOT ' : ''}NULL ORDER BY f.uploaded_at DESC`).all(found.id) as FileRow[]
    return rows.map(fileResponse)
  }
  app.get('/api/v1/spaces/:token/files', listFiles(false))
  app.get('/api/v1/spaces/:token/trash', listFiles(true))

  app.get('/api/v1/spaces/:token/files/:publicFileId', async (request) => {
    const { token, publicFileId } = request.params as { token: string; publicFileId: string }
    const found = requireSpace(token)
    const row = db.prepare(`${FILE_SELECT} WHERE f.space_id = ? AND f.public_id = ?`).get(found.id, publicFileId) as FileRow | undefined
    if (!row) throw new ApiError(404, 'FILE_NOT_FOUND', 'This file does not exist.')
    return fileResponse(row)
  })

  app.get('/api/v1/spaces/:token/files/:publicFileId/content', async (request, reply) => {
    const { token, publicFileId } = request.params as { token: string; publicFileId: string }
    const found = requireSpace(token)
    const row = db.prepare(`${FILE_SELECT} WHERE f.space_id = ? AND f.public_id = ? AND f.deleted_at IS NULL`).get(found.id, publicFileId) as FileRow | undefined
    if (!row || !storage.exists(row.storage_key)) throw new ApiError(404, 'FILE_NOT_FOUND', 'This file does not exist.')
    const size = storage.getMetadata(row.storage_key).size
    let range
    try { range = parseRange(request.headers.range, size) } catch { return reply.code(416).header('Content-Range', `bytes */${size}`).send() }
    const download = (request.query as { download?: string }).download === '1'
    const inline = !download && canPreviewInline(row.mime_type)
    reply.header('Content-Type', row.mime_type).header('Content-Disposition', contentDisposition(row.original_name, inline)).header('Cache-Control', 'private, max-age=3600').header('Accept-Ranges', 'bytes')
    if (range) {
      reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`).header('Content-Length', String(range.end - range.start + 1))
      return reply.send(storage.createReadStream(row.storage_key, range))
    }
    reply.header('Content-Length', String(size))
    return reply.send(storage.createReadStream(row.storage_key))
  })

  app.get('/api/v1/spaces/:token/download', async (request, reply) => {
    const found = requireSpace((request.params as { token: string }).token)
    const raw = (request.query as { ids?: string }).ids ?? ''
    const ids = [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))]
    if (ids.length === 0 || ids.length > 500) throw new ApiError(400, 'INVALID_REQUEST', 'A valid list of file ids is required.')
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(`${FILE_SELECT} WHERE f.space_id = ? AND f.public_id IN (${placeholders}) AND f.deleted_at IS NULL`).all(found.id, ...ids) as FileRow[]
    const byId = new Map(rows.map((row) => [row.public_id, row]))
    const files = ids.map((id) => byId.get(id)).filter((row): row is FileRow => row !== undefined && storage.exists(row.storage_key))
    if (files.length === 0) throw new ApiError(404, 'FILE_NOT_FOUND', 'None of the requested files are available.')

    // De-duplicate entry names so the archive never contains two identical paths.
    const used = new Set<string>()
    const names = files.map((row) => {
      const base = zipEntryName(row.original_name)
      let candidate = base
      let counter = 2
      while (used.has(candidate)) candidate = `${base.slice(0, 180)} (${counter++})`
      used.add(candidate)
      return candidate
    })

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('shared-files.zip', false),
      'Cache-Control': 'private, max-age=0',
    })
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('warning', (error) => { if (error.code !== 'ENOENT') request.log.warn({ err: error }, 'zip archive warning') })
    archive.on('error', (error) => { request.log.error({ err: error }, 'zip archive failed'); reply.raw.destroy(error) })
    archive.pipe(reply.raw)
    for (let index = 0; index < files.length; index += 1) archive.append(storage.createReadStream(files[index].storage_key), { name: names[index] })
    await archive.finalize()
  })

  app.get('/api/v1/spaces/:token/files/:publicFileId/thumbnail', async (request, reply) => {
    const { token, publicFileId } = request.params as { token: string; publicFileId: string }
    const found = requireSpace(token)
    const row = db.prepare(`${FILE_SELECT} WHERE f.space_id = ? AND f.public_id = ? AND f.deleted_at IS NULL`).get(found.id, publicFileId) as FileRow | undefined
    if (!row) throw new ApiError(404, 'FILE_NOT_FOUND', 'This file does not exist.')
    if (!row.thumbnail_storage_key || !storage.exists(row.thumbnail_storage_key)) throw new ApiError(404, 'THUMBNAIL_NOT_FOUND', 'No preview is available for this file.')
    const size = storage.getMetadata(row.thumbnail_storage_key).size
    reply.header('Content-Type', 'image/webp')
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    reply.header('Content-Length', String(size))
    return reply.send(storage.createReadStream(row.thumbnail_storage_key))
  })

  app.post('/api/v1/spaces/:token/folders', async (request, reply) => {
    const found = requireSpace((request.params as { token: string }).token)
    const body = (request.body ?? {}) as { name?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw new ApiError(400, 'INVALID_FOLDER', 'Folder name is required.')
    if (name.length > 255) throw new ApiError(400, 'INVALID_FOLDER', 'Folder name is too long.')
    const existing = db.prepare('SELECT id FROM folders WHERE space_id = ? AND name = ?').get(found.id, name)
    if (existing) throw new ApiError(409, 'FOLDER_EXISTS', 'A folder with this name already exists.')
    const id = randomUUID()
    const publicId = randomUUID()
    const now = new Date().toISOString()
    db.prepare('INSERT INTO folders (id, public_id, space_id, name, created_at) VALUES (?, ?, ?, ?, ?)').run(id, publicId, found.id, name, now)
    return reply.code(201).send({ folder: { id: publicId, name, createdAt: now } })
  })

  app.post('/api/v1/spaces/:token/files', async (request, reply) => {
    const found = requireSpace((request.params as { token: string }).token)
    if (!request.isMultipart()) throw new ApiError(400, 'INVALID_REQUEST', 'Uploads must use multipart/form-data.')
    if (activeUploads >= settings.uploadConcurrency) throw new ApiError(429, 'TOO_MANY_CONCURRENT', 'Too many uploads are in progress. Please try again shortly.')

    activeUploads++
    const uploadId = randomUUID()
    activeTempIds.add(uploadId)
    let tempCreated = false
    let finalized = false

    try {
      let folderId: string | null = null
      let originalName = ''
      let receivedFile = false
      let totalBytes = 0
      const sniff: Buffer[] = []
      let sniffed = 0

      const parts = request.parts()
      for await (const part of parts) {
        if (part.type === 'field') {
          if (part.fieldname === 'folderId') {
            const value = typeof part.value === 'string' ? part.value.trim() : ''
            folderId = value || null
          }
          continue
        }

        if (receivedFile) {
          part.file.resume()
          throw new ApiError(400, 'TOO_MANY_FILES', 'Only one file may be uploaded per request.')
        }
        receivedFile = true
        originalName = (part.filename ?? '').trim()
        if (!originalName || originalName.length > MAX_FILENAME_LENGTH || originalName.includes('\u0000')) {
          part.file.resume()
          throw new ApiError(400, 'INVALID_FILENAME', 'The filename is missing or too long.')
        }

        const writeStream = storage.createTempWriteStream(uploadId)
        tempCreated = true

        const meter = new Transform({
          transform(this: Transform, chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
            totalBytes += chunk.length
            if (totalBytes > settings.maxUploadBytes) {
              callback(new ApiError(413, 'FILE_TOO_LARGE', 'This file exceeds the upload limit.'))
              return
            }
            if (sniffed < 512) {
              const take = chunk.subarray(0, Math.min(512 - sniffed, chunk.length))
              sniff.push(Buffer.from(take))
              sniffed += take.length
            }
            this.push(chunk)
            callback()
          },
        })

        await pipeline(part.file, meter, writeStream)
      }

      if (!receivedFile) throw new ApiError(400, 'FILE_REQUIRED', 'No file was provided.')
      if (totalBytes === 0) throw new ApiError(400, 'FILE_EMPTY', 'Empty files cannot be uploaded.')

      const mimeType = detectFileType(Buffer.concat(sniff))
      if (!mimeType) throw new ApiError(400, 'INVALID_FILE_TYPE', 'This file type is not supported.')

      let folderInternalId: string | null = null
      if (folderId) {
        const folderRow = db.prepare('SELECT id FROM folders WHERE public_id = ? AND space_id = ?').get(folderId, found.id) as { id: string } | undefined
        if (!folderRow) throw new ApiError(400, 'INVALID_FOLDER', 'The target folder does not exist in this space.')
        folderInternalId = folderRow.id
      }

      const { publicId } = finalizeUploadedFile({
        db, storage, settings, processingQueue,
        spaceId: found.id,
        folderInternalId,
        originalName,
        mimeType,
        sizeBytes: totalBytes,
        sourcePath: storage.getTempPath(uploadId),
      })
      finalized = true

      const row = db.prepare(`${FILE_SELECT} WHERE f.space_id = ? AND f.public_id = ?`).get(found.id, publicId) as FileRow
      return reply.code(201).send({ file: fileResponse(row) })
    } catch (error) {
      if (tempCreated && !finalized) storage.removeTemp(uploadId)
      throw error
    } finally {
      activeTempIds.delete(uploadId)
      activeUploads--
    }
  })
  app.post('/api/v1/spaces/:token/trash', async (request) => {
    const found = requireSpace((request.params as { token: string }).token)
    const ids = normalizeIds((request.body as { ids?: unknown } | undefined)?.ids)
    const now = new Date().toISOString()
    const moved: FileRow[] = []
    db.transaction(() => {
      for (const id of ids) {
        const row = db.prepare(`${FILE_SELECT} WHERE f.space_id = ? AND f.public_id = ?`).get(found.id, id) as FileRow | undefined
        if (!row) throw new ApiError(404, 'FILE_NOT_FOUND', 'A file was not found.')
        if (row.deleted_at) continue
        db.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').run(now, row.id)
        moved.push({ ...row, deleted_at: now })
      }
    })()
    return { files: moved.map(fileResponse) }
  })

  app.post('/api/v1/spaces/:token/restore', async (request) => {
    const found = requireSpace((request.params as { token: string }).token)
    const ids = normalizeIds((request.body as { ids?: unknown } | undefined)?.ids)
    const restored: FileRow[] = []
    db.transaction(() => {
      for (const id of ids) {
        const row = db.prepare(`${FILE_SELECT} WHERE f.space_id = ? AND f.public_id = ?`).get(found.id, id) as FileRow | undefined
        if (!row) throw new ApiError(404, 'FILE_NOT_FOUND', 'A file was not found.')
        if (!row.deleted_at) continue
        db.prepare('UPDATE files SET deleted_at = NULL WHERE id = ?').run(row.id)
        restored.push({ ...row, deleted_at: null })
      }
    })()
    return { files: restored.map(fileResponse) }
  })

  app.delete('/api/v1/spaces/:token/trash', async (request) => {
    const found = requireSpace((request.params as { token: string }).token)
    const ids = normalizeIds((request.body as { ids?: unknown } | undefined)?.ids)
    let deleted = 0
    for (const id of ids) {
      const row = db.prepare(`${FILE_SELECT} WHERE f.space_id = ? AND f.public_id = ?`).get(found.id, id) as FileRow | undefined
      if (!row) throw new ApiError(404, 'FILE_NOT_FOUND', 'A file was not found.')
      if (!row.deleted_at) throw new ApiError(409, 'NOT_IN_TRASH', 'Only files in Trash can be permanently deleted.')
      try {
        if (row.thumbnail_storage_key) storage.remove(row.thumbnail_storage_key)
        storage.remove(row.storage_key)
      } catch {
        throw new ApiError(500, 'STORAGE_ERROR', 'The file could not be fully removed. Please try again.')
      }
      db.prepare('DELETE FROM files WHERE id = ?').run(row.id)
      deleted++
    }
    return { deleted }
  })

  return app
}

if (require.main === module) {
  const app = buildServer()
  const access = app as unknown as { processingQueue: ProcessingQueue; db: { close: () => void } }
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutdown initiated')
    access.processingQueue.stop()
    const forceExit = setTimeout(() => {
      app.log.error('graceful shutdown timed out; forcing exit')
      process.exit(1)
    }, config.shutdownGracePeriodMs)
    forceExit.unref()
    try {
      await app.close()
    } catch (error) {
      app.log.error({ error }, 'error during shutdown')
    } finally {
      clearTimeout(forceExit)
      try { access.db.close() } catch { /* already closed */ }
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })

  void Promise.all([binaryAvailable(config.ffmpegPath), binaryAvailable(config.ffprobePath)]).then(([ffmpeg, ffprobe]) => {
    if (!ffmpeg || !ffprobe) app.log.warn('ffmpeg/ffprobe not found; video poster/metadata processing will be unavailable.')
  })

  app.listen({ port: config.port, host: '127.0.0.1' }).catch((error) => {
    app.log.error({ error }, 'failed to start')
    process.exit(1)
  })
}
