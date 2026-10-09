import { useState, type FormEvent } from 'react'
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk'
import Avatar from '../components/Avatar'
import { ReactionButtons } from '../components/Reactions'
import { IconEdit, IconFeed, IconLock } from '../components/icons'
import { ENCRYPTED_ROOM_STATE, sendEdit, toggleReaction } from '../lib/actions'
import { aggregateReactions, bodyOf, collectReplacements, feedOrder } from '../lib/timeline'
import { useMatrixTick } from '../lib/useMatrixTick'

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

function findFeedRoom(client: MatrixClient): Room | undefined {
  return client
    .getRooms()
    .find((r) => r.getCanonicalAlias()?.startsWith('#feed:') && r.getMyMembership() === 'join')
}

/**
 * Team feed: one shared, encrypted room rendered as a stream of posts rather
 * than a chat. Edits fold into the original post; newest posts come first.
 */
export default function Feed({ client }: { client: MatrixClient }) {
  useMatrixTick(client)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const myId = client.getUserId()!
  const room = findFeedRoom(client)

  async function createFeed() {
    setBusy(true)
    try {
      await client.createRoom({
        name: 'Team feed',
        topic: 'Announcements for everyone',
        room_alias_name: 'feed',
        initial_state: ENCRYPTED_ROOM_STATE,
      })
    } finally {
      setBusy(false)
    }
  }

  if (!room) {
    return (
      <main className="empty-pane full">
        <IconFeed width={30} height={30} />
        <h2>Team feed</h2>
        <p>There is no feed room yet. It is a shared, encrypted stream for announcements.</p>
        <button className="primary" onClick={createFeed} disabled={busy}>
          {busy ? 'Creating...' : 'Create the feed'}
        </button>
      </main>
    )
  }

  const events = room.getLiveTimeline().getEvents()
  const replacements = collectReplacements(events)
  const posts = feedOrder(events)
  const reactions = aggregateReactions(events, myId)

  async function post(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !room) return
    setDraft('')
    await client.sendTextMessage(room.roomId, text)
  }

  async function saveEdit() {
    if (!editing || !room) return
    const text = editing.text.trim()
    const original = posts.find((p) => p.getId() === editing.id)
    setEditing(null)
    if (!text || !original || text === bodyOf(original, replacements).body) return
    await sendEdit(client, room.roomId, editing.id, text)
  }

  return (
    <main className="feed">
      <header className="pane-head">
        <h2>Feed</h2>
        <span className="enc-line ok">
          <IconLock width={11} height={11} /> End-to-end encrypted · {room.getJoinedMemberCount()} members
        </span>
      </header>

      <div className="feed-scroll">
        <div className="feed-column">
          <form className="card feed-composer" onSubmit={post}>
            <Avatar name={myId} size={32} />
            <div className="composer-body">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Share an update with the team"
                aria-label="New post"
                rows={2}
              />
              <div className="composer-foot">
                <span className="dim">Visible to everyone in the feed</span>
                <button className="primary small" type="submit" disabled={!draft.trim()}>
                  Post
                </button>
              </div>
            </div>
          </form>

          {posts.length === 0 && <p className="empty-state">Nothing posted yet.</p>}

          {posts.map((p: MatrixEvent) => {
            const id = p.getId()!
            const { body, edited } = bodyOf(p, replacements)
            const mine = p.getSender() === myId
            const canEdit = mine && Date.now() - p.getTs() <= EDIT_WINDOW_MS
            const name = p.sender?.name ?? p.getSender() ?? '?'
            const tally = reactions.get(id)
            return (
              <article key={id} className="card post">
                <header>
                  <Avatar name={name} size={32} />
                  <div className="post-meta">
                    <strong>{name}</strong>
                    <time>
                      {new Date(p.getTs()).toLocaleString([], {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {edited && ' · edited'}
                    </time>
                  </div>
                  {canEdit && editing?.id !== id && (
                    <button
                      className="iconbtn"
                      onClick={() => setEditing({ id, text: body })}
                      title="Edit post"
                      aria-label="Edit post"
                    >
                      <IconEdit width={14} height={14} />
                    </button>
                  )}
                </header>
                {editing?.id === id ? (
                  <div className="edit-box">
                    <textarea
                      value={editing.text}
                      onChange={(e) => setEditing({ id, text: e.target.value })}
                      autoFocus
                      aria-label="Edit post"
                    />
                    <div className="edit-actions">
                      <button className="primary small" onClick={saveEdit}>
                        Save
                      </button>
                      <button className="ghost small" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="post-body">{body}</p>
                )}
                <ReactionButtons
                  tally={tally}
                  onToggle={(key) => toggleReaction(client, room.roomId, id, key, tally?.get(key)?.myEventId)}
                />
              </article>
            )
          })}
        </div>
      </div>
    </main>
  )
}
