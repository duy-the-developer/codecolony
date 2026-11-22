import {
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GitPullRequestArrowIcon,
  MapPinIcon,
  PlusIcon,
} from 'lucide-react'
import { useState } from 'react'
import {
  QUEUE_SECTIONS,
  type QueueSection,
} from '../../../modules/preferences/shell-preferences.ts'
import type { BuildOrder, BuildQueueResponse, OrderState } from '../../../modules/wire/api-types.ts'
import { Button } from '../ui/button.tsx'
import { cn } from '../ui/class-names.ts'

export interface BuildQueueProps {
  queue: BuildQueueResponse | undefined
  // The project on the map, or "All projects".
  scope: string
  openSections: Record<QueueSection, boolean>
  onToggleSection(section: QueueSection): void
  // Resolves false when there is nothing to show on the map yet.
  onShowOnMap(order: BuildOrder): Promise<boolean>
}

const SECTION_TITLES: Record<QueueSection, string> = {
  active: 'Active',
  queued: 'Queued',
  done: 'Done',
}

// Open sections share the height in this ratio and scroll on their own.
const SECTION_GROW: Record<QueueSection, string> = {
  active: 'flex-[3]',
  queued: 'flex-[2]',
  done: 'flex-[2]',
}

const EMPTY_SECTION: Record<QueueSection, string> = {
  active: 'Nothing in flight.',
  queued: 'Nothing queued.',
  done: 'Nothing done yet.',
}

const STATE_STYLES: Record<OrderState, { label: string; chip: string; bar: string }> = {
  waiting: {
    label: 'waiting on you',
    chip: 'bg-status-waiting/15 text-status-waiting',
    bar: 'border-l-status-waiting',
  },
  blocked: {
    label: 'blocked',
    chip: 'bg-status-blocked/15 text-status-blocked',
    bar: 'border-l-status-blocked',
  },
  'pr-ready': {
    label: 'PR ready',
    chip: 'bg-status-pr-ready/15 text-status-pr-ready',
    bar: 'border-l-status-pr-ready',
  },
  working: {
    label: 'working',
    chip: 'bg-status-working/15 text-status-working',
    bar: 'border-l-status-working',
  },
  queued: {
    label: 'queued',
    chip: 'bg-muted text-muted-foreground',
    bar: 'border-l-border',
  },
  done: {
    label: 'done',
    chip: 'bg-muted text-muted-foreground',
    bar: 'border-l-border',
  },
}

// Build orders from the configured firstmate home, read only, in VS Code
// Source Control-style sections. Placing orders is not wired up yet.
export function BuildQueue({
  queue,
  scope,
  openSections,
  onToggleSection,
  onShowOnMap,
}: BuildQueueProps) {
  const orders = queue?.isConnected ? queue.orders : []
  const openCount = orders.filter((order) => order.section !== 'done').length
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
        <span className="truncate text-muted-foreground text-xs">
          {scope} · {openCount} open {openCount === 1 ? 'order' : 'orders'}
        </span>
        <span title="Placing build orders is not available yet">
          <Button size="sm" disabled>
            <PlusIcon />
            Order
          </Button>
        </span>
      </div>
      {queue && !queue.isConnected ? (
        <p className="px-3 py-2.5 text-muted-foreground text-xs">
          Not connected to firstmate. Set <code className="font-mono">firstmateHome</code> in the
          config to show its orders here.
        </p>
      ) : (
        <>
          {QUEUE_SECTIONS.map((section) => (
            <QueueSectionView
              key={section}
              section={section}
              orders={orders.filter((order) => order.section === section)}
              isOpen={openSections[section]}
              onToggle={() => onToggleSection(section)}
              onShowOnMap={onShowOnMap}
            />
          ))}
          <p className="mt-auto shrink-0 border-t px-3 py-2 text-muted-foreground text-xs">
            From the firstmate backlog, read only.
          </p>
        </>
      )}
    </div>
  )
}

interface QueueSectionViewProps {
  section: QueueSection
  orders: BuildOrder[]
  isOpen: boolean
  onToggle(): void
  onShowOnMap(order: BuildOrder): Promise<boolean>
}

