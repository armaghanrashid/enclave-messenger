import { describe, expect, it } from 'vitest'
import {
  backlinksTo,
  buildGraph,
  collectNotesFromEvents,
  linksIn,
  NOTE_EVENT_TYPE,
  type Note,
} from './notes.ts'
import { fakeEvent } from './testing.ts'

function note(title: string, body: string): Note {
  return { title, body, sender: 'alice', senderId: '@alice:localhost', ts: 1, eventId: title }
}

describe('linksIn (wikilink parsing)', () => {
  it('extracts titles in order and trims whitespace', () => {
    expect(linksIn('See [[Roadmap]] and [[ Key rotation ]].')).toEqual(['Roadmap', 'Key rotation'])
  })

  it('ignores empty and unterminated links', () => {
    expect(linksIn('[[]] [[   ]] [[open')).toEqual([])
  })

  it('de-duplicates repeated links', () => {
    expect(linksIn('[[A]] then [[B]] then [[A]]')).toEqual(['A', 'B'])
  })

  it('does not span brackets or lines of unrelated text', () => {
    expect(linksIn('[[a]] x [b] y [[c]]')).toEqual(['a', 'c'])
  })

  it('returns nothing for plain text', () => {
    expect(linksIn('no links here')).toEqual([])
  })
})

describe('buildGraph', () => {
  const notes = new Map([
    ['Roadmap', note('Roadmap', 'Plan: [[Launch]] and [[Hiring]]')],
    ['Launch', note('Launch', 'Depends on [[Roadmap]] and [[Launch]]')],
    ['Retro', note('Retro', 'standalone')],
  ])
  const graph = buildGraph(notes)

  it('creates one node per note plus phantom targets', () => {
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['Hiring', 'Launch', 'Retro', 'Roadmap'])
    expect(graph.nodes.find((n) => n.id === 'Hiring')?.exists).toBe(false)
    expect(graph.nodes.find((n) => n.id === 'Launch')?.exists).toBe(true)
  })

  it('creates one edge per wikilink and drops self links', () => {
    expect(graph.links).toEqual([
      { source: 'Roadmap', target: 'Launch' },
      { source: 'Roadmap', target: 'Hiring' },
      { source: 'Launch', target: 'Roadmap' },
    ])
  })

  it('finds backlinks', () => {
    expect(backlinksTo(notes, 'Roadmap').map((n) => n.title)).toEqual(['Launch'])
    expect(backlinksTo(notes, 'Retro')).toEqual([])
  })
})

describe('collectNotesFromEvents', () => {
  const noteEvent = (id: string, ts: number, title: string, body: string, redacted = false) =>
    fakeEvent({ id, ts, type: NOTE_EVENT_TYPE, content: { title, body }, redacted })

  it('keeps the newest version of each title', () => {
    const notes = collectNotesFromEvents([
      noteEvent('e1', 100, 'Plan', 'v1'),
      noteEvent('e2', 300, 'Plan', 'v3'),
      noteEvent('e3', 200, 'Plan', 'v2'),
    ])
    expect(notes.get('Plan')?.body).toBe('v3')
    expect(notes.size).toBe(1)
  })

  it('skips redacted, malformed and unrelated events', () => {
    const notes = collectNotesFromEvents([
      noteEvent('e1', 1, 'Gone', 'x', true),
      fakeEvent({ id: 'e2', ts: 2, type: NOTE_EVENT_TYPE, content: { body: 'no title' } }),
      fakeEvent({ id: 'e3', ts: 3 }),
      noteEvent('e4', 4, 'Kept', 'ok'),
    ])
    expect([...notes.keys()]).toEqual(['Kept'])
  })
})
