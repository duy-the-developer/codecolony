import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, type Extension, RangeSet } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutterLineClass,
  highlightSpecialChars,
  lineNumbers,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import type { LineRange } from '../../../shared/world-types.ts'

export interface CodeViewProps {
  text: string
  // Picks the syntax colours: `pack.ts`, `Dockerfile`.
  fileName: string
  // Lines to highlight and scroll to, such as the selected symbol's.
  highlight: LineRange | undefined
}

// A read-only CodeMirror view: line numbers and syntax colours, no editing.
// The view lives as long as the component; text, language and highlight are
// swapped into it.
export function CodeView({ text, fileName, highlight }: CodeViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const language = useRef(new Compartment())
  const lines = useRef(new Compartment())

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          highlightSpecialChars(),
          syntaxHighlighting(CODE_HIGHLIGHT),
          CODE_THEME,
          language.current.of([]),
          lines.current.of([]),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      effects: EditorView.scrollIntoView(0),
    })
  }, [text])

  useEffect(() => {
    const description = LanguageDescription.matchFilename(languages, fileName)
    let isCurrent = true
    const apply = (extension: Extension) => {
      if (isCurrent) viewRef.current?.dispatch({ effects: language.current.reconfigure(extension) })
    }
    apply([])
    description?.load().then(apply, () => apply([]))
    return () => {
      isCurrent = false
    }
  }, [fileName])

  const start = highlight?.start
  const end = highlight?.end
  // biome-ignore lint/correctness/useExhaustiveDependencies: new text moves the lines, so re-apply them.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (start === undefined || end === undefined) {
      view.dispatch({ effects: lines.current.reconfigure([]) })
      return
    }
    const first = view.state.doc.line(Math.min(Math.max(start, 1), view.state.doc.lines))
    view.dispatch({
      effects: [
        lines.current.reconfigure(highlightLines(start, end)),
        EditorView.scrollIntoView(first.from, { y: 'start', yMargin: 24 }),
      ],
    })
  }, [start, end, text])

  return <div ref={hostRef} className="h-full min-h-0" data-testid="code-view" />
}

const HIGHLIGHTED_LINE = Decoration.line({ class: 'cm-highlighted-line' })

class HighlightedGutterLine extends GutterMarker {
  override elementClass = 'cm-highlighted-gutter-line'
}
const HIGHLIGHTED_GUTTER_LINE = new HighlightedGutterLine()

// Marks lines start..end (1-based, inclusive) in the text and the gutter.
function highlightLines(start: number, end: number): Extension {
  return [
    EditorView.decorations.compute(['doc'], (state) =>
      Decoration.set(listLineStarts(state, start, end).map((at) => HIGHLIGHTED_LINE.range(at))),
    ),
    gutterLineClass.compute(['doc'], (state) =>
      RangeSet.of(listLineStarts(state, start, end).map((at) => HIGHLIGHTED_GUTTER_LINE.range(at))),
    ),
  ]
}

function listLineStarts(state: EditorState, start: number, end: number): number[] {
  const starts: number[] = []
  for (let n = Math.max(start, 1); n <= Math.min(end, state.doc.lines); n++) {
    starts.push(state.doc.line(n).from)
  }
  return starts
}

const AMBER = '#f7a21b'

const CODE_THEME = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#08121c', color: '#dce7f2', fontSize: '12px' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, Menlo, monospace',
      fontVariantLigatures: 'none',
      lineHeight: '1.6',
    },
    '.cm-content': { padding: '4px 0' },
    '.cm-gutters': { backgroundColor: '#08121c', color: '#4b6178', border: 'none' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 10px', minWidth: '40px' },
    '.cm-line': { padding: '0 12px 0 6px' },
    '.cm-highlighted-line': {
      backgroundColor: 'rgba(247, 162, 27, 0.08)',
      boxShadow: `inset 2px 0 ${AMBER}`,
    },
    '.cm-highlighted-gutter-line': { color: AMBER },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#24405c !important' },
  },
  { dark: true },
)

const CODE_HIGHLIGHT = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword],
    color: '#c792ea',
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#7fb2f0' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#82cfff' },
  {
    tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)],
    color: '#eef4fa',
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#a5d6a7' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#f78c6c' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: '#5f7a93',
    fontStyle: 'italic',
  },
  { tag: [tags.tagName], color: '#7fb2f0' },
  { tag: [tags.attributeName], color: '#c792ea' },
  { tag: [tags.heading], color: '#eef4fa', fontWeight: '600' },
  { tag: [tags.link, tags.url], color: '#82cfff', textDecoration: 'underline' },
  { tag: [tags.meta, tags.processingInstruction], color: '#7d93a8' },
  { tag: tags.invalid, color: '#e05050' },
])
