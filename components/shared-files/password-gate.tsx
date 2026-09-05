'use client'

import { useState } from 'react'
import { File } from 'lucide-react'
import { useAuth } from '@/lib/auth/auth'

export function PasswordGate() {
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password || loading) return
    setLoading(true)
    setError('')
    try {
      await login(password)
    } catch {
      setError('Invalid password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <form onSubmit={submit} className="w-full max-w-xs">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><File className="size-5" /></div>
          <h1 className="text-xl font-semibold">Shared Files</h1>
        </div>
        <label htmlFor="access-password" className="sr-only">Password</label>
        <input id="access-password" type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="current-password" enterKeyHint="go" className="h-12 w-full rounded-xl border border-input bg-card px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={loading || !password} className="mt-4 h-12 w-full rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">{loading ? 'Checking…' : 'Continue'}</button>
      </form>
    </main>
  )
}
