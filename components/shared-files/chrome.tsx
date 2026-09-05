'use client'

import { Dialog } from '@base-ui/react/dialog'
import { AlertTriangle, File, Folder as FolderIcon, FolderOpen, Image as ImageIcon, Film, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Folder, SharedFile, UploadItem } from '@/lib/files/types'
import { formatSize } from '@/lib/files/utils'

export function AppHeader({ fileCount, totalBytes, onUpload }: { fileCount: number; totalBytes: number; onUpload: () => void }) {
  return <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur-xl"><div className="mobile-safe-gutter mx-auto flex h-[4.5rem] max-w-[1240px] items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8"><div className="flex items-center gap-3"><div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><File className="size-4" /></div><div><p className="text-sm font-semibold tracking-tight">Shared Files</p><p className="text-xs text-muted-foreground">{fileCount} files · {formatSize(totalBytes)}</p></div></div><button onClick={onUpload} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="size-4" /> Upload</button></div></header>
}

export function FolderNavigation({ folders, files, trashCount, activeFolderId, showingTrash, onFolder, onTrash, onCreate }: { folders: Folder[]; files: SharedFile[]; trashCount: number; activeFolderId: string; showingTrash: boolean; onFolder: (id: string) => void; onTrash: () => void; onCreate: () => void }) {
  const count = (folder: Folder) => folder.id === 'all' ? files.length : files.filter((file) => file.folderId === folder.id).length
  const folderButton = (folder: Folder, mobile = false) => <button key={folder.id} onClick={() => onFolder(folder.id)} aria-current={!showingTrash && activeFolderId === folder.id ? 'page' : undefined} className={mobile ? `flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs ${!showingTrash && activeFolderId === folder.id ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground'}` : `folder-nav-item group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${!showingTrash && activeFolderId === folder.id ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'}`}>
    {mobile ? <><FolderIcon className="size-3.5" />{folder.name}</> : <><span className="flex min-w-0 items-center gap-2.5"><span className={`flex size-7 items-center justify-center rounded-md ${folder.tone}`}><FolderOpen className={`size-3.5 ${activeFolderId === folder.id ? 'text-accent' : 'text-muted-foreground'}`} /></span><span className="truncate">{folder.name}</span></span><span className="text-xs text-muted-foreground">{count(folder)}</span></>}
  </button>
  return <><aside className="hidden w-52 shrink-0 border-r border-border/70 pr-6 pt-12 md:block"><div className="mb-4 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Folders</p><button onClick={onCreate} aria-label="Create folder" className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"><Plus className="size-4" /></button></div><nav className="space-y-1">{folders.map((folder) => folderButton(folder))}</nav><button onClick={onCreate} className="mt-6 flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground transition hover:text-foreground"><Plus className="size-3.5" /> New folder</button><button onClick={onTrash} aria-current={showingTrash ? 'page' : undefined} className={`mt-8 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${showingTrash ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60'}`}><span className="flex items-center gap-2.5"><Trash2 className="size-4" /> Trash</span><span className="text-xs">{trashCount}</span></button></aside><div className="no-scrollbar -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-2 md:hidden">{folders.map((folder) => folderButton(folder, true))}<button onClick={onTrash} aria-current={showingTrash ? 'page' : undefined} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs ${showingTrash ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border text-muted-foreground'}`}><Trash2 className="size-3.5" /> Trash {trashCount ? `(${trashCount})` : ''}</button><button onClick={onCreate} className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"><Plus className="size-3.5" /> New</button></div></>
}

export function UploadQueue({ items, onCancel, onRetry, onPause, onResume, onReselect, onPauseAll, onResumeAll, onRetryFailed, onCancelFailed }: { items: UploadItem[]; onCancel: (id: string) => void; onRetry: (id: string) => void; onPause: (id: string) => void; onResume: (id: string) => void; onReselect: (id: string) => void; onPauseAll: () => void; onResumeAll: () => void; onRetryFailed: () => void; onCancelFailed: () => void }) {
  if (!items.length) return null
  const statusLabel = (item: UploadItem) => {
    switch (item.status) {
      case 'queued': return 'Queued'
      case 'preparing': return 'Preparing'
      case 'paused': return 'Paused'
      case 'finalizing': return 'Finalizing'
      case 'complete': return '✓'
      case 'failed': return 'Failed'
      case 'reselect': return 'Needs file'
      default: return `${item.progress}%`
    }
  }
  const showError = (item: UploadItem) => (item.status === 'failed' || item.status === 'reselect') && Boolean(item.error)
  const showPause = (item: UploadItem) => item.status === 'uploading' || item.status === 'queued' || item.status === 'preparing'

  const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0)
  const uploadedBytes = items.reduce((sum, item) => sum + Math.round((item.sizeBytes * item.progress) / 100), 0)
  const activeCount = items.filter((item) => item.status === 'uploading' || item.status === 'preparing' || item.status === 'queued' || item.status === 'finalizing').length
  const pausedCount = items.filter((item) => item.status === 'paused').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const retryableFailedCount = items.filter((item) => item.status === 'failed' && item.retryable !== false).length
  const overall = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0

  return <section aria-label="Upload queue" className="mt-6 rounded-xl border border-border bg-card p-4">
    <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Uploading {activeCount} of {items.length}</h2><span className="text-xs text-muted-foreground">{formatSize(uploadedBytes)} / {formatSize(totalBytes)}</span></div>
    <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${overall}%` }} /></div>
    {items.length > 1 && <div className="mb-3 flex flex-wrap items-center gap-2">
      {activeCount > 0 && <button onClick={onPauseAll} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary">Pause all</button>}
      {pausedCount > 0 && <button onClick={onResumeAll} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-secondary">Resume all</button>}
      {retryableFailedCount > 0 && <button onClick={onRetryFailed} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-secondary">Retry failed</button>}
      {failedCount > 0 && <button onClick={onCancelFailed} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-secondary">Clear failed</button>}
    </div>}
    <div className="space-y-3">{items.map((item) => <div key={item.id} className="queue-item flex items-center gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">{item.kind === 'video' ? <Film className="size-4" /> : item.kind === 'image' ? <ImageIcon className="size-4" /> : <File className="size-4" />}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-3 text-xs"><span className="truncate font-medium">{item.name}</span><span className="shrink-0 text-muted-foreground">{statusLabel(item)}</span></div>{showError(item) ? <p className="mt-1 truncate text-xs text-destructive">{item.error}</p> : <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary"><div className="progress-shine h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${item.progress}%` }} /></div>}</div>{item.status === 'failed' ? (item.retryable === false ? <button onClick={() => onCancel(item.id)} aria-label={`Remove ${item.name}`} className="rounded-md px-2 py-1.5 text-xs font-medium text-destructive hover:bg-secondary">Remove</button> : <button onClick={() => onRetry(item.id)} aria-label={`Retry ${item.name}`} className="rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-secondary">Retry</button>) : item.status === 'paused' ? <button onClick={() => onResume(item.id)} aria-label={`Resume ${item.name}`} className="rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-secondary">Resume</button> : item.status === 'reselect' ? <button onClick={() => onReselect(item.id)} aria-label={`Select ${item.name}`} className="rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-secondary">Select file</button> : showPause(item) ? <button onClick={() => onPause(item.id)} aria-label={`Pause ${item.name}`} className="rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-secondary">Pause</button> : null}{item.status !== 'complete' && <button onClick={() => onCancel(item.id)} aria-label={`Cancel ${item.name}`} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="size-4" /></button>}</div>)}</div>
  </section>
}

