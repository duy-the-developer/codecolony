import { ChevronsRightIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { RIGHT_TABS, type RightTab } from '../../../modules/preferences/shell-preferences.ts'
import type { PlacedColonist } from '../../../modules/scene/colonist-places.ts'
import type { Scene } from '../../../modules/scene/scene.ts'
import type { WorldNode } from '../../../modules/world/world-types.ts'
import { ColonistCard } from '../colonist-card/colonist-card.tsx'
import { Inspector } from '../inspector/inspector.tsx'
import { PanelHeader } from '../panel-header/panel-header.tsx'
import { Button } from '../ui/button.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.tsx'

// CodeMirror and its languages load only once the File tab first shows.
const FileTab = lazy(() =>
  import('../file-tab/file-tab.tsx').then(({ FileTab }) => ({ default: FileTab })),
)

export interface RightPanelProps {
  tab: RightTab
  scene: Scene | undefined
  // The node the File tab follows: the last one selected.
  selected: WorldNode | undefined
  // Everything selected, for the Inspector.
  selection: readonly WorldNode[]
  // The picked colonist: the Inspector shows its card instead of the selection.
  colonist: PlacedColonist | undefined
  canOpenTerminal: boolean
  workerCount: number
  // Receives the element the terminal dock mounts into.
  dockRef(element: HTMLDivElement | null): void
  onTabChange(tab: RightTab): void
  onCollapse(): void
  onPick(id: string): void
  onOpen(id: string): void
  onTraceCalls(file: WorldNode): Promise<void>
  onCloseColonist(): void
  onOpenTerminal(paneId: string): void
}

export function RightPanel({
  tab,
  scene,
  selected,
  selection,
  colonist,
  canOpenTerminal,
  workerCount,
  dockRef,
  onTabChange,
  onCollapse,
  onPick,
  onOpen,
  onTraceCalls,
  onCloseColonist,
  onOpenTerminal,
}: RightPanelProps) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(RIGHT_TABS.find((t) => t === value) ?? tab)}
      className="h-full bg-card"
    >
      <PanelHeader>
        <TabsList className="min-w-0 overflow-x-auto [scrollbar-width:none]">
          <TabsTrigger value="terminal">
            Terminal <span className="text-muted-foreground text-xs">{workerCount}</span>
          </TabsTrigger>
          <TabsTrigger value="file">File</TabsTrigger>
          <TabsTrigger value="inspector">Inspector</TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0 text-muted-foreground"
          aria-label="Hide right panel"
          title="Hide right panel ( ] )"
          onClick={onCollapse}
        >
          <ChevronsRightIcon />
        </Button>
      </PanelHeader>
      {/* Kept mounted so the terminal keeps its session while another tab shows. */}
      <TabsContent value="terminal" forceMount>
        <div ref={dockRef} className="h-full" />
      </TabsContent>
      <TabsContent value="file" className="overflow-hidden">
        <Suspense fallback={<p className="p-3 text-muted-foreground text-sm">Loading...</p>}>
          <FileTab scene={scene} selected={selected} onPick={onPick} />
        </Suspense>
      </TabsContent>
      <TabsContent value="inspector" className="overflow-y-auto">
        {colonist ? (
          <ColonistCard
            placed={colonist}
            canOpenTerminal={canOpenTerminal}
            onClose={onCloseColonist}
            onOpenTerminal={onOpenTerminal}
            onPick={onPick}
          />
        ) : (
          <Inspector
            scene={scene}
            selection={selection}
            onPick={onPick}
            onOpen={onOpen}
            onTraceCalls={onTraceCalls}
          />
        )}
      </TabsContent>
    </Tabs>
  )
}
