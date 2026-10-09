import { describe, expect, it } from 'vitest'
import {
  aggregateReactions,
  bodyOf,
  collectReplacements,
  continuesRun,
  feedOrder,
  visibleMessages,
} from './timeline.ts'
import { fakeEvent } from './testing.ts'

const edit = (id: string, target: string, ts: number, body: string) =>
  fakeEvent({
    id,
    ts,
    content: {
      msgtype: 'm.text',
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body },
      'm.relates_to': { rel_type: 'm.replace', event_id: target },
    },
  })

const reaction = (id: string, target: string, key: string, sender: string) =>
  fakeEvent({
    id,
    ts: 1,
    sender,
    type: 'm.reaction',
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: target, key } },
  })

describe('feedOrder', () => {
  it('puts the newest post first', () => {
    const posts = feedOrder([
      fakeEvent({ id: 'old', ts: 100 }),
      fakeEvent({ id: 'new', ts: 300 }),
      fakeEvent({ id: 'mid', ts: 200 }),
    ])
    expect(posts.map((p) => p.getId())).toEqual(['new', 'mid', 'old'])
  })

  it('keeps timeline order for equal timestamps (later event on top)', () => {
    const posts = feedOrder([
      fakeEvent({ id: 'a', ts: 100 }),
      fakeEvent({ id: 'b', ts: 100 }),
      fakeEvent({ id: 'c', ts: 100 }),
    ])
    expect(posts.map((p) => p.getId())).toEqual(['c', 'b', 'a'])
  })

  it('drops edits, redactions, reactions and non-message events', () => {
    const posts = feedOrder([
      fakeEvent({ id: 'p1', ts: 1 }),
      edit('edit1', 'p1', 5, 'changed'),
      fakeEvent({ id: 'p2', ts: 2, redacted: true }),
      reaction('r1', 'p1', 'like', '@bob:localhost'),
      fakeEvent({ id: 'state', ts: 3, type: 'm.room.member' }),
      fakeEvent({ id: 'p3', ts: 4 }),
    ])
    expect(posts.map((p) => p.getId())).toEqual(['p3', 'p1'])
  })

  it('does not reorder a post when it is edited', () => {
    const events = [fakeEvent({ id: 'p1', ts: 10 }), fakeEvent({ id: 'p2', ts: 20 }), edit('e', 'p1', 99, 'x')]
    expect(feedOrder(events).map((p) => p.getId())).toEqual(['p2', 'p1'])
  })
})

describe('edits', () => {
  it('uses the newest edit and flags the message as edited', () => {
    const original = fakeEvent({ id: 'm1', ts: 1, content: { msgtype: 'm.text', body: 'first' } })
    const events = [original, edit('e2', 'm1', 30, 'third'), edit('e1', 'm1', 20, 'second')]
    const replacements = collectReplacements(events)
    expect(bodyOf(original, replacements)).toEqual({ body: 'third', edited: true })
    expect(visibleMessages(events)).toEqual([original])
  })

  it('returns the original text when there is no edit', () => {
    const original = fakeEvent({ id: 'm1', ts: 1, content: { msgtype: 'm.text', body: 'hi' } })
    expect(bodyOf(original, new Map())).toEqual({ body: 'hi', edited: false })
  })
})

describe('aggregateReactions', () => {
  it('counts per key and remembers the viewer own reaction event', () => {
    const tally = aggregateReactions(
      [
        reaction('r1', 'm1', 'like', '@alice:localhost'),
        reaction('r2', 'm1', 'like', '@bob:localhost'),
        reaction('r3', 'm1', 'heart', '@bob:localhost'),
        reaction('r4', 'm2', 'like', '@bob:localhost'),
        fakeEvent({ id: 'gone', ts: 1, type: 'm.reaction', redacted: true }),
      ],
      '@alice:localhost',
    )
    expect(tally.get('m1')?.get('like')).toEqual({ count: 2, myEventId: 'r1' })
    expect(tally.get('m1')?.get('heart')).toEqual({ count: 1 })
    expect(tally.get('m2')?.get('like')).toEqual({ count: 1 })
  })
})

describe('continuesRun', () => {
  const at = (id: string, ts: number, sender: string) => fakeEvent({ id, ts, sender })
  const t0 = new Date(2026, 9, 9, 10, 0, 0).getTime()

  it('groups same sender messages within five minutes', () => {
    expect(continuesRun(at('a', t0, '@a:localhost'), at('b', t0 + 4 * 60_000, '@a:localhost'))).toBe(true)
  })

  it('breaks on a different sender, a long gap, or a new day', () => {
    expect(continuesRun(at('a', t0, '@a:localhost'), at('b', t0 + 1000, '@b:localhost'))).toBe(false)
    expect(continuesRun(at('a', t0, '@a:localhost'), at('b', t0 + 6 * 60_000, '@a:localhost'))).toBe(false)
    expect(continuesRun(at('a', t0, '@a:localhost'), at('b', t0 + 86_400_000, '@a:localhost'))).toBe(false)
    expect(continuesRun(undefined, at('b', t0, '@a:localhost'))).toBe(false)
  })
})
