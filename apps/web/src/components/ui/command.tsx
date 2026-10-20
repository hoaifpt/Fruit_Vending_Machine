import { Command as CommandPrimitive } from 'cmdk'
import { SearchIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive className={cn('flex h-full w-full flex-col overflow-hidden bg-popover text-popover-foreground', className)} {...props} />
}
export function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return <div className="flex h-12 items-center gap-2 border-b px-3">
    <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
    <CommandPrimitive.Input className={cn('flex h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground', className)} {...props} />
  </div>
}
export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn('max-h-[min(360px,60vh)] scroll-py-1 overflow-x-hidden overflow-y-auto p-1', className)} {...props} />
}
export function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-8 text-center text-sm text-muted-foreground" {...props} />
}
export function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group className={cn('overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground', className)} {...props} />
}
export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return <CommandPrimitive.Item className={cn('relative flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground', className)} {...props} />
}
