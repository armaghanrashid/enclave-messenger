import { describe, expect, it } from 'vitest'
import { RateLimiter } from './ratelimit.ts'

describe('RateLimiter', () => {
  it('blocks after the limit and reports when to retry', () => {
    let t = 0
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: () => t })
    expect(limiter.check('a').remaining).toBe(2)
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(true)
    t = 400
    const blocked = limiter.check('a')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(600)
  })

  it('tracks keys independently', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now: () => 0 })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('b').allowed).toBe(true)
  })

  it('opens a fresh window once the old one ends', () => {
    let t = 0
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now: () => t })
    limiter.check('a')
    expect(limiter.check('a').allowed).toBe(false)
    t = 1000
    expect(limiter.check('a').allowed).toBe(true)
  })
})
