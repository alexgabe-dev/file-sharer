import type { Folder, SharedFile } from './types'

export interface FileSpaceRepository {
  load(): Promise<void>
  refreshFiles(): Promise<void>
  listFiles(): SharedFile[]
  listTrash(): SharedFile[]
  listFolders(): Folder[]
  createFolder(name: string): Promise<Folder>
  uploadFile(file: File, folderId: string | null, onProgress: (progress: number) => void, signal?: AbortSignal): Promise<SharedFile>
  deleteFiles(ids: string[]): Promise<SharedFile[]>
  restoreFiles(ids: string[]): Promise<SharedFile[]>
  permanentlyDeleteFiles(ids: string[]): Promise<void>
}
