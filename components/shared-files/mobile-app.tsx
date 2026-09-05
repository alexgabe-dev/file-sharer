'use client'

import { useState } from 'react'
import { Check, ChevronDown, Download, File, FolderOpen, FolderPlus, Grid2X2, List, Play, Plus, Search, Share2, Trash2, UploadCloud, X } from 'lucide-react'
import type { Folder, FileSort, SharedFile } from '@/lib/files/types'
import type { useFileSpace } from '@/lib/files/use-file-space'
import { formatSize } from '@/lib/files/utils'
import { MediaThumb } from './media-thumb'
import { UploadQueue } from './chrome'

type SpaceState = ReturnType<typeof useFileSpace>

type MobileAppProps = {
  space: SpaceState
  visibleFiles: SharedFile[]
  activeFolder: Folder
  totalBytes: number
  query: string
  onQueryChange: (value: string) => void
  sort: FileSort
  onSortChange: (value: FileSort) => void
  view: 'grid' | 'list'
  onViewChange: (value: 'grid' | 'list') => void
  activeFolderId: string
  showingTrash: boolean
  selectedIds: string[]
  onSelectFolder: (id: string) => void
  onTrash: () => void
  onToggleSelected: (id: string) => void
  onToggleAll: () => void
  onClearSelection: () => void
  onUpload: () => void
  onOpen: (file: SharedFile) => void
  onShare: (file: SharedFile) => void
  onReselect: (id: string) => void
  onCreateFolder: () => void
  onConfirmDelete: () => void
  notify: (message: string) => void
}

