import { Dialog as SheetPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close

const SIDES = {
  right: 'inset-y-0 right-0 h-full w-full border-l sm:max-w-md data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  left: 'inset-y-0 left-0 h-full w-72 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
}

export function SheetContent({ className, children, side = 'right', ...props }: ComponentProps<typeof SheetPrimitive.Content> & { side?: keyof typeof SIDES }) {
  return <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
    <SheetPrimitive.Content className={cn('ui-root fixed z-50 flex flex-col gap-4 bg-background shadow-lg ease-out data-[state=open]:animate-in data-[state=open]:duration-250 data-[state=closed]:animate-out data-[state=closed]:duration-200', SIDES[side], className)} {...props}>
      {children}
      <SheetPrimitive.Close className="absolute top-3.5 right-3.5 rounded-sm p-1 text-muted-foreground opacity-80 transition-opacity hover:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/40">
        <XIcon className="size-4" /><span className="sr-only">Đóng</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn('font-semibold text-foreground', className)} {...props} />
}
export function SheetDescription({ className, ...props }: ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
}
