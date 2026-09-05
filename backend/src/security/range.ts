export type ByteRange = { start: number; end: number }
export function parseRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim()); if (!match || size < 1) throw new RangeError('Invalid range')
  const [, startRaw, endRaw] = match
  if (!startRaw && !endRaw) throw new RangeError('Invalid range')
  if (!startRaw) { const suffix = Number(endRaw); if (!Number.isSafeInteger(suffix) || suffix < 1) throw new RangeError('Invalid range'); return { start: Math.max(0, size - suffix), end: size - 1 } }
  const start = Number(startRaw); const end = endRaw ? Number(endRaw) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) throw new RangeError('Invalid range')
  return { start, end: Math.min(end, size - 1) }
}
