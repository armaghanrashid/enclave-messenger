import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { generateCode, hashCode, InviteStore, normaliseCode } from './invites.ts'

describe('invite codes', () => {
  it('hashes with sha256 and ignores case and separators', () => {
    expect(hashCode('abcd-efgh-jkmn')).toBe(hashCode('ABCDEFGHJKMN'))
    expect(hashCode('ABCDEFGHJKMN')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashCode('ABCDEFGHJKMN')).not.toBe(hashCode('ABCDEFGHJKMP'))
    expect(normaliseCode(' ab cd-ef ')).toBe('ABCDEF')
  })

  it('generates well-formed, distinct codes', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const code = generateCode()
      expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/)
      seen.add(code)
    }
    expect(seen.size).toBe(200)
  })
})

describe('InviteStore', () => {
  let db: Database.Database
  let time: number
  let store: InviteStore

  beforeEach(() => {
    db = new Database(':memory:')
    time = 1_000_000
    store = new InviteStore(db, { now: () => time })
  })

  it('never stores the plaintext code', () => {
    const { code } = store.create(60)
    const rows = db.prepare('SELECT * FROM invites').all() as Array<{ code_hash: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].code_hash).toBe(hashCode(code))
    expect(JSON.stringify(rows)).not.toContain(normaliseCode(code))
  })

  it('accepts a valid code exactly once', () => {
    const { code } = store.create(60)
    expect(store.claim(code)).toBe('ok')
    expect(store.claim(code)).toBe('used')
  })

  it('accepts the code regardless of formatting', () => {
    const { code } = store.create(60)
    expect(store.claim(code.toLowerCase().replaceAll('-', ' '))).toBe('ok')
  })

  it('rejects unknown codes', () => {
    expect(store.claim('AAAA-BBBB-CCCC')).toBe('unknown')
  })

  it('expires codes at the deadline', () => {
    const { code, expiresAt } = store.create(60)
    expect(expiresAt).toBe(1_000_000 + 60_000)
    time = expiresAt - 1
    expect(store.claim(code)).toBe('ok')

    const second = store.create(60)
    time = second.expiresAt
    expect(store.claim(second.code)).toBe('expired')
  })

  it('lets a released code be used again', () => {
    const { code } = store.create(60)
    expect(store.claim(code)).toBe('ok')
    store.release(code)
    expect(store.claim(code)).toBe('ok')
  })

  it('prunes invites that expired more than a day ago', () => {
    store.create(60)
    time += 25 * 60 * 60 * 1000
    expect(store.prune()).toBe(1)
    expect(db.prepare('SELECT count(*) AS n FROM invites').get()).toEqual({ n: 0 })
  })
})
