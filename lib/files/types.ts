export type FileKind = 'image' | 'video' | 'document'
export type FileStatus = 'processing' | 'ready' | 'failed'
export type UploadStatus = 'queued' | 'preparing' | 'uploading' | 'paused' | 'finalizing' | 'processing' | 'complete' | 'failed' | 'cancelled' | 'reselect'

export type SharedFile = {
  id: string
  name: string
  kind: FileKind
  sizeBytes: number
  uploadedLabel: string
  uploadedAt: number
  src?: string
  thumbnailUrl?: string
  downloadUrl?: string
  status: FileStatus
  width?: number
  height?: number
  durationSeconds?: number
  slug?: string
  color: string
  folderId: string
}

export type Folder = { id: string; name: string; tone: string }

export type UploadItem = {
  id: string
  name: string
  sizeBytes: number
  kind: FileKind
  progress: number
  status: UploadStatus
  folderId: string | null
  error?: string
  /** For `failed` items: whether a Retry could plausibly succeed. */
  retryable?: boolean
}

export type FileSort = 'Newest' | 'Oldest' | 'Name' | 'Largest'
