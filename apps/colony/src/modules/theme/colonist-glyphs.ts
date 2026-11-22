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

// SVG path data per glyph; lucide's rects and circles written as paths.
export const GLYPH_PATHS: Record<ColonistGlyph, readonly string[]> = {
  bot: [
    'M12 8V4H8',
    'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
    'M2 14h2',
    'M20 14h2',
    'M15 13v2',
    'M9 13v2',
  ],
  hourglass: [
    'M5 22h14',
    'M5 2h14',
    'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22',
    'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2',
  ],
  'bot-message-square': [
    'M12 6V2H8',
    'M15 11v2',
    'M2 12h2',
    'M20 12h2',
    'M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z',
    'M9 11v2',
  ],
  'octagon-alert': [
    'M12 16h.01',
    'M12 8v4',
    'M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z',
  ],
  'bot-off': [
    'M13.67 8H18a2 2 0 0 1 2 2v4.33',
    'M2 14h2',
    'M20 14h2',
    'M22 22 2 2',
    'M8 8H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 1.414-.586',
    'M9 13v2',
    'M9.67 4H12v2.33',
  ],
  'git-pull-request-arrow': [
    'M2 6a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    'M5 9v12',
    'M16 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    'm15 9-3-3 3-3',
    'M12 6h5a2 2 0 0 1 2 2v7',
  ],
}

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
