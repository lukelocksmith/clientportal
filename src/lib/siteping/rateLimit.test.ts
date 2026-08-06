import { describe, it, beforeEach } from 'vitest'
import assert from 'node:assert'
import { checkRateLimit, resetRateLimits } from './rateLimit'

describe('checkRateLimit', () => {
  beforeEach(() => resetRateLimits())

  it('allows requests up to the max within the window', () => {
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(checkRateLimit('k1', { max: 5, windowMs: 60_000 }), true)
    }
  })

  it('rejects the request once max is exceeded', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('k2', { max: 5, windowMs: 60_000 })
    assert.strictEqual(checkRateLimit('k2', { max: 5, windowMs: 60_000 }), false)
  })

  it('tracks separate keys independently', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('k3', { max: 5, windowMs: 60_000 })
    assert.strictEqual(checkRateLimit('k4', { max: 5, windowMs: 60_000 }), true)
  })
})