function QueueSectionView({
  section,
  orders,
  isOpen,
  onToggle,
  onShowOnMap,
}: QueueSectionViewProps) {
  const Chevron = isOpen ? ChevronDownIcon : ChevronRightIcon
  const listId = `build-queue-${section}`
  return (
    <section
      className={cn('flex min-h-0 flex-col border-b', isOpen ? SECTION_GROW[section] : 'shrink-0')}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={listId}
        onClick={onToggle}
        className="flex h-[26px] shrink-0 cursor-pointer items-center gap-1 px-1.5 font-semibold text-[11px] uppercase tracking-wide hover:bg-accent/50"
      >
        <Chevron className="size-4 text-muted-foreground" />
        <span className="flex-1 text-left">{SECTION_TITLES[section]}</span>
        <span className="rounded-full bg-secondary px-1.5 font-normal text-[11px] text-muted-foreground tabular-nums">
          {orders.length}
        </span>
      </button>
      {isOpen && (
        <ol id={listId} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pt-0.5 pb-2">
          {orders.length === 0 ? (
            <li className="px-1 py-1 text-muted-foreground text-xs">{EMPTY_SECTION[section]}</li>
          ) : (
            orders.map((order, index) => (
              <OrderCard
                key={order.id}
                order={order}
                number={index + 1}
                onShowOnMap={onShowOnMap}
              />
            ))
          )}
        </ol>
      )}
    </section>
  )
}

interface OrderCardProps {
  order: BuildOrder
  number: number
  onShowOnMap(order: BuildOrder): Promise<boolean>
}

function OrderCard({ order, number, onShowOnMap }: OrderCardProps) {
  const [hasNoChanges, setHasNoChanges] = useState(false)
  const style = STATE_STYLES[order.state]
  const isDone = order.section === 'done'
  const handleShowOnMap = () => {
    onShowOnMap(order).then(
      (isShown) => setHasNoChanges(!isShown),
      () => setHasNoChanges(true),
    )
  }
  return (
    <li
      className={cn(
        'rounded-md border border-l-2 bg-background/40 px-2.5 py-2',
        style.bar,
        isDone && 'opacity-60',
      )}
    >
      <p className="text-[13px] leading-snug">
        {!isDone && <span className="mr-1.5 text-muted-foreground tabular-nums">{number}</span>}
        {order.title}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn('rounded px-1.5 py-px', style.chip)}>{style.label}</span>
        {order.kind && (
          <span className="rounded bg-secondary px-1.5 py-px text-muted-foreground">
            {order.kind}
          </span>
        )}
        {isDone && order.date && (
          <span className="ml-auto text-muted-foreground tabular-nums">{order.date}</span>
        )}
      </div>
      {order.colonist && (
        <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <BotIcon className="size-3.5 shrink-0 text-status-working" aria-hidden="true" />
          <span className="truncate">{order.colonist}</span>
        </p>
      )}
      {order.note && (
        <p className="mt-1 line-clamp-3 text-muted-foreground text-xs leading-snug">{order.note}</p>
      )}
      {hasNoChanges && (
        <p className="mt-1 text-muted-foreground text-xs">No file changes on the map yet.</p>
      )}
      {(order.pullRequestUrl || order.hasWorktree) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {order.pullRequestUrl && (
            <Button variant={isDone ? 'ghost' : 'outline'} size="sm" asChild>
              <a href={order.pullRequestUrl} target="_blank" rel="noreferrer">
                <GitPullRequestArrowIcon />
                {isDone ? pullRequestLabel(order.pullRequestUrl) : 'Review PR'}
              </a>
            </Button>
          )}
          {order.hasWorktree && (
            <Button variant="outline" size="sm" onClick={handleShowOnMap}>
              <MapPinIcon />
              Show on map
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

// "PR #63" from its link.
function pullRequestLabel(url: string): string {
  const number = /\/(\d+)$/.exec(url)?.[1]
  return number ? `PR #${number}` : 'PR'
}
