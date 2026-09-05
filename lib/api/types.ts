export type ApiSpace = { token: string; name: string; createdAt: string; updatedAt: string }
export type ApiFolder = { id: string; name: string; createdAt: string }
export type FileStatus = 'processing' | 'ready' | 'failed'
export type ApiFile = { id: string; name: string; mimeType: string; sizeBytes: number; uploadedAt: string; folderId: string | null; status: FileStatus; width: number | null; height: number | null; durationSeconds: number | null; hasThumbnail: boolean; slug: string | null }
export type ApiErrorBody = { error?: { code?: string; message?: string } }
