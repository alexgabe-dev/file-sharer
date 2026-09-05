export type MediaJob = (publicId: string) => Promise<boolean>

/**
 * Small in-process media worker with bounded concurrency, per-file
 * deduplication, and delayed retry. Startup reconciliation is performed by the
 * caller (which enqueues persisted unfinished jobs), so a restart never
 * permanently loses jobs while still avoiding volatile-only state.
 */
export class ProcessingQueue {
  private pending: string[] = []
  private inFlight = new Set<string>()
  private running = 0
  private stopped = false

  constructor(
    private readonly options: { concurrency: number; retryDelayMs: number; run: MediaJob },
  ) {}

  enqueue(publicId: string) {
    if (this.stopped || this.inFlight.has(publicId)) return
    this.inFlight.add(publicId)
    this.pending.push(publicId)
    this.pump()
  }

  /** Stop scheduling new work. In-flight jobs are allowed to finish; queued jobs are recoverable via startup reconciliation. */
  stop() {
    this.stopped = true
    this.pending = []
  }

  /** Resolves when nothing is queued or running (useful for tests). */
  async waitUntilIdle() {
    while (this.running > 0 || this.pending.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  private pump() {
    if (this.stopped) return
    while (this.running < this.options.concurrency && this.pending.length > 0) {
      const next = this.pending.shift()
      if (!next) break
      this.running += 1
      void this.execute(next)
    }
  }

  private async execute(publicId: string) {
    let retry: boolean
    try {
      retry = await this.options.run(publicId)
    } catch {
      retry = false
    } finally {
      this.running -= 1
      this.inFlight.delete(publicId)
      this.pump()
    }
    if (retry) {
      const timer = setTimeout(() => this.enqueue(publicId), this.options.retryDelayMs)
      if (typeof timer.unref === 'function') timer.unref()
    }
  }
}
