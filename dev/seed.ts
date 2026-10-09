/**
 * Fills a fresh local stack with demo content: three users created through the
 * gatekeeper, an encrypted group chat, a feed and a set of linked notes.
 *
 * Needs Synapse (dev/start.sh) and the gatekeeper (npm run dev:gatekeeper)
 * running. Every demo account shares the same throwaway password and recovery
 * passphrase, which exist only on this machine.
 */
import {
  ClientEvent,
  EventType,
  SyncState,
  createClient,
  type MatrixClient,
} from 'matrix-js-sdk'
import { deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api/key-passphrase.js'

const HOMESERVER = process.env.HOMESERVER_URL ?? 'http://localhost:8008'
const GATEKEEPER = process.env.GATEKEEPER_URL ?? 'http://localhost:8090'
const ADMIN_TOKEN = process.env.GATEKEEPER_ADMIN_TOKEN
const SERVER_NAME = 'localhost'

const DEMO_PASSWORD = 'enclave-demo-1'
const DEMO_RECOVERY_PASSPHRASE = 'enclave demo recovery'
const USERS = ['alice', 'bob', 'carol'] as const
type User = (typeof USERS)[number]

const NOTE_EVENT_TYPE = 'app.enclave.note'
const ENCRYPTION = [
  { type: EventType.RoomEncryption, state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
]

// The SDK and its crypto core are chatty at debug level. Keep our own output
// on a saved reference and silence everything else on the console.
const out = console.log.bind(console)
const outErr = console.error.bind(console)
for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) console[level] = () => {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (msg: string) => out(msg)

function die(msg: string): never {
  outErr(`\nseed: ${msg}`)
  process.exit(1)
}

async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json().catch(() => ({}))) as Record<string, any>
}

/* ---------- accounts via the gatekeeper ---------- */

