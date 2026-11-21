import { type DockWorker, workerTitle } from '@codecolony/dock/web'
import { cn } from '../../class-names.ts'
import { WORKER_STATUS_DOTS } from '../../worker-status-dots.ts'

export interface WorkerPawnsProps {
  workers: DockWorker[]
  onFocus(worker: DockWorker): void
}

// Worker pawns on the map. Until the renderer places them where they work,
// they stand in a row at the top right. Clicking one shows its terminal.
export function WorkerPawns({ workers, onFocus }: WorkerPawnsProps) {
  if (workers.length === 0) return null
  return (
    <ul
      aria-label="Workers on the map"
      className="pointer-events-auto ml-auto flex max-w-1/2 shrink-0 flex-wrap justify-end gap-1.5"
    >
      {workers.map((worker) => (
        <li key={worker.paneId}>
          <button
            type="button"
            title={workerTitle(worker)}
            aria-pressed={worker.focused}
            onClick={() => onFocus(worker)}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full border bg-card/90 px-2.5 text-xs hover:border-primary aria-pressed:border-primary"
          >
            <span className={cn('size-2 rounded-full', WORKER_STATUS_DOTS[worker.status])} />
            {worker.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
