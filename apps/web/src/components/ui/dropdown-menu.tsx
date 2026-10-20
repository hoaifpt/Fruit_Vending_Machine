import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

export const DropdownMenu = MenuPrimitive.Root
export const DropdownMenuTrigger = MenuPrimitive.Trigger
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return <MenuPrimitive.Portal>
    <MenuPrimitive.Content sideOffset={sideOffset} className={cn('ui-root z-50 min-w-48 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2', className)} {...props} />
  </MenuPrimitive.Portal>
}

const ITEM = 'relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

export function DropdownMenuItem({ className, variant, ...props }: ComponentProps<typeof MenuPrimitive.Item> & { variant?: 'destructive' }) {
  return <MenuPrimitive.Item className={cn(ITEM, variant === 'destructive' && 'text-destructive data-[highlighted]:text-destructive [&_svg]:text-destructive', className)} {...props} />
}
export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return <MenuPrimitive.RadioItem className={cn(ITEM, 'pr-8', className)} {...props}>
    {children}
    <span className="absolute right-2 flex size-3.5 items-center justify-center"><MenuPrimitive.ItemIndicator><span className="block size-1.5 rounded-full bg-primary" /></MenuPrimitive.ItemIndicator></span>
  </MenuPrimitive.RadioItem>
}
export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />
}
export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}
