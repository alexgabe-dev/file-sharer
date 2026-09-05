'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PasswordGate } from '@/components/shared-files/password-gate'
import { FileViewer } from '@/components/shared-files/viewer'
import { useAuth } from '@/lib/auth/auth'
import { fileBySlug } from '@/lib/api/client'
import { apiFileToShared } from '@/lib/files/api-file'
import { downloadFile, shareFile } from '@/lib/files/share'
import type { SharedFile } from '@/lib/files/types'

export default function FileBySlugPage() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const auth = useAuth()
  const [state, setState] = useState<'loading' | 'notfound' | 'ready'>('loading')
  const [file, setFile] = useState<SharedFile | null>(null)

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    let active = true
    fileBySlug(params.slug)
      .then(({ spaceToken, file }) => {
        if (!active) return
        setFile(apiFileToShared(spaceToken, file))
        setState('ready')
      })
      .catch(() => { if (active) setState('notfound') })
    return () => { active = false }
  }, [auth.status, params.slug])

  if (auth.status === 'loading') return <main className="min-h-screen bg-background" />
  if (auth.status === 'unauthenticated') return <PasswordGate />
  if (state === 'loading') return <main className="min-h-screen bg-background" />
  if (state === 'notfound' || !file) {
    return <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-foreground"><div><h1 className="text-2xl font-semibold">File not found</h1><p className="mt-2 text-muted-foreground">This file is unavailable or has been removed.</p><button onClick={() => router.push('/')} className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Back to files</button></div></main>
  }

  return <FileViewer file={file} onClose={() => router.push('/')} onShare={() => { void shareFile(file) }} onDownload={() => downloadFile(file)} />
}
