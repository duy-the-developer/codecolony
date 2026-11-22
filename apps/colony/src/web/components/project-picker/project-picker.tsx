import { ChevronDownIcon } from 'lucide-react'
import type { Scene } from '../../../modules/scene/scene.ts'
import type { ProjectSummary } from '../../../modules/wire/api-types.ts'
import { Button } from '../ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx'

export interface ProjectPickerProps {
  projects: ProjectSummary[]
  scene: Scene | undefined
  // Flies the map to a node: a project, or the whole map when undefined.
  onPick(id: string | undefined): void
}

// The mapped projects; picking one flies the map to it.
export function ProjectPicker({ projects, scene, onPick }: ProjectPickerProps) {
  const first = projects[0]
  const commit = first && scene ? projectCommit(scene, first.name) : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 max-w-72 gap-2 px-2.5 font-normal">
          <span className="truncate font-medium">
            {first ? first.name : 'No projects'}
            {projects.length > 1 ? ` +${projects.length - 1}` : ''}
          </span>
          {commit && <span className="font-mono text-muted-foreground text-xs">{commit}</span>}
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Projects on the map</DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem key={project.name} onSelect={() => onPick(`project:${project.name}`)}>
            <span className="flex-1 truncate">{project.name}</span>
            <span className="text-muted-foreground text-xs">{project.kind}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onPick(undefined)}>
          <span className="flex-1">Show the whole map</span>
          <span className="text-muted-foreground text-xs">Home</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The indexed commit of a single-repository project, shortened.
function projectCommit(scene: Scene, name: string): string | undefined {
  const repos = scene.children.get(`project:${name}`)?.filter((node) => node.kind === 'repo')
  return repos?.length === 1 ? repos[0]?.commit?.slice(0, 7) : undefined
}
