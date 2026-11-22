import { ChevronRightIcon } from 'lucide-react'
import { Fragment } from 'react'
import type { Scene } from '../../../modules/scene/scene.ts'
import type { WorldNode } from '../../../modules/world/world-types.ts'

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
  const leaf = shown.at(-1)
  if (!leaf) return null
  const ancestors = shown.slice(0, -1)
  return (
    <nav
      aria-label="Selection path"
      className="pointer-events-auto flex min-w-0 items-center gap-0.5 overflow-hidden rounded-md border bg-card/90 px-1.5 py-1 text-xs"
    >
      {/* The ancestors and every chevron before the selected name shrink and
          clip as one group, so the selected name keeps its width and truncates
          only when it alone is wider than the bar. */}
      <span className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden">
        {ancestors.map((node, i) => (
          <Fragment key={node.id}>
            {i === 1 && hidden.length > 0 && (
              <>
                <span
                  className="shrink-0 px-1 text-muted-foreground"
                  title={hidden.map((n) => n.name).join(' › ')}
                >
                  …
                </span>
                <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
              </>
            )}
            <button
              type="button"
              onClick={() => onPick(node.id)}
              className="min-w-0 truncate rounded px-1 py-0.5 text-muted-foreground hover:bg-accent"
            >
              {node.name}
            </button>
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
          </Fragment>
        ))}
      </span>
      <button
        type="button"
        onClick={() => onPick(leaf.id)}
        className="max-w-full shrink-0 truncate rounded px-1 py-0.5 font-medium text-foreground hover:bg-accent"
      >
        {leaf.name}
      </button>
    </nav>
  )
}
