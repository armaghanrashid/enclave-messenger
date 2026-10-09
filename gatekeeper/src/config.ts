export interface Config {
  adminToken: string
  sharedSecret: string
  synapseUrl: string
  serverName: string
  dbPath: string
  host: string
  port: number
  corsOrigins: string[]
  redeemLimit: number
  redeemWindowSeconds: number
}

const PLACEHOLDER = /^replace-with/

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (!value || PLACEHOLDER.test(value)) {
    throw new Error(`${key} is not set (copy .env.example to .env and fill it in)`)
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    adminToken: required(env, 'GATEKEEPER_ADMIN_TOKEN'),
    sharedSecret: required(env, 'REGISTRATION_SHARED_SECRET'),
    synapseUrl: env.SYNAPSE_URL ?? 'http://localhost:8008',
    serverName: env.MATRIX_SERVER_NAME ?? 'localhost',
    dbPath: env.GATEKEEPER_DB ?? './data/gatekeeper.db',
    host: env.HOST ?? 'localhost',
    port: Number(env.PORT ?? 8090),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    redeemLimit: Number(env.REDEEM_LIMIT ?? 10),
    redeemWindowSeconds: Number(env.REDEEM_WINDOW_SECONDS ?? 900),
  }
}
