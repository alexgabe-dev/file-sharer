import type { FastifyRequest } from 'fastify'

/**
 * Minimal in-memory sliding-window rate limiter. This is a single-process
 * deployment, so a shared Map is sufficient and no Redis is required.
 */
export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()

  return function rateLimit(request: FastifyRequest): boolean {
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown'
    const now = Date.now()
    const cutoff = now - windowMs

    let bucket = hits.get(key)
    if (!bucket) {
      bucket = []
      hits.set(key, bucket)
    }

    while (bucket.length > 0 && bucket[0] <= cutoff) bucket.shift()

    if (bucket.length >= max) return false
    bucket.push(now)

    // Bound memory for a long-running process with many clients.
    if (hits.size > 10000) {
      for (const [entryKey, timestamps] of hits) {
        const fresh = timestamps.filter((timestamp) => timestamp > cutoff)
        if (fresh.length > 0) hits.set(entryKey, fresh)
        else hits.delete(entryKey)
      }
    }

    return true
  }
}
