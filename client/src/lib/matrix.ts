import { ClientEvent, createClient, SyncState, type MatrixClient } from 'matrix-js-sdk'
import type { GeneratedSecretStorageKey } from 'matrix-js-sdk/lib/crypto-api'
import { deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api/key-passphrase.js'

/**
 * Secret-storage key cache: the SDK asks for the 4S key via these callbacks
 * during bootstrap/unlock. Held in memory only, never persisted.
 */
let cachedSecretKey: { keyId: string; key: Uint8Array } | null = null

const cryptoCallbacks = {
  getSecretStorageKey: async ({
    keys,
  }: {
    keys: Record<string, unknown>
  }): Promise<[string, Uint8Array] | null> => {
    if (!cachedSecretKey) return null
    if (keys[cachedSecretKey.keyId]) return [cachedSecretKey.keyId, cachedSecretKey.key]
    const first = Object.keys(keys)[0]
    return first ? [first, cachedSecretKey.key] : null
  },
  cacheSecretStorageKey: (keyId: string, _info: unknown, key: Uint8Array) => {
    cachedSecretKey = { keyId, key }
  },
}

const SESSION_KEY = 'enclave.session.v1'

export const DEFAULT_HOMESERVER = import.meta.env.VITE_HOMESERVER_URL ?? 'http://localhost:8008'
export const GATEKEEPER_URL = import.meta.env.VITE_GATEKEEPER_URL ?? 'http://localhost:8090'

export interface Session {
  baseUrl: string
  userId: string
  accessToken: string
  deviceId: string
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function saveSession(s: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

/** Password login, persisted as the current session. */
export async function loginWithPassword(
  baseUrl: string,
  username: string,
  password: string,
): Promise<Session> {
  const tmp = createClient({ baseUrl })
  const res = await tmp.login('m.login.password', {
    identifier: { type: 'm.id.user', user: username },
    password,
    initial_device_display_name: 'Enclave (Web)',
  })
  const session: Session = {
    baseUrl,
    userId: res.user_id,
    accessToken: res.access_token,
    deviceId: res.device_id,
  }
  saveSession(session)
  return session
}

/**
 * Build the long-lived client with end-to-end encryption (Rust crypto,
 * IndexedDB-backed). Singleton: React StrictMode double-mounts effects in
 * development, and two concurrent initRustCrypto() calls corrupt the shared
 * IndexedDB store.
 */
let clientPromise: Promise<MatrixClient> | null = null

export function startClient(session: Session): Promise<MatrixClient> {
  clientPromise ??= (async () => {
    const client = createClient({
      baseUrl: session.baseUrl,
      userId: session.userId,
      accessToken: session.accessToken,
      deviceId: session.deviceId,
      cryptoCallbacks: cryptoCallbacks as never,
    })
    await client.initRustCrypto()
    await client.startClient({ initialSyncLimit: 30 })
    return client
  })()
  return clientPromise
}

/** Resolve once the first sync has delivered account data and rooms. */
export function waitForFirstSync(client: MatrixClient): Promise<void> {
  const ready = (state: string | null) => state === SyncState.Prepared || state === SyncState.Syncing
  if (ready(client.getSyncState())) return Promise.resolve()
  return new Promise((resolve) => {
    const onSync = (state: SyncState) => {
      if (!ready(state)) return
      client.off(ClientEvent.Sync, onSync)
      resolve()
    }
    client.on(ClientEvent.Sync, onSync)
  })
}

/**
 * Create the recovery passphrase: cross-signing, secret storage keyed by the
 * passphrase, and a fresh server-side key backup. The server stores the backup
 * but can never open it.
 */
export async function setupRecovery(
  client: MatrixClient,
  passphrase: string,
  accountPassword: string,
): Promise<void> {
  const crypto = client.getCrypto()
  if (!crypto) throw new Error('Encryption is not initialised yet')
  const recovery: GeneratedSecretStorageKey = await crypto.createRecoveryKeyFromPassphrase(passphrase)
  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys: async (makeRequest) => {
      await makeRequest({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: client.getUserId()! },
        password: accountPassword,
      } as never)
    },
  })
  await crypto.bootstrapSecretStorage({
    createSecretStorageKey: async () => recovery,
    setupNewSecretStorage: true,
  })
  await crypto.resetKeyBackup()
}

/**
 * Restore history on a fresh device from the recovery passphrase. The
 * passphrase unlocks secret storage; the random backup key lives inside it, so
 * derive the storage key, cache it for the SDK callbacks, then pull the backup
 * key out and decrypt the backed-up room keys.
 */
export async function restoreFromPassphrase(
  client: MatrixClient,
  passphrase: string,
): Promise<{ imported: number; total: number }> {
  const crypto = client.getCrypto()
  if (!crypto) throw new Error('Encryption is not initialised yet')

  const keyId = await client.secretStorage.getDefaultKeyId()
  if (!keyId) throw new Error('No recovery passphrase has been set up for this account')
  const keyInfo = client.getAccountData(`m.secret_storage.key.${keyId}`)?.getContent() as
    | { passphrase?: { salt: string; iterations: number } }
    | undefined
  if (!keyInfo?.passphrase) throw new Error('The stored recovery key has no passphrase information')

  const key = await deriveRecoveryKeyFromPassphrase(
    passphrase,
    keyInfo.passphrase.salt,
    keyInfo.passphrase.iterations,
  )
  cachedSecretKey = { keyId, key }

  await crypto.loadSessionBackupPrivateKeyFromSecretStorage()
  const res = await crypto.restoreKeyBackup()
  return { imported: res.imported, total: res.total }
}

export async function recoveryStatus(client: MatrixClient): Promise<{
  backupExists: boolean
  crossSigningReady: boolean
}> {
  const crypto = client.getCrypto()
  if (!crypto) return { backupExists: false, crossSigningReady: false }
  const crossSigningReady = await crypto.isCrossSigningReady().catch(() => false)
  let backupExists = !!(await crypto.getActiveSessionBackupVersion().catch(() => null))
  if (!backupExists) {
    // not yet trusted on this device: ask the server directly
    const check = await crypto.checkKeyBackupAndEnable().catch(() => null)
    backupExists = !!check?.backupInfo
  }
  return { backupExists, crossSigningReady }
}

/** End this session on the server and forget it locally. */
export async function signOut(client: MatrixClient | null) {
  try {
    await client?.logout(true)
  } catch {
    // the token may already be invalid; clear the local session regardless
  }
  localStorage.removeItem(SESSION_KEY)
  location.reload()
}

export interface RedeemResult {
  userId: string
}

/** Exchange an invite code for an account via the gatekeeper service. */
export async function redeemInvite(input: {
  code: string
  username: string
  password: string
}): Promise<RedeemResult> {
  let res: Response
  try {
    res = await fetch(`${GATEKEEPER_URL.replace(/\/$/, '')}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('Could not reach the invite service')
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; userId?: string }
  if (!res.ok || !body.userId) throw new Error(body.error ?? `Invite redemption failed (${res.status})`)
  return { userId: body.userId }
}
