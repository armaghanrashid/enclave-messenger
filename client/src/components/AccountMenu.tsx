import { useEffect, useState, type FormEvent } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { recoveryStatus, restoreFromPassphrase, setupRecovery, signOut } from '../lib/matrix'
import Avatar from './Avatar'
import { IconClose, IconKey, IconSignOut } from './icons'

type Status = { backupExists: boolean; crossSigningReady: boolean } | null

/** Account popover: recovery-passphrase setup and restore, and sign out. */
export default function AccountMenu({ client, onClose }: { client: MatrixClient; onClose: () => void }) {
  const [status, setStatus] = useState<Status>(null)
  const [passphrase, setPassphrase] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const userId = client.getUserId() ?? ''

  useEffect(() => {
    let alive = true
    recoveryStatus(client).then((s) => alive && setStatus(s))
    return () => {
      alive = false
    }
  }, [client])

  async function setup(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await setupRecovery(client, passphrase, password)
      setStatus(await recoveryStatus(client))
      setPassphrase('')
      setPassword('')
      setMessage({ kind: 'ok', text: 'Recovery is set up. Keep the passphrase somewhere safe.' })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  async function restore(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const r = await restoreFromPassphrase(client, passphrase)
      setPassphrase('')
      setMessage({ kind: 'ok', text: `Restored ${r.imported} of ${r.total} message keys.` })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="popover account-menu" role="dialog" aria-label="Account">
      <div className="popover-head">
        <Avatar name={userId} size={36} />
        <div className="popover-id">
          <strong>{userId.slice(1).split(':')[0]}</strong>
          <span className="dim">{userId}</span>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>

      <section>
        <h3>
          <IconKey width={14} height={14} /> Recovery
        </h3>
        {status === null ? (
          <p className="dim">Checking...</p>
        ) : status.backupExists ? (
          <form onSubmit={restore}>
            <p className="dim">
              Message keys are backed up, encrypted with your passphrase. Restore them to read history on this
              browser.
            </p>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Recovery passphrase"
              aria-label="Recovery passphrase"
              autoComplete="off"
              required
            />
            <button className="primary" disabled={busy} type="submit">
              {busy ? 'Restoring...' : 'Restore history'}
            </button>
          </form>
        ) : (
          <form onSubmit={setup}>
            <p className="dim">
              Set a passphrase to back up your message keys. The server stores the backup but cannot read it.
            </p>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="New recovery passphrase"
              aria-label="New recovery passphrase"
              autoComplete="off"
              minLength={8}
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Account password"
              aria-label="Account password"
              autoComplete="current-password"
              required
            />
            <button className="primary" disabled={busy} type="submit">
              {busy ? 'Setting up...' : 'Set up recovery'}
            </button>
          </form>
        )}
        {message && (
          <p className={message.kind === 'ok' ? 'form-ok' : 'form-error'} role="status">
            {message.text}
          </p>
        )}
      </section>

      <button className="menu-item" onClick={() => signOut(client)}>
        <IconSignOut /> Sign out
      </button>
    </div>
  )
}
