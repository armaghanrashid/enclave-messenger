import { createHash, randomBytes } from 'node:crypto'
import type { Database } from 'better-sqlite3'

// Crockford-style alphabet: no 0/O/1/I/L so codes survive being read aloud.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
const GROUPS = 3
const GROUP_LEN = 4

export interface InviteClock {
  now(): number
}

const systemClock: InviteClock = { now: () => Date.now() }

/** Normalise user input: strip separators, upper-case. */
export function normaliseCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase()
}

/** SHA-256 hex of the normalised code. Only this digest is ever stored. */
export function hashCode(input: string): string {
  return createHash('sha256').update(normaliseCode(input)).digest('hex')
}

/** Random code of the form ABCD-EFGH-JKMN (about 59 bits of entropy). */
export function generateCode(): string {
  const bytes = randomBytes(GROUPS * GROUP_LEN)
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
  const groups: string[] = []
  for (let i = 0; i < GROUPS; i++) groups.push(chars.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(''))
  return groups.join('-')
}

export type ClaimResult = 'ok' | 'unknown' | 'expired' | 'used'

interface InviteRow {
  expires_at: number
  used_at: number | null
}

export class InviteStore {
  private readonly db: Database
  private readonly clock: InviteClock

  constructor(db: Database, clock: InviteClock = systemClock) {
    this.db = db
    this.clock = clock
    db.exec(`
      CREATE TABLE IF NOT EXISTS invites (
        code_hash  TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at    INTEGER
      )
    `)
  }

  /** Create an invite; the plaintext code is returned once and never stored. */
  create(ttlSeconds: number): { code: string; expiresAt: number } {
    const code = generateCode()
    const createdAt = this.clock.now()
    const expiresAt = createdAt + ttlSeconds * 1000
    this.db
      .prepare('INSERT INTO invites (code_hash, created_at, expires_at) VALUES (?, ?, ?)')
      .run(hashCode(code), createdAt, expiresAt)
    return { code, expiresAt }
  }

  /**
   * Atomically mark an invite as used. The conditional UPDATE is the single
   * point of truth, so two concurrent redemptions can never both succeed.
   */
  claim(code: string): ClaimResult {
    const hash = hashCode(code)
    const now = this.clock.now()
    const claimed = this.db
      .prepare('UPDATE invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
      .run(now, hash, now)
    if (claimed.changes === 1) return 'ok'
    const row = this.db
      .prepare('SELECT expires_at, used_at FROM invites WHERE code_hash = ?')
      .get(hash) as InviteRow | undefined
    if (!row) return 'unknown'
    if (row.used_at !== null) return 'used'
    return 'expired'
  }

  /** Give an invite back, used when account creation failed after the claim. */
  release(code: string): void {
    this.db.prepare('UPDATE invites SET used_at = NULL WHERE code_hash = ?').run(hashCode(code))
  }

  /** Remove invites that expired more than a day ago. */
  prune(): number {
    const cutoff = this.clock.now() - 24 * 60 * 60 * 1000
    return this.db.prepare('DELETE FROM invites WHERE expires_at < ?').run(cutoff).changes
  }
}
