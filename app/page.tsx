'use client'

import { useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, CheckCircle2, ChevronRight, Download, FileText, Grid2X2, List, Play, Search, Share2, Sparkles, UploadCloud } from 'lucide-react'
import { AppHeader, ConfirmDialog, FolderNavigation, NewFolderDialog, Toast, UploadQueue } from '@/components/shared-files/chrome'
import { FileViewer } from '@/components/shared-files/viewer'
import { PasswordGate } from '@/components/shared-files/password-gate'
import { useAuth } from '@/lib/auth/auth'
import { useFileSpace, useVisibleFiles } from '@/lib/files/use-file-space'
import { downloadFile, shareFile } from '@/lib/files/share'
import type { FileSort, SharedFile } from '@/lib/files/types'
import { formatSize } from '@/lib/files/utils'

export default function Page({ remoteToken }: { remoteToken?: string }) {
  const auth = useAuth()
  const spaceToken = remoteToken ?? process.env.NEXT_PUBLIC_SPACE_TOKEN
  // Pure mock dev preview (no backend configured) skips the password gate.
  if (!process.env.NEXT_PUBLIC_API_BASE_URL) return <AuthenticatedApp remoteToken={spaceToken} />
  if (auth.status === 'loading') return <main className="min-h-screen bg-background" />
  if (auth.status === 'unauthenticated') return <PasswordGate />
  return <AuthenticatedApp remoteToken={spaceToken} />
}

