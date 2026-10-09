// Flat, muted fills with white initials; contrast checked against white text.
const PALETTE = ['#0b7a60', '#3a6ea5', '#8a5a9e', '#b0663a', '#4f6f2f', '#a6485c', '#5b5fa8', '#2f7280']

function pick(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

/** Rounded-square initials avatar with a stable colour per name. */
export default function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .replace(/^[@!#]/, '')
    .split(/[\s._:-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: pick(name),
        borderRadius: Math.max(5, Math.round(size * 0.2)),
      }}
      aria-hidden
    >
      {initials || '?'}
    </span>
  )
}
