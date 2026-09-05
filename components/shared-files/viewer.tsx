'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Clipboard, Download, FileText, X } from 'lucide-react'
import type { SharedFile } from '@/lib/files/types'
import { formatSize } from '@/lib/files/utils'

const SWIPE_THRESHOLD = 60
const HORIZONTAL_DOMINANCE = 1.3
const EDGE_RESISTANCE = 0.3
const SETTLE_MS = 220

type FileViewerProps = {
  file: SharedFile
  onClose: () => void
  onShare: () => void
  onDownload: () => void
  onPrevious?: () => void
  onNext?: () => void
  hasPrevious?: boolean
  hasNext?: boolean
  previousFile?: SharedFile
  nextFile?: SharedFile
  position?: { index: number; total: number }
}

export function FileViewer({ file, onClose, onShare, onDownload, onPrevious, onNext, hasPrevious = false, hasNext = false, previousFile, nextFile, position }: FileViewerProps) {
  const [failed, setFailed] = useState(false)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [settling, setSettling] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const gestureRef = useRef<{ x: number; y: number; pointerId: number; active: boolean; dragging: boolean }>({ x: 0, y: 0, pointerId: -1, active: false, dragging: false })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mql.matches)
    const handler = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // Reset transient state when the displayed file changes.
  useEffect(() => {
    setFailed(false)
    setDragX(0)
    setDragging(false)
    setSettling(false)
  }, [file.id])

  // Preload adjacent images (never large videos) for smooth navigation.
  useEffect(() => {
    const preload = (candidate?: SharedFile) => { if (candidate?.kind === 'image' && candidate.src) { const image = new Image(); image.src = candidate.src } }
    preload(previousFile)
    preload(nextFile)
  }, [previousFile, nextFile])

  // Keyboard navigation (ignores editable targets and key auto-repeat).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft' && hasPrevious) onPrevious?.()
      else if (event.key === 'ArrowRight' && hasNext) onNext?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, onPrevious, onNext, hasPrevious, hasNext])

  const beginGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return
    const target = event.target as HTMLElement
    if (target.closest('button, a, [role="button"], video, input, textarea, select')) return
    gestureRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: true, dragging: false }
  }, [])

  const moveGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture.active || event.pointerId !== gesture.pointerId) return
    const dx = event.clientX - gesture.x
    const dy = event.clientY - gesture.y
    if (!gesture.dragging) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_DOMINANCE) {
        gesture.dragging = true
        setDragging(true)
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
      } else if (Math.abs(dy) > Math.abs(dx)) {
        gesture.active = false // vertical gesture — release
      } else {
        return
      }
    }
    if (!gesture.dragging) return
    let offset = dx
    if ((!hasPrevious && dx > 0) || (!hasNext && dx < 0)) offset = dx * EDGE_RESISTANCE
    setDragX(offset)
  }, [hasPrevious, hasNext])

  const endGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture.active || event.pointerId !== gesture.pointerId) return
    gesture.active = false
    if (!gesture.dragging) return
    gesture.dragging = false
    setDragging(false)
    const dx = event.clientX - gesture.x
    const dy = event.clientY - gesture.y
    const horizontal = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_DOMINANCE
    const settle = reducedMotion ? 0 : SETTLE_MS
    if (horizontal && dx < -SWIPE_THRESHOLD && hasNext) {
      setSettling(true)
      setDragX(-window.innerWidth)
      window.setTimeout(() => onNext?.(), settle)
    } else if (horizontal && dx > SWIPE_THRESHOLD && hasPrevious) {
      setSettling(true)
      setDragX(window.innerWidth)
      window.setTimeout(() => onPrevious?.(), settle)
    } else {
      setSettling(true)
      setDragX(0)
      window.setTimeout(() => setSettling(false), settle)
    }
  }, [hasNext, hasPrevious, onNext, onPrevious, reducedMotion])

  const transition = dragging ? 'none' : settling ? `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none'

  return <div role="dialog" aria-modal="true" aria-label={file.name} className="fixed inset-0 z-50 flex h-dvh flex-col bg-primary/95 text-primary-foreground">
    <div className="flex min-h-16 shrink-0 items-center justify-between border-b border-primary-foreground/10 px-4 pt-[env(safe-area-inset-top)] sm:px-8">
      <button autoFocus onClick={onClose} className="inline-flex min-h-10 items-center gap-2 text-sm text-primary-foreground/80"><ArrowLeft className="size-4" /> <span className="hidden sm:inline">Back</span></button>
      <div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{file.name}</span>{position && <span className="shrink-0 text-xs tabular-nums text-primary-foreground/50">{position.index + 1} / {position.total}</span>}</div>
      <div className="flex items-center gap-1">
        <button aria-label="Copy link" onClick={onShare} className="rounded-lg p-2.5 text-primary-foreground/70 hover:bg-primary-foreground/10"><Clipboard className="size-4" /></button>
        <button aria-label="Download file" onClick={onDownload} className="rounded-lg p-2.5 text-primary-foreground/70 hover:bg-primary-foreground/10"><Download className="size-4" /></button>
        <button aria-label="Close viewer" onClick={onClose} className="rounded-lg p-2.5 text-primary-foreground/70"><X className="size-5" /></button>
      </div>
    </div>
    <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-10" onPointerDown={beginGesture} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} style={{ touchAction: file.kind === 'video' ? 'auto' : 'pan-y' }}>
      {hasPrevious && <button type="button" aria-label="Previous file" onClick={onPrevious} className="absolute left-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary-foreground/10 text-primary-foreground/75 backdrop-blur-sm transition hover:bg-primary-foreground/20 hover:text-primary-foreground active:scale-95 sm:left-5"><ChevronLeft className="size-5" /></button>}
      {hasNext && <button type="button" aria-label="Next file" onClick={onNext} className="absolute right-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary-foreground/10 text-primary-foreground/75 backdrop-blur-sm transition hover:bg-primary-foreground/20 hover:text-primary-foreground active:scale-95 sm:right-5"><ChevronRight className="size-5" /></button>}
      <div className="flex h-full w-full items-center justify-center will-change-transform" style={{ transform: `translate3d(${dragX}px, 0, 0)`, transition }}>
        {file.src && !failed ? file.kind === 'video' ? <video key={file.id} src={file.src} controls poster={file.thumbnailUrl} onError={() => setFailed(true)} className="max-h-full max-w-full rounded-lg" /> : <img key={file.id} src={file.src} alt={file.name} onError={() => setFailed(true)} className="max-h-full max-w-full rounded-lg object-contain" /> : <div className="flex flex-col items-center gap-4 text-center"><FileText className="size-16 stroke-[1.2] text-primary-foreground/60" /><div><p className="font-medium">{file.name}</p><p className="mt-1 text-sm text-primary-foreground/60">{failed ? 'Preview unavailable' : `${formatSize(file.sizeBytes)} · ${file.uploadedLabel}`}</p></div><button onClick={onDownload} className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary-foreground/10 px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-foreground/20"><Download className="size-4" /> Download</button></div>}
      </div>
    </div>
  </div>
}
