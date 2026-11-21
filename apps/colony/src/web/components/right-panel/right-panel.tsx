import { ChevronsRightIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { WorldNode } from '../../../shared/world-types.ts'
import type { Scene } from '../../scene.ts'
import { RIGHT_TABS, type RightTab } from '../../shell-preferences.ts'
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
  selected: WorldNode | undefined
  workerCount: number
  // Receives the element the terminal dock mounts into.
  dockRef(element: HTMLDivElement | null): void
  onTabChange(tab: RightTab): void
  onCollapse(): void
  onPick(id: string): void
  onOpen(id: string): void
  onTraceCalls(file: WorldNode): Promise<void>
}

export function RightPanel({
  tab,
  scene,
  selected,
  workerCount,
  dockRef,
  onTabChange,
  onCollapse,
  onPick,
  onOpen,
  onTraceCalls,
}: RightPanelProps) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(RIGHT_TABS.find((t) => t === value) ?? tab)}
      className="h-full bg-card"
    >
      <PanelHeader>
        <TabsList>
          <TabsTrigger value="terminal">
            Terminal <span className="text-muted-foreground text-xs">{workerCount}</span>
          </TabsTrigger>
          <TabsTrigger value="file">File</TabsTrigger>
          <TabsTrigger value="inspector">Inspector</TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-muted-foreground"
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
        <Inspector
          scene={scene}
          selected={selected}
          onPick={onPick}
          onOpen={onOpen}
          onTraceCalls={onTraceCalls}
        />
      </TabsContent>
    </Tabs>
  )
}
