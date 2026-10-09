/**
 * Pure helpers that turn a room's raw event list into what the screens show:
 * edits fold into the original message, redactions drop out, reactions are
 * counted and the feed is ordered newest first.
 */

export interface EventLike {
  getId(): string | undefined
  getType(): string
  getContent(): Record<string, any>
  getTs(): number
  getSender(): string | null | undefined
  isRedacted(): boolean
}

export interface RelationContent {
  rel_type?: string
  event_id?: string
  key?: string
  'm.in_reply_to'?: { event_id?: string }
}

export const MESSAGE_TYPE = 'm.room.message'
export const REACTION_TYPE = 'm.reaction'

/** Reaction keys the UI offers; each renders as an icon, never an emoji. */
export const REACTION_KEYS = ['like', 'heart', 'done'] as const

export function relationOf(evt: EventLike): RelationContent | undefined {
  return evt.getContent()['m.relates_to'] as RelationContent | undefined
}

export function isReplacement(evt: EventLike): boolean {
  return relationOf(evt)?.rel_type === 'm.replace'
}

/** Map of original event id to its newest edit. */
export function collectReplacements<T extends EventLike>(events: T[]): Map<string, T> {
  const replacements = new Map<string, T>()
  for (const event of events) {
    if (event.getType() !== MESSAGE_TYPE || event.isRedacted()) continue
    const rel = relationOf(event)
    if (rel?.rel_type !== 'm.replace' || !rel.event_id) continue
    const existing = replacements.get(rel.event_id)
    if (!existing || existing.getTs() <= event.getTs()) replacements.set(rel.event_id, event)
  }
  return replacements
}

/** Messages in timeline order with edits and redacted events removed. */
export function visibleMessages<T extends EventLike>(events: T[]): T[] {
  return events.filter((e) => e.getType() === MESSAGE_TYPE && !e.isRedacted() && !isReplacement(e))
}

/** Feed posts, newest first. Equal timestamps keep the later timeline event on top. */
export function feedOrder<T extends EventLike>(events: T[]): T[] {
  return visibleMessages(events)
    .map((event, index) => ({ event, index }))
    .sort((a, b) => b.event.getTs() - a.event.getTs() || b.index - a.index)
    .map((x) => x.event)
}

export interface ReactionTally {
  count: number
  myEventId?: string
}

/** target event id, then reaction key, then count and the viewer's own reaction event. */
export function aggregateReactions(
  events: EventLike[],
  myId: string | null | undefined,
): Map<string, Map<string, ReactionTally>> {
  const out = new Map<string, Map<string, ReactionTally>>()
  for (const e of events) {
    if (e.getType() !== REACTION_TYPE || e.isRedacted()) continue
    const rel = relationOf(e)
    if (rel?.rel_type !== 'm.annotation' || !rel.event_id || !rel.key) continue
    const forTarget = out.get(rel.event_id) ?? new Map<string, ReactionTally>()
    const entry = forTarget.get(rel.key) ?? { count: 0 }
    entry.count += 1
    if (myId && e.getSender() === myId) entry.myEventId = e.getId()
    forTarget.set(rel.key, entry)
    out.set(rel.event_id, forTarget)
  }
  return out
}

/** Text of an event after applying its newest edit. */
export function bodyOf(
  evt: EventLike,
  replacements?: Map<string, EventLike>,
): { body: string; edited: boolean } {
  const edit = replacements?.get(evt.getId() ?? '')
  const next = edit?.getContent()['m.new_content'] as { body?: unknown } | undefined
  const content = next ?? evt.getContent()
  return { body: typeof content.body === 'string' ? content.body : '', edited: !!edit }
}

const GROUP_WINDOW_MS = 5 * 60 * 1000

/** True when `evt` continues the previous message's run from the same sender. */
export function continuesRun(prev: EventLike | undefined, evt: EventLike): boolean {
  if (!prev) return false
  if (prev.getSender() !== evt.getSender()) return false
  if (new Date(prev.getTs()).toDateString() !== new Date(evt.getTs()).toDateString()) return false
  return evt.getTs() - prev.getTs() <= GROUP_WINDOW_MS
}

export function dayLabel(ts: number, now = new Date()): string {
  const d = new Date(ts)
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
}