function AuthenticatedApp({ remoteToken }: { remoteToken?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const reselectRef = useRef<HTMLInputElement>(null)
  const reselectTargetRef = useRef<string | null>(null)
  const viewerReturnFocusRef = useRef<HTMLElement | null>(null)
  const space = useFileSpace(remoteToken)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<FileSort>('Newest')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState<SharedFile | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeFolderId, setActiveFolderId] = useState('all')
  const [showingTrash, setShowingTrash] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [toast, setToast] = useState('')
  const sourceFiles = showingTrash ? space.trash : space.files
  const visibleFiles = useVisibleFiles(sourceFiles, activeFolderId, query, sort, showingTrash)
  const activeFolder = space.folders.find((folder) => folder.id === activeFolderId) ?? space.folders[0]
  const totalBytes = useMemo(() => space.files.reduce((total, file) => total + file.sizeBytes, 0), [space.files])
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2200) }
  const selectFolder = (id: string) => { setActiveFolderId(id); setShowingTrash(false); setSelectedIds([]) }
  const selectTrash = () => { setShowingTrash(true); setSelectedIds([]) }
  const toggleSelected = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
  const toggleAll = () => setSelectedIds((ids) => ids.length === visibleFiles.length ? [] : visibleFiles.map((file) => file.id))
  const targetFolder = activeFolderId === 'all' ? null : activeFolderId
  const openReselect = (id: string) => { reselectTargetRef.current = id; reselectRef.current?.click() }

  if (space.remoteError) return <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-foreground"><div><h1 className="text-2xl font-semibold">Shared space not found</h1><p className="mt-2 text-muted-foreground">This link is invalid or no longer available.</p></div></main>
  if (space.remoteLoading) return <main className="min-h-screen bg-background" />
  return <main className="min-h-screen bg-background text-foreground">
    <AppHeader fileCount={space.files.length} totalBytes={totalBytes} onUpload={() => inputRef.current?.click()} />
    <div className="mobile-safe-gutter mx-auto flex max-w-[1240px] gap-8 px-4 pb-20 sm:px-6 lg:px-8">
      <FolderNavigation folders={space.folders} files={space.files} trashCount={space.trash.length} activeFolderId={activeFolderId} showingTrash={showingTrash} onFolder={selectFolder} onTrash={selectTrash} onCreate={() => setNewFolderOpen(true)} />
      <div className="min-w-0 flex-1"><section className="pt-8 sm:pt-14"><p className="mb-2 text-sm font-medium text-accent">OPEN SPACE</p><h1 className="text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{showingTrash ? 'Trash' : activeFolder.name}</h1><p className="mt-2 text-pretty text-base text-muted-foreground">{showingTrash ? 'Deleted files stay here until you restore or permanently remove them.' : 'Upload files or browse what others have shared.'}</p></section>
        <button aria-label="Choose files to upload" onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }} onDrop={(event) => { event.preventDefault(); setDragging(false); space.addFiles(event.dataTransfer.files, targetFolder) }} className={`mobile-sheen mobile-card-shadow group relative mt-6 flex min-h-44 w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed px-5 py-8 text-center transition sm:mt-7 sm:min-h-48 sm:rounded-xl sm:px-6 ${dragging ? 'is-dragging border-accent bg-accent/10' : 'border-border bg-card hover:border-accent/60 hover:bg-card/80'}`}><span className="relative mb-3 flex size-11 items-center justify-center rounded-full bg-secondary text-accent"><UploadCloud className="size-5" /></span><span className="relative text-sm font-semibold">{dragging ? 'Release to upload' : 'Drop files here'}</span><span className="relative mt-1 text-sm text-muted-foreground">{dragging ? 'Your files are ready to land' : 'or click to browse'}</span><span className="relative mt-4 text-xs text-muted-foreground">Photos, videos and other files</span></button>
        <input ref={inputRef} type="file" multiple className="sr-only" onChange={(event) => { if (event.target.files) space.addFiles(event.target.files, targetFolder); event.target.value = '' }} />
        <input ref={reselectRef} type="file" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; const target = reselectTargetRef.current; reselectTargetRef.current = null; if (file && target) void space.reselectFile(target, file).catch(() => {}); event.target.value = '' }} />
        <UploadQueue items={space.queue} onCancel={space.cancelUpload} onRetry={space.retryUpload} onPause={space.pauseUpload} onResume={space.resumeUpload} onReselect={openReselect} onPauseAll={space.pauseAll} onResumeAll={space.resumeAll} onRetryFailed={space.retryFailed} onCancelFailed={space.cancelFailed} />
        <section className="mt-12"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold tracking-tight">{showingTrash ? 'Trash' : activeFolderId === 'all' ? 'All files' : activeFolder.name}</h2><ChevronRight className="size-4 text-muted-foreground" /><Sparkles className="size-4 text-accent" /></div><p className="mt-1 text-sm text-muted-foreground">{visibleFiles.length} items shared in this space</p></div><div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:flex sm:flex-wrap"><label className="col-span-2 flex h-10 min-w-0 items-center gap-2 rounded-xl border border-input bg-card px-3 shadow-sm shadow-primary/[0.03] sm:col-span-1 sm:h-9 sm:w-52 sm:flex-none sm:rounded-lg"><Search className="size-4 shrink-0 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search files" placeholder="Search files" className="min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></label><label className="sr-only" htmlFor="file-sort">Sort files</label><select id="file-sort" value={sort} onChange={(event) => setSort(event.target.value as FileSort)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm outline-none"><option>Newest</option><option>Oldest</option><option>Name</option><option>Largest</option></select><div className="flex h-9 rounded-lg border border-input bg-card p-1"><button onClick={() => setView('grid')} aria-label="Grid view" aria-pressed={view === 'grid'} className={`rounded-md px-2 ${view === 'grid' ? 'bg-secondary' : 'text-muted-foreground'}`}><Grid2X2 className="size-4" /></button><button onClick={() => setView('list')} aria-label="List view" aria-pressed={view === 'list'} className={`rounded-md px-2 ${view === 'list' ? 'bg-secondary' : 'text-muted-foreground'}`}><List className="size-4" /></button></div></div></div>
          {selectedIds.length > 0 && <div className="bulk-toolbar mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/25 bg-card/95 p-2.5 shadow-xl shadow-accent/10 backdrop-blur-xl"><button onClick={toggleAll} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition hover:bg-secondary"><span className="flex size-5 items-center justify-center rounded-md border border-accent/50 bg-accent/10 text-accent">{selectedIds.length === visibleFiles.length ? <Check className="size-3.5" /> : selectedIds.length}</span>{selectedIds.length === visibleFiles.length ? 'Deselect all' : `${selectedIds.length} selected`}</button><span className="hidden h-5 w-px bg-border sm:block" />{showingTrash ? <button onClick={async () => { try { const restored = await space.restore(selectedIds); setSelectedIds([]); notify(`${restored.length} restored`) } catch (err) { notify(err instanceof Error ? err.message : 'Something went wrong') } }} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-medium text-muted-foreground transition hover:bg-secondary">Restore</button> : <><button onClick={() => notify(`Preparing ${selectedIds.length} files for download`)} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-medium text-muted-foreground transition hover:bg-secondary"><Download className="size-4" /> Download</button><button onClick={() => { navigator.clipboard?.writeText(window.location.href); notify('Share link copied') }} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-medium text-muted-foreground transition hover:bg-secondary"><Share2 className="size-4" /> Share</button></>}<button onClick={() => setConfirmDelete(true)} className="ml-auto inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-medium text-destructive transition hover:bg-destructive/10">{showingTrash ? 'Delete forever' : 'Remove'}</button></div>}
          <FileResults files={visibleFiles} view={view} selectedIds={selectedIds} selecting={selectedIds.length > 0} onSelect={toggleSelected} onOpen={(file) => { viewerReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelected(file) }} onShare={(file) => { void shareFile(file).then(() => notify('Link copied')) }} />
        </section></div>
    </div>
    <Toast message={toast} /><NewFolderDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} onCreate={async (name) => { try { const folder = await space.createFolder(name); selectFolder(folder.id); notify(`Created ${folder.name}`) } catch (err) { notify(err instanceof Error ? err.message : 'Something went wrong') } }} /><ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} trash={showingTrash} count={selectedIds.length} onConfirm={async () => { try { if (showingTrash) { await space.permanentlyDelete(selectedIds) } else { const moved = await space.moveToTrash(selectedIds); notify(`${moved.length} moved to Trash`) }; setSelectedIds([]); setConfirmDelete(false) } catch (err) { notify(err instanceof Error ? err.message : 'Something went wrong') } }} />
    {selected && <FileViewer file={selected} onClose={() => { setSelected(null); window.setTimeout(() => viewerReturnFocusRef.current?.focus(), 0) }} onShare={() => { void shareFile(selected).then(() => notify('Link copied')) }} onDownload={() => downloadFile(selected)} />}
  </main>
}

