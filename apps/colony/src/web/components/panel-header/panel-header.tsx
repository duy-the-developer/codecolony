import type { ReactNode } from 'react'

export interface PanelHeaderProps {
  children: ReactNode
}

// The tab row at the top of a side panel.
export function PanelHeader({ children }: PanelHeaderProps) {
  return <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2">{children}</div>
}
