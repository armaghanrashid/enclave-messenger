import { EventType, type MatrixClient, type Room } from 'matrix-js-sdk'

/**
 * Linked notes: notes are custom events in a shared, encrypted notes room (the
 * event type and body are ciphertext to the server). A note is identified by
 * its title and the newest event for a title wins, so an edit is just a
 * re-send and history comes for free.
 */

export const NOTE_EVENT_TYPE = 'app.enclave.note'
const WIKILINK = /\[\[([^\][]+)\]\]/g

export interface Note {
  title: string
  body: string
  sender: string
  senderId: string
  ts: number
  eventId: string
}

export function findNotesRoom(client: MatrixClient): Room | undefined {
  return client
    .getRooms()
    .find((r) => r.getCanonicalAlias()?.startsWith('#notes:') && r.getMyMembership() === 'join')
}

export async function createNotesRoom(client: MatrixClient): Promise<string> {
  const res = await client.createRoom({
    name: 'Notes',
    topic: 'Linked notes: [[like this]]',
    room_alias_name: 'notes',
    initial_state: [
      {
        type: EventType.RoomEncryption,
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      },
    ],
  })
  return res.room_id
}

/** The pieces of a timeline event that note collection needs. */
export interface NoteEventLike {
  getType(): string
  getContent(): Record<string, unknown>
  getTs(): number
  getId(): string | undefined
  getSender(): string | null | undefined
  isRedacted(): boolean
  sender?: { name?: string } | null
}

/** Latest version of every note, given a room's events in timeline order. */
export function collectNotesFromEvents(events: NoteEventLike[]): Map<string, Note> {
  const notes = new Map<string, Note>()
  for (const e of events) {
    if (e.getType() !== NOTE_EVENT_TYPE || e.isRedacted()) continue
    const c = e.getContent()
    if (typeof c.title !== 'string' || !c.title.trim()) continue
    const existing = notes.get(c.title)
    if (existing && existing.ts > e.getTs()) continue
    notes.set(c.title, {
      title: c.title,
      body: typeof c.body === 'string' ? c.body : '',
      sender: e.sender?.name ?? e.getSender() ?? '?',
      senderId: e.getSender() ?? '',
      ts: e.getTs(),
      eventId: e.getId() ?? '',
    })
  }
  return notes
}

export function collectNotes(room: Room): Map<string, Note> {
  return collectNotesFromEvents(room.getLiveTimeline().getEvents())
}

export async function saveNote(
  client: MatrixClient,
  roomId: string,
  title: string,
  body: string,
): Promise<string | undefined> {
  const res = await client.sendEvent(roomId, NOTE_EVENT_TYPE as never, { title, body } as never)
  return res.event_id
}

/** Titles referenced by [[wikilinks]] in a note body, in order, de-duplicated. */
export function linksIn(body: string): string[] {
  const seen = new Set<string>()
  for (const m of body.matchAll(WIKILINK)) {
    const title = m[1].trim()
    if (title) seen.add(title)
  }
  return [...seen]
}

export interface NoteGraph {
  nodes: { id: string; exists: boolean }[]
  links: { source: string; target: string }[]
}

/** Nodes are notes (plus phantom link targets), edges are wikilinks. */
export function buildGraph(notes: Map<string, Note>): NoteGraph {
  const ids = new Set<string>(notes.keys())
  const links: { source: string; target: string }[] = []
  for (const note of notes.values()) {
    for (const target of linksIn(note.body)) {
      if (target === note.title) continue
      ids.add(target)
      links.push({ source: note.title, target })
    }
  }
  return {
    nodes: [...ids].map((id) => ({ id, exists: notes.has(id) })),
    links,
  }
}

export function backlinksTo(notes: Map<string, Note>, title: string): Note[] {
  return [...notes.values()].filter((n) => n.title !== title && linksIn(n.body).includes(title))
}
