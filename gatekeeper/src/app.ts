import { timingSafeEqual } from 'node:crypto'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import { InviteStore } from './invites.ts'
import { RateLimiter } from './ratelimit.ts'
import { RegistrationError, type Registrar } from './synapse.ts'

export interface AppDeps {
  invites: InviteStore
  registrar: Registrar
  adminToken: string
  serverName: string
  corsOrigins: string[]
  limiter: RateLimiter
  logger?: boolean
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/
const DEFAULT_TTL_HOURS = 72
const MAX_TTL_HOURS = 24 * 14

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 4 * 1024 })
  await app.register(cors, { origin: deps.corsOrigins, methods: ['GET', 'POST'] })

  app.get('/health', async () => ({ ok: true }))

  app.post('/invites', async (req, reply) => {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!safeEqual(token, deps.adminToken)) return reply.code(401).send({ error: 'unauthorized' })

    const body = (req.body ?? {}) as { ttlHours?: unknown }
    let ttlHours = DEFAULT_TTL_HOURS
    if (body.ttlHours !== undefined) {
      if (typeof body.ttlHours !== 'number' || !(body.ttlHours > 0) || body.ttlHours > MAX_TTL_HOURS) {
        return reply.code(400).send({ error: `ttlHours must be between 0 and ${MAX_TTL_HOURS}` })
      }
      ttlHours = body.ttlHours
    }
    const { code, expiresAt } = deps.invites.create(Math.round(ttlHours * 3600))
    return reply.code(201).send({ code, expiresAt: new Date(expiresAt).toISOString() })
  })

  app.post('/redeem', async (req, reply) => {
    const decision = deps.limiter.check(req.ip)
    if (!decision.allowed) {
      reply.header('Retry-After', Math.ceil(decision.retryAfterMs / 1000))
      return reply.code(429).send({ error: 'too many attempts, try again later' })
    }

    const body = (req.body ?? {}) as { code?: unknown; username?: unknown; password?: unknown }
    if (typeof body.code !== 'string' || typeof body.username !== 'string' || typeof body.password !== 'string') {
      return reply.code(400).send({ error: 'code, username and password are required' })
    }
    const username = body.username.trim().toLowerCase()
    if (!USERNAME.test(username)) {
      return reply.code(400).send({ error: 'username must be 3-32 characters: a-z, 0-9, dot, dash, underscore' })
    }
    if (body.password.length < 8 || body.password.length > 128) {
      return reply.code(400).send({ error: 'password must be 8-128 characters' })
    }

    const claim = deps.invites.claim(body.code)
    if (claim !== 'ok') {
      // One message for every failure so codes cannot be probed for state.
      return reply.code(403).send({ error: 'invalid or expired invite code' })
    }

    try {
      await deps.registrar.register({ username, password: body.password })
    } catch (err) {
      deps.invites.release(body.code)
      if (err instanceof RegistrationError) {
        if (err.kind === 'taken') return reply.code(409).send({ error: 'username is already taken' })
        if (err.kind === 'unavailable') return reply.code(502).send({ error: 'homeserver unavailable' })
        return reply.code(400).send({ error: err.message })
      }
      throw err
    }
    return reply.code(201).send({ userId: `@${username}:${deps.serverName}` })
  })

  return app
}
