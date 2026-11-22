// The icon of each colonist status, from lucide (ISC license), drawn with
// the components from lucide-react.

export const COLONIST_GLYPHS = {
  working: 'bot',
  paused: 'hourglass',
  waiting: 'bot-message-square',
  blocked: 'octagon-alert',
  error: 'bot-off',
  'pr-ready': 'git-pull-request-arrow',
  idle: 'bot',
} as const satisfies Record<string, string>

export type ColonistGlyph = (typeof COLONIST_GLYPHS)[keyof typeof COLONIST_GLYPHS]

// How each status reads in words, on the map, the roster and the cards.
export const COLONIST_STATUS_TEXT = {
  working: 'working',
  paused: 'paused',
  waiting: 'waiting on you',
  blocked: 'blocked',
  error: 'error',
  'pr-ready': 'PR ready',
  idle: 'no live session',
} as const satisfies Record<string, string>
