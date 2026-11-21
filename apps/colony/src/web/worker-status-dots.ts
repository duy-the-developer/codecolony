import type { WorkerStatus } from '@codecolony/dock/web'

// Tailwind classes for a worker's status dot.
export const WORKER_STATUS_DOTS: Record<WorkerStatus, string> = {
  working: 'bg-status-working',
  idle: 'bg-status-idle',
  blocked: 'bg-status-blocked',
  done: 'bg-status-done',
  unknown: 'bg-muted-foreground/50',
}
