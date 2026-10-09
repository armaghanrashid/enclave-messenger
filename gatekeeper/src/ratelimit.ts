export interface RateLimiterOptions {
  /** Requests allowed per key inside one window. */
  limit: number
  windowMs: number
  now?: () => number
}

export interface RateDecision {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

/** Fixed-window limiter keyed by an arbitrary string (client address). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()
  private readonly opts: RateLimiterOptions
  private readonly now: () => number

  constructor(opts: RateLimiterOptions) {
    this.opts = opts
    this.now = opts.now ?? Date.now
  }

  check(key: string): RateDecision {
    const t = this.now()
    this.sweep(t)
    let entry = this.hits.get(key)
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + this.opts.windowMs }
      this.hits.set(key, entry)
    }
    if (entry.count >= this.opts.limit) {
      return { allowed: false, remaining: 0, retryAfterMs: entry.resetAt - t }
    }
    entry.count += 1
    return { allowed: true, remaining: this.opts.limit - entry.count, retryAfterMs: 0 }
  }

  private sweep(t: number): void {
    if (this.hits.size < 1024) return
    for (const [key, entry] of this.hits) if (entry.resetAt <= t) this.hits.delete(key)
  }
}
