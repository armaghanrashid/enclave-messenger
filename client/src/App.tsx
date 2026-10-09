import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { loadSession, restoreFromPassphrase, signOut, startClient, waitForFirstSync, type Session } from './lib/matrix'
import Login from './screens/Login'
import Chats from './screens/Chats'
import Feed from './screens/Feed'
import Notes from './screens/Notes'
import AccountMenu from './components/AccountMenu'
import Avatar from './components/Avatar'
import { IconChats, IconClose, IconFeed, IconNotes } from './components/icons'

type Section = 'chats' | 'feed' | 'notes'

const SECTIONS: { id: Section; Icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }[] = [
  { id: 'chats', Icon: IconChats, label: 'Chats' },
  { id: 'feed', Icon: IconFeed, label: 'Feed' },
  { id: 'notes', Icon: IconNotes, label: 'Notes' },
]

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [client, setClient] = useState<MatrixClient | null>(null)
  const [section, setSection] = useState<Section>('chats')
  const [startupError, setStartupError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const pendingPassphrase = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!session) return
    // startClient is a module singleton, so it is safe under StrictMode double-mount
    startClient(session)
      .then(async (c) => {
        setClient(c)
        const passphrase = pendingPassphrase.current
        pendingPassphrase.current = undefined
        if (!passphrase) return
        try {
          await waitForFirstSync(c)
          const r = await restoreFromPassphrase(c, passphrase)
          setNotice({ kind: 'ok', text: `History restored: ${r.imported} of ${r.total} message keys.` })
        } catch (e) {
          setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
        }
      })
      .catch((e) => setStartupError(e instanceof Error ? e.message : String(e)))
  }, [session])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 8000)
    return () => window.clearTimeout(t)
  }, [notice])

  if (!session) {
    return (
      <Login
        onLogin={(s, passphrase) => {
          pendingPassphrase.current = passphrase
          setSession(s)
        }}
      />
    )
  }

  if (startupError) {
    return (
      <div className="splash">
        <h1>Connection failed</h1>
        <p>{startupError}</p>
        <button className="primary" onClick={() => signOut(client)}>
          Sign out
        </button>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="splash">
        <img src="/icon.svg" alt="" width={40} height={40} />
        <p>Starting encryption and syncing...</p>
      </div>
    )
  }

  return (
    <div className="app">
      <nav className="rail" aria-label="Primary">
        <img className="logo" src="/icon.svg" alt="Enclave" width={32} height={32} />
        {SECTIONS.map(({ id, Icon, label }) => (
          <button
            key={id}
            className={`rail-btn ${id === section ? 'active' : ''}`}
            title={label}
            aria-label={label}
            aria-current={id === section ? 'page' : undefined}
            onClick={() => setSection(id)}
          >
            <Icon width={20} height={20} />
            <span>{label}</span>
          </button>
        ))}
        <div className="spacer" />
        <button
          className="rail-account"
          title="Account"
          aria-label="Account"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Avatar name={client.getUserId() ?? '?'} size={30} />
        </button>
        {menuOpen && <AccountMenu client={client} onClose={() => setMenuOpen(false)} />}
      </nav>

      <div className="workspace">
        {notice && (
          <div className={`notice ${notice.kind}`} role="status">
            <span>{notice.text}</span>
            <button className="iconbtn" onClick={() => setNotice(null)} aria-label="Dismiss">
              <IconClose width={14} height={14} />
            </button>
          </div>
        )}
        {section === 'chats' ? <Chats client={client} /> : section === 'feed' ? <Feed client={client} /> : <Notes client={client} />}
      </div>
    </div>
  )
}
