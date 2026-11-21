import type { DockHandle, Worker } from '@codecolony/dock/web'

// Worker pawns on the map. Until the renderer places them where they work, they
// stand in a row at the top of the map. Clicking a pawn focuses its Herdr pane
// in the dock.
export function mountWorkers(map: HTMLElement, dock: DockHandle): void {
  const layer = document.createElement('ul')
  layer.className = 'pawns'
  layer.setAttribute('aria-label', 'Workers on the map')
  map.append(layer)

  dock.onWorkers((workers: Worker[]) => {
    layer.replaceChildren(
      ...workers.map((worker) => {
        const item = document.createElement('li')
        const pawn = document.createElement('button')
        pawn.type = 'button'
        pawn.className = `pawn status-${worker.status}`
        pawn.setAttribute('aria-pressed', String(worker.focused))
        pawn.title = `Focus ${worker.name ?? worker.agent ?? worker.paneId} (${worker.status})`
        pawn.textContent = worker.name ?? worker.agent ?? worker.paneId
        pawn.addEventListener('click', () => {
          dock
            .focusPane(worker.paneId)
            .catch((error: unknown) => console.error('Could not focus pane', error))
        })
        item.append(pawn)
        return item
      }),
    )
  })
}
