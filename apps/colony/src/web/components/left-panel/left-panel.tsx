import { ChevronsLeftIcon } from 'lucide-react'
import type { WorldNode } from '../../../shared/world-types.ts'
import type { Scene } from '../../scene.ts'
import { LEFT_TABS, type LeftTab } from '../../shell-preferences.ts'
import { BuildQueue } from '../build-queue/build-queue.tsx'
import { FileTree } from '../file-tree/file-tree.tsx'
import { Legend } from '../legend/legend.tsx'
import { PanelHeader } from '../panel-header/panel-header.tsx'
import { Button } from '../ui/button.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.tsx'

export interface LeftPanelProps {
  tab: LeftTab
  scene: Scene | undefined
  selected: WorldNode | undefined
  onTabChange(tab: LeftTab): void
  onCollapse(): void
  onPick(id: string): void
}

export function LeftPanel({
  tab,
  scene,
  selected,
  onTabChange,
  onCollapse,
  onPick,
}: LeftPanelProps) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(LEFT_TABS.find((t) => t === value) ?? tab)}
      className="h-full bg-card"
    >
      <PanelHeader>
        <TabsList>
          <TabsTrigger value="queue">
            Build queue <span className="text-muted-foreground text-xs">0</span>
          </TabsTrigger>
          <TabsTrigger value="legend">Legend</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-muted-foreground"
          aria-label="Hide left panel"
          title="Hide left panel ( [ )"
          onClick={onCollapse}
        >
          <ChevronsLeftIcon />
        </Button>
      </PanelHeader>
      <TabsContent value="queue" className="overflow-y-auto">
        <BuildQueue />
      </TabsContent>
      <TabsContent value="legend" className="overflow-y-auto">
        <Legend scene={scene} />
      </TabsContent>
      <TabsContent value="files" className="overflow-y-auto">
        <FileTree scene={scene} selected={selected} onPick={onPick} />
      </TabsContent>
    </Tabs>
  )
}