async function createAccount(username: User): Promise<void> {
  const invite = await fetch(`${GATEKEEPER}/invites`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttlHours: 1 }),
  })
  if (!invite.ok) die(`could not create an invite (${invite.status}); is GATEKEEPER_ADMIN_TOKEN set?`)
  const { code } = (await json(invite)) as { code: string }

  const redeem = await fetch(`${GATEKEEPER}/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, username, password: DEMO_PASSWORD }),
  })
  if (redeem.status === 409) {
    die(`@${username}:${SERVER_NAME} already exists. Run "bash dev/start.sh reset" to start from a clean slate.`)
  }
  if (!redeem.ok) die(`redeem failed for ${username}: ${JSON.stringify(await json(redeem))}`)
  log(`  created @${username}:${SERVER_NAME} via invite`)
}

/* ---------- Matrix clients ---------- */

interface Actor {
  name: User
  userId: string
  client: MatrixClient
  backupRemaining: number | null
}

function makeCryptoCallbacks() {
  let cached: { keyId: string; key: Uint8Array } | null = null
  return {
    callbacks: {
      getSecretStorageKey: async ({ keys }: { keys: Record<string, unknown> }) => {
        if (!cached) return null
        const id = keys[cached.keyId] ? cached.keyId : Object.keys(keys)[0]
        return id ? ([id, cached.key] as [string, Uint8Array]) : null
      },
      cacheSecretStorageKey: (keyId: string, _info: unknown, key: Uint8Array) => {
        cached = { keyId, key }
      },
    },
    set(keyId: string, key: Uint8Array) {
      cached = { keyId, key }
    },
  }
}

async function login(username: string) {
  const res = await fetch(`${HOMESERVER}/_matrix/client/v3/login`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password: DEMO_PASSWORD,
      initial_device_display_name: 'seed script',
    }),
  })
  const body = await json(res)
  if (!res.ok) die(`login failed for ${username}: ${JSON.stringify(body)}`)
  return body as { user_id: string; access_token: string; device_id: string }
}

async function startActor(name: User): Promise<Actor> {
  const session = await login(name)
  const holder = makeCryptoCallbacks()
  const client = createClient({
    baseUrl: HOMESERVER,
    userId: session.user_id,
    accessToken: session.access_token,
    deviceId: session.device_id,
    cryptoCallbacks: holder.callbacks as never,
  })
  await client.initRustCrypto({ useIndexedDB: false })
  const actor: Actor = { name, userId: session.user_id, client, backupRemaining: null }
  client.on('crypto.keyBackupSessionsRemaining' as never, ((n: number) => {
    actor.backupRemaining = n
  }) as never)
  const prepared = new Promise<void>((resolve) => {
    const on = (state: SyncState) => {
      if (state !== SyncState.Prepared) return
      client.off(ClientEvent.Sync, on)
      resolve()
    }
    client.on(ClientEvent.Sync, on)
  })
  await client.startClient({ initialSyncLimit: 50 })
  await prepared
  return actor
}

/** Cross-signing, secret storage keyed by the passphrase, and a fresh key backup. */
async function setUpRecovery(actor: Actor): Promise<void> {
  const crypto = actor.client.getCrypto()!
  const recovery = await crypto.createRecoveryKeyFromPassphrase(DEMO_RECOVERY_PASSPHRASE)
  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys: async (makeRequest) => {
      await makeRequest({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: actor.userId },
        password: DEMO_PASSWORD,
      } as never)
    },
  })
  await crypto.bootstrapSecretStorage({
    createSecretStorageKey: async () => recovery,
    setupNewSecretStorage: true,
  })
  await crypto.resetKeyBackup()
}

/* ---------- content ---------- */

async function createSharedRoom(
  owner: Actor,
  others: Actor[],
  opts: { name: string; topic: string; alias?: string },
): Promise<string> {
  const { room_id } = await owner.client.createRoom({
    name: opts.name,
    topic: opts.topic,
    room_alias_name: opts.alias,
    invite: others.map((o) => o.userId),
    initial_state: ENCRYPTION,
  })
  for (const o of others) await o.client.joinRoom(room_id)
  return room_id
}

async function say(actor: Actor, roomId: string, body: string, replyTo?: string): Promise<string> {
  await sleep(350)
  const content: Record<string, unknown> = { msgtype: 'm.text', body }
  if (replyTo) content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo } }
  const res = await actor.client.sendEvent(roomId, EventType.RoomMessage, content as never)
  return res.event_id
}

async function edit(actor: Actor, roomId: string, targetId: string, body: string) {
  await sleep(350)
  await actor.client.sendEvent(roomId, EventType.RoomMessage, {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body },
    'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
  } as never)
}

async function react(actor: Actor, roomId: string, targetId: string, key: 'like' | 'heart' | 'done') {
  await sleep(150)
  await actor.client.sendEvent(roomId, 'm.reaction' as never, {
    'm.relates_to': { rel_type: 'm.annotation', event_id: targetId, key },
  } as never)
}

async function note(actor: Actor, roomId: string, title: string, body: string) {
  await sleep(200)
  await actor.client.sendEvent(roomId, NOTE_EVENT_TYPE as never, { title, body } as never)
}

async function writeGroupChat(roomId: string, alice: Actor, bob: Actor, carol: Actor) {
  await say(alice, roomId, 'Morning. Release candidate 4 is tagged and the staging deploy is running now.')
  const dryRun = await say(bob, roomId, 'Saw it. The migration dry-run passed: 38 seconds on a copy of production data.')
  await say(carol, roomId, "I'll review the rollout checklist before standup. Anything risky in this one?")
  const risky = await say(alice, roomId, 'Only the index rebuild on the events table. I would run it off-peak.')
  const schedule = await say(bob, roomId, 'Agreed. Scheduling it for 22:00 tonight.')
  await say(carol, roomId, "Then let's gate the deploy on the rebuild finishing. I'll add a check to the pipeline.", risky)
  await say(alice, roomId, 'Good call. Can someone update the runbook with the rollback steps?')
  await say(bob, roomId, "On it. I'll link it from the release checklist note.")
  await edit(bob, roomId, schedule, 'Agreed. Scheduling it for 22:30 tonight, after the backups finish.')
  await say(carol, roomId, 'Thanks both. Standup in ten.')
  await react(alice, roomId, dryRun, 'like')
  await react(carol, roomId, dryRun, 'like')
  await react(bob, roomId, risky, 'done')
  await react(carol, roomId, schedule, 'like')
}

async function writeFeed(roomId: string, alice: Actor, bob: Actor, carol: Actor) {
  const release = await say(
    alice,
    roomId,
    'Release 2.4 goes out on Thursday. The freeze starts Wednesday at 17:00, so please get pending merges in before then.',
  )
  const handover = await say(
    bob,
    roomId,
    'Reminder: the on-call handover doc now lives in Notes. Search for "On-call handover" to find the current rotation.',
  )
  const design = await say(
    carol,
    roomId,
    'Design review for the new onboarding flow is Friday at 14:00. The prototype link is in the shared notes.',
  )
  const patch = await say(
    alice,
    roomId,
    'Thanks everyone for the quick turnaround on the security patch. It was fixed and rolled out within a day of the report.',
  )
  await react(bob, roomId, release, 'like')
  await react(carol, roomId, release, 'done')
  await react(alice, roomId, handover, 'like')
  await react(bob, roomId, design, 'heart')
  await react(carol, roomId, patch, 'heart')
  await react(bob, roomId, patch, 'like')
}

async function writeNotes(roomId: string, alice: Actor, bob: Actor, carol: Actor) {
  await note(
    alice,
    roomId,
    'Release checklist',
    'Steps for every production release.\n\n- Tag the release candidate\n- Run the [[Migration plan]] dry-run on a copy of production\n- Confirm [[On-call handover]] is current\n- Announce the release in the feed\n\nIf anything goes wrong, follow the [[Rollback runbook]].',
  )
  await note(
    bob,
    roomId,
    'Migration plan',
    'Database changes are applied in three phases: expand, backfill, contract.\n\n- Expand: add new columns and indexes; nothing reads them yet\n- Backfill: a batch job, throttled to protect latency\n- Contract: drop the old columns after one full release\n\nSee the [[Release checklist]] for where this fits, and the [[Rollback runbook]] for reversing a phase.',
  )
  await note(
    carol,
    roomId,
    'Rollback runbook',
    'Decide within 15 minutes whether to roll back.\n\n- Revert the deploy to the previous image\n- Pause the backfill job\n- Post a status update in the feed\n\nThe owner during release week is listed in [[On-call handover]]. Background in [[Incident review 14 Sep]].',
  )
  await note(
    bob,
    roomId,
    'On-call handover',
    'Current rotation and escalation notes.\n\n- Primary: alice this week, carol next\n- Paging rules are in [[Alerting rules]]\n- Anything unresolved goes in the feed before handover',
  )
  await note(
    carol,
    roomId,
    'Incident review 14 Sep',
    'A short outage caused by an unbounded query on the events table. The fix was an index plus a query timeout.\n\nFollow-ups: add the dry-run from the [[Migration plan]] and tighten the [[Alerting rules]].',
  )
  await note(
    alice,
    roomId,
    'Alerting rules',
    'Page only for user-visible impact; everything else becomes a ticket.\n\nReviewed after the [[Incident review 14 Sep]]. Next quarter: define an [[Error budget]] per service.',
  )
}

/* ---------- backup flush and verification ---------- */

async function waitForBackup(actors: Actor[], timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  // Room keys reach bob and carol over to-device messages; give them time to
  // arrive, then wait until every client reports an empty upload queue.
  await sleep(4000)
  for (;;) {
    const pending = actors.filter((a) => a.backupRemaining !== 0)
    if (pending.length === 0) {
      await sleep(3000) // a late key can still arrive; confirm the queue stayed empty
      if (actors.every((a) => a.backupRemaining === 0)) return
      continue
    }
    if (Date.now() > deadline) die(`key backup did not finish for ${pending.map((a) => a.name).join(', ')}`)
    await sleep(1000)
  }
}

async function verifyFreshDevice(roomIds: string[]): Promise<{ imported: number; total: number; ok: number; seen: number }> {
  const session = await login('alice')
  const holder = makeCryptoCallbacks()
  const client = createClient({
    baseUrl: HOMESERVER,
    userId: session.user_id,
    accessToken: session.access_token,
    deviceId: session.device_id,
    cryptoCallbacks: holder.callbacks as never,
  })
  await client.initRustCrypto({ useIndexedDB: false })
  const prepared = new Promise<void>((resolve) => {
    const on = (state: SyncState) => {
      if (state !== SyncState.Prepared) return
      client.off(ClientEvent.Sync, on)
      resolve()
    }
    client.on(ClientEvent.Sync, on)
  })
  await client.startClient({ initialSyncLimit: 50 })
  await prepared

  const keyId = (await client.secretStorage.getDefaultKeyId())!
  const info = client.getAccountData(`m.secret_storage.key.${keyId}`)!.getContent() as {
    passphrase: { salt: string; iterations: number }
  }
  holder.set(keyId, await deriveRecoveryKeyFromPassphrase(DEMO_RECOVERY_PASSPHRASE, info.passphrase.salt, info.passphrase.iterations))
  const crypto = client.getCrypto()!
  await crypto.loadSessionBackupPrivateKeyFromSecretStorage()
  const restored = await crypto.restoreKeyBackup()

  let seen = 0
  let ok = 0
  for (const roomId of roomIds) {
    const room = client.getRoom(roomId)
    if (!room) continue
    for (const event of room.getLiveTimeline().getEvents()) {
      if (!event.isEncrypted()) continue
      seen += 1
      await client.decryptEventIfNeeded(event)
      if (!event.isDecryptionFailure()) ok += 1
    }
  }
  client.stopClient()
  await client.logout(true).catch(() => {})
  return { imported: restored.imported, total: restored.total, ok, seen }
}

/* ---------- main ---------- */

async function main() {
  if (!ADMIN_TOKEN) die('GATEKEEPER_ADMIN_TOKEN is not set (it is generated into dev/.secrets by dev/start.sh).')
  for (const [label, url] of [
    ['Synapse', `${HOMESERVER}/_matrix/client/versions`],
    ['Gatekeeper', `${GATEKEEPER}/health`],
  ] as const) {
    const ok = await fetch(url).then((r) => r.ok, () => false)
    if (!ok) die(`${label} is not reachable at ${url}`)
  }

  log('Creating accounts through the gatekeeper')
  for (const u of USERS) await createAccount(u)

  log('Signing in and setting up recovery')
  const [alice, bob, carol] = await Promise.all(USERS.map(startActor))
  for (const a of [alice, bob, carol]) await setUpRecovery(a)

  log('Creating rooms')
  const others = [bob, carol]
  const chatId = await createSharedRoom(alice, others, { name: 'Platform team', topic: 'Releases, rollouts and runbooks' })
  const feedId = await createSharedRoom(alice, others, { name: 'Team feed', topic: 'Announcements for everyone', alias: 'feed' })
  const notesId = await createSharedRoom(alice, others, { name: 'Notes', topic: 'Linked notes: [[like this]]', alias: 'notes' })

  log('Writing messages, posts and notes')
  await writeGroupChat(chatId, alice, bob, carol)
  await writeFeed(feedId, alice, bob, carol)
  await writeNotes(notesId, alice, bob, carol)

  log('Waiting for encrypted key backups to upload')
  await waitForBackup([alice, bob, carol])

  log('Verifying that a brand-new device can read the history')
  const check = await verifyFreshDevice([chatId, feedId, notesId])
  if (check.ok !== check.seen || check.seen === 0) {
    die(`fresh device decrypted ${check.ok} of ${check.seen} events; backup is incomplete`)
  }

  for (const a of [alice, bob, carol]) {
    a.client.stopClient()
    await a.client.logout(true).catch(() => {})
  }

  log('')
  log(`Fresh device restored ${check.imported} of ${check.total} keys and decrypted ${check.ok} of ${check.seen} events.`)
  log('')
  log('Demo accounts (username / password / recovery passphrase):')
  for (const u of USERS) log(`  ${u} / ${DEMO_PASSWORD} / ${DEMO_RECOVERY_PASSPHRASE}`)
  process.exit(0)
}

main().catch((err) => die(err instanceof Error ? (err.stack ?? err.message) : String(err)))
