import type { ReactNode } from 'react'
import type { EdgeKind, SymbolKind } from '../../../shared/world-types.ts'
import { cn } from '../../class-names.ts'
import { EDGE_COLORS, hueOf, SYMBOL_COLORS } from '../../render.ts'
import type { Scene } from '../../scene.ts'
import { listTreeRoots } from '../../tree-entries.ts'
import { WORKER_STATUS_DOTS } from '../../worker-status-dots.ts'
import { Kbd } from '../ui/kbd.tsx'

export interface LegendProps {
  scene: Scene | undefined
}

const EDGE_NAMES: Record<EdgeKind, string> = {
  import: 'Imports',
  call: 'Calls',
  http: 'HTTP requests',
  queue: 'Messages',
  data: 'Data access',
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
  const folders = scene
    ? listTreeRoots(scene).filter((node) => node.kind === 'package' || node.kind === 'module')
    : []
  return (
    <div className="space-y-5 px-3 py-3">
      <LegendSection title="Folders" note="each package and module has its own colour">
        {folders.slice(0, 10).map((folder) => (
          <LegendRow
            key={folder.id}
            mark={<Swatch color={`hsl(${hueOf(folder)}, 42%, 40%)`} />}
            label={folder.name}
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

      <LegendSection title="Dependencies" note="arrow points at the dependency">
        {Object.entries(EDGE_NAMES).map(([kind, name]) => (
          <LegendRow
            key={kind}
            mark={<Line color={EDGE_COLORS[kind as EdgeKind]} />}
            label={name}
          />
        ))}
        <LegendRow
          mark={<Line color="#9fb3c8" />}
          label="Solid"
          detail="proven by a language server or the syntax tree"
        />
        <LegendRow
          mark={<Line color="#9fb3c8" isDashed />}
          label="Dashed"
          detail="matched on text"
        />
      </LegendSection>

      <LegendSection title="Workers" note="labelled by workspace name">
        {(['working', 'idle', 'blocked', 'done'] as const).map((status) => (
          <LegendRow
            key={status}
            mark={<span className={cn('size-2.5 rounded-full', WORKER_STATUS_DOTS[status])} />}
            label={status[0]?.toUpperCase() + status.slice(1)}
          />
        ))}
      </LegendSection>

      <LegendSection title="Keys">
        {KEYS.map(([key, action]) => (
          <LegendRow key={key} mark={<Kbd className="min-w-9">{key}</Kbd>} label={action} />
        ))}
      </LegendSection>
    </div>
  )
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
      <span className="leading-5">
        {label}
        {detail && <span className="block text-muted-foreground text-xs leading-4">{detail}</span>}
      </span>
    </li>
  )
}

function Swatch({ color }: { color: string }) {
  return <span className="size-3 rounded-sm" style={{ background: color }} />
}

function Line({ color, isDashed = false }: { color: string; isDashed?: boolean }) {
  return (
    <span
      className="w-7 border-t-2"
      style={{ borderColor: color, borderTopStyle: isDashed ? 'dashed' : 'solid' }}
    />
  )
}
