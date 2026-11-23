import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Layout,
  LayoutChangedMeta,
  PanelImperativeHandle,
  PanelSize,
} from 'react-resizable-panels'
import { logError } from '../../../modules/logging/log.ts'
import { type MapHandle, ZOOM_STEP } from '../../../modules/map/map-controller.ts'
import {
  type DrawnLines,
  type OverlayId,
  resolveOverlayKey,
} from '../../../modules/map/overlays.ts'
import {
  fitPanelWidths,
  MIN_MAP_PERCENT,
  MIN_PANEL_PX,
  maxPanelWidthPx,
  type QueueSection,
  type ShellPreferences,
} from '../../../modules/preferences/shell-preferences.ts'
import { findChangeTarget } from '../../../modules/scene/change-target.ts'
import { placeColonists } from '../../../modules/scene/colonist-places.ts'
import type { BuildOrder } from '../../../modules/wire/api-types.ts'
import type { DeepResponse, WorldNode } from '../../../modules/world/world-types.ts'
import { fetchOrderChanges } from '../../client/build-queue-client.ts'
import { fetchSearchMatches } from '../../client/world-client.ts'
import { useBuildQueue } from '../../hooks/use-build-queue.ts'
import { useColonists } from '../../hooks/use-colonists.ts'
import { useDock } from '../../hooks/use-dock.ts'
import { useProjects } from '../../hooks/use-projects.ts'
import { useSceneRevision } from '../../hooks/use-scene-revision.ts'
import { useShellPreferences } from '../../hooks/use-shell-preferences.ts'
import { useWorld } from '../../hooks/use-world.ts'
import { AppHeader } from '../app-header/app-header.tsx'
import { ColonistRoster } from '../colonist-roster/colonist-roster.tsx'
import { LeftPanel } from '../left-panel/left-panel.tsx'
import { MapBreadcrumb } from '../map-breadcrumb/map-breadcrumb.tsx'
import { MapLegend } from '../map-legend/map-legend.tsx'
import { MapView } from '../map-view/map-view.tsx'
import { RightPanel } from '../right-panel/right-panel.tsx'
import { SearchPalette } from '../search-palette/search-palette.tsx'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/resizable.tsx'
import { ZoomControls } from '../zoom-controls/zoom-controls.tsx'

type PanelSide = 'left' | 'right'

const NO_LINES: DrawnLines = { overlays: [], isDirected: false, isSelected: false }
const NO_OVERLAYS: ReadonlySet<OverlayId> = new Set()

