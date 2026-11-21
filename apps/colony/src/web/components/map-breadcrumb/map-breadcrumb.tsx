import { ChevronRightIcon } from 'lucide-react'
import { Fragment } from 'react'
import type { WorldNode } from '../../../shared/world-types.ts'
import type { Scene } from '../../scene.ts'

export interface MapBreadcrumbProps {
  scene: Scene | undefined
  selected: WorldNode | undefined
  onPick(id: string): void
}

// Where the selection sits: project › folders › file › symbol.
export function MapBreadcrumb({ scene, selected, onPick }: MapBreadcrumbProps) {
  if (!scene || !selected) return null
  const chain = scene.listAncestry(selected).filter((node) => node.kind !== 'repo')
  return (
    <nav
      aria-label="Selection path"
      className="pointer-events-auto flex min-w-0 items-center gap-0.5 overflow-hidden rounded-md border bg-card/90 px-1.5 py-1 text-xs"
    >
      {chain.map((node, i) => (
        <Fragment key={node.id}>
          {i > 0 && <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />}
          <button
            type="button"
            onClick={() => onPick(node.id)}
            className={`truncate rounded px-1 py-0.5 hover:bg-accent ${
              // Ancestors give up their width; the selected name only truncates
              // when it alone is wider than the whole path.
              node === selected ? 'max-w-full shrink-0 font-medium text-foreground' : 'shrink text-muted-foreground'
            }`}
          >
            {node.name}
          </button>
        </Fragment>
      ))}
    </nav>
  )
}
