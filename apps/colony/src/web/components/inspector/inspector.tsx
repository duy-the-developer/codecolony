import { FileCodeIcon } from 'lucide-react'
import { useState } from 'react'
import { isMacPlatform, toggleKeyLabel } from '../../../modules/map/selection.ts'
import { listColonistsOn, type PlacedColonist } from '../../../modules/scene/colonist-places.ts'
import {
  describeEdgeRow,
  type EdgeSection,
  listEdgeSections,
} from '../../../modules/scene/edge-sections.ts'
import type { Scene } from '../../../modules/scene/scene.ts'
import { buildSelectionSummary } from '../../../modules/scene/selection-summary.ts'
import { COLONIST_STATUS_TEXT } from '../../../modules/theme/colonist-glyphs.ts'
import {
  COLONIST_CHIP,
  COLONIST_COLORS,
  CONFLICT_COLOR,
  EDGE_COLORS,
  SELECTION_COLOR,
} from '../../../modules/theme/palette.ts'
import { PROVEN_PROVENANCES } from '../../../modules/world/facts.ts'
import type { Provenance, WorldNode } from '../../../modules/world/world-types.ts'
import { Button } from '../ui/button.tsx'
import { cn } from '../ui/class-names.ts'
import { Kbd } from '../ui/kbd.tsx'

export interface InspectorProps {
  scene: Scene | undefined
  // The selected nodes, in the order they were added.
  selection: readonly WorldNode[]
  // Every colonist on the map, to list those changing the node.
  colonists: readonly PlacedColonist[]
  onPick(id: string): void
  // Picks a colonist and frames its pins.
  onPickColonist(id: string): void
  // Shows the node's file in the File tab.
  onOpen(id: string): void
  // Proves a file's calls with the language server; rejects with the reason.
  onTraceCalls(file: WorldNode): Promise<void>
}

const MAX_ROWS = 14

// The selected node: its facts, and every dependency in or out of it with
// how it was proven. Several selected nodes show combined.
export function Inspector({
  scene,
  selection,
  colonists,
  onPick,
  onPickColonist,
  onOpen,
  onTraceCalls,
}: InspectorProps) {
  const [first] = selection
  if (!scene || !first) {
    return (
      <p className="m-3 rounded-md border border-dashed p-4 text-center text-muted-foreground">
        Click anything on the map to inspect it.
      </p>
    )
  }
  if (selection.length > 1) {
    return <CombinedDetails scene={scene} selection={selection} onPick={onPick} />
  }
  return (
    <NodeDetails
      scene={scene}
      node={first}
      colonists={colonists}
      onPick={onPick}
      onPickColonist={onPickColonist}
      onOpen={onOpen}
      onTraceCalls={onTraceCalls}
    />
  )
}

interface NodeDetailsProps {
  scene: Scene
  node: WorldNode
  colonists: readonly PlacedColonist[]
  onPick(id: string): void
  onPickColonist(id: string): void
  onOpen(id: string): void
  onTraceCalls(file: WorldNode): Promise<void>
}

