import type { SVGProps } from 'react'

/**
 * Line icons drawn for this app: one stroke weight, rounded caps, currentColor.
 * No emoji and no icon fonts.
 */
function base(props: SVGProps<SVGSVGElement>) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    width: props.width ?? 18,
    height: props.height ?? 18,
    'aria-hidden': true,
    ...props,
  } as SVGProps<SVGSVGElement>
}

type P = SVGProps<SVGSVGElement>

export const IconChats = (p: P) => (
  <svg {...base(p)}>
    <path d="M20.5 11.4c0 4-3.6 7-8 7-.9 0-1.8-.12-2.6-.36L5 19.5l1.1-2.9C4.9 15.4 4.5 13.5 4.5 11.4c0-4 3.6-7 8-7s8 3 8 7Z" />
  </svg>
)

export const IconFeed = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="6" rx="1.8" />
    <rect x="4" y="13.5" width="16" height="6.5" rx="1.8" />
    <path d="M7.5 7h6M7.5 16.7h9" />
  </svg>
)

export const IconNotes = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="6.5" r="2.2" />
    <circle cx="18" cy="8" r="2.2" />
    <circle cx="11.5" cy="17.5" r="2.2" />
    <path d="M8.1 7 15.9 7.8M7.2 8.4l3.2 7.2M16.9 10l-4 6" />
  </svg>
)

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10.5" cy="10.5" r="5.8" />
    <path d="m15 15 5 5" />
  </svg>
)

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
)

export const IconSend = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12 20 4.5l-4.5 15.5-3.6-6.2L4 12Z" />
    <path d="m11.9 13.8 3.4-3.4" />
  </svg>
)

export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
    <path d="M8.5 10.5v-3a3.5 3.5 0 0 1 7 0v3" />
  </svg>
)

export const IconBack = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
)

export const IconReply = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 7 4 12l5 5" />
    <path d="M5 12h8a6 6 0 0 1 6 6v1" />
  </svg>
)

export const IconEdit = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 19.5h4.2L19 9.2a2.7 2.7 0 0 0-3.8-3.8L4.9 15.7 4.5 19.5Z" />
    <path d="m13.8 6.8 3.4 3.4" />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 7h14" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    <path d="m7 7 .8 12a2 2 0 0 0 2 1.8h4.4a2 2 0 0 0 2-1.8L17 7" />
  </svg>
)

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m4.5 12.5 4.5 4.5L19.5 6.5" />
  </svg>
)

export const IconDoubleCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m2.5 12.5 4.2 4.2L15 8.4" />
    <path d="m11.5 14.5 2.2 2.2L22 8.4" />
  </svg>
)

export const IconThumb = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 11v8.5H5a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1h3Z" />
    <path d="M8 11 11.2 4.6a1.7 1.7 0 0 1 3.1 1.2L13.6 9.5h4.7a1.8 1.8 0 0 1 1.8 2.2l-1.3 6a1.8 1.8 0 0 1-1.8 1.4H8" />
  </svg>
)

export const IconHeart = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 19.6S4.5 15.2 4.5 9.8A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.2c0 5.4-7.5 9.8-7.5 9.8Z" />
  </svg>
)

export const IconSmilePlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12.5A8 8 0 1 1 11.5 4" />
    <path d="M8.8 14.2a4.2 4.2 0 0 0 6.4 0M9 10h.01M14.5 10h.01" />
    <path d="M18 3v5M15.5 5.5h5" />
  </svg>
)

export const IconGraph = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="12" r="2" />
    <circle cx="18.5" cy="6" r="2" />
    <circle cx="18.5" cy="18" r="2" />
    <path d="m7.4 11 9.2-4M7.4 13l9.2 4" />
  </svg>
)

export const IconList = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
  </svg>
)

export const IconKey = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="15.5" r="3.7" />
    <path d="m10.7 12.8 8.3-8.3M15.5 8l2.5 2.5M17.5 6l2 2" />
  </svg>
)

export const IconSignOut = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" />
    <path d="M14 8.5 18 12l-4 3.5M18 12H9.5" />
  </svg>
)

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="m6.5 6.5 11 11m0-11-11 11" />
  </svg>
)

export const ReactionIcons = {
  like: IconThumb,
  heart: IconHeart,
  done: IconCheck,
} as const
