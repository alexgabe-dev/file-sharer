'use client'

import { useState } from 'react'
import { ArrowLeft, Clipboard, Download, FileText, X } from 'lucide-react'
import type { SharedFile } from '@/lib/files/types'
import { formatSize } from '@/lib/files/utils'

export function FileViewer({ file, onClose, onShare, onDownload }: { file: SharedFile; onClose: () => void; onShare: () => void; onDownload: () => void }) {
  const [failed, setFailed] = useState(false)
  return <div role="dialog" aria-modal="true" aria-label={file.name} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }} className="fixed inset-0 z-50 flex h-dvh flex-col bg-primary/95 text-primary-foreground">
    <div className="flex min-h-16 shrink-0 items-center justify-between border-b border-primary-foreground/10 px-4 pt-[env(safe-area-inset-top)] sm:px-8">
      <button autoFocus onClick={onClose} className="inline-flex min-h-10 items-center gap-2 text-sm text-primary-foreground/80"><ArrowLeft className="size-4" /> <span className="hidden sm:inline">Back</span></button>
      <span className="max-w-[45%] truncate text-sm font-medium">{file.name}</span>
      <div className="flex items-center gap-1">
        <button aria-label="Copy link" onClick={onShare} className="rounded-lg p-2.5 text-primary-foreground/70 hover:bg-primary-foreground/10"><Clipboard className="size-4" /></button>
        <button aria-label="Download file" onClick={onDownload} className="rounded-lg p-2.5 text-primary-foreground/70 hover:bg-primary-foreground/10"><Download className="size-4" /></button>
        <button aria-label="Close viewer" onClick={onClose} className="rounded-lg p-2.5 text-primary-foreground/70"><X className="size-5" /></button>
      </div>
    </div>
    <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-4 sm:p-10">
      {file.src && !failed ? file.kind === 'video' ? <video src={file.src} controls poster={file.thumbnailUrl} onError={() => setFailed(true)} className="max-h-full max-w-full rounded-lg" /> : <img src={file.src} alt={file.name} onError={() => setFailed(true)} className="max-h-full max-w-full rounded-lg object-contain" /> : <div className="flex flex-col items-center gap-4 text-center"><FileText className="size-16 stroke-[1.2] text-primary-foreground/60" /><div><p className="font-medium">{file.name}</p><p className="mt-1 text-sm text-primary-foreground/60">{failed ? 'Preview unavailable' : `${formatSize(file.sizeBytes)} · ${file.uploadedLabel}`}</p></div><button onClick={onDownload} className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary-foreground/10 px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-foreground/20"><Download className="size-4" /> Download</button></div>}
    </div>
  </div>
}
