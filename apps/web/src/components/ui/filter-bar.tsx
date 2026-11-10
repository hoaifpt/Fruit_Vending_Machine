import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { Button } from './button.tsx'

interface FilterBarProps {
  children: ReactNode
  /** Number of filters in effect; with `onClear`, above zero shows the clear button. */
  activeCount?: number
  onClear?: () => void
  className?: string
}

/** Filter row above a list: filters wrap on wide screens and stack on phones. Filter values live in the URL. */
export function FilterBar({ children, activeCount = 0, onClear, className }: FilterBarProps) {
  return <div
    data-slot="filter-bar"
    role="group"
    aria-label="Bộ lọc"
    className={cn(
      'mb-4 flex flex-wrap items-end gap-3',
      '[&>[data-slot=form-field]]:mb-0! [&>[data-slot=form-field]]:min-w-[170px]',
      '[&>[data-slot=form-field]:has(input[type=search])]:max-w-[380px] [&>[data-slot=form-field]:has(input[type=search])]:flex-1',
      'max-[680px]:[&>*]:max-w-none! max-[680px]:[&>*]:flex-[1_1_100%]!',
      className,
    )}
  >
    {children}
    {onClear && activeCount > 0 && <Button type="button" variant="ghost" onClick={onClear}><X aria-hidden="true" />Xóa bộ lọc ({activeCount})</Button>}
  </div>
}
