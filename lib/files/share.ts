import { fileUrl } from '@/lib/api/client'
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

/** Trigger a download of the file's protected content endpoint. */
export function downloadFile(file: SharedFile): void {
  const url = file.downloadUrl ?? file.src
  if (!url) return
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
