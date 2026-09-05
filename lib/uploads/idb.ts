import type { FileKind } from '@/lib/files/types'

export type PersistedUpload = {
  localId: string
  uploadId: string | null
  token: string
  name: string
  sizeBytes: number
  kind: FileKind
  folderId: string | null
  lastModified: number
  chunkSizeBytes: number
  totalChunks: number
  receivedChunks: number[]
  createdAt: number
}

const DB_NAME = 'shared-files-uploads'
const DB_VERSION = 1
const RECORDS = 'records'
const BLOBS = 'blobs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'localId' })
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'localId' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    } catch (error) {
      reject(error)
    }
  })
}

function request<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    const store = db.transaction(storeName, mode).objectStore(storeName)
    return await request(run(store))
  } finally {
    db.close()
  }
}

export async function putUploadRecord(record: PersistedUpload): Promise<void> {
  await withStore(RECORDS, 'readwrite', (store) => store.put(record))
}

export async function getUploadRecords(): Promise<PersistedUpload[]> {
  const result = await withStore(RECORDS, 'readonly', (store) => store.getAll())
  return result as PersistedUpload[]
}

export async function deleteUploadRecord(localId: string): Promise<void> {
  await withStore(RECORDS, 'readwrite', (store) => store.delete(localId))
}

export async function putUploadBlob(localId: string, blob: Blob): Promise<void> {
  await withStore(BLOBS, 'readwrite', (store) => store.put({ localId, blob }))
}

export async function getUploadBlob(localId: string): Promise<Blob | undefined> {
  const result = await withStore(BLOBS, 'readonly', (store) => store.get(localId))
  const entry = result as { localId: string; blob: Blob } | undefined
  return entry?.blob
}

export async function deleteUpload(localId: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([RECORDS, BLOBS], 'readwrite')
      tx.objectStore(RECORDS).delete(localId)
      tx.objectStore(BLOBS).delete(localId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
