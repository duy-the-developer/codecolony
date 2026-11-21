import { PlusIcon } from 'lucide-react'
import { Button } from '../ui/button.tsx'

// Build orders for the workers. Placing orders is not wired up yet, so the
// queue is empty and "+ Order" says so.
export function BuildQueue() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="text-muted-foreground text-xs">All projects · 0 orders</span>
        <span title="Placing build orders is not available yet">
          <Button size="sm" disabled>
            <PlusIcon />
            Order
          </Button>
        </span>
      </div>
      <div className="mx-3 rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm">
        No orders yet. Orders appear here with their project, worker and state.
      </div>
    </div>
  )
}
