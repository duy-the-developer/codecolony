import { CrosshairIcon, FileCodeIcon } from 'lucide-react'
import type { WorldNode } from '../../../shared/world-types.ts'
import type { Scene } from '../../scene.ts'
import { Button } from '../ui/button.tsx'

export interface FileTabProps {
  scene: Scene | undefined
  selected: WorldNode | undefined
  onReveal(id: string): void
}

// The File tab: the selected file's name and path. The read-only code view
// comes later.
export function FileTab({ scene, selected, onReveal }: FileTabProps) {
  const file = selected?.kind === 'symbol' ? scene?.parentOf(selected) : selected
  if (file?.kind !== 'file') {
    return <EmptyState>Select a file on the map, in Files or with ⌘K to see it here.</EmptyState>
  }
  const folder = (file.path ?? '').slice(0, -file.name.length)
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate font-mono text-xs">
          <span className="text-muted-foreground">{folder}</span>
          <span className="font-semibold">{file.name}</span>
        </p>
        <Button variant="outline" size="sm" onClick={() => onReveal(file.id)}>
          <CrosshairIcon />
          Reveal on map
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {[file.language, `${file.lines.toLocaleString()} lines`].filter(Boolean).join(' · ')}
      </p>
      <EmptyState>The read-only file viewer is coming in a later release.</EmptyState>
    </div>
  )
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm">
      {children}
    </div>
  )
}
