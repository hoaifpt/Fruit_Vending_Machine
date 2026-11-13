import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { nextSort, sortSelectValue } from '../../lib/table-query.ts'
import type { SortDirection, SortState } from '../../lib/table-query.ts'
import { FormField } from './form-field.tsx'
import { NativeSelect } from './input.tsx'

export interface DataTableColumn<T> {
  head: string
  cell: (row: T) => ReactNode
  /** API sort field. Leave it out for columns the contract cannot sort. */
  sortKey?: string
  /** Direction used when this column is first pressed (default ascending). */
  firstDirection?: SortDirection
  /** Codes and amounts that must not break mid-value (order code, machine code): kept on one line in table layout. */
  nowrap?: boolean
  /**
   * Detail that can wait for the record page: hidden while the table is narrow (681–1023px), so many-column tables stay
   * readable at tablet width. Still shown in the card layout and on wide screens. Never use it for a sortable column.
   */
  secondary?: boolean
}

const SECONDARY = '@min-[681px]:@max-[1023px]:hidden'
/** Tablet-width tables: slightly tighter cell padding so a row stays on one line. */
const TIGHT = '@min-[681px]:@max-[1023px]:px-2'

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  /** Shown above the rows when a refresh fails but earlier rows are still visible. */
  error?: ReactNode
  empty?: ReactNode
  sort?: SortState
  onSort?: (sort: SortState) => void
  /** Name of the table for screen readers. */
  caption?: string
  className?: string
}

const ariaSort = { asc: 'ascending', desc: 'descending' } as const
const directionLabel = { asc: 'tăng dần', desc: 'giảm dần' } as const

/**
 * Server-driven table: it only renders the rows it is given. It follows the width of its own container, so at 680px
 * and below rows become cards and the header sort moves to a select. ARIA roles keep table semantics when CSS changes `display`.
 */
export function DataTable<T>({ columns, rows, rowKey, loading = false, error, empty = 'Không có kết quả phù hợp.', sort, onSort, caption, className }: DataTableProps<T>) {
  const sortable = onSort ? columns.filter(column => column.sortKey) : []
  // A sort no column shows (the endpoint default, e.g. createdAt,desc) reads "Mặc định" so every column option can be picked.
  const selectValue = sortSelectValue(sort, sortable.map(column => column.sortKey as string))
  return <div data-slot="data-table" className={cn('@container w-full', className)}>
    {onSort && sortable.length > 0 && <FormField label="Sắp xếp" className="mb-3 @min-[681px]:hidden">
      <NativeSelect value={selectValue} onChange={event => { if (!event.target.value) return; const [field, direction] = event.target.value.split(','); onSort({ field, direction: direction as SortDirection }) }}>
        {!selectValue && <option value="">Mặc định</option>}
        {sortable.flatMap(column => (['asc', 'desc'] as const).map(direction => <option key={`${column.sortKey},${direction}`} value={`${column.sortKey},${direction}`}>{column.head}: {directionLabel[direction]}</option>))}
      </NativeSelect>
    </FormField>}
    <div aria-busy={loading} className="relative w-full overflow-x-auto rounded-xl border bg-card @max-[680px]:overflow-visible @max-[680px]:rounded-none @max-[680px]:border-0 @max-[680px]:bg-transparent">
      {/* Reloading over rows already shown: a thin bar on top; the rows keep full contrast (no dimming). */}
      {loading && rows.length > 0 && <div data-slot="data-table-progress" aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-1 h-0.5 overflow-hidden">
        <div className="h-full w-2/5 animate-progress rounded-full bg-primary motion-reduce:w-full motion-reduce:animate-none" />
      </div>}
      {error}
      {/* No rows: no table at all. An empty rowgroup (and, on phones, a hidden header) leaves the table without rows,
          which assistive tech reports as a broken table (axe aria-required-children); the empty message stands in. */}
      {rows.length > 0 && <table role="table" className="w-full border-collapse text-left text-sm @max-[680px]:block">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead role="rowgroup" className="@max-[680px]:hidden">
          <tr role="row">{columns.map(column => {
            const active = column.sortKey !== undefined && sort?.field === column.sortKey
            const canSort = !!onSort && !!column.sortKey
            return <th key={column.head} role="columnheader" scope="col" aria-sort={!canSort ? undefined : active && sort ? ariaSort[sort.direction] : 'none'}
              className={cn('border-b bg-muted px-3 py-2.5 align-bottom text-xs font-medium text-muted-foreground', TIGHT, column.secondary && SECONDARY)}>
              {canSort && column.sortKey
                ? <SortButton head={column.head} direction={active ? sort?.direction : undefined} next={nextSort(sort, column.sortKey, column.firstDirection)} onSort={onSort} />
                : column.head}
            </th>
          })}</tr>
        </thead>
        <tbody role="rowgroup" className="@max-[680px]:block">
          {rows.map(row => <tr key={rowKey(row)} role="row" className="transition-colors duration-150 ease-out hover:bg-muted/60 [&:last-child>td]:border-b-0 @max-[680px]:mb-2.5 @max-[680px]:block @max-[680px]:rounded-xl @max-[680px]:border @max-[680px]:bg-card @max-[680px]:px-3.5 @max-[680px]:py-2 @max-[680px]:hover:bg-card">
            {columns.map(column => <td key={column.head} role="cell" data-label={column.head}
              className={cn(column.nowrap && '@min-[681px]:whitespace-nowrap', column.secondary && SECONDARY, TIGHT, 'border-b px-3 py-3 align-middle wrap-break-word @max-[680px]:wrap-anywhere [&_a]:font-medium [&_a]:text-primary [&_a]:no-underline [&_a:hover]:underline @max-[680px]:flex @max-[680px]:justify-between @max-[680px]:gap-3 @max-[680px]:border-0 @max-[680px]:px-0 @max-[680px]:py-1.5 @max-[680px]:text-right @max-[680px]:before:shrink-0 @max-[680px]:before:text-left @max-[680px]:before:text-xs @max-[680px]:before:text-muted-foreground @max-[680px]:before:content-[attr(data-label)]')}>
              {column.cell(row)}
            </td>)}
          </tr>)}
        </tbody>
      </table>}
      {!rows.length && !loading && <p className="px-4 py-10 text-center text-muted-foreground">{empty}</p>}
    </div>
  </div>
}

function SortButton({ head, direction, next, onSort }: { head: string; direction: SortDirection | undefined; next: SortState; onSort: (sort: SortState) => void }) {
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ChevronsUpDown
  return <button type="button" data-slot="sort-button" onClick={() => onSort(next)}
    className={cn('-mx-1 inline-flex items-center gap-1 rounded-sm text-left px-1 py-0.5 font-medium transition-colors duration-150 ease-out hover:text-foreground', direction && 'text-foreground')}>
    {head}
    <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', !direction && 'opacity-60')} />
    <span className="sr-only">. Sắp xếp {directionLabel[next.direction]}</span>
  </button>
}
