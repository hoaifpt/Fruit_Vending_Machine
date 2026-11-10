import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

const control = 'min-h-9 w-full max-w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1.5 text-sm transition-[border-color,box-shadow] duration-150 ease-out outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50'
const editable = 'read-only:bg-muted read-only:text-muted-foreground'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(control, editable, className)} {...props} />
}

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select data-slot="select" className={cn(control, className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(control, editable, 'min-h-25 resize-y', className)} {...props} />
}
