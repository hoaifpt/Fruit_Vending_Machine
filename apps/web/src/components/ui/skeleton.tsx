import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

/** Placeholder block with a soft shimmer; shape it like the content that is loading. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn('animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--ui-muted)_0%,var(--ui-accent)_50%,var(--ui-muted)_100%)] bg-[length:200%_100%]', className)} {...props} />
}
