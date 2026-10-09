import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { registrationMac } from './synapse.ts'

describe('registrationMac', () => {
  it('matches the documented NUL-separated HMAC-SHA1 construction', () => {
    const expected = createHmac('sha1', 's3cret')
      .update(Buffer.from('nonce1\0alice\0pw-pw-pw-pw\0notadmin'))
      .digest('hex')
    expect(registrationMac('s3cret', 'nonce1', 'alice', 'pw-pw-pw-pw')).toBe(expected)
  })

  it('changes when any input changes', () => {
    const base = registrationMac('k', 'n', 'u', 'p')
    expect(registrationMac('k2', 'n', 'u', 'p')).not.toBe(base)
    expect(registrationMac('k', 'n2', 'u', 'p')).not.toBe(base)
    expect(registrationMac('k', 'n', 'u2', 'p')).not.toBe(base)
    expect(registrationMac('k', 'n', 'u', 'p2')).not.toBe(base)
  })
})