export function MobileApp({ space, visibleFiles, activeFolder, totalBytes, query, onQueryChange, sort, onSortChange, view, onViewChange, activeFolderId, showingTrash, selectedIds, onSelectFolder, onTrash, onToggleSelected, onToggleAll, onClearSelection, onUpload, onOpen, onShare, onReselect, onCreateFolder, onConfirmDelete, notify }: MobileAppProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const selecting = selectedIds.length > 0
  const title = showingTrash ? 'Trash' : activeFolderId === 'all' ? 'All files' : activeFolder.name
  const allSelected = visibleFiles.length > 0 && selectedIds.length === visibleFiles.length

  const handleRestore = async () => {
    try { const restored = await space.restore(selectedIds); onClearSelection(); notify(`${restored.length} restored`) } catch (err) { notify(err instanceof Error ? err.message : 'Something went wrong') }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="mobile-px flex h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><File className="size-4" /></div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">Shared Files</p>
              <p className="truncate text-[11px] text-muted-foreground">{space.files.length} files · {formatSize(totalBytes)}</p>
            </div>
          </div>
          <button onClick={onUpload} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground"><Plus className="size-4" /> Upload</button>
        </div>
        <div className="no-scrollbar mobile-px flex gap-2 overflow-x-auto pb-2.5">
          <button onClick={() => onSelectFolder('all')} aria-current={!showingTrash && activeFolderId === 'all' ? 'page' : undefined} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${!showingTrash && activeFolderId === 'all' ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground'}`}>All files</button>
          {space.folders.filter((folder) => folder.id !== 'all').map((folder) => (
            <button key={folder.id} onClick={() => onSelectFolder(folder.id)} aria-current={!showingTrash && activeFolderId === folder.id ? 'page' : undefined} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${!showingTrash && activeFolderId === folder.id ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground'}`}><FolderOpen className="mr-1.5 inline size-3.5 -translate-y-px" />{folder.name}</button>
          ))}
          <button onClick={onTrash} aria-current={showingTrash ? 'page' : undefined} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${showingTrash ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground'}`}><Trash2 className="mr-1.5 inline size-3.5 -translate-y-px" />Trash</button>
          <button onClick={onCreateFolder} className="shrink-0 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground"><FolderPlus className="mr-1.5 inline size-3.5 -translate-y-px" />New folder</button>
        </div>
      </header>

      <div className="mobile-px flex-1 pb-28">
        <div className="flex items-center justify-between gap-3 pt-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{visibleFiles.length} {visibleFiles.length === 1 ? 'item' : 'items'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button onClick={() => setSearchOpen((value) => !value)} aria-label="Search" aria-pressed={searchOpen} className={`flex size-9 items-center justify-center rounded-lg border ${searchOpen ? 'border-accent bg-accent/10 text-accent' : 'border-input bg-card text-muted-foreground'}`}><Search className="size-4" /></button>
            <div className="relative">
              <select value={sort} onChange={(event) => onSortChange(event.target.value as FileSort)} aria-label="Sort files" className="h-9 appearance-none rounded-lg border border-input bg-card pl-3 pr-8 text-xs font-medium outline-none">
                <option>Newest</option><option>Oldest</option><option>Name</option><option>Largest</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
            <div className="flex h-9 rounded-lg border border-input bg-card p-1">
              <button onClick={() => onViewChange('grid')} aria-label="Grid view" aria-pressed={view === 'grid'} className={`rounded-md px-2 ${view === 'grid' ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}><Grid2X2 className="size-4" /></button>
              <button onClick={() => onViewChange('list')} aria-label="List view" aria-pressed={view === 'list'} className={`rounded-md px-2 ${view === 'list' ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}><List className="size-4" /></button>
            </div>
          </div>
        </div>

        {searchOpen && <label className="mt-3 flex h-11 items-center gap-2 rounded-xl border border-input bg-card px-3"><Search className="size-4 shrink-0 text-muted-foreground" /><input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search files" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></label>}

        <button onClick={onUpload} className="mobile-card-shadow mt-4 flex min-h-28 w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-card px-5 py-6 text-center"><span className="mb-2.5 flex size-11 items-center justify-center rounded-full bg-secondary text-accent"><UploadCloud className="size-5" /></span><span className="text-sm font-semibold">Add files</span><span className="mt-0.5 text-xs text-muted-foreground">Photos, videos and documents</span></button>

        <UploadQueue items={space.queue} onCancel={space.cancelUpload} onRetry={space.retryUpload} onPause={space.pauseUpload} onResume={space.resumeUpload} onReselect={onReselect} onPauseAll={space.pauseAll} onResumeAll={space.resumeAll} onRetryFailed={space.retryFailed} onCancelFailed={space.cancelFailed} />

        {visibleFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <File className="size-10 stroke-[1.3] text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{showingTrash ? 'Trash is empty' : 'No files yet'}</p>
            <p className="mt-1 text-xs text-muted-foreground">{showingTrash ? 'Deleted files will appear here.' : 'Add files to get started.'}</p>
          </div>
        ) : view === 'list' ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
            {visibleFiles.map((file) => (
              <div key={file.id} role="button" tabIndex={0} onClick={() => selecting ? onToggleSelected(file.id) : onOpen(file)} onKeyDown={(event) => { if (event.key === 'Enter') { if (selecting) onToggleSelected(file.id); else onOpen(file) } }} className="flex w-full items-center gap-3 border-b border-border px-3.5 py-3 text-left last:border-0">
                <button aria-label={`Select ${file.name}`} aria-pressed={selectedIds.includes(file.id)} onClick={(event) => { event.stopPropagation(); onToggleSelected(file.id) }} className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selectedIds.includes(file.id) ? 'border-accent bg-accent text-primary-foreground' : 'border-border'}`}>{selectedIds.includes(file.id) && <Check className="size-3" />}</button>
                <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary"><MediaThumb file={file} compact /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(file.sizeBytes)} · {file.uploadedLabel}</p>
                </div>
                <button aria-label={`Copy link for ${file.name}`} onClick={(event) => { event.stopPropagation(); onShare(file) }} className="rounded-lg p-2 text-muted-foreground"><Share2 className="size-4" /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {visibleFiles.map((file) => (
              <article key={file.id} className="min-w-0">
                <div className="relative">
                  <button onClick={() => selecting ? onToggleSelected(file.id) : onOpen(file)} className="relative block aspect-square w-full overflow-hidden rounded-2xl bg-secondary text-left">
                    <MediaThumb file={file} />
                    {file.kind === 'video' && <span className="absolute bottom-2.5 left-2.5 flex size-8 items-center justify-center rounded-full bg-primary/85 text-primary-foreground"><Play className="ml-0.5 size-3.5 fill-current" /></span>}
                  </button>
                  <button aria-label={`Select ${file.name}`} aria-pressed={selectedIds.includes(file.id)} onClick={() => onToggleSelected(file.id)} className={`absolute left-2.5 top-2.5 flex size-6 items-center justify-center rounded-full border ${selectedIds.includes(file.id) ? 'border-accent bg-accent text-primary-foreground' : 'border-primary-foreground/70 bg-primary/40 text-primary-foreground'}`}>{selectedIds.includes(file.id) && <Check className="size-3.5" />}</button>
                </div>
                <div className="mt-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium">{file.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatSize(file.sizeBytes)}</p>
                  </div>
                  <button aria-label={`Copy link for ${file.name}`} onClick={() => onShare(file)} className="shrink-0 rounded-lg p-1.5 text-muted-foreground"><Share2 className="size-4" /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {selecting && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-card/95 backdrop-blur-xl">
          <div className="mobile-px flex items-center gap-1 py-2">
            <button onClick={onToggleAll} className="flex h-10 shrink-0 items-center gap-2 rounded-xl px-2.5 text-sm font-semibold">
              <span className="flex size-6 items-center justify-center rounded-md border border-accent/50 bg-accent/10 text-xs text-accent">{allSelected ? <Check className="size-3.5" /> : selectedIds.length}</span>
              {allSelected ? 'Clear' : 'Select all'}
            </button>
            <div className="ml-auto flex items-center gap-1">
              {showingTrash ? (
                <button onClick={handleRestore} className="flex h-10 items-center rounded-xl px-3 text-sm font-medium text-foreground">Restore</button>
              ) : (
                <>
                  <button onClick={() => notify(`Preparing ${selectedIds.length} files for download`)} aria-label="Download" className="flex size-10 items-center justify-center rounded-xl text-muted-foreground"><Download className="size-4" /></button>
                  <button onClick={() => { navigator.clipboard?.writeText(window.location.href); notify('Share link copied') }} aria-label="Share" className="flex size-10 items-center justify-center rounded-xl text-muted-foreground"><Share2 className="size-4" /></button>
                </>
              )}
              <button onClick={onConfirmDelete} aria-label={showingTrash ? 'Delete forever' : 'Remove'} className="flex size-10 items-center justify-center rounded-xl text-destructive"><Trash2 className="size-4" /></button>
              <button onClick={onClearSelection} aria-label="Close selection" className="flex size-10 items-center justify-center rounded-xl text-muted-foreground"><X className="size-4" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
