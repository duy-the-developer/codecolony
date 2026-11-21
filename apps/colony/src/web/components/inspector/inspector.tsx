import { FileCodeIcon } from 'lucide-react'
import { useState } from 'react'
import type { Provenance, WorldNode } from '../../../shared/world-types.ts'
import { cn } from '../../class-names.ts'
import { describeEdgeRow, type EdgeSection, listEdgeSections } from '../../edge-sections.ts'
import { EDGE_COLORS } from '../../render.ts'
import { PROVEN_PROVENANCES } from '../../road-cache.ts'
import type { Scene } from '../../scene.ts'
import { Button } from '../ui/button.tsx'

export interface InspectorProps {
  scene: Scene | undefined
  selected: WorldNode | undefined
  onPick(id: string): void
  // Shows the node's file in the File tab.
  onOpen(id: string): void
  // Proves a file's calls with the language server; rejects with the reason.
  onTraceCalls(file: WorldNode): Promise<void>
}

const MAX_ROWS = 14

// The selected node: its facts, and every dependency in or out of it with
// how it was proven.
export function Inspector({ scene, selected, onPick, onOpen, onTraceCalls }: InspectorProps) {
  if (!scene || !selected) {
    return (
      <p className="m-3 rounded-md border border-dashed p-4 text-center text-muted-foreground">
        Click anything on the map to inspect it.
      </p>
    )
  }
  const node = selected
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