function MediaThumb({ file, compact = false }: { file: SharedFile; compact?: boolean }) {
  const [failed, setFailed] = useState(false)
  const thumbSrc = file.thumbnailUrl
  if (file.status === 'processing') {
    return compact
      ? <span className="flex size-full items-center justify-center bg-secondary/60"><span className="size-3 animate-pulse rounded-full bg-muted" /></span>
      : <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"><span className="size-8 animate-pulse rounded-full bg-secondary" /><span className="text-xs font-medium uppercase tracking-widest">Processing</span></div>
  }
  if (!failed && thumbSrc && file.kind !== 'document') {
    return <img src={thumbSrc} alt="" loading="lazy" onError={() => setFailed(true)} className={compact ? 'size-full object-cover' : 'size-full object-cover transition duration-500 group-hover:scale-[1.04]'} />
  }
  if (compact) return <FileText className="size-4 text-muted-foreground" />
  return <div className="flex size-full flex-col items-center justify-center gap-3 text-muted-foreground"><FileText className="size-10 stroke-[1.3]" /><span className="text-xs font-medium uppercase tracking-widest">{file.kind === 'video' ? 'Video' : file.kind === 'image' ? 'Image' : 'PDF'}</span></div>
}

function FileResults({ files, view, selectedIds, selecting, onSelect, onOpen, onShare }: { files: SharedFile[]; view: 'grid' | 'list'; selectedIds: string[]; selecting: boolean; onSelect: (id: string) => void; onOpen: (file: SharedFile) => void; onShare: (file: SharedFile) => void }) {
  if (view === 'list') return <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">{files.map((file) => <div key={file.id} role="button" tabIndex={0} onClick={() => selecting ? onSelect(file.id) : onOpen(file)} onKeyDown={(event) => { if (event.key === 'Enter') { if (selecting) onSelect(file.id); else onOpen(file) } }} className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition last:border-0 hover:bg-secondary/50"><div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary"><MediaThumb file={file} compact /></div><span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span><span className="hidden text-xs text-muted-foreground sm:block">{formatSize(file.sizeBytes)}</span><button aria-label={`Copy link for ${file.name}`} onClick={(event) => { event.stopPropagation(); onShare(file) }} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><Share2 className="size-4" /></button><ArrowRight className="size-4 text-muted-foreground" /></div>)}</div>
  return <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">{files.map((file) => <article key={file.id} className={`file-card group min-w-0 ${selectedIds.includes(file.id) ? 'is-selected' : ''}`}><button aria-label={`Select ${file.name}`} aria-pressed={selectedIds.includes(file.id)} onClick={() => onSelect(file.id)} className={`selection-check absolute z-10 left-3 top-3 flex size-7 items-center justify-center rounded-full border text-primary-foreground shadow-lg transition ${selectedIds.includes(file.id) ? 'selected' : ''}`}><CheckCircle2 className="size-4" /></button><button onClick={() => selecting ? onSelect(file.id) : onOpen(file)} className={`relative aspect-square w-full overflow-hidden rounded-xl ${file.color} text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}><MediaThumb file={file} />{file.kind === 'video' && <span className="absolute bottom-3 left-3 flex size-8 items-center justify-center rounded-full bg-primary/85 text-primary-foreground"><Play className="ml-0.5 size-3.5 fill-current" /></span>}</button><div className="mt-3 flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-medium">{file.name}</h3><p className="mt-1 text-xs text-muted-foreground">{formatSize(file.sizeBytes)} · {file.uploadedLabel}</p></div><button aria-label={`Copy link for ${file.name}`} onClick={() => onShare(file)} className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-secondary hover:text-foreground"><Share2 className="size-4" /></button></div></article>)}</div>
}


