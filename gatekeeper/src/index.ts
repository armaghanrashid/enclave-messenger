import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { InviteStore } from './invites.ts'
import { RateLimiter } from './ratelimit.ts'
import { SynapseRegistrar } from './synapse.ts'

const config = loadConfig()
mkdirSync(dirname(config.dbPath), { recursive: true })

const db = new Database(config.dbPath)
db.pragma('journal_mode = WAL')
const invites = new InviteStore(db)
invites.prune()

const app = await buildApp({
  invites,
  registrar: new SynapseRegistrar(config.synapseUrl, config.sharedSecret),
  adminToken: config.adminToken,
  serverName: config.serverName,
  corsOrigins: config.corsOrigins,
  limiter: new RateLimiter({ limit: config.redeemLimit, windowMs: config.redeemWindowSeconds * 1000 }),
  logger: true,
})

await app.listen({ port: config.port, host: config.host })
