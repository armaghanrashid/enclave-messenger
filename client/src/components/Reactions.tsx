import { ReactionIcons } from './icons'
import { REACTION_KEYS, type ReactionTally } from '../lib/timeline'

const LABELS: Record<string, string> = { like: 'Like', heart: 'Love', done: 'Done' }

function KeyIcon({ reactionKey }: { reactionKey: string }) {
  const Icon = ReactionIcons[reactionKey as keyof typeof ReactionIcons]
  return Icon ? <Icon width={13} height={13} /> : <span>{reactionKey}</span>
}

/** Chips for reactions that already exist on a message. */
export function ReactionChips({
  tally,
  onToggle,
}: {
  tally?: Map<string, ReactionTally>
  onToggle: (key: string) => void
}) {
  if (!tally || tally.size === 0) return null
  return (
    <div className="reaction-row">
      {[...tally.entries()].map(([key, { count, myEventId }]) => (
        <button
          key={key}
          className={`reaction-chip ${myEventId ? 'mine' : ''}`}
          onClick={() => onToggle(key)}
          aria-pressed={!!myEventId}
          aria-label={`${LABELS[key] ?? key}, ${count}`}
        >
          <KeyIcon reactionKey={key} />
          {count}
        </button>
      ))}
    </div>
  )
}

/** The full set of reaction buttons, with counts where present. */
export function ReactionButtons({
  tally,
  onToggle,
}: {
  tally?: Map<string, ReactionTally>
  onToggle: (key: string) => void
}) {
  return (
    <div className="reaction-row">
      {REACTION_KEYS.map((key) => {
        const t = tally?.get(key)
        return (
          <button
            key={key}
            className={`reaction-chip ${t?.myEventId ? 'mine' : ''} ${t ? '' : 'empty'}`}
            onClick={() => onToggle(key)}
            aria-pressed={!!t?.myEventId}
            aria-label={LABELS[key]}
            title={LABELS[key]}
          >
            <KeyIcon reactionKey={key} />
            {t ? t.count : null}
          </button>
        )
      })}
    </div>
  )
}
