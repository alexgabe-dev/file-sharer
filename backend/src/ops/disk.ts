import { statfsSync } from 'node:fs'

/** Available bytes on the filesystem containing `path` (Infinity if unknown). */
export function availableBytes(path: string): number {
  try {
    const stats = statfsSync(path)
    return stats.bavail * stats.bsize
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** True when reserving `requiredBytes` still leaves `reserveBytes` free. */
export function hasSufficientSpace(available: number, requiredBytes: number, reserveBytes: number): boolean {
  if (!Number.isFinite(available)) return true
  return available - requiredBytes >= reserveBytes
}
