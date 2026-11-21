import type { DockWorker } from '@codecolony/dock/web'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Layout,
  LayoutChangedMeta,
  PanelImperativeHandle,
  PanelSize,
} from 'react-resizable-panels'
import { logError } from '../../../shared/log.ts'
import type { DeepResponse, WorldNode } from '../../../shared/world-types.ts'
import { useDock } from '../../hooks/use-dock.ts'
import { useProjects } from '../../hooks/use-projects.ts'
import { useShellPreferences } from '../../hooks/use-shell-preferences.ts'
import { useWorld } from '../../hooks/use-world.ts'
import { type MapHandle, ZOOM_STEP } from '../../map-controller.ts'
import { buildSearchIndex } from '../../search-index.ts'
import { MAX_PANEL_PX, MIN_PANEL_PX, type ShellPreferences } from '../../shell-preferences.ts'
import { AppHeader } from '../app-header/app-header.tsx'
import { LeftPanel } from '../left-panel/left-panel.tsx'
import { MapBreadcrumb } from '../map-breadcrumb/map-breadcrumb.tsx'
import { MapView } from '../map-view/map-view.tsx'
import { RightPanel } from '../right-panel/right-panel.tsx'
import { SearchPalette } from '../search-palette/search-palette.tsx'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/resizable.tsx'
import { WorkerPawns } from '../worker-pawns/worker-pawns.tsx'
import { ZoomControls } from '../zoom-controls/zoom-controls.tsx'

type PanelSide = 'left' | 'right'

// The page: header, left panel | map | right panel.
export function App() {
  const scene = useWorld()
  const projects = useProjects()
  const [preferences, updatePreferences] = useShellPreferences()
  const [selectedId, setSelectedId] = useState<string>()
  const [, setEdgeVersion] = useState(0)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [dockElement, setDockElement] = useState<HTMLDivElement | null>(null)
  const { dock, workers } = useDock(dockElement)
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

  const selected = selectedId ? scene?.byId.get(selectedId) : undefined
  const searchIndex = useMemo(() => (scene ? buildSearchIndex(scene.world) : undefined), [scene])

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

  // The map selected something: a click, or a pick from a panel or search.
  // A new selection brings up the inspector in place of the terminal; the
  // File tab stays, since it follows the selection too.
  const handleSelect = useCallback(
    (id: string | undefined) => {
      setSelectedId(id)
      if (!id) return
      updatePreferences((current) =>
        current.right.tab === 'terminal'
          ? { ...current, right: { ...current.right, tab: 'inspector' } }
          : current,
      )
    },
    [updatePreferences],
  )

  const pick = useCallback((id: string | undefined) => {
    if (id) mapRef.current?.select(id, true)
    else mapRef.current?.fitAll()
  }, [])

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

  const togglePanel = useCallback(
    (side: PanelSide) => {
      const panel = panelRefs[side].current
      if (!panel) return
      if (panel.isCollapsed()) panel.resize(widthsPx.current[side])
      else panel.collapse()
    },
    [panelRefs],
  )

  const focusWorker = useCallback(
    (worker: DockWorker) => {
      updatePanel('right', { tab: 'terminal' })
      if (panelRefs.right.current?.isCollapsed()) togglePanel('right')
      dock
        ?.focusPane(worker.paneId)
        .catch((error: unknown) => logError('Could not focus pane', { error }))
    },
    [dock, updatePanel, panelRefs, togglePanel],
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

  // Widths are remembered when a drag settles; window resizes keep them as is.
  // A collapsed panel keeps the width it had before.
  const groupRef = useRef<HTMLDivElement | null>(null)
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

  // Page-wide keys: ⌘K search, [ and ] toggle the panels.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsSearchOpen(true)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
      if (event.key === '[') togglePanel('left')
      else if (event.key === ']') togglePanel('right')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePanel])

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
          maxSize={MAX_PANEL_PX}
          defaultSize={preferences.left.widthPx}
          groupResizeBehavior="preserve-pixel-size"
          onResize={handleResize('left')}
        >
          <LeftPanel
            tab={preferences.left.tab}
            scene={scene}
            selected={selected}
            onTabChange={(tab) => updatePanel('left', { tab })}
            onCollapse={() => panelRefs.left.current?.collapse()}
            onPick={pick}
          />
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left panel" />
        <ResizablePanel id="map" minSize="25%">
          <MapView scene={scene} handleRef={mapRef} onSelect={handleSelect}>
            <MapBreadcrumb scene={scene} selected={selected} onPick={pick} />
            <WorkerPawns workers={workers} onFocus={focusWorker} />
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
          maxSize={MAX_PANEL_PX}
          defaultSize={preferences.right.widthPx}
          groupResizeBehavior="preserve-pixel-size"
          onResize={handleResize('right')}
        >
          <RightPanel
            tab={preferences.right.tab}
            scene={scene}
            selected={selected}
            workerCount={workers.length}
            dockRef={setDockElement}
            onTabChange={(tab) => updatePanel('right', { tab })}
            onCollapse={() => panelRefs.right.current?.collapse()}
            onPick={pick}
            onTraceCalls={traceCalls}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <SearchPalette
        isOpen={isSearchOpen}
        index={searchIndex}
        onOpenChange={setIsSearchOpen}
        onPick={pick}
      />
    </div>
  )
}

function buildDefaultLayout(preferences: ShellPreferences, windowPx: number): Layout {
  const percent = (side: PanelSide) =>
    preferences[side].isCollapsed ? 0 : (100 * preferences[side].widthPx) / Math.max(windowPx, 1)
  const left = percent('left')
  const right = percent('right')
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
