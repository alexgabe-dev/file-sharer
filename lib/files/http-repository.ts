import { apiDelete, apiGet, apiJson, uploadFileXhr } from '@/lib/api/client'
import type { ApiFile, ApiFolder, ApiSpace } from '@/lib/api/types'
import { apiFileToShared } from './api-file'
import type { FileSpaceRepository } from './repository'
import type { Folder, SharedFile } from './types'

const toFolder = (folder: ApiFolder): Folder => ({ id: folder.id, name: folder.name, tone: 'bg-[#e9e6ef]' })

export class HttpFileSpaceRepository implements FileSpaceRepository {
  private files: SharedFile[] = []
  private trash: SharedFile[] = []
  private folders: Folder[] = []

  constructor(private token: string) {}

  async load() {
    const [, folders, files, trash] = await Promise.all([
      apiGet<ApiSpace>(`/api/v1/spaces/${encodeURIComponent(this.token)}`),
      apiGet<ApiFolder[]>(`/api/v1/spaces/${encodeURIComponent(this.token)}/folders`),
      apiGet<ApiFile[]>(`/api/v1/spaces/${encodeURIComponent(this.token)}/files`),
      apiGet<ApiFile[]>(`/api/v1/spaces/${encodeURIComponent(this.token)}/trash`),
    ])
    this.folders = [{ id: 'all', name: 'All files', tone: 'bg-secondary' }, ...folders.map(toFolder)]
    this.files = files.map((file) => apiFileToShared(this.token, file))
    this.trash = trash.map((file) => apiFileToShared(this.token, file))
  }

  async refreshFiles() {
    const [files, trash] = await Promise.all([
      apiGet<ApiFile[]>(`/api/v1/spaces/${encodeURIComponent(this.token)}/files`),
      apiGet<ApiFile[]>(`/api/v1/spaces/${encodeURIComponent(this.token)}/trash`),
    ])
    this.files = files.map((file) => apiFileToShared(this.token, file))
    this.trash = trash.map((file) => apiFileToShared(this.token, file))
  }

  listFiles = () => [...this.files]
  listTrash = () => [...this.trash]
  listFolders = () => [...this.folders]

  async createFolder(name: string) {
    const response = await apiJson<{ folder: ApiFolder }>(`/api/v1/spaces/${encodeURIComponent(this.token)}/folders`, { body: { name } })
    const folder = toFolder(response.folder)
    this.folders = [...this.folders, folder]
    return folder
  }

  async uploadFile(file: File, folderId: string | null, onProgress: (progress: number) => void, signal?: AbortSignal) {
    const uploaded = await uploadFileXhr(this.token, file, folderId, onProgress, signal)
    const shared = apiFileToShared(this.token, uploaded)
    this.files = [shared, ...this.files.filter((existing) => existing.id !== shared.id)]
    return shared
  }

  async deleteFiles(ids: string[]) {
    const response = await apiJson<{ files: ApiFile[] }>(`/api/v1/spaces/${encodeURIComponent(this.token)}/trash`, { body: { ids } })
    const moved = response.files.map((file) => apiFileToShared(this.token, file))
    const movedIds = new Set(moved.map((file) => file.id))
    this.files = this.files.filter((file) => !movedIds.has(file.id))
    this.trash = [...moved, ...this.trash.filter((file) => !movedIds.has(file.id))]
    return moved
  }

  async restoreFiles(ids: string[]) {
    const response = await apiJson<{ files: ApiFile[] }>(`/api/v1/spaces/${encodeURIComponent(this.token)}/restore`, { body: { ids } })
    const restored = response.files.map((file) => apiFileToShared(this.token, file))
    const restoredIds = new Set(restored.map((file) => file.id))
    this.trash = this.trash.filter((file) => !restoredIds.has(file.id))
    this.files = [...restored, ...this.files.filter((file) => !restoredIds.has(file.id))]
    return restored
  }

  async permanentlyDeleteFiles(ids: string[]) {
    await apiDelete<{ deleted: number }>(`/api/v1/spaces/${encodeURIComponent(this.token)}/trash`, { ids })
    const deletedIds = new Set(ids)
    this.trash = this.trash.filter((file) => !deletedIds.has(file.id))
  }
}
