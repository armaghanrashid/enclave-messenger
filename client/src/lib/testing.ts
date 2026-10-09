import type { EventLike } from './timeline.ts'

export interface FakeEventInit {
  id: string
  type?: string
  ts: number
  sender?: string
  content?: Record<string, unknown>
  redacted?: boolean
}

/** Minimal stand-in for a Matrix timeline event, used by the unit tests. */
export function fakeEvent(init: FakeEventInit): EventLike & { sender: { name: string } } {
  const sender = init.sender ?? '@alice:localhost'
  return {
    getId: () => init.id,
    getType: () => init.type ?? 'm.room.message',
    getContent: () => init.content ?? { msgtype: 'm.text', body: init.id },
    getTs: () => init.ts,
    getSender: () => sender,
    isRedacted: () => init.redacted ?? false,
    sender: { name: sender.slice(1).split(':')[0] },
  }
}
