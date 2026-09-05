'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { SharedFile } from '@/lib/files/types'

export function MediaThumb({ file, compact = false }: { file: SharedFile; compact?: boolean }) {
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