// The page: header, left panel | map | right panel.
export function App() {
  const scene = useWorld()
  // Symbols arrive after the scene; the panels re-render with them.
  useSceneRevision(scene)
  const projects = useProjects()
  const queue = useBuildQueue()
  const [preferences, updatePreferences] = useShellPreferences()
  // In the order they were added; the last is the one the panels follow.
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [, setEdgeVersion] = useState(0)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  // Overlays start off: the map shows only blocks until one is switched on.
  const [overlays, setOverlays] = useState<ReadonlySet<OverlayId>>(() => new Set())
  const toggleOverlay = useCallback((id: OverlayId) => {
    setOverlays((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])
  // The kinds of line the map draws, for its legend.
  const [lines, setLines] = useState<DrawnLines>(NO_LINES)
  const toggleLegend = useCallback(
    () => updatePreferences((current) => ({ ...current, isLegendOpen: !current.isLegendOpen })),
    [updatePreferences],
  )
  const [dockElement, setDockElement] = useState<HTMLDivElement | null>(null)
  const { dock, workers } = useDock(dockElement)
  const { colonists, notice: colonistsNotice } = useColonists()
  // Active only keeps the colonists at work; the rest leave the roster and
  // the map, robots, outlines and pins alike.
  const shownColonists = useMemo(
    () =>
      preferences.isActiveOnly
        ? colonists.filter((colonist) => colonist.status === 'working')
        : colonists,
    [colonists, preferences.isActiveOnly],
  )
  const placed = useMemo(
    () => (scene ? placeColonists(scene, shownColonists) : []),
    [scene, shownColonists],
  )
  const toggleActiveOnly = useCallback(
    () => updatePreferences((current) => ({ ...current, isActiveOnly: !current.isActiveOnly })),
    [updatePreferences],
  )
  const [selectedColonistId, setSelectedColonistId] = useState<string>()
  const mapRef = useRef<MapHandle | null>(null)
  const leftPanelRef = useRef<PanelImperativeHandle | null>(null)
  const rightPanelRef = useRef<PanelImperativeHandle | null>(null)
  const panelRefs = useMemo(() => ({ left: leftPanelRef, right: rightPanelRef }), [])
  const [collapsed, setCollapsed] = useState({
    left: preferences.left.isCollapsed,
    right: preferences.right.isCollapsed,
  })

  // The group spans the window, so the remembered pixel widths become its
  // first layout in percentages. Its own first layout is computed before it
  // has measured itself, so pixel sizes alone would land off.
  const [defaultLayout] = useState(() => buildDefaultLayout(preferences, window.innerWidth))
  // The last width of each panel while open: what expanding returns to.
  const widthsPx = useRef({ left: preferences.left.widthPx, right: preferences.right.widthPx })

  const selection = useMemo(
    () => selectedIds.flatMap((id) => scene?.byId.get(id) ?? []),
    [selectedIds, scene],
  )
  const selected = selection.at(-1)
  const selectedColonist = placed.find((p) => p.colonist.id === selectedColonistId)

  const updatePanel = useCallback(
    <S extends PanelSide>(side: S, change: Partial<ShellPreferences[S]>) =>
      updatePreferences((current) => {
        const panel: ShellPreferences[S] = { ...current[side], ...change }
        const keys = Object.keys(change) as (keyof ShellPreferences[S])[]
        if (keys.every((key) => current[side][key] === panel[key])) return current
        return { ...current, [side]: panel }
      }),
    [updatePreferences],
  )

  const pick = useCallback((id: string | undefined) => {
    if (id) mapRef.current?.select(id, true)
    else mapRef.current?.fitAll()
  }, [])

  // Shows the selection's file in the File tab, opening the right panel.
  const showFile = useCallback(() => {
    updatePanel('right', { tab: 'file' })
    const panel = panelRefs.right.current
    if (panel?.isCollapsed()) panel.resize(widthsPx.current.right)
  }, [updatePanel, panelRefs])

  // Opens the right panel on a tab.
  const showRightTab = useCallback(
    (tab: ShellPreferences['right']['tab']) => {
      updatePanel('right', { tab })
      const panel = panelRefs.right.current
      if (panel?.isCollapsed()) panel.resize(widthsPx.current.right)
    },
    [updatePanel, panelRefs],
  )

  // A colonist picked on the map shows its card in the Inspector.
  const handleSelectColonist = useCallback(
    (id: string | undefined) => {
      setSelectedColonistId(id)
      if (id) showRightTab('inspector')
    },
    [showRightTab],
  )

  // Picks a colonist from a panel and frames everything it touches.
  const pickColonist = useCallback((id: string) => {
    mapRef.current?.selectColonist(id, true)
  }, [])

  const openTerminal = useCallback(
    (paneId: string) => {
      showRightTab('terminal')
      dock?.focusPane(paneId).catch((error: unknown) => {
        logError('Could not focus the pane', { paneId, error })
      })
    },
    [dock, showRightTab],
  )

  const openFile = useCallback(
    (id: string) => {
      pick(id)
      showFile()
    },
    [pick, showFile],
  )

  const traceCalls = useCallback(
    async (file: WorldNode) => {
      const response = await fetch(`/api/deep?file=${encodeURIComponent(file.id)}`)
      const body = (await response.json()) as DeepResponse | { error: string }
      if ('error' in body) throw new Error(body.error)
      scene?.mergeEdges(body.edges)
      mapRef.current?.redraw()
      setEdgeVersion((version) => version + 1)
    },
    [scene],
  )

  const toggleQueueSection = useCallback(
    (section: QueueSection) =>
      updatePreferences((current) => ({
        ...current,
        openQueueSections: {
          ...current.openQueueSections,
          [section]: !current.openQueueSections[section],
        },
      })),
    [updatePreferences],
  )

  // Picks the order's colonist when it is on the map, else flies to the files
  // its worker changed.
  const showOrderOnMap = useCallback(
    async (order: BuildOrder) => {
      const colonist = placed.find(
        (p) => order.colonist !== undefined && p.colonist.task === order.colonist && p.bounds,
      )
      if (colonist) {
        pickColonist(colonist.colonist.id)
        return true
      }
      const changes = await fetchOrderChanges(order.id)
      const target = changes && scene ? findChangeTarget(scene, changes) : undefined
      if (target) pick(target.id)
      return target !== undefined
    },
    [placed, pickColonist, scene, pick],
  )

  const togglePanel = useCallback(
    (side: PanelSide) => {
      const panel = panelRefs[side].current
      if (!panel) return
      if (panel.isCollapsed()) panel.resize(widthsPx.current[side])
      else panel.collapse()
    },
    [panelRefs],
  )

  // Collapsing and expanding, by key, button or drag, is remembered at once.
  const handleResize = (side: PanelSide) => (size: PanelSize) => {
    const isCollapsed = size.inPixels < 1
    if (!isCollapsed) widthsPx.current[side] = Math.round(size.inPixels)
    setCollapsed((current) =>
      current[side] === isCollapsed ? current : { ...current, [side]: isCollapsed },
    )
    updatePanel(side, { isCollapsed })
  }

  // The group's width, which sets how wide each panel can be dragged.
  const groupRef = useRef<HTMLDivElement | null>(null)
  const [groupPx, setGroupPx] = useState(() => window.innerWidth)
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const observer = new ResizeObserver(() => setGroupPx(group.clientWidth))
    observer.observe(group)
    return () => observer.disconnect()
  }, [])

  // Widths are remembered when a drag settles; window resizes keep them as is.
  // A collapsed panel keeps the width it had before.
  const handleLayoutChanged = (layout: Layout, meta: LayoutChangedMeta) => {
    const groupPx = groupRef.current?.clientWidth
    if (!meta.isUserInteraction || !groupPx) return
    for (const side of ['left', 'right'] as const) {
      const widthPx = Math.round(((layout[side] ?? 0) * groupPx) / 100)
      if (widthPx < 1) continue
      widthsPx.current[side] = widthPx
      updatePanel(side, { widthPx })
    }
  }

  // Page-wide keys: ⌘K search, [ and ] toggle the panels, L the legend, 1-3
  // the overlays and 0 switches them all off (#47). Ctrl+K opens the
  // search too, except in a text field or the terminal, where it edits text.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isTyping = isTypingTarget(event.target)
      if ((event.metaKey || (event.ctrlKey && !isTyping)) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsSearchOpen(true)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping) return
      if (event.key === '[') togglePanel('left')
      else if (event.key === ']') togglePanel('right')
      else if (event.key.toLowerCase() === 'l') toggleLegend()
      else if (resolveOverlayKey(NO_OVERLAYS, event.key)) {
        const { key } = event
        setOverlays((current) => resolveOverlayKey(current, key) ?? current)
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePanel, toggleLegend])

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        projects={projects}
        scene={scene}
        onPickProject={pick}
        onOpenSearch={() => setIsSearchOpen(true)}
        isLeftCollapsed={collapsed.left}
        isRightCollapsed={collapsed.right}
        onToggleLeft={() => togglePanel('left')}
        onToggleRight={() => togglePanel('right')}
        overlays={overlays}
        onToggleOverlay={toggleOverlay}
      />
      <ResizablePanelGroup
        className="min-h-0 flex-1"
        defaultLayout={defaultLayout}
        elementRef={groupRef}
        onLayoutChanged={handleLayoutChanged}
      >
        <ResizablePanel
          id="left"
          panelRef={panelRefs.left}
          collapsible
          collapsedSize={0}
          minSize={MIN_PANEL_PX}
          maxSize={maxPanelWidthPx(groupPx, !collapsed.right)}
          defaultSize={preferences.left.widthPx}
          groupResizeBehavior="preserve-pixel-size"
          onResize={handleResize('left')}
          inert={collapsed.left}
        >
          <PanelContent isCollapsed={collapsed.left}>
            <LeftPanel
              tab={preferences.left.tab}
              scene={scene}
              selected={selected}
              queue={queue}
              queueScope={projects.length === 1 ? (projects[0]?.name ?? '') : 'All projects'}
              openQueueSections={preferences.openQueueSections}
              onToggleQueueSection={toggleQueueSection}
              onShowOrderOnMap={showOrderOnMap}
              onTabChange={(tab) => updatePanel('left', { tab })}
              onCollapse={() => panelRefs.left.current?.collapse()}
              onPick={pick}
              onOpen={openFile}
            />
          </PanelContent>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left panel" />
        <ResizablePanel id="map" minSize={`${MIN_MAP_PERCENT}%`}>
          <MapView
            scene={scene}
            handleRef={mapRef}
            overlays={overlays}
            colonists={placed}
            onSelect={setSelectedIds}
            onSelectColonist={handleSelectColonist}
            onOpen={showFile}
            onLines={setLines}
          >
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2">
              <div className="flex min-w-0 flex-col items-start gap-2">
                <MapBreadcrumb scene={scene} selected={selected} onPick={pick} />
                <MapLegend
                  lines={lines}
                  overlays={overlays}
                  hasColonists={placed.length > 0}
                  isColonistPicked={selectedColonist !== undefined}
                  hasConflicts={placed.some((p) => p.changes.some((c) => c.sharedWith))}
                  isOpen={preferences.isLegendOpen}
                  onToggle={toggleLegend}
                />
              </div>
              <div className="ml-auto flex min-w-0 justify-end">
                <ColonistRoster
                  colonists={shownColonists}
                  hiddenCount={colonists.length - shownColonists.length}
                  notice={colonistsNotice}
                  selectedId={selectedColonistId}
                  isActiveOnly={preferences.isActiveOnly}
                  onPick={pickColonist}
                  onToggleActiveOnly={toggleActiveOnly}
                />
              </div>
            </div>
            <ZoomControls
              onZoomIn={() => mapRef.current?.zoomBy(ZOOM_STEP)}
              onZoomOut={() => mapRef.current?.zoomBy(1 / ZOOM_STEP)}
              onFitAll={() => mapRef.current?.fitAll()}
            />
          </MapView>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize right panel" />
        <ResizablePanel
          id="right"
          panelRef={panelRefs.right}
          collapsible
          collapsedSize={0}
          minSize={MIN_PANEL_PX}
          maxSize={maxPanelWidthPx(groupPx, !collapsed.left)}
          defaultSize={preferences.right.widthPx}
          groupResizeBehavior="preserve-pixel-size"
          onResize={handleResize('right')}
          inert={collapsed.right}
        >
          <PanelContent isCollapsed={collapsed.right}>
            <RightPanel
              tab={preferences.right.tab}
              scene={scene}
              selected={selected}
              selection={selection}
              colonist={selectedColonist}
              colonists={placed}
              canOpenTerminal={workers.some(
                (worker) => worker.paneId === selectedColonist?.colonist.paneId,
              )}
              workerCount={workers.length}
              dockRef={setDockElement}
              onTabChange={(tab) => updatePanel('right', { tab })}
              onCollapse={() => panelRefs.right.current?.collapse()}
              onPick={pick}
              onOpen={openFile}
              onTraceCalls={traceCalls}
              onCloseColonist={() => mapRef.current?.selectColonist(undefined)}
              onPickColonist={pickColonist}
              onOpenTerminal={openTerminal}
            />
          </PanelContent>
        </ResizablePanel>
      </ResizablePanelGroup>
      <SearchPalette
        isOpen={isSearchOpen}
        fetchMatches={fetchSearchMatches}
        onOpenChange={setIsSearchOpen}
        onPick={pick}
        onOpen={openFile}
      />
    </div>
  )
}

// A collapsed panel stays mounted but out of reach: the panel itself is inert,
// so nothing inside it, neither the terminal's input nor the library's scroll
// wrapper, can take focus and swallow the page's keys.
function PanelContent({ isCollapsed, children }: { isCollapsed: boolean; children: ReactNode }) {
  return <div className={isCollapsed ? 'invisible h-full' : 'h-full'}>{children}</div>
}

function buildDefaultLayout(preferences: ShellPreferences, windowPx: number): Layout {
  const openPx = (side: PanelSide) =>
    preferences[side].isCollapsed ? 0 : preferences[side].widthPx
  const widthsPx = fitPanelWidths({ left: openPx('left'), right: openPx('right') }, windowPx)
  const left = (100 * widthsPx.left) / Math.max(windowPx, 1)
  const right = (100 * widthsPx.right) / Math.max(windowPx, 1)
  return { left, map: 100 - left - right, right }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  )
}
