import { SearchIcon } from 'lucide-react'
import type { ProjectSummary } from '../../../shared/api-types.ts'
import type { Scene } from '../../scene.ts'
import { MapControls, type MapControlsProps } from '../map-controls/map-controls.tsx'
import { ProjectPicker } from '../project-picker/project-picker.tsx'
import { Kbd } from '../ui/kbd.tsx'

export interface AppHeaderProps extends MapControlsProps {
  projects: ProjectSummary[]
  scene: Scene | undefined
  onPickProject(id: string | undefined): void
  onOpenSearch(): void
}

export function AppHeader({
  projects,
  scene,
  onPickProject,
  onOpenSearch,
  ...controls
}: AppHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card px-3">
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex items-center gap-2 font-semibold">
          <ColonyMark />
          <span className="whitespace-nowrap">Code Colony</span>
        </div>
        <ProjectPicker projects={projects} scene={scene} onPick={onPickProject} />
      </div>
      <button
        type="button"
        onClick={onOpenSearch}
        className="mx-auto flex h-8 min-w-0 max-w-[460px] flex-1 cursor-text items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-muted-foreground text-sm transition-colors hover:border-ring/60"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="flex-1 truncate">Search files and symbols</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="flex shrink-0 justify-end">
        <MapControls {...controls} />
      </div>
    </header>
  )
}

function ColonyMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-5" aria-hidden="true">
      <rect width="16" height="16" rx="3" fill="#0d1b2a" />
      <rect x="3" y="3" width="4" height="10" fill="#50a0e0" />
      <rect x="9" y="6" width="4" height="7" fill="#f7a21b" />
    </svg>
  )
}
