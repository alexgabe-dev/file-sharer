import { downloadZipUrl, fileUrl } from '@/lib/api/client'
import type { SharedFile } from './types'

/** Share a file's canonical URL (Web Share API when available, else clipboard). */
export async function shareFile(file: SharedFile): Promise<void> {
  const slug = file.slug
  if (!slug) return
  const url = fileUrl(slug)
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try { await navigator.share({ title: file.name, url }) } catch { /* cancelled */ }
    return
  }
  try { await navigator.clipboard.writeText(url) } catch { /* ignore */ }
}

/**
 * Download a single file by navigating to its protected content endpoint
 * (`?download=1`). The server responds with `Content-Disposition: attachment`,
 * so the browser downloads without navigating the SPA away. We intentionally do
 * NOT set the anchor `download` attribute: browsers ignore it for cross-origin
 * URLs and Safari silently drops the click entirely.
 */
export function downloadFile(file: SharedFile): void {
  const url = file.downloadUrl ?? file.src
  if (!url) return
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Download several files as a single server-side ZIP. */
export function downloadFilesZip(token: string, ids: string[]): void {
  const url = downloadZipUrl(token, ids)
  if (!url || ids.length === 0) return
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
