import { ChevronRightIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorldNode } from '../../../shared/world-types.ts'
import { cn } from '../../class-names.ts'
import { hueOf } from '../../render.ts'
import type { Scene } from '../../scene.ts'
import { listTreeChildren, listTreeRoots } from '../../tree-entries.ts'

export interface FileTreeProps {
  scene: Scene | undefined
  selected: WorldNode | undefined
  // A file was clicked: fly the map to it and select it.
  onPick(id: string): void
}

// The Files tab: folders and files with their line totals.
export function FileTree({ scene, selected, onPick }: FileTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const roots = useMemo(() => (scene ? listTreeRoots(scene) : []), [scene])

  // Reveal the selection: open the folders above it.
  useEffect(() => {
    if (!scene || !selected) return
    const above = scene.listAncestry(selected).slice(0, -1)
    setExpanded((current) => {
      if (above.every((node) => current.has(node.id))) return current
      return new Set([...current, ...above.map((node) => node.id)])
    })
  }, [scene, selected])

  if (!scene) return <p className="p-3 text-muted-foreground">Indexing...</p>
  const files = scene.world.nodes.filter((node) => node.kind === 'file')
  const lines = files.reduce((sum, file) => sum + file.lines, 0)
  const selectedFile = selected?.kind === 'symbol' ? scene.parentOf(selected) : selected
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <div className="py-2">
      <p className="px-3 pb-2 text-muted-foreground text-xs">
        {files.length.toLocaleString()} files · {lines.toLocaleString()} lines · click a file to fly
        to it
      </p>
      <ul aria-label="Files">
        {roots.map((node) => (
          <TreeEntry
            key={node.id}
            node={node}
            depth={0}
            scene={scene}
            expanded={expanded}
            selectedId={selectedFile?.id}
            onToggle={toggle}
            onPick={onPick}
          />
        ))}
      </ul>
    </div>
  )
}

interface TreeEntryProps {
  node: WorldNode
  depth: number
  scene: Scene
  expanded: ReadonlySet<string>
  selectedId: string | undefined
  onToggle(id: string): void
  onPick(id: string): void
}

function TreeEntry({ node, depth, scene, expanded, selectedId, onToggle, onPick }: TreeEntryProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const isFile = node.kind === 'file'
  const isOpen = !isFile && expanded.has(node.id)
  const isSelected = node.id === selectedId
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [isSelected])

  return (
    <li>
      <button
        ref={ref}
        type="button"
        aria-expanded={isFile ? undefined : isOpen}
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => (isFile ? onPick(node.id) : onToggle(node.id))}
        onDoubleClick={() => !isFile && onPick(node.id)}
        className={cn(
          'flex h-6 w-full cursor-pointer items-center gap-1.5 pr-3 text-left text-[13px] hover:bg-accent/60',
          isSelected && 'bg-accent text-accent-foreground',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {isFile ? (
          <span
            className="mx-[3px] size-2 shrink-0 rounded-[2px]"
            style={{ background: `hsl(${hueOf(node)}, 42%, 45%)` }}
          />
        ) : (
          <ChevronRightIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              isOpen && 'rotate-90',
            )}
          />
        )}
        <span className={cn('flex-1 truncate', !isFile && 'text-muted-foreground')}>
          {node.name}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {node.lines.toLocaleString()}
        </span>
      </button>
      {isOpen && (
        <ul>
          {listTreeChildren(scene, node.id).map((child) => (
            <TreeEntry
              key={child.id}
              node={child}
              depth={depth + 1}
              scene={scene}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