export function NewFolderDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) setName('') }, [open])
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-50 bg-primary/30 backdrop-blur-sm" /><Dialog.Popup initialFocus={inputRef} className="confirm-pop fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border bg-card p-6 shadow-2xl"><Dialog.Title className="text-lg font-semibold">Create folder</Dialog.Title><Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">Give this folder a name.</Dialog.Description><form onSubmit={(event) => { event.preventDefault(); const trimmed = name.trim(); if (trimmed) { onCreate(trimmed); onOpenChange(false) } }}><label className="mt-5 block text-sm font-medium" htmlFor="folder-name">Folder name</label><input ref={inputRef} id="folder-name" value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /><div className="mt-6 flex gap-2"><Dialog.Close className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-secondary">Cancel</Dialog.Close><button type="submit" className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">Create</button></div></form></Dialog.Popup></Dialog.Portal></Dialog.Root>
}

export function ConfirmDialog({ open, trash, count, onOpenChange, onConfirm }: { open: boolean; trash: boolean; count: number; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-50 bg-primary/30 backdrop-blur-sm" /><Dialog.Popup className="confirm-pop fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border bg-card p-6 shadow-2xl"><div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertTriangle className="size-6" /></div><Dialog.Title className="mt-5 text-lg font-semibold">{trash ? 'Delete permanently?' : 'Move to Trash?'}</Dialog.Title><Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">{trash ? 'These files will be removed forever. This action cannot be undone.' : `Move ${count} ${count === 1 ? 'file' : 'files'} to Trash? You can restore them later.`}</Dialog.Description><div className="mt-6 flex gap-2"><Dialog.Close className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-secondary">Cancel</Dialog.Close><button onClick={onConfirm} className="flex-1 rounded-xl bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground">{trash ? 'Delete forever' : 'Move to Trash'}</button></div></Dialog.Popup></Dialog.Portal></Dialog.Root>
}

export function Toast({ message }: { message: string }) { return message ? <div role="status" aria-live="polite" className="toast-pop fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-xl">{message}</div> : null }
