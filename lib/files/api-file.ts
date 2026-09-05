import { contentUrl, downloadUrl, thumbnailUrl } from '@/lib/api/client'
import type { ApiFile } from '@/lib/api/types'
import type { SharedFile } from './types'

const kind = (mime: string): SharedFile['kind'] => mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'document'

export function apiFileToShared(token: string, file: ApiFile): SharedFile {
  const fileKind = kind(file.mimeType)
  return {
    id: file.id,
    name: file.name,
    kind: fileKind,
    sizeBytes: file.sizeBytes,
    uploadedLabel: new Date(file.uploadedAt).toLocaleDateString(),
    uploadedAt: Date.parse(file.uploadedAt),
    src: fileKind === 'document' ? undefined : contentUrl(token, file.id),
    thumbnailUrl: file.hasThumbnail ? thumbnailUrl(token, file.id) : undefined,
    downloadUrl: downloadUrl(token, file.id),
    status: file.status,
    width: file.width ?? undefined,
    height: file.height ?? undefined,
    durationSeconds: file.durationSeconds ?? undefined,
    slug: file.slug ?? undefined,
    color: 'bg-secondary',
    folderId: file.folderId ?? 'all',
  }
}
