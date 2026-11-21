import { ChevronRightIcon } from 'lucide-react'
import { Fragment } from 'react'
import type { WorldNode } from '../../../shared/world-types.ts'
import type { Scene } from '../../scene.ts'

export interface MapBreadcrumbProps {
  scene: Scene | undefined
  selected: WorldNode | undefined
  onPick(id: string): void
}

// Where the selection sits: project › … › parent › selected. The middle
// ancestors fold into one "…" so the selected name keeps its width.
export function MapBreadcrumb({ scene, selected, onPick }: MapBreadcrumbProps) {
  if (!scene || !selected) return null
  const chain = scene.listAncestry(selected).filter((node) => node.kind !== 'repo')
  const hidden = chain.length > 4 ? chain.slice(1, -2) : []
  const shown = hidden.length > 0 ? [...chain.slice(0, 1), ...chain.slice(-2)] : chain
  return (
    <nav
      aria-label="Selection path"
      className="pointer-events-auto flex min-w-0 items-center gap-0.5 overflow-hidden rounded-md border bg-card/90 px-1.5 py-1 text-xs"
    >
      {shown.map((node, i) => (
        <Fragment key={node.id}>
          {i > 0 && <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />}
          {i === 1 && hidden.length > 0 && (
            <>
              <span className="shrink-0 px-1 text-muted-foreground" title={hidden.map((n) => n.name).join(' › ')}>
                …
              </span>
              <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
            </>
          )}
          <button
            type="button"
            onClick={() => onPick(node.id)}
            className={`min-w-0 truncate rounded px-1 py-0.5 hover:bg-accent ${
              // Ancestors give up their width first; the selected name only
              // truncates once they are down to nothing.
              node === selected ? 'shrink font-medium text-foreground' : 'shrink-[1000] text-muted-foreground'
            }`}
          >
            {node.name}
          </button>
        </Fragment>
      ))}
    </nav>
  )
}
