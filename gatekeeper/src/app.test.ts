import Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import { InviteStore } from './invites.ts'
import { RateLimiter } from './ratelimit.ts'
import { RegistrationError, type RegisterInput, type Registrar } from './synapse.ts'

class FakeRegistrar implements Registrar {
  users: string[] = []
  fail: RegistrationError | null = null
  async register({ username }: RegisterInput) {
    if (this.fail) throw this.fail
    if (this.users.includes(username)) throw new RegistrationError('taken', 'taken')
    this.users.push(username)
  }
}

const ADMIN = 'test-admin-token'

describe('gatekeeper routes', () => {
  let app: FastifyInstance
  let registrar: FakeRegistrar
  let time: number

  beforeEach(async () => {
    time = 0
    registrar = new FakeRegistrar()
    app = await buildApp({
      invites: new InviteStore(new Database(':memory:'), { now: () => time }),
      registrar,
      adminToken: ADMIN,
      serverName: 'localhost',
      corsOrigins: ['http://localhost:5173'],
      limiter: new RateLimiter({ limit: 4, windowMs: 60_000, now: () => time }),
    })
  })

  async function invite(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: {},
    })
    expect(res.statusCode).toBe(201)
    return res.json().code
  }

  const redeem = (code: string, username = 'alice') =>
    app.inject({
      method: 'POST',
      url: '/redeem',
      payload: { code, username, password: 'correct-horse-battery' },
    })

  it('requires the admin token to create invites', async () => {
    const none = await app.inject({ method: 'POST', url: '/invites', payload: {} })
    const wrong = await app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: 'Bearer nope' },
      payload: {},
    })
    expect(none.statusCode).toBe(401)
    expect(wrong.statusCode).toBe(401)
  })

  it('registers a user once per invite', async () => {
    const code = await invite()
    const first = await redeem(code)
    expect(first.statusCode).toBe(201)
    expect(first.json().userId).toBe('@alice:localhost')
    expect(registrar.users).toEqual(['alice'])

    const second = await redeem(code, 'bob')
    expect(second.statusCode).toBe(403)
    expect(registrar.users).toEqual(['alice'])
  })

  it('refuses an expired invite', async () => {
    const code = await invite()
    time = 73 * 3600 * 1000
    expect((await redeem(code)).statusCode).toBe(403)
  })

  it('gives the invite back when the username is taken', async () => {
    registrar.users.push('alice')
    const code = await invite()
    expect((await redeem(code, 'alice')).statusCode).toBe(409)
    expect((await redeem(code, 'bob')).statusCode).toBe(201)
  })

  it('validates usernames and passwords before spending the invite', async () => {
    const code = await invite()
    expect((await redeem(code, 'A!')).statusCode).toBe(400)
    const short = await app.inject({
      method: 'POST',
      url: '/redeem',
      payload: { code, username: 'carol', password: 'short' },
    })
    expect(short.statusCode).toBe(400)
    expect((await redeem(code, 'carol')).statusCode).toBe(201)
  })

  it('rate limits redeem attempts per client', async () => {
    for (let i = 0; i < 4; i++) expect((await redeem('AAAA-BBBB-CCCC')).statusCode).toBe(403)
    const blocked = await redeem('AAAA-BBBB-CCCC')
    expect(blocked.statusCode).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  })
})
