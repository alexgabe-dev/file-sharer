import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Remove application-created backup directories older than `retentionDays`.
 * Operates strictly within `backupRoot` and never touches non-directory files
 * or anything outside it. Returns the removed absolute paths.
 */
export function pruneExpiredBackups(backupRoot: string, retentionDays: number, nowMs = Date.now(), skipDir?: string): string[] {
  if (retentionDays <= 0) return []
  const cutoff = nowMs - retentionDays * 86400000
  const removed: string[] = []
  let names: string[]
  try { names = readdirSync(backupRoot) } catch { return [] }
  for (const name of names) {
    const full = join(backupRoot, name)
    if (full === skipDir) continue
    try {
      if (statSync(full).isDirectory() && statSync(full).mtimeMs < cutoff) {
        rmSync(full, { recursive: true, force: true })
        removed.push(full)
      }
    } catch { /* ignore transient errors */ }
  }
  return removed
}
