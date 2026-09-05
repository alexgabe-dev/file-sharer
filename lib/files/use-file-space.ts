'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MockFileSpaceRepository } from './mock-repository'
import type { FileSort, Folder, SharedFile, UploadItem } from './types'
import { createId, fileKindFor } from './utils'
import { HttpFileSpaceRepository } from './http-repository'
import { ResumableUpload } from '@/lib/uploads/resumable'
import { deleteUpload, getUploadBlob, getUploadRecords, putUploadBlob, putUploadRecord, type PersistedUpload } from '@/lib/uploads/idb'

const MAX_CONCURRENT_UPLOADS = 3
const CHUNK_CONCURRENCY = 3
const mockRepository = new MockFileSpaceRepository()

type PendingUpload = { item: UploadItem; file: File; record: PersistedUpload }

export function useFileSpace(remoteToken?: string) {
  const repository = useMemo(() => (remoteToken ? new HttpFileSpaceRepository(remoteToken) : mockRepository), [remoteToken])

  const [files, setFiles] = useState<SharedFile[]>(() => repository.listFiles())
  const [trash, setTrash] = useState<SharedFile[]>(() => repository.listTrash())
  const [folders, setFolders] = useState<Folder[]>(() => repository.listFolders())
  const [queue, setQueue] = useState<UploadItem[]>([])
  const [remoteError, setRemoteError] = useState(false)
  const [remoteLoading, setRemoteLoading] = useState(Boolean(remoteToken))

  const pending = useRef<PendingUpload[]>([])
  const engines = useRef(new Map<string, ResumableUpload>())
  const activeUploads = useRef(0)
  const pausedRef = useRef(false)
  const pumpRef = useRef<() => void>(() => {})

  const refresh = useCallback(() => {
    setFiles(repository.listFiles())
    setTrash(repository.listTrash())
    setFolders(repository.listFolders())
  }, [repository])

  const hasProcessing = useMemo(
    () => files.some((file) => file.status === 'processing') || trash.some((file) => file.status === 'processing'),
    [files, trash],
  )

  useEffect(() => {
    if (!remoteToken) return
    let active = true
    repository.load().then(() => {
      if (!active) return
      refresh()
      setRemoteLoading(false)
    }).catch(() => {
      if (!active) return
      setRemoteError(true)
      setRemoteLoading(false)
    })
    return () => { active = false }
  }, [repository, remoteToken, refresh])

  // Poll the backend only while processing files exist; stop automatically.
  useEffect(() => {
    if (!remoteToken || !hasProcessing) return
    const timer = window.setInterval(() => {
      repository.refreshFiles().then(() => refresh()).catch(() => { /* transient */ })
    }, 2500)
    return () => window.clearInterval(timer)
  }, [remoteToken, hasProcessing, repository, refresh])

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setQueue((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const removeItem = useCallback((id: string) => {
    setQueue((items) => items.filter((item) => item.id !== id))
  }, [])

  const startEngine = useCallback((token: string, item: UploadItem, file: File, record: PersistedUpload) => {
    const engine = new ResumableUpload(token, file, item.name, item.folderId, item.kind, CHUNK_CONCURRENCY, {
      onStatus: (status) => updateItem(item.id, { status }),
      onProgress: (bytes) => updateItem(item.id, { progress: item.sizeBytes ? Math.min(100, Math.round((bytes / item.sizeBytes) * 100)) : 0 }),
      onFile: () => {
        updateItem(item.id, { status: 'complete', progress: 100 })
        void repository.refreshFiles().then(() => refresh())
        window.setTimeout(() => removeItem(item.id), 1200)
      },
      onError: (message) => updateItem(item.id, { status: 'failed', error: message }),
      onPersist: (next) => { void putUploadRecord(next).catch(() => {}) },
      onDeletePersist: () => { void deleteUpload(record.localId).catch(() => {}) },
      onDone: () => {
        engines.current.delete(item.id)
        activeUploads.current -= 1
        pumpRef.current()
      },
    }, record)
    engines.current.set(item.id, engine)
    void engine.start()
  }, [repository, refresh, removeItem, updateItem])

  const runMockUpload = useCallback((item: UploadItem, file: File) => {
    updateItem(item.id, { status: 'preparing', progress: 0 })
    repository.uploadFile(file, item.folderId, (progress) => {
      updateItem(item.id, { progress, status: 'uploading' })
    }).then(() => {
      updateItem(item.id, { status: 'complete', progress: 100 })
      refresh()
      window.setTimeout(() => removeItem(item.id), 1200)
    }).catch((error) => {
      updateItem(item.id, { status: 'failed', error: error instanceof Error ? error.message : 'Upload failed' })
    })
  }, [repository, refresh, removeItem, updateItem])

  const pump = useCallback(() => {
    if (pausedRef.current) return
    while (activeUploads.current < MAX_CONCURRENT_UPLOADS && pending.current.length > 0) {
      const next = pending.current.shift()
      if (!next) break
      activeUploads.current += 1
      if (remoteToken) startEngine(remoteToken, next.item, next.file, next.record)
      else runMockUpload(next.item, next.file)
    }
  }, [remoteToken, startEngine, runMockUpload])

  useEffect(() => {
    pumpRef.current = pump
  }, [pump])

  const addFiles = useCallback((list: FileList | File[], folderId: string | null) => {
    const entries: PendingUpload[] = Array.from(list).map((file) => {
      const id = createId('upload')
      const item: UploadItem = { id, name: file.name, sizeBytes: file.size, kind: fileKindFor(file), progress: 0, status: 'queued', folderId }
      const record: PersistedUpload = { localId: id, uploadId: null, token: remoteToken ?? '', name: file.name, sizeBytes: file.size, kind: item.kind, folderId, lastModified: file.lastModified, chunkSizeBytes: 0, totalChunks: 0, receivedChunks: [], createdAt: Date.now() }
      return { item, file, record }
    })
    if (entries.length === 0) return
    setQueue((items) => [...entries.map((entry) => entry.item), ...items])
    if (remoteToken) {
      entries.forEach((entry) => {
        void putUploadBlob(entry.item.id, entry.file).catch(() => {})
        void putUploadRecord(entry.record).catch(() => {})
      })
      pending.current.push(...entries)
      pump()
    } else {
      entries.forEach((entry) => runMockUpload(entry.item, entry.file))
    }
  }, [remoteToken, pump, runMockUpload])

  const restoreAndStart = useCallback(async (id: string) => {
    if (!remoteToken) return
    const record = (await getUploadRecords()).find((entry) => entry.localId === id)
    const blob = await getUploadBlob(id)
    if (!blob) {
      updateItem(id, { status: 'reselect', error: 'Select this file again to continue uploading.' })
      return
    }
    const name = record?.name ?? (blob as File).name ?? 'file'
    const item: UploadItem = { id, name, sizeBytes: blob.size, kind: record?.kind ?? fileKindFor(blob as File), progress: 0, status: 'queued', folderId: record?.folderId ?? null }
    updateItem(id, { status: 'queued', progress: 0, error: undefined })
    const finalRecord: PersistedUpload = record ?? { localId: id, uploadId: null, token: remoteToken, name, sizeBytes: blob.size, kind: item.kind, folderId: item.folderId, lastModified: (blob as File).lastModified ?? 0, chunkSizeBytes: 0, totalChunks: 0, receivedChunks: [], createdAt: Date.now() }
    pending.current.push({ item, file: blob as File, record: finalRecord })
    pump()
  }, [remoteToken, pump, updateItem])

  const cancelUpload = useCallback((id: string) => {
    pending.current = pending.current.filter((entry) => entry.item.id !== id)
    const engine = engines.current.get(id)
    if (engine) engine.cancel()
    engines.current.delete(id)
    setQueue((items) => items.filter((item) => item.id !== id))
  }, [])

  const pauseUpload = useCallback((id: string) => {
    engines.current.get(id)?.pause()
  }, [])

  const resumeUpload = useCallback((id: string) => {
    const engine = engines.current.get(id)
    if (engine) engine.resume()
    else void restoreAndStart(id).catch(() => {})
  }, [restoreAndStart])

  const retryUpload = useCallback((id: string) => {
    void restoreAndStart(id).catch(() => {})
  }, [restoreAndStart])

  const reselectFile = useCallback(async (id: string, file: File) => {
    if (!remoteToken) return
    const record = (await getUploadRecords()).find((entry) => entry.localId === id)
    if (record && (record.name !== file.name || record.sizeBytes !== file.size)) {
      updateItem(id, { status: 'failed', error: 'This file does not match the original upload.' })
      return
    }
    void putUploadBlob(id, file).catch(() => {})
    const item: UploadItem = { id, name: file.name, sizeBytes: file.size, kind: fileKindFor(file), progress: 0, status: 'queued', folderId: record?.folderId ?? null }
    updateItem(id, { status: 'queued', progress: 0, error: undefined })
    const finalRecord: PersistedUpload = record ?? { localId: id, uploadId: null, token: remoteToken, name: file.name, sizeBytes: file.size, kind: item.kind, folderId: item.folderId, lastModified: file.lastModified, chunkSizeBytes: 0, totalChunks: 0, receivedChunks: [], createdAt: Date.now() }
    pending.current.push({ item, file, record: finalRecord })
    pump()
  }, [remoteToken, pump, updateItem])

  const pauseAll = useCallback(() => {
    pausedRef.current = true
    engines.current.forEach((engine) => engine.pause())
  }, [])

  const resumeAll = useCallback(() => {
    pausedRef.current = false
    engines.current.forEach((engine) => engine.resume())
    queue.filter((item) => item.status === 'paused' && !engines.current.has(item.id)).forEach((item) => { void restoreAndStart(item.id).catch(() => {}) })
    pumpRef.current()
  }, [queue, restoreAndStart])

  const retryFailed = useCallback(() => {
    queue.filter((item) => item.status === 'failed').forEach((item) => { void restoreAndStart(item.id).catch(() => {}) })
  }, [queue, restoreAndStart])

  const cancelFailed = useCallback(() => {
    const failedIds = queue.filter((item) => item.status === 'failed').map((item) => item.id)
    failedIds.forEach((id) => { void deleteUpload(id).catch(() => {}) })
    setQueue((items) => items.filter((item) => !failedIds.includes(item.id)))
  }, [queue])

  // Restore persisted uploads for this space on load (offer manual resume).
  useEffect(() => {
    if (!remoteToken) return
    let active = true
    void getUploadRecords().then((records) => {
      if (!active) return
      const mine = records.filter((record) => record.token === remoteToken)
      if (mine.length === 0) return
      void Promise.all(mine.map((record) => getUploadBlob(record.localId))).then((blobs) => {
        if (!active) return
        setQueue((items) => {
          const restored: UploadItem[] = mine.map((record, index) => {
            const hasBlob = Boolean(blobs[index])
            return {
              id: record.localId,
              name: record.name,
              sizeBytes: record.sizeBytes,
              kind: record.kind,
              progress: hasBlob && record.chunkSizeBytes ? Math.min(100, Math.round((record.receivedChunks.length * record.chunkSizeBytes) / record.sizeBytes)) : 0,
              status: hasBlob ? 'paused' : 'reselect',
              folderId: record.folderId,
              error: hasBlob ? undefined : 'Select this file again to continue uploading.',
            }
          })
          const existing = new Set(items.map((item) => item.id))
          return [...restored.filter((item) => !existing.has(item.id)), ...items]
        })
      }).catch(() => {})
    }).catch(() => {})
    return () => { active = false }
  }, [remoteToken])

  useEffect(() => () => {
    engines.current.forEach((engine) => engine.cancel())
    pending.current = []
  }, [])

  const createFolder = useCallback(async (name: string) => {
    const folder = await repository.createFolder(name)
    refresh()
    return folder
  }, [refresh, repository])

  const moveToTrash = useCallback(async (ids: string[]) => {
    const moved = await repository.deleteFiles(ids)
    refresh()
    return moved
  }, [refresh, repository])

  const restore = useCallback(async (ids: string[]) => {
    const restored = await repository.restoreFiles(ids)
    refresh()
    return restored
  }, [refresh, repository])

  const permanentlyDelete = useCallback(async (ids: string[]) => {
    await repository.permanentlyDeleteFiles(ids)
    refresh()
  }, [refresh, repository])

  return { files, trash, folders, queue, addFiles, cancelUpload, retryUpload, pauseUpload, resumeUpload, reselectFile, pauseAll, resumeAll, retryFailed, cancelFailed, createFolder, moveToTrash, restore, permanentlyDelete, remoteError, remoteLoading }
}

export function useVisibleFiles(source: SharedFile[], activeFolderId: string, query: string, sort: FileSort, showingTrash: boolean) {
  return useMemo(() => source
    .filter((file) => (showingTrash || activeFolderId === 'all' || file.folderId === activeFolderId) && file.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'Oldest' ? a.uploadedAt - b.uploadedAt : sort === 'Name' ? a.name.localeCompare(b.name) : sort === 'Largest' ? b.sizeBytes - a.sizeBytes : b.uploadedAt - a.uploadedAt), [source, activeFolderId, query, sort, showingTrash])
}

export function folderFileCount(folder: Folder, files: SharedFile[]) {
  return folder.id === 'all' ? files.length : files.filter((file) => file.folderId === folder.id).length
}
