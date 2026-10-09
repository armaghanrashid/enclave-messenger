import { createHmac } from 'node:crypto'

export interface RegisterInput {
  username: string
  password: string
}

/** Narrow seam so route tests can swap the homeserver out. */
export interface Registrar {
  register(input: RegisterInput): Promise<void>
}

export class RegistrationError extends Error {
  readonly kind: 'taken' | 'rejected' | 'unavailable'

  constructor(kind: 'taken' | 'rejected' | 'unavailable', message: string) {
    super(message)
    this.kind = kind
  }
}

/**
 * MAC defined by the homeserver's shared-secret registration API:
 * HMAC-SHA1(secret, nonce NUL username NUL password NUL "notadmin").
 */
export function registrationMac(
  secret: string,
  nonce: string,
  username: string,
  password: string,
): string {
  return createHmac('sha1', secret)
    .update(nonce)
    .update('\0')
    .update(username)
    .update('\0')
    .update(password)
    .update('\0')
    .update('notadmin')
    .digest('hex')
}

export class SynapseRegistrar implements Registrar {
  private readonly baseUrl: string
  private readonly sharedSecret: string

  constructor(baseUrl: string, sharedSecret: string) {
    this.baseUrl = baseUrl
    this.sharedSecret = sharedSecret
  }

  async register({ username, password }: RegisterInput): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/_synapse/admin/v1/register`
    let nonce: string
    try {
      const res = await fetch(url)
      if (!res.ok) throw new RegistrationError('unavailable', `nonce request failed (${res.status})`)
      nonce = ((await res.json()) as { nonce: string }).nonce
    } catch (err) {
      if (err instanceof RegistrationError) throw err
      throw new RegistrationError('unavailable', 'homeserver unreachable')
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce,
        username,
        password,
        admin: false,
        mac: registrationMac(this.sharedSecret, nonce, username, password),
      }),
    }).catch(() => null)

    if (!res) throw new RegistrationError('unavailable', 'homeserver unreachable')
    if (res.ok) return
    const body = (await res.json().catch(() => ({}))) as { errcode?: string; error?: string }
    if (body.errcode === 'M_USER_IN_USE') throw new RegistrationError('taken', 'username already taken')
    throw new RegistrationError('rejected', body.error ?? `registration failed (${res.status})`)
  }
}
