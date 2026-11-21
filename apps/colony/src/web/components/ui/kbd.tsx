import type { ComponentProps } from 'react'
import { cn } from '../../class-names.ts'

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center rounded border bg-muted px-1 font-mono font-medium text-[11px] text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
