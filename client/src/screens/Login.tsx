import { useState, type FormEvent } from 'react'
import { DEFAULT_HOMESERVER, loginWithPassword, redeemInvite, type Session } from '../lib/matrix'

type Mode = 'signin' | 'join'

export default function Login({
  onLogin,
}: {
  onLogin: (session: Session, recoveryPassphrase?: string) => void
}) {
  const [mode, setMode] = useState<Mode>('signin')
  const [homeserver, setHomeserver] = useState(DEFAULT_HOMESERVER)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [recovery, setRecovery] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const name = username.trim().toLowerCase()
      if (mode === 'join') await redeemInvite({ code: code.trim(), username: name, password })
      const session = await loginWithPassword(homeserver.trim(), name, password)
      onLogin(session, mode === 'signin' && recovery ? recovery : undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src="/icon.svg" alt="" width={36} height={36} />
          <div>
            <h1>Enclave</h1>
            <p>End-to-end encrypted team messenger</p>
          </div>
        </div>

        <div className="segmented" role="tablist" aria-label="Account">
          <button role="tab" aria-selected={mode === 'signin'} onClick={() => setMode('signin')} type="button">
            Sign in
          </button>
          <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')} type="button">
            Join with invite
          </button>
        </div>

        <form onSubmit={submit}>
          {mode === 'join' && (
            <label>
              Invite code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABCD-EFGH-JKMN"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
          )}
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="alice"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'join' ? 'new-password' : 'current-password'}
              minLength={mode === 'join' ? 8 : undefined}
              required
            />
          </label>
          {mode === 'signin' && (
            <label>
              <span className="label-row">
                Recovery passphrase <span className="optional">optional</span>
              </span>
              <input
                type="password"
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
                autoComplete="off"
              />
              <span className="hint">Restores your message history on this browser.</span>
            </label>
          )}
          <label>
            Homeserver
            <input type="url" value={homeserver} onChange={(e) => setHomeserver(e.target.value)} required />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary block" type="submit" disabled={busy}>
            {busy ? 'Working...' : mode === 'join' ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
