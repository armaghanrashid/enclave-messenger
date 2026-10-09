import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { EventType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import Avatar from '../components/Avatar'
import { ReactionButtons, ReactionChips } from '../components/Reactions'
import {
  IconBack,
  IconCheck,
  IconChats,
  IconDoubleCheck,
  IconEdit,
  IconLock,
  IconPlus,
  IconReply,
  IconSearch,
  IconSend,
  IconTrash,
} from '../components/icons'
import { ENCRYPTED_ROOM_STATE, sendEdit, toggleReaction } from '../lib/actions'
import {
  aggregateReactions,
  bodyOf,
  collectReplacements,
  continuesRun,
  dayLabel,
  relationOf,
  visibleMessages,
  type ReactionTally,
} from '../lib/timeline'
import { useMatrixTick } from '../lib/useMatrixTick'

function messageText(evt: MatrixEvent, replacements: Map<string, MatrixEvent>) {
  if (evt.isBeingDecrypted()) return { body: 'Decrypting...', edited: false, muted: true }
  if (evt.isDecryptionFailure()) return { body: 'Unable to decrypt this message on this browser.', edited: false, muted: true }
  return { ...bodyOf(evt, replacements), muted: false }
}

function previewText(evt: MatrixEvent, replacements: Map<string, MatrixEvent>): string {
  return messageText(evt, replacements).body
}

function typingNames(room: Room | null, myId: string): string[] {
  const typed = room as (Room & { getTypingMembers?: () => Array<{ userId: string; name?: string }> }) | null
  return (typed?.getTypingMembers?.() ?? []).filter((m) => m.userId !== myId).map((m) => m.name ?? m.userId)
}

function senderColour(id: string): string {
  const palette = ['#0b7a60', '#3a6ea5', '#8a5a9e', '#b0663a', '#4f6f2f', '#a6485c', '#5b5fa8', '#2f7280']
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return palette[Math.abs(h) % palette.length]
}

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function Chats({ client }: { client: MatrixClient }) {
  useMatrixTick(client)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [replyTo, setReplyTo] = useState<MatrixEvent | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatIds, setNewChatIds] = useState('')
  const [newChatError, setNewChatError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const myId = client.getUserId()!

  const rooms = client
    .getRooms()
    .filter((r) => ['join', 'invite'].includes(r.getMyMembership()))
    // feed and notes have their own screens
    .filter((r) => !/^#(feed|notes):/.test(r.getCanonicalAlias() ?? ''))
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())

  const activeRoom = activeRoomId ? client.getRoom(activeRoomId) : null
  const rawEvents = activeRoom ? activeRoom.getLiveTimeline().getEvents() : []

  // recomputed every render on purpose: events change shape without the
  // timeline length changing (decryption completing), so memoizing goes stale
  const replacements = collectReplacements(rawEvents)
  const events = visibleMessages(rawEvents)
  const eventById = new Map(rawEvents.map((e) => [e.getId() ?? '', e]))
  const reactions = aggregateReactions(rawEvents, myId)

  // client-side search: the server only ever sees ciphertext, so search can
  // only live on the device
  const q = query.trim().toLowerCase()
  const roomHits = q ? rooms.filter((r) => r.name?.toLowerCase().includes(q)) : []
  const messageHits: { room: Room; event: MatrixEvent }[] = []
  if (q) {
    outer: for (const room of rooms) {
      const evs = room.getLiveTimeline().getEvents()
      const reps = collectReplacements(evs)
      for (const event of visibleMessages(evs)) {
        if (previewText(event, reps).toLowerCase().includes(q)) messageHits.push({ room, event })
        if (messageHits.length >= 40) break outer
      }
    }
    messageHits.sort((a, b) => b.event.getTs() - a.event.getTs())
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [events.length, activeRoomId])

  // mark the latest message read while viewing a room; guard by event id or
  // the receipt itself re-triggers a render and the effect loops forever
  const lastReceipted = useRef<string | null>(null)
  useEffect(() => {
    const last = events[events.length - 1]
    if (!activeRoom || !last || last.getSender() === myId) return
    const id = last.getId()
    if (!id || lastReceipted.current === id) return
    lastReceipted.current = id
    client.sendReadReceipt(last).catch(() => {})
  })

  useEffect(() => {
    if (!activeRoomId) return
    const typing = draft.trim().length > 0
    client.sendTyping(activeRoomId, typing, typing ? 5000 : 0).catch(() => {})
    if (!typing) return
    const timeout = window.setTimeout(() => client.sendTyping(activeRoomId, false, 0).catch(() => {}), 1500)
    return () => window.clearTimeout(timeout)
  }, [client, activeRoomId, draft])

  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [draft])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || !activeRoomId) return
    setDraft('')
    const content: Record<string, unknown> = { msgtype: 'm.text', body: text }
    if (replyTo?.getId()) content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo.getId() } }
    setReplyTo(null)
    await client.sendEvent(activeRoomId, EventType.RoomMessage, content as never)
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  async function saveEdit() {
    if (!editing || !activeRoom) return
    const text = editing.text.trim()
    const original = eventById.get(editing.id)
    setEditing(null)
    if (!text || !original || text === bodyOf(original, replacements).body) return
    await sendEdit(client, activeRoom.roomId, editing.id, text)
  }

  async function startChat(e: FormEvent) {
    e.preventDefault()
    setNewChatError(null)
    const ids = newChatIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('@') ? s : `@${s}:${client.getDomain() ?? 'localhost'}`))
    if (ids.length === 0) return
    try {
      const res = await client.createRoom({
        invite: ids,
        is_direct: ids.length === 1,
        initial_state: ENCRYPTED_ROOM_STATE,
      })
      setActiveRoomId(res.room_id)
      setNewChatOpen(false)
      setNewChatIds('')
    } catch (err) {
      setNewChatError(err instanceof Error ? err.message : 'Could not start the chat')
    }
  }

  async function openRoom(room: Room) {
    if (room.getMyMembership() === 'invite') await client.joinRoom(room.roomId)
    setActiveRoomId(room.roomId)
    setQuery('')
    setReplyTo(null)
    setEditing(null)
  }

  const isGroup = (activeRoom?.getJoinedMemberCount() ?? 0) > 2
  const typers = typingNames(activeRoom, myId)
  const encrypted = activeRoom?.hasEncryptionStateEvent() ?? false

  return (
    <div className="split">
      <aside className={`list-pane ${activeRoom ? 'has-open' : ''}`}>
        <header className="pane-head">
          <h2>Chats</h2>
          <button
            className="iconbtn"
            onClick={() => setNewChatOpen((o) => !o)}
            title="New chat"
            aria-label="New chat"
            aria-expanded={newChatOpen}
          >
            <IconPlus />
          </button>
        </header>

        {newChatOpen && (
          <form className="inline-form" onSubmit={startChat}>
            <input
              value={newChatIds}
              onChange={(e) => setNewChatIds(e.target.value)}
              placeholder="alice, bob (usernames or @user:server)"
              aria-label="People to invite"
              autoFocus
            />
            <button className="primary small" type="submit" disabled={!newChatIds.trim()}>
              Start
            </button>
            {newChatError && <p className="form-error">{newChatError}</p>}
          </form>
        )}

        <div className="searchbox">
          <IconSearch width={15} height={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats and messages"
            aria-label="Search"
          />
        </div>

        <div className="list-scroll">
          {q ? (
            <>
              {roomHits.length === 0 && messageHits.length === 0 && <p className="empty">No matches in synced history.</p>}
              {roomHits.map((room) => (
                <button key={room.roomId} className="row" onClick={() => openRoom(room)}>
                  <Avatar name={room.name || '?'} size={32} />
                  <span className="row-main">
                    <span className="row-title">{room.name || room.roomId}</span>
                    <span className="row-sub">Chat</span>
                  </span>
                </button>
              ))}
              {messageHits.map(({ room, event }) => (
                <button key={event.getId()} className="row" onClick={() => openRoom(room)}>
                  <Avatar name={event.sender?.name ?? '?'} size={32} />
                  <span className="row-main">
                    <span className="row-title">
                      {event.sender?.name} <span className="dim">in {room.name}</span>
                    </span>
                    <span className="row-sub">{previewText(event, collectReplacements(room.getLiveTimeline().getEvents())).slice(0, 80)}</span>
                  </span>
                </button>
              ))}
            </>
          ) : (
            <>
              {rooms.length === 0 && <p className="empty">No conversations yet. Start one with the plus button.</p>}
              {rooms.map((room) => {
                const evs = room.getLiveTimeline().getEvents()
                const reps = collectReplacements(evs)
                const last = visibleMessages(evs).at(-1)
                const unread = room.getUnreadNotificationCount()
                const invited = room.getMyMembership() === 'invite'
                return (
                  <button
                    key={room.roomId}
                    className={`row ${room.roomId === activeRoomId ? 'active' : ''} ${unread > 0 ? 'unread' : ''}`}
                    onClick={() => openRoom(room)}
                  >
                    <Avatar name={room.name || '?'} size={32} />
                    <span className="row-main">
                      <span className="row-title">{room.name || room.roomId}</span>
                      <span className="row-sub">
                        {invited
                          ? 'Invitation, click to join'
                          : last
                            ? `${last.getSender() === myId ? 'You: ' : ''}${previewText(last, reps).slice(0, 56)}`
                            : 'No messages yet'}
                      </span>
                    </span>
                    <span className="row-side">
                      {last && <span className="row-time">{clock(last.getTs())}</span>}
                      {unread > 0 && <span className="badge">{unread}</span>}
                    </span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      </aside>

      <section className="main-pane">
        {!activeRoom ? (
          <div className="empty-pane">
            <IconChats width={30} height={30} />
            <p>Select a chat, or start a new encrypted one.</p>
          </div>
        ) : (
          <>
            <header className="pane-head conversation-head">
              <button className="iconbtn back" onClick={() => setActiveRoomId(null)} aria-label="Back to chats">
                <IconBack />
              </button>
              <Avatar name={activeRoom.name || '?'} size={28} />
              <div className="head-text">
                <h2>{activeRoom.name}</h2>
                <span className={`enc-line ${encrypted ? 'ok' : 'warn'}`}>
                  <IconLock width={11} height={11} />
                  {encrypted ? 'End-to-end encrypted' : 'Not encrypted'}
                  {isGroup && ` · ${activeRoom.getJoinedMemberCount()} members`}
                </span>
              </div>
            </header>

            <div className="timeline" ref={scrollRef}>
              {events.map((evt, i) => {
                const prev = events[i - 1]
                const newDay = !prev || new Date(prev.getTs()).toDateString() !== new Date(evt.getTs()).toDateString()
                const run = continuesRun(prev, evt)
                const mine = evt.getSender() === myId
                const id = evt.getId()!
                const text = messageText(evt, replacements)
                const sender = evt.sender?.name ?? evt.getSender() ?? '?'
                const repliedId = relationOf(evt)?.['m.in_reply_to']?.event_id
                const repliedTo = repliedId ? eventById.get(repliedId) : undefined
                const tally: Map<string, ReactionTally> | undefined = reactions.get(id)
                const isLastMine = mine && events.filter((e) => e.getSender() === myId).at(-1) === evt
                const seen = isLastMine && activeRoom.getReceiptsForEvent(evt).some((r) => r.userId !== myId)
                return (
                  <div key={id}>
                    {newDay && (
                      <div className="day-sep">
                        <span>{dayLabel(evt.getTs())}</span>
                      </div>
                    )}
                    <div className={`msg ${run && !newDay ? 'run' : ''}`}>
                      <div className="msg-gutter">
                        {run && !newDay ? <span className="msg-hover-time">{clock(evt.getTs())}</span> : <Avatar name={sender} size={32} />}
                      </div>
                      <div className="msg-main">
                        {!(run && !newDay) && (
                          <div className="msg-head">
                            <strong style={{ color: senderColour(evt.getSender() ?? sender) }}>{sender}</strong>
                            <time>{clock(evt.getTs())}</time>
                          </div>
                        )}
                        {repliedTo && (
                          <div className="msg-quote">
                            <IconReply width={12} height={12} />
                            <strong>{repliedTo.sender?.name ?? repliedTo.getSender()}</strong>
                            <span>{previewText(repliedTo, replacements).slice(0, 90)}</span>
                          </div>
                        )}
                        {editing?.id === id ? (
                          <div className="edit-box">
                            <textarea
                              value={editing.text}
                              onChange={(e) => setEditing({ id, text: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditing(null)
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault()
                                  void saveEdit()
                                }
                              }}
                              autoFocus
                              aria-label="Edit message"
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
                          <p className={`msg-body ${text.muted ? 'muted' : ''}`}>
                            {text.body}
                            {text.edited && <span className="edited-mark"> (edited)</span>}
                          </p>
                        )}
                        <ReactionChips tally={tally} onToggle={(key) => toggleReaction(client, activeRoom.roomId, id, key, tally?.get(key)?.myEventId)} />
                        {isLastMine && (
                          <span className={`receipt ${seen ? 'seen' : ''}`}>
                            {seen ? <IconDoubleCheck width={13} height={13} /> : <IconCheck width={13} height={13} />}
                            {seen ? 'Seen' : 'Sent'}
                          </span>
                        )}
                      </div>
                      <div className="msg-actions" role="toolbar" aria-label="Message actions">
                        <ReactionButtons
                          tally={undefined}
                          onToggle={(key) => toggleReaction(client, activeRoom.roomId, id, key, tally?.get(key)?.myEventId)}
                        />
                        <span className="sep" />
                        <button className="iconbtn" onClick={() => setReplyTo(evt)} title="Reply" aria-label="Reply">
                          <IconReply width={14} height={14} />
                        </button>
                        {mine && (
                          <button
                            className="iconbtn"
                            onClick={() => setEditing({ id, text: bodyOf(evt, replacements).body })}
                            title="Edit"
                            aria-label="Edit"
                          >
                            <IconEdit width={14} height={14} />
                          </button>
                        )}
                        {mine &&
                          (confirmDelete === id ? (
                            <button
                              className="danger small"
                              onClick={async () => {
                                setConfirmDelete(null)
                                await client.redactEvent(activeRoom.roomId, id)
                              }}
                              onBlur={() => setConfirmDelete(null)}
                              autoFocus
                            >
                              Delete?
                            </button>
                          ) : (
                            <button className="iconbtn" onClick={() => setConfirmDelete(id)} title="Delete" aria-label="Delete">
                              <IconTrash width={14} height={14} />
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                )
              })}
              {events.length === 0 && <p className="empty-state">No messages yet. Say hello.</p>}
            </div>

            <div className="typing-line" aria-live="polite">
              {typers.length > 0 && `${typers.slice(0, 2).join(', ')}${typers.length > 2 ? ` and ${typers.length - 2} more` : ''} typing...`}
            </div>

            {replyTo && (
              <div className="reply-bar">
                <IconReply width={13} height={13} />
                <span>
                  Replying to <strong>{replyTo.sender?.name ?? replyTo.getSender()}</strong>
                  <small>{previewText(replyTo, replacements).slice(0, 100)}</small>
                </span>
                <button className="ghost small" onClick={() => setReplyTo(null)}>
                  Cancel
                </button>
              </div>
            )}

            <form className="composer" onSubmit={send}>
              <textarea
                ref={composerRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKey}
                placeholder={replyTo ? `Reply to ${replyTo.sender?.name ?? 'message'}` : `Message ${activeRoom.name ?? ''}`}
                aria-label="Message"
              />
              <button className="primary icon" type="submit" disabled={!draft.trim()} aria-label="Send" title="Send">
                <IconSend width={16} height={16} />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
