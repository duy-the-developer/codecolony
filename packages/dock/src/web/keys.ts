// Keys xterm.js encodes differently from a native terminal set up for coding
// agents. xterm.js sends a bare CR for Shift+Enter, the same as Enter, so an
// agent such as Claude Code submits instead of starting a new line. ESC CR is
// what those terminals send instead (Claude Code's /terminal-setup binds it),
// and Herdr passes it through to the pane unchanged.
export const SHIFT_ENTER = '\x1b\r'

export type KeyInput = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing'
>

// The bytes to send for a key in place of xterm.js's own, or null to let
// xterm.js handle it.
export function keySequence(event: KeyInput): string | null {
  if (event.isComposing || event.key !== 'Enter') return null
  if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) return SHIFT_ENTER
  return null
}