function NodeDetails({
  scene,
  node,
  colonists,
  onPick,
  onPickColonist,
  onOpen,
  onTraceCalls,
}: NodeDetailsProps) {
  const kind = node.kind === 'symbol' ? (node.symbolKind ?? 'symbol') : node.kind
  const repo = scene.repoOf(node)
  const subtree = scene.listSubtree(node)
  const facts: [string, string | undefined][] = [
    ['Lines', node.range ? `${node.range.start}-${node.range.end}` : node.lines.toLocaleString()],
    ['Branches', node.complexity.toLocaleString()],
    ['Language', node.language],
    ['Exported', node.exported === undefined ? undefined : node.exported ? 'yes' : 'no'],
    ['Package', node.package ? 'yes (manifest)' : undefined],
    ['Commit', (node.commit ?? (node.kind === 'repo' ? undefined : repo?.commit))?.slice(0, 8)],
  ]
  const canTrace =
    node.kind === 'file' && node.language && scene.world.languages[node.language]?.semantic

  return (
    <div className="space-y-4 p-3 text-[13px]">
      <div>
        <p className="font-semibold text-[11px] text-primary uppercase tracking-wider">{kind}</p>
        <h3 className="break-all font-semibold text-base">{node.name}</h3>
        {node.path && (
          <p className="break-all font-mono text-muted-foreground text-xs">{node.path}</p>
        )}
        {(node.kind === 'file' || node.kind === 'symbol') && (
          <Button variant="outline" size="sm" className="mt-2" onClick={() => onOpen(node.id)}>
            <FileCodeIcon />
            Open file
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        {facts.map(([label, value]) =>
          value === undefined || value === '' ? null : (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ),
        )}
      </dl>

      <ColonistList scene={scene} node={node} colonists={colonists} onPick={onPickColonist} />

      {node.transports?.length ? (
        <section>
          <SectionTitle title="Transport" count={node.transports.length} />
          <ul>
            {node.transports.map((t) => (
              <li key={`${t.kind}|${t.method}|${t.target}|${t.line}`} className="flex gap-2 py-0.5">
                <span className="min-w-0 flex-1 break-all">
                  {`${t.kind} ${t.method ?? ''} ${t.target}`.replace(/\s+/g, ' ')}
                </span>
                <span className="text-muted-foreground">line {t.line}</span>
                <ProvenanceTag provenance={t.provenance} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {listEdgeSections(scene, subtree).map((section) => (
        <EdgeList
          key={`${section.kind}|${section.direction}`}
          scene={scene}
          section={section}
          onPick={onPick}
        />
      ))}

      {canTrace && <TraceButton key={node.id} file={node} onTraceCalls={onTraceCalls} />}
    </div>
  )
}

interface CombinedDetailsProps {
  scene: Scene
  selection: readonly WorldNode[]
  onPick(id: string): void
}

// Several selected nodes: what they are, how they connect to each other, and
// every dependency in or out of them together.
function CombinedDetails({ scene, selection, onPick }: CombinedDetailsProps) {
  const summary = buildSelectionSummary(scene, selection)
  const facts: [string, number][] = [
    ['Files', summary.files],
    ['Imports between them', summary.importsBetween],
    ['Imports out', summary.importsOut],
    ['Imported by others', summary.importedBy],
  ]
  return (
    <div className="space-y-4 p-3 text-[13px]">
      <div>
        <p className="font-semibold text-[11px] text-primary uppercase tracking-wider">
          {selection.length} selected
        </p>
        <h3 className="font-semibold text-base">Combined</h3>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
          <Kbd>{toggleKeyLabel(isMacPlatform())}</Kbd> click adds or removes ·<Kbd>Esc</Kbd>
          clears
        </p>
      </div>
      <ul aria-label="Selected">
        {selection.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onPick(node.id)}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
            >
              <span
                className="size-2.5 shrink-0 rounded-full border-2"
                style={{ borderColor: SELECTION_COLOR }}
              />
              <span className="shrink-0 text-muted-foreground">
                {node.kind === 'symbol' ? (node.symbolKind ?? 'symbol') : node.kind}
              </span>
              <span className="min-w-0 flex-1 break-all font-mono text-xs">
                {node.path ?? node.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {summary.sections.map((section) => (
        <EdgeList
          key={`${section.kind}|${section.direction}`}
          scene={scene}
          section={section}
          onPick={onPick}
        />
      ))}
    </div>
  )
}

interface ColonistListProps {
  scene: Scene
  node: WorldNode
  colonists: readonly PlacedColonist[]
  onPick(id: string): void
}

// The colonists changing the node. A file two or more of them change, in
// different copies, is a possible conflict.
function ColonistList({ scene, node, colonists, onPick }: ColonistListProps) {
  const touching = listColonistsOn(scene, colonists, node)
  if (touching.length === 0) return null
  const isConflict =
    touching.length > 1 &&
    (node.kind === 'file' ||
      touching.some(({ placed, paths }) =>
        placed.changes.some((change) => change.sharedWith && paths.includes(change.path)),
      ))
  return (
    <section>
      <SectionTitle title="Colonists changing it" count={touching.length} />
      {isConflict && (
        <p
          className="mb-1 border-l-2 pl-2 text-xs"
          style={{ borderColor: CONFLICT_COLOR, color: CONFLICT_COLOR }}
        >
          Possible conflict: {node.kind === 'file' ? 'this file is' : 'files in here are'} changed
          in more than one copy.
        </p>
      )}
      <ul aria-label="Colonists changing it">
        {touching.map(({ placed, paths }) => {
          const { colonist } = placed
          const color = COLONIST_COLORS[colonist.status]
          const shared = placed.changes.filter(
            (change) => change.sharedWith && paths.includes(change.path),
          ).length
          return (
            <li key={colonist.id}>
              <button
                type="button"
                onClick={() => onPick(colonist.id)}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
              >
                <span
                  className="shrink-0 rounded-full px-1.5 font-bold text-[10px] leading-4"
                  style={{ background: color, color: COLONIST_CHIP }}
                >
                  {placed.initials}
                </span>
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{colonist.label}</span>
                <span className="shrink-0 text-[11px]" style={{ color }}>
                  {COLONIST_STATUS_TEXT[colonist.status]}
                </span>
                {node.kind !== 'file' && (
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {paths.length} {paths.length === 1 ? 'file' : 'files'}
                    {shared > 0 && (
                      <span style={{ color: CONFLICT_COLOR }}> · {shared} shared</span>
                    )}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface EdgeListProps {
  scene: Scene
  section: EdgeSection
  onPick(id: string): void
}

function EdgeList({ scene, section, onPick }: EdgeListProps) {
  const shown = section.rows.slice(0, MAX_ROWS)
  return (
    <section>
      <SectionTitle title={section.title} count={section.total} />
      <ul>
        {shown.map((row) => {
          const where =
            row.count > 1 ? `×${row.count}` : row.edge.at ? `line ${row.edge.at.line}` : ''
          const { other, otherId } = row
          return (
            <li key={`${row.edge.from}|${row.edge.to}|${row.edge.label}|${row.edge.provenance}`}>
              <button
                type="button"
                disabled={!other && !scene.fileIdOf(otherId)}
                onClick={() => onPick(otherId)}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: EDGE_COLORS[section.kind] }}
                />
                <span className="min-w-0 flex-1 break-all">
                  {describeEdgeRow(scene, row, section.direction)}
                </span>
                {where && <span className="shrink-0 text-muted-foreground">{where}</span>}
                <ProvenanceTag provenance={row.edge.provenance} />
              </button>
            </li>
          )
        })}
        {section.rows.length > MAX_ROWS && (
          <li className="px-1 text-muted-foreground">+ {section.rows.length - MAX_ROWS} more</li>
        )}
      </ul>
    </section>
  )
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <h4 className="mb-1 flex justify-between font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
      {title}
      <span className="font-normal">{count}</span>
    </h4>
  )
}

function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  const isProven = PROVEN_PROVENANCES.has(provenance)
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 font-medium text-[11px] text-[#0d1b2a]',
        isProven ? 'bg-[#7fd49b]' : 'bg-[#f0c060]',
      )}
    >
      {provenance}
    </span>
  )
}

interface TraceButtonProps {
  file: WorldNode
  onTraceCalls(file: WorldNode): Promise<void>
}

function TraceButton({ file, onTraceCalls }: TraceButtonProps) {
  const [status, setStatus] = useState<string>()
  const [isBusy, setIsBusy] = useState(false)
  const handleClick = () => {
    setIsBusy(true)
    setStatus('Asking the language server...')
    onTraceCalls(file)
      .then(() => setStatus(undefined))
      .catch((error: unknown) => setStatus(`Failed: ${(error as Error).message}`))
      .finally(() => setIsBusy(false))
  }
  return (
    <div>
      <Button variant="secondary" size="sm" disabled={isBusy} onClick={handleClick}>
        Trace calls with the language server
      </Button>
      {status && <p className="mt-1 text-muted-foreground text-xs">{status}</p>}
    </div>
  )
}
