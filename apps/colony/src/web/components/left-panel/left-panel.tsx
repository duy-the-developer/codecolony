import { ChevronsLeftIcon } from 'lucide-react'
import {
  LEFT_TABS,
  type LeftTab,
  type QueueSection,
} from '../../../modules/preferences/shell-preferences.ts'
import type { Scene } from '../../../modules/scene/scene.ts'
import type { BuildOrder, BuildQueueResponse } from '../../../modules/wire/api-types.ts'
import type { WorldNode } from '../../../modules/world/world-types.ts'
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
  queue: BuildQueueResponse | undefined
  queueScope: string
  openQueueSections: Record<QueueSection, boolean>
  onToggleQueueSection(section: QueueSection): void
  onShowOrderOnMap(order: BuildOrder): Promise<boolean>
  onTabChange(tab: LeftTab): void
  onCollapse(): void
  onPick(id: string): void
  onOpen(id: string): void
}

export function LeftPanel({
  tab,
  scene,
  selected,
  queue,
  queueScope,
  openQueueSections,
  onToggleQueueSection,
  onShowOrderOnMap,
  onTabChange,
  onCollapse,
  onPick,
  onOpen,
}: LeftPanelProps) {
  const openOrders = queue?.isConnected
    ? queue.orders.filter((order) => order.section !== 'done').length
    : 0
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(LEFT_TABS.find((t) => t === value) ?? tab)}
      className="h-full bg-card"
    >
      <PanelHeader>
        <TabsList className="min-w-0 overflow-x-auto [scrollbar-width:none]">
          <TabsTrigger value="queue">
            Build queue <span className="text-muted-foreground text-xs">{openOrders}</span>
          </TabsTrigger>
          <TabsTrigger value="legend">Legend</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0 text-muted-foreground"
          aria-label="Hide left panel"
          title="Hide left panel ( [ )"
          onClick={onCollapse}
        >
          <ChevronsLeftIcon />
        </Button>
      </PanelHeader>
      <TabsContent value="queue">
        <BuildQueue
          queue={queue}
          scope={queueScope}
          openSections={openQueueSections}
          onToggleSection={onToggleQueueSection}
          onShowOnMap={onShowOrderOnMap}
        />
      </TabsContent>
      <TabsContent value="legend" className="overflow-y-auto">
        <Legend scene={scene} />
      </TabsContent>
      <TabsContent value="files" className="overflow-y-auto">
        <FileTree scene={scene} selected={selected} onPick={onPick} onOpen={onOpen} />
      </TabsContent>
    </Tabs>
  )
}
