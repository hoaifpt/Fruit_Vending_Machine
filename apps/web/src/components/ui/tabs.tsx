import { Tabs as TabsPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

/** Radix tabs (arrow keys move between tabs, Home/End jump). Inactive panels are unmounted, so each loads when opened. */
export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn('mb-5 flex max-w-full gap-1 overflow-x-auto border-b', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger
    data-slot="tabs-trigger"
    className={cn(
      '-mb-px inline-flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors',
      'hover:text-foreground focus-visible:rounded-t-md focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none',
      'data-[state=active]:border-primary data-[state=active]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0',
      className,
    )}
    {...props} />
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('min-w-0 focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none', className)} {...props} />
}
