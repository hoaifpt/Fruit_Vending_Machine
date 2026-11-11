import { Popover as PopoverPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverClose = PopoverPrimitive.Close

/** Non-modal panel anchored to its trigger: Esc or a click outside closes it and focus returns to the trigger. */
export function PopoverContent({ className, align = 'end', sideOffset = 6, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content align={align} sideOffset={sideOffset} collisionPadding={8}
      className={cn('ui-root z-50 w-80 max-w-[calc(100vw-16px)] rounded-lg border bg-popover p-0 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 motion-reduce:animate-none!', className)} {...props} />
  </PopoverPrimitive.Portal>
}
