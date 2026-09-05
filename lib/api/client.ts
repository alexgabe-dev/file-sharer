import type { ApiErrorBody, ApiFile } from './types'

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '')

export class ApiError extends Error {
  constructor(public status: number, public code?: string, message?: string) {
    super(message ?? (status === 404 ? 'Not found' : 'The file service could not complete the request.'))
    this.name = 'ApiError'
  }
}

function defaultMessage(status: number) {
  if (status === 404) return 'Not found'
  if (status === 413) return 'This file exceeds the upload limit.'
  if (status === 429) return 'Too many requests. Please try again shortly.'
  return 'The file service could not complete the request.'
}

export function csrfToken(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(/(?:^|;\s*)barnus_csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!baseUrl) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'The file service is not configured.')
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, credentials: 'include' })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the file service.')
  }
  if (!response.ok) {
    let body: ApiErrorBody | null = null
    try { body = await response.json() as ApiErrorBody } catch { /* ignore */ }
    throw new ApiError(response.status, body?.error?.code, body?.error?.message ?? defaultMessage(response.status))
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function csrfHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = csrfToken()
  return { Accept: 'application/json', ...extra, ...(token ? { 'X-CSRF-Token': token } : {}) }
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { headers: { Accept: 'application/json' } })
}

export function apiJson<T>(path: string, options: { method?: 'POST' | 'PUT' | 'PATCH'; body?: unknown }): Promise<T> {
  return request<T>(path, {
    method: options.method ?? 'POST',
    headers: csrfHeaders({ 'Content-Type': 'application/json' }),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'DELETE',
    headers: csrfHeaders({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function contentUrl(token: string, fileId: string) {
  if (!baseUrl) return ''
  return `${baseUrl}/api/v1/spaces/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/content`
}

export function thumbnailUrl(token: string, fileId: string) {
  if (!baseUrl) return ''
  return `${baseUrl}/api/v1/spaces/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/thumbnail`
}

export function downloadUrl(token: string, fileId: string) {
  const url = contentUrl(token, fileId)
  if (!url) return ''
  return `${url}?download=1`
}

/** Canonical frontend URL for a file slug (the human share URL). */
export function fileUrl(slug: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/f/${encodeURIComponent(slug)}`
}

export function authLogin(password: string): Promise<{ authenticated: boolean }> {
  return apiJson<{ authenticated: boolean }>('/api/v1/auth/login', { body: { password } })
}

export function authLogout(): Promise<{ authenticated: boolean }> {
  return apiJson<{ authenticated: boolean }>('/api/v1/auth/logout', { body: {} })
}

export function authSession(): Promise<{ authenticated: boolean }> {
  return apiGet<{ authenticated: boolean }>('/api/v1/auth/session')
}

export function fileBySlug(slug: string): Promise<{ spaceToken: string; file: ApiFile }> {
  return apiGet<{ spaceToken: string; file: ApiFile }>(`/api/v1/files/by-slug/${encodeURIComponent(slug)}`)
}

export function uploadUrl(token: string) {
  if (!baseUrl) return ''
  return `${baseUrl}/api/v1/spaces/${encodeURIComponent(token)}/files`
}

export type ApiUploadSession = {
  publicId: string
  status: string
  totalSizeBytes: number
  uploadedBytes: number
  chunkSizeBytes: number
  totalChunks: number
  receivedChunks: number[]
  expiresAt: string
}

export function initUpload(token: string, input: { name: string; sizeBytes: number; mimeType: string; folderId: string | null }): Promise<{ upload: ApiUploadSession }> {
  return apiJson<{ upload: ApiUploadSession }>(`/api/v1/spaces/${encodeURIComponent(token)}/uploads/init`, { body: input })
}

export function getUploadSession(token: string, uploadId: string): Promise<{ upload: ApiUploadSession }> {
  return apiGet<{ upload: ApiUploadSession }>(`/api/v1/spaces/${encodeURIComponent(token)}/uploads/${encodeURIComponent(uploadId)}`)
}

export function completeUpload(token: string, uploadId: string): Promise<{ file: ApiFile }> {
  return apiJson<{ file: ApiFile }>(`/api/v1/spaces/${encodeURIComponent(token)}/uploads/${encodeURIComponent(uploadId)}/complete`, { body: {} })
}

export function cancelUpload(token: string, uploadId: string): Promise<{ cancelled: boolean }> {
  return apiDelete<{ cancelled: boolean }>(`/api/v1/spaces/${encodeURIComponent(token)}/uploads/${encodeURIComponent(uploadId)}`)
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const data = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function uploadChunkXhr(
  token: string,
  uploadId: string,
  chunkIndex: number,
  blob: Blob,
  checksum: string,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!baseUrl) return Promise.reject(new ApiError(503, 'SERVICE_UNAVAILABLE', 'The file service is not configured.'))
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${baseUrl}/api/v1/spaces/${encodeURIComponent(token)}/uploads/${encodeURIComponent(uploadId)}/chunks/${chunkIndex}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-Checksum-Sha256', checksum)
    xhr.withCredentials = true
    xhr.setRequestHeader('X-CSRF-Token', csrfToken())

    const abort = () => xhr.abort()
    signal?.addEventListener('abort', abort, { once: true })

    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded) }
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else {
        let errorBody: ApiErrorBody | null = null
        try { errorBody = JSON.parse(xhr.responseText) as ApiErrorBody } catch { /* ignore */ }
        reject(new ApiError(xhr.status, errorBody?.error?.code, errorBody?.error?.message ?? defaultMessage(xhr.status)))
      }
    }
    xhr.onerror = () => { signal?.removeEventListener('abort', abort); reject(new ApiError(0, 'NETWORK_ERROR', 'The upload failed due to a network error.')) }
    xhr.onabort = () => { signal?.removeEventListener('abort', abort); reject(new ApiError(0, 'UPLOAD_CANCELLED', 'The upload was cancelled.')) }
    xhr.send(blob)
  })
}

/**
 * Stream a file directly from the browser to the backend using XHR so upload
 * progress reflects actual bytes sent. The request is never proxied through
 * Vercel. Aborting the supplied signal cancels the underlying request.
 */
export function uploadFileXhr(
  token: string,
  file: File,
  folderId: string | null,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ApiFile> {
  if (!baseUrl) return Promise.reject(new ApiError(503, 'SERVICE_UNAVAILABLE', 'The file service is not configured.'))

  return new Promise<ApiFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', uploadUrl(token))
    xhr.responseType = 'json'
    xhr.withCredentials = true
    xhr.setRequestHeader('X-CSRF-Token', csrfToken())

    const abort = () => xhr.abort()
    signal?.addEventListener('abort', abort, { once: true })

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = xhr.response as { file?: ApiFile } | undefined
        if (body?.file) resolve(body.file)
        else reject(new ApiError(xhr.status, 'INVALID_RESPONSE', 'The file service returned an invalid response.'))
        return
      }
      let errorBody: ApiErrorBody | null = null
      try { errorBody = xhr.response as ApiErrorBody } catch { /* ignore */ }
      reject(new ApiError(xhr.status, errorBody?.error?.code, errorBody?.error?.message ?? defaultMessage(xhr.status)))
    }
    xhr.onerror = () => {
      signal?.removeEventListener('abort', abort)
      reject(new ApiError(0, 'NETWORK_ERROR', 'The upload failed due to a network error.'))
    }
    xhr.onabort = () => {
      signal?.removeEventListener('abort', abort)
      reject(new ApiError(0, 'UPLOAD_CANCELLED', 'The upload was cancelled.'))
    }

    const form = new FormData()
    if (folderId) form.append('folderId', folderId)
    form.append('file', file, file.name)
    xhr.send(form)
  })
}
