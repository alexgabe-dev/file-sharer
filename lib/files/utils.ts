import type { FileKind } from './types'

export function formatSize(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1_000))} KB`
}

export function fileKindFor(file: File): FileKind {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  return 'document'
}

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}
