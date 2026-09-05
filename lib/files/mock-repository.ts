import type { FileSpaceRepository } from './repository'
import type { Folder, SharedFile } from './types'

const folders: Folder[] = [
  { id: 'all', name: 'All files', tone: 'bg-secondary' },
  { id: 'design', name: 'Design references', tone: 'bg-[#e7eee9]' },
  { id: 'projects', name: 'Projects', tone: 'bg-[#eee9e1]' },
  { id: 'personal', name: 'Personal', tone: 'bg-[#e4ebee]' },
]

const seedFiles: SharedFile[] = [
  { id: 'file-coastal-morning', name: 'coastal-morning.jpg', kind: 'image', sizeBytes: 4_800_000, uploadedLabel: '12 min ago', uploadedAt: 6, src: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=1000&q=80', thumbnailUrl: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=400&q=80', status: 'ready', color: 'bg-[#dfe9ec]', folderId: 'personal' },
  { id: 'file-img-2841', name: 'IMG_2841.MOV', kind: 'video', sizeBytes: 128_000_000, uploadedLabel: '18 min ago', uploadedAt: 5, status: 'ready', color: 'bg-[#d8e3e8]', folderId: 'personal' },
  { id: 'file-team-lunch', name: 'team-lunch.png', kind: 'image', sizeBytes: 2_100_000, uploadedLabel: '31 min ago', uploadedAt: 4, src: 'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?w=1000&q=80', thumbnailUrl: 'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?w=400&q=80', status: 'ready', color: 'bg-[#eadfd2]', folderId: 'projects' },
  { id: 'file-project-notes', name: 'project-notes.pdf', kind: 'document', sizeBytes: 840_000, uploadedLabel: '1 hr ago', uploadedAt: 3, status: 'ready', color: 'bg-[#e9e7e2]', folderId: 'projects' },
  { id: 'file-forest-walk', name: 'forest-walk.mp4', kind: 'video', sizeBytes: 76_000_000, uploadedLabel: '2 hrs ago', uploadedAt: 2, status: 'ready', color: 'bg-[#dce5db]', folderId: 'design' },
  { id: 'file-receipt-march', name: 'receipt-march.pdf', kind: 'document', sizeBytes: 1_200_000, uploadedLabel: 'Yesterday', uploadedAt: 1, status: 'ready', color: 'bg-[#e8e5df]', folderId: 'design' },
]

export class MockFileSpaceRepository implements FileSpaceRepository {
  private files = [...seedFiles]
  private trash: SharedFile[] = []
  private folders = [...folders]

  async load() { /* mock repository is already populated */ }
  async refreshFiles() { /* mock repository updates state synchronously */ }

  listFiles = () => [...this.files]
  listTrash = () => [...this.trash]
  listFolders = () => [...this.folders]

  createFolder = (name: string) => {
    const folder: Folder = { id: `folder-${crypto.randomUUID()}`, name, tone: 'bg-[#e9e6ef]' }
    this.folders = [...this.folders, folder]
    return Promise.resolve(folder)
  }

  uploadFile = (file: File, folderId: string | null, onProgress: (progress: number) => void, signal?: AbortSignal) => {
    return new Promise<SharedFile>((resolve, reject) => {
      const created: SharedFile = {
        id: `file-${crypto.randomUUID()}`,
        name: file.name,
        kind: file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : 'document',
        sizeBytes: file.size,
        uploadedLabel: 'Just now',
        uploadedAt: Date.now(),
        status: 'ready',
        color: 'bg-secondary',
        folderId: folderId ?? 'projects',
      }
      let progress = 0
      let timer = 0
      const onAbort = () => {
        window.clearInterval(timer)
        reject(new Error('Upload cancelled'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) return onAbort()
      timer = window.setInterval(() => {
        progress = Math.min(100, progress + 20)
        onProgress(progress)
        if (progress === 100) {
          window.clearInterval(timer)
          signal?.removeEventListener('abort', onAbort)
          this.files = [created, ...this.files]
          resolve(created)
        }
      }, 200)
    })
  }

  deleteFiles = (ids: string[]) => {
    const moving = this.files.filter((file) => ids.includes(file.id))
    this.files = this.files.filter((file) => !ids.includes(file.id))
    this.trash = [...moving, ...this.trash]
    return Promise.resolve(moving)
  }

  restoreFiles = (ids: string[]) => {
    const restoring = this.trash.filter((file) => ids.includes(file.id))
    this.trash = this.trash.filter((file) => !ids.includes(file.id))
    this.files = [...restoring, ...this.files]
    return Promise.resolve(restoring)
  }

  permanentlyDeleteFiles = (ids: string[]) => {
    this.trash = ids.length ? this.trash.filter((file) => !ids.includes(file.id)) : []
    return Promise.resolve()
  }
}
