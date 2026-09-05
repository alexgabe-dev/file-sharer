import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, parse, resolve, sep } from 'node:path'

const STORAGE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/
const UPLOAD_ID_PATTERN = /^[a-zA-Z0-9-]+$/

export class FileStorage {
  private root: string
  private objectsDir: string
  private thumbsDir: string
  private tmpDir: string
  private sessionsDir: string

  constructor(root: string) {
    this.root = resolve(root)
    const rootParsed = parse(this.root).root
    if (!this.root || this.root === rootParsed || this.root === sep) {
      throw new Error('Storage root must be a dedicated directory, not the filesystem root.')
    }
    this.objectsDir = join(this.root, 'objects')
    this.thumbsDir = join(this.root, 'thumbs')
    this.tmpDir = join(this.root, 'tmp')
    this.sessionsDir = join(this.root, 'upload-sessions')
    mkdirSync(this.objectsDir, { recursive: true })
    mkdirSync(this.thumbsDir, { recursive: true })
    mkdirSync(this.tmpDir, { recursive: true })
    mkdirSync(this.sessionsDir, { recursive: true })
  }

  getRoot() { return this.root }

  /** Verify the storage directory is writable without leaving anything behind. */
  probeWritable(): boolean {
    const probe = this.tempFilePath('probe')
    try {
      writeFileSync(probe, 'ok')
      rmSync(probe, { force: true })
      return true
    } catch {
      return false
    }
  }

  resolveInternalPath(storageKey: string) {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) throw new Error('Invalid storage key')
    const path = resolve(this.root, storageKey)
    if (!path.startsWith(`${this.root}${sep}`)) throw new Error('Storage traversal rejected')
    return path
  }

  exists(storageKey: string) { return existsSync(this.resolveInternalPath(storageKey)) }
  getMetadata(storageKey: string) { return statSync(this.resolveInternalPath(storageKey)) }
  createReadStream(storageKey: string, options?: { start?: number; end?: number }) { return createReadStream(this.resolveInternalPath(storageKey), options) }

  private tempPath(uploadId: string) {
    if (!UPLOAD_ID_PATTERN.test(uploadId)) throw new Error('Invalid upload id')
    return join(this.tmpDir, uploadId)
  }

  getTempPath(uploadId: string) { return this.tempPath(uploadId) }

  createTempWriteStream(uploadId: string) {
    return createWriteStream(this.tempPath(uploadId), { flags: 'wx' })
  }

  /** Atomically move a fully-written source file into object storage. */
  moveToObject(sourcePath: string, storageKey: string) {
    renameSync(sourcePath, this.resolveInternalPath(storageKey))
  }

  removeTemp(uploadId: string) {
    try { rmSync(this.tempPath(uploadId), { force: true }) } catch { /* already gone */ }
  }

  /** Remove a stored object. A missing file is treated as already removed. */
  remove(storageKey: string) {
    try { unlinkSync(this.resolveInternalPath(storageKey)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /** Reserve a unique path in the temp directory (not created yet). */
  tempFilePath(label: string) {
    return join(this.tmpDir, `${label}-${randomUUID()}`)
  }

  /** Atomically write a small generated object (e.g. a thumbnail). */
  writeObject(storageKey: string, data: Buffer) {
    const destination = this.resolveInternalPath(storageKey)
    const tempPath = this.tempFilePath('write')
    writeFileSync(tempPath, data)
    try { renameSync(tempPath, destination) } catch (error) { rmSync(tempPath, { force: true }); throw error }
  }

  /** List relative storage keys within a top-level subdirectory. */
  listKeys(subdir: 'objects' | 'thumbs' | 'upload-sessions'): string[] {
    try { return readdirSync(join(this.root, subdir)).map((name) => `${subdir}/${name}`) } catch { return [] }
  }

  /** List temp files older than `maxAgeMs` (for reconciliation reporting). */
  listStaleTemps(maxAgeMs: number): string[] {
    let names: string[]
    try { names = readdirSync(this.tmpDir) } catch { return [] }
    const now = Date.now()
    return names.filter((name) => {
      try { return now - statSync(join(this.tmpDir, name)).mtimeMs > maxAgeMs } catch { return false }
    })
  }

  /** Remove stale temp files older than `maxAgeMs`, skipping any active upload. */
  cleanupStaleTemps(maxAgeMs: number, activeIds: Set<string>) {
    let names: string[]
    try { names = readdirSync(this.tmpDir) } catch { return }
    const now = Date.now()
    for (const name of names) {
      if (activeIds.has(name)) continue
      try {
        const path = join(this.tmpDir, name)
        if (now - statSync(path).mtimeMs > maxAgeMs) unlinkSync(path)
      } catch { /* ignore transient errors */ }
    }
  }

  // ---- Resumable upload session chunk storage ---------------------------

  private sessionDirPath(sessionId: string) {
    if (!UPLOAD_ID_PATTERN.test(sessionId)) throw new Error('Invalid session id')
    return join(this.sessionsDir, sessionId)
  }

  ensureSessionDir(sessionId: string) {
    mkdirSync(this.sessionDirPath(sessionId), { recursive: true })
  }

  chunkPath(sessionId: string, chunkIndex: number) {
    return join(this.sessionDirPath(sessionId), `${String(chunkIndex).padStart(6, '0')}.part`)
  }

  chunkExists(sessionId: string, chunkIndex: number) {
    return existsSync(this.chunkPath(sessionId, chunkIndex))
  }

  /** Atomically write a single chunk (write temp then rename into place). */
  writeChunk(sessionId: string, chunkIndex: number, data: Buffer) {
    const destination = this.chunkPath(sessionId, chunkIndex)
    const tempPath = join(this.tmpDir, `chunk-${randomUUID()}`)
    writeFileSync(tempPath, data)
    try { renameSync(tempPath, destination) } catch (error) { rmSync(tempPath, { force: true }); throw error }
  }

  removeSessionDir(sessionId: string) {
    try { rmSync(this.sessionDirPath(sessionId), { recursive: true, force: true }) } catch { /* already gone */ }
  }

  listSessionChunkFiles(sessionId: string): string[] {
    try { return readdirSync(this.sessionDirPath(sessionId)) } catch { return [] }
  }
}
