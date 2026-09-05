// Client-side file-type gate that mirrors the backend's allowlist
// (backend/src/security/upload.ts). It is a UX fast-path only: the backend
// still performs authoritative content sniffing on finalize.

const SUPPORTED_FILE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif',
  'mp4', 'mov', 'webm', 'pdf',
])

export function fileExtension(name: string): string {
  const base = name.split('/').pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * Returns a human-readable reason the file should be rejected up front, or
 * `null` when the file looks acceptable (the backend remains authoritative).
 * Files with no extension are allowed so content sniffing can decide.
 */
export function unsupportedFileReason(name: string): string | null {
  const ext = fileExtension(name)
  if (ext && !SUPPORTED_FILE_EXTENSIONS.has(ext)) return 'Unsupported file type'
  return null
}
