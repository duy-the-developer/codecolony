import type { ReactNode } from 'react'
import { OVERLAYS } from '../../../modules/map/overlays.ts'
import type { Scene } from '../../../modules/scene/scene.ts'
import { listTreeChildren, listTreeRoots } from '../../../modules/scene/tree-entries.ts'
import { hueOf, SYMBOL_COLORS } from '../../../modules/theme/palette.ts'
import type { SymbolKind, WorldNode } from '../../../modules/world/world-types.ts'
import { Kbd } from '../ui/kbd.tsx'

export interface LegendProps {
  scene: Scene | undefined
}

const OVERLAY_DETAILS: Record<(typeof OVERLAYS)[number]['id'], string> = {
  dependency: 'imports between modules; the arrow points at the imported one',
}

const SYMBOL_NAMES: Record<SymbolKind, string> = {
  function: 'Function',
  method: 'Method',
  class: 'Class',
  interface: 'Interface',
  type: 'Type',
  enum: 'Enum',
  variable: 'Variable',
  namespace: 'Namespace',
}

const MAX_MODULES = 10

const KEYS: [string, string][] = [
  ['⌘K', 'Search files and symbols'],
  ['[', 'Toggle the left panel'],
  [']', 'Toggle the right panel'],
  ['+ −', 'Zoom (or scroll, pinch)'],
  ['← →', 'Pan (or drag)'],
  ['Home', 'Show the whole map'],
  ['Esc', 'Clear the selection'],
]

// What the map's colours, lines and keys mean.
export function Legend({ scene }: LegendProps) {
  const modules = scene ? listColourGroups(scene) : []
  return (
    <div className="space-y-5 px-3 py-3">
      <LegendSection title="Modules" note="the files of each module share a colour">
        {modules.map((module) => (
          <LegendRow
            key={module.id}
            mark={<Swatch color={`hsl(${hueOf(module)}, 42%, 40%)`} />}
            label={module.path ?? module.name}
          />
        ))}
        <LegendRow mark={<Swatch color="hsl(210, 12%, 34%)" />} label="Tests (greyed out)" />
      </LegendSection>

      <LegendSection title="Size">
        <LegendRow
          mark={<Swatch color="hsl(210, 42%, 34%)" />}
          label="File"
          detail="area follows its line count"
        />
        <LegendRow
          mark={<span className="size-3 rounded-sm border border-[#7fa9d6]" />}
          label="Folder"
          detail="grows with its files; zoom in to open it"
        />
      </LegendSection>

      <LegendSection title="Symbols" note="inside a file, zoomed in">
        {Object.entries(SYMBOL_NAMES).map(([kind, name]) => (
          <LegendRow
            key={kind}
            mark={<Swatch color={SYMBOL_COLORS[kind as SymbolKind]} />}
            label={name}
          />
        ))}
      </LegendSection>

      <LegendSection title="Overlays" note="off by default; switch them on from Overlays">
        {OVERLAYS.map((overlay) => (
          <LegendRow
            key={overlay.id}
            mark={<Arrow color={overlay.color} />}
            label={overlay.name}
            detail={OVERLAY_DETAILS[overlay.id]}
          />
        ))}
        <LegendRow
          mark={<Lanes color={OVERLAYS[0].color} />}
          label="Lanes"
          detail="run in the gutters one grid unit apart and never overlap; in a full gutter, links to the same module share one"
        />
        <LegendRow
          mark={<Swatch color="#e4edf6" />}
          label="Hover"
          detail="shows a module's or file's connections; with an overlay on, highlights them. Click keeps them"
        />
      </LegendSection>

      <LegendSection title="Keys">
        {KEYS.map(([key, action]) => (
          <LegendRow key={key} mark={<Kbd className="min-w-9">{key}</Kbd>} label={action} />
        ))}
      </LegendSection>
    </div>
  )
}

// The packages and modules that hold files directly, in tree order: the map
// colours each file by the hue of its parent.
function listColourGroups(scene: Scene): WorldNode[] {
  const groups: WorldNode[] = []
  const visit = (nodes: WorldNode[]) => {
    for (const node of nodes) {
      if (groups.length >= MAX_MODULES) return
      if (node.kind !== 'package' && node.kind !== 'module') continue
      const children = listTreeChildren(scene, node.id)
      if (children.some((child) => child.kind === 'file')) groups.push(node)
      visit(children)
    }
  }
  visit(listTreeRoots(scene))
  return groups
}

interface LegendSectionProps {
  title: string
  note?: string
  children: ReactNode
}

function LegendSection({ title, note, children }: LegendSectionProps) {
  return (
    <section>
      <h3 className="mb-1.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
        {title}
        {note && <span className="font-normal normal-case tracking-normal"> · {note}</span>}
      </h3>
      <ul className="space-y-1">{children}</ul>
    </section>
  )
}

interface LegendRowProps {
  mark: ReactNode
  label: string
  detail?: string
}

function LegendRow({ mark, label, detail }: LegendRowProps) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="flex h-5 w-9 shrink-0 items-center justify-center">{mark}</span>
      <span className="min-w-0 leading-5 [overflow-wrap:anywhere]">
        {label}
        {detail && <span className="block text-muted-foreground text-xs leading-4">{detail}</span>}
      </span>
    </li>
  )
}

function Swatch({ color }: { color: string }) {
  return <span className="size-3 rounded-sm" style={{ background: color }} />
}

// A lane ending in an arrowhead.
function Arrow({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 28 10" className="h-2.5 w-7" aria-hidden="true">
      <path d="M1 5H22" stroke={color} strokeWidth="1.5" />
      <path d="M27 5L21 1.5V8.5Z" fill={color} />
    </svg>
  )
}

// Three lanes one unit apart, turning a corner together.
function Lanes({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 28 16" className="h-4 w-7" aria-hidden="true">
      <path d="M1 3H25V16M1 7H21V16M1 11H17V16" fill="none" stroke={color} strokeWidth="1.25" />
    </svg>
  )
}
