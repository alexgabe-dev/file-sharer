export type ChunkRange = { start: number; end: number }

export function chunkCount(sizeBytes: number, chunkSizeBytes: number): number {
  return Math.ceil(sizeBytes / chunkSizeBytes)
}

export function chunkRange(index: number, chunkSizeBytes: number, totalBytes: number): ChunkRange {
  const start = index * chunkSizeBytes
  const end = Math.min(start + chunkSizeBytes, totalBytes)
  return { start, end }
}

export function progressPercent(confirmedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((confirmedBytes / totalBytes) * 100)))
}

export function missingChunkIndexes(received: number[], totalChunks: number): number[] {
  const receivedSet = new Set(received)
  const missing: number[] = []
  for (let index = 0; index < totalChunks; index += 1) if (!receivedSet.has(index)) missing.push(index)
  return missing
}

export function backoffBaseMs(attempt: number, baseMs = 750): number {
  return baseMs * 2 ** Math.max(0, attempt - 1)
}

export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500
}

export function matchesReselect(record: { name: string; sizeBytes: number }, file: { name: string; size: number }): boolean {
  return record.name === file.name && record.sizeBytes === file.size
}
