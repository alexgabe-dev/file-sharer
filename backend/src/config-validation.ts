import { parse, resolve, sep } from 'node:path'
import type { config } from './config'

/** Fail fast on clearly-unsafe or invalid configuration before opening resources. */
export function validateConfig(settings: typeof config) {
  const root = resolve(settings.storageRoot)
  if (!root || root === parse(root).root || root === sep) {
    throw new Error('FILE_STORAGE_ROOT must be a dedicated directory, not the filesystem root.')
  }
  if (settings.frontendOrigins.length === 0) throw new Error('FRONTEND_ORIGIN must specify at least one exact origin.')
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) throw new Error('PORT is invalid.')
  if (settings.uploadChunkSizeBytes < 1) throw new Error('UPLOAD_CHUNK_SIZE_BYTES must be positive.')
}
