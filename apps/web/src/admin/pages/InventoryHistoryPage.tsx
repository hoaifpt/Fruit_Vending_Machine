// I4 Lịch sử kho: append-only history, one row per event of one box (load, hold for an order, sale, return, removal,
// dispense failure…). Read only. Filters (machine, slot of that machine, type, box, reference = load operation or
// order) and the page live in the URL: a reload or a shared link shows the same rows, and every filter change is a
// browser history entry so Back/Forward step through them. Ids that are not UUIDs never reach the API: from the URL
// they are ignored with a note, typed ones get a field error. Rules: ../inventory-history.ts.
// Names shown for ids (machine, slot, product through the batch, person) come from the first 100 records of each list.
import { useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import { batchesApi, inventoryApi, machinesApi, slotsApi, usersApi } from '../../api/resources.ts'
import type { InventoryTransaction } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, NativeSelect } from '../../components/ui/input.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { navigate, useQueryParams } from '../../lib/router.ts'
import { statusMeta } from '../../lib/status.ts'
import {
  FILTER_LABELS, NO_FILTERS, REFERENCE_LABELS, TRANSACTION_TYPES, activeHistoryFilterCount, cleanHistoryHref, describeHistoryError, eventText,
  historyHref, historyKey, historyQuery, loadSlotCodes, parseIdInput, performerText, readHistoryFilters, reasonText, referenceFilterable, referenceKind, shortId,
} from '../inventory-history.ts'
import type { HistoryFilters, HistoryPatch } from '../inventory-history.ts'
import { Badge, DataTable, Forbidden, PAGE_SIZE, PageHead, Pagination } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'
import { InventoryTabs } from './InventoryPage.tsx'

const NO_NAMES: Record<string, string> = {}
const REFERENCE_HEAD = FILTER_LABELS.referenceId
/** In-table links: at least 24px tall, 44px on the phone cards. */
const TARGET = 'inline-flex min-h-6 items-center @max-[680px]:min-h-11'

/** Follows an in-app link with a plain left click (others keep the browser behaviour: new tab, copy…). */
function follow(event: MouseEvent<HTMLAnchorElement>, to: string, after?: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
  event.preventDefault()
  navigate(to)
  after?.()
}

function InventoryHistoryPage() {
  const { pathname, params } = useQueryParams()
  const { filters, ignored } = readHistoryFilters(params)
  const { session, can } = useSession()
  const canSeeOrders = can('ORDER_READ')
  const canSeeUsers = can('USER_READ')
  const canSeeBatches = can('BATCH_READ')
  // Bumped by "Xóa bộ lọc" so the id fields drop what was typed but never applied.
  const [resets, setResets] = useState(0)
  const results = useRef<HTMLHeadingElement>(null)
  // A new browser history entry per change (not replace), so Back/Forward walk through the filters.
  const go = (patch: HistoryPatch) => navigate(historyHref(filters, patch, pathname))
  const hrefFor = (patch: HistoryPatch) => historyHref(filters, patch, pathname)
  const clearFilters = () => { setResets(count => count + 1); go({ ...NO_FILTERS }) }
  // A quick filter link may disappear with the new rows: focus goes to the results heading, not <body>.
  const focusResults = () => results.current?.focus()

  const state = useApi(signal => inventoryApi.history(historyQuery(filters, PAGE_SIZE), signal), historyKey(filters))
  const data = state.data
  const rows = data?.content
  const machineList = useApi(signal => machinesApi.list({ page: 0, size: 100, sort: 'name,asc' }, signal), 'history-machines').data?.content ?? []
  const machines = machineList.filter(machine => machine.id).map(machine => ({ value: machine.id as string, label: `${machine.name} (${machine.code})`, code: machine.code ?? '' }))
  const machineNames: Record<string, string> = Object.fromEntries(machines.map(option => [option.value, option.label]))
  const machineCodes: Record<string, string> = Object.fromEntries(machines.map(option => [option.value, option.code || option.label]))
  const filterSlots = useApi(signal => filters.machineId ? slotsApi.list(filters.machineId, { page: 0, size: 100, sort: 'slotCode,asc' }, signal) : Promise.resolve(undefined), `history-slots|${filters.machineId}`)
  // While another machine's slots load, the old machine's slots are not offered.
  const machineSlots = filters.machineId && filterSlots.data ? filterSlots.data.content.filter(slot => slot.id && (slot.machineId === undefined || slot.machineId === filters.machineId)) : []
  const slotOptions = machineSlots.map(slot => ({ value: slot.id as string, label: `Ngăn ${slot.slotCode}` }))
  // Slot codes of the rows: the filtered machine's slots are already loaded for the picker; only other machines are fetched.
  const otherMachines = [...new Set((rows ?? []).map(row => row.machineId).filter((id): id is string => !!id && id !== filters.machineId))].sort()
  const otherCodes = useApi(signal => otherMachines.length ? loadSlotCodes(otherMachines, signal) : Promise.resolve(NO_NAMES), `history-slot-codes|${otherMachines.join(',')}`).data ?? NO_NAMES
  const slotCodes: Record<string, string> = { ...otherCodes, ...Object.fromEntries(machineSlots.map(slot => [slot.id as string, slot.slotCode ?? ''])) }
  const products = useApi(signal => canSeeBatches ? batchesApi.list({ page: 0, size: 100, sort: 'createdAt,desc' }, signal)
    .then(page => Object.fromEntries(page.content.filter(batch => batch.id).map(batch => [batch.id as string, batch.productName ?? '']))) : Promise.resolve(NO_NAMES), `history-batches|${canSeeBatches}`).data ?? NO_NAMES
  const people = useApi(signal => canSeeUsers ? usersApi.list({ page: 0, size: 100 }, signal)
    .then(page => Object.fromEntries(page.content.filter(user => user.id).map(user => [user.id as string, user.fullName || user.email || '']))) : Promise.resolve(NO_NAMES), `history-users|${canSeeUsers}`).data ?? NO_NAMES

  const problem = state.error && !data ? describeHistoryError(state.error) : undefined
  const forbidden = problem?.kind === 'forbidden'
  const filterCount = activeHistoryFilterCount(filters)
  const pastEnd = !!data && data.content.length === 0 && data.totalElements > 0
  const machineLabel = (id: string) => machineNames[id] ?? `Máy ${shortId(id)}`
  const machineCode = (id: string) => machineCodes[id] ?? `Máy ${shortId(id)}`
  const slotLabel = (id: string) => slotCodes[id] ? `Ngăn ${slotCodes[id]}` : `Ngăn ${shortId(id)}`

  const summary = [
    filters.machineId && machineLabel(filters.machineId),
    filters.slotId && slotLabel(filters.slotId),
    filters.type && `loại “${statusMeta('inventoryTransactionType', filters.type).label}”`,
    filters.inventoryItemId && `hộp ${shortId(filters.inventoryItemId)}`,
    filters.referenceId && `phiếu nạp / đơn hàng ${shortId(filters.referenceId)}`,
  ].filter(Boolean).join(', ')
  const empty = pastEnd
    ? <>Trang này không còn giao dịch nào. <Button type="button" variant="link" className="h-auto p-0" onClick={() => go({ page: 0 })}>Về trang đầu</Button></>
    : filterCount
      ? <>Không có giao dịch nào khớp bộ lọc ({summary}). <Button type="button" variant="link" className="h-auto p-0" onClick={clearFilters}>Xóa bộ lọc</Button></>
      : <>Chưa có giao dịch kho nào. Lịch sử bắt đầu khi có hộp được nạp vào ngăn. <a href="/admin/inventory" onClick={event => follow(event, '/admin/inventory')}>Mở Tồn kho</a></>
  const heading = data
    ? `${data.totalElements.toLocaleString('vi-VN')} giao dịch${filterCount ? ' khớp bộ lọc' : ''}, mới nhất ở trên`
    : state.error ? 'Giao dịch' : 'Đang tải giao dịch…'

  const link = (to: string, active: boolean, label: string, children: string, options: { title?: string; mono?: boolean } = {}) =>
    <FilterLink to={to} active={active} label={label} title={options.title} mono={options.mono} onFollow={focusResults}>{children}</FilterLink>

  const columns: Column<InventoryTransaction>[] = [
    { head: 'Thời gian', nowrap: true, cell: row => <span className="tabular-nums">{formatDateTime(row.createdAt)}</span> },
    { head: 'Sự kiện · trạng thái hộp', cell: row => <span className="grid max-w-72 justify-items-start gap-1 @max-[680px]:justify-items-end">
      <Badge domain="inventoryTransactionType" value={row.type} />
      <StatusChange row={row} />
      <span className="text-xs text-muted-foreground">{eventText(row)}</span>
    </span> },
    { head: 'Vị trí', cell: row => row.machineId
      ? <span className="grid @max-[680px]:justify-items-end">
        {row.slotId && link(hrefFor({ machineId: row.machineId, slotId: row.slotId }), filters.slotId === row.slotId,
          `Chỉ xem lịch sử ${slotLabel(row.slotId)} của máy ${machineLabel(row.machineId)}`, slotLabel(row.slotId))}
        <span className="text-xs">{link(hrefFor({ machineId: row.machineId, slotId: '' }), filters.machineId === row.machineId && !filters.slotId,
          `Chỉ xem lịch sử của máy ${machineLabel(row.machineId)}`, machineCode(row.machineId), { title: machineLabel(row.machineId), mono: true })}</span>
      </span>
      : <span className="text-muted-foreground">Không ghi nhận</span> },
    { head: 'Hộp', cell: row => <span className="grid gap-0.5 @max-[680px]:justify-items-end">
      {row.batchId && products[row.batchId] && <span className="font-medium">{products[row.batchId]}</span>}
      {row.batchCode && <span className="font-mono text-xs text-muted-foreground">Lô {row.batchCode}</span>}
      {row.inventoryItemId && <span className="text-xs">{link(hrefFor({ inventoryItemId: row.inventoryItemId }), filters.inventoryItemId === row.inventoryItemId,
        `Chỉ xem lịch sử hộp ${shortId(row.inventoryItemId)}`, `Hộp ${shortId(row.inventoryItemId)}`, { title: row.inventoryItemId, mono: true })}</span>}
    </span> },
    { head: REFERENCE_HEAD, cell: row => <Reference row={row} filters={filters} hrefFor={hrefFor} canSeeOrders={canSeeOrders} link={link} /> },
    { head: 'Lý do · người thực hiện', cell: row => {
      const reason = reasonText(row.reason), who = performerText(row, people, session?.user.id)
      return <span className="grid max-w-64 gap-0.5 @max-[680px]:justify-items-end">
        <span className={reason ? undefined : 'text-muted-foreground'} title={row.reason && reason !== row.reason ? row.reason : undefined}>{reason || 'Không có lý do'}</span>
        {who && <span className="text-xs text-muted-foreground">{who}</span>}
      </span>
    } },
  ]

  const machineKnown = !!machineNames[filters.machineId]
  const slotKnown = slotOptions.some(option => option.value === filters.slotId)
  return <>
    <PageHead title="Lịch sử kho"
      subtitle="Mỗi dòng là một sự kiện của một hộp: nạp vào ngăn, giữ chỗ cho đơn, bán, trả lại ngăn, rút hộp hoặc điều chỉnh khi máy nhả hàng thất bại. Nhật ký chỉ ghi thêm, không sửa hay xóa được; mới nhất ở trên. Bấm vào máy, ngăn, mã hộp hoặc mã phiếu trong bảng để lọc nhanh." />
    <InventoryTabs current="history" />
    {ignored.length > 0 && <div role="note" className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3.5 py-2.5 text-[13px] text-status-warning-foreground">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p>Đường dẫn có bộ lọc không dùng được nên đã bỏ qua; danh sách dưới đây không áp dụng các bộ lọc này:</p>
        <ul className="mt-1 list-disc pl-5">
          {ignored.map(item => <li key={item.key} className="wrap-anywhere">{FILTER_LABELS[item.key]} “{item.value.length > 40 ? `${item.value.slice(0, 40)}…` : item.value}”: {item.reason}.</li>)}
        </ul>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => navigate(cleanHistoryHref(filters, pathname), { replace: true })}>Bỏ khỏi đường dẫn</Button>
    </div>}
    {!forbidden && <FilterBar activeCount={filterCount} onClear={clearFilters}>
      <FormField label="Máy">
        <NativeSelect value={filters.machineId} onChange={event => go({ machineId: event.target.value })}>
          <option value="">Tất cả máy</option>
          {machines.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          {/* The URL's machine before the list arrives, or one the list does not have: the select still shows it. */}
          {filters.machineId && !machineKnown && <option value={filters.machineId}>Máy {shortId(filters.machineId)}{machines.length ? ' (không có trong danh sách)' : ''}</option>}
        </NativeSelect>
      </FormField>
      {filters.machineId && <FormField label="Ngăn">
        <NativeSelect value={filters.slotId} onChange={event => go({ slotId: event.target.value })}>
          <option value="">Tất cả ngăn</option>
          {slotOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          {filters.slotId && !slotKnown && <option value={filters.slotId}>Ngăn {shortId(filters.slotId)}{filterSlots.data ? ' (không thuộc máy này)' : ''}</option>}
        </NativeSelect>
      </FormField>}
      <FormField label="Loại giao dịch">
        <NativeSelect value={filters.type} onChange={event => go({ type: event.target.value as HistoryFilters['type'] })}>
          <option value="">Tất cả loại</option>
          {TRANSACTION_TYPES.map(type => <option key={type} value={type}>{statusMeta('inventoryTransactionType', type).label}</option>)}
        </NativeSelect>
      </FormField>
      <IdFilter key={`item-${filters.inventoryItemId}-${resets}`} label={FILTER_LABELS.inventoryItemId} value={filters.inventoryItemId} onCommit={value => go({ inventoryItemId: value })} />
      <IdFilter key={`ref-${filters.referenceId}-${resets}`} label={FILTER_LABELS.referenceId} value={filters.referenceId} onCommit={value => go({ referenceId: value })} />
    </FilterBar>}
    {forbidden
      ? <Forbidden />
      : <>
        <h2 ref={results} tabIndex={-1} className="mb-2 rounded-sm text-sm font-medium text-muted-foreground outline-none focus:ring-3 focus:ring-ring/40">{heading}</h2>
        {problem?.kind === 'filters' || problem?.kind === 'notFound'
          ? <div role="alert" className="rounded-xl border border-dashed px-4 py-10 text-center text-muted-foreground">
            <p>{problem.message}</p>
            <p className="mt-3! flex flex-wrap justify-center gap-2">
              {filterCount > 0 && <Button type="button" variant="outline" size="sm" onClick={clearFilters}>Xóa bộ lọc</Button>}
              <Button type="button" variant="ghost" size="sm" onClick={state.reload}>Thử lại</Button>
            </p>
          </div>
          : <DataTable state={state} rows={rows} rowKey={row => row.id ?? `${row.inventoryItemId}-${row.createdAt}-${row.type}`} columns={columns} caption="Lịch sử kho, mới nhất ở trên" empty={empty} />}
      </>}
    {data && !forbidden && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} onPage={next => go({ page: next })} />}
  </>
}

/** Status before → after; a load has no "before" (the box did not exist), legacy rows have neither. */
function StatusChange({ row }: { row: InventoryTransaction }) {
  if (!row.statusBefore && !row.statusAfter) return <span className="text-muted-foreground">Không ghi nhận</span>
  return <span className="inline-flex flex-wrap items-center gap-1 @max-[680px]:justify-end">
    {row.statusBefore ? <Badge domain="box" value={row.statusBefore} /> : <span className="text-xs text-muted-foreground">{row.type === 'LOAD' ? 'Mới' : 'Không rõ'}</span>}
    <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
    <span className="sr-only">thành</span>
    {row.statusAfter ? <Badge domain="box" value={row.statusAfter} /> : <span className="text-xs text-muted-foreground">Không rõ</span>}
  </span>
}

/** A link that narrows the list to this value; plain text when that filter is already on. */
function FilterLink({ to, active, label, title, mono = false, onFollow, children }: {
  to: string; active: boolean; label: string; title?: string; mono?: boolean; onFollow?: () => void; children: string
}) {
  const className = cn('whitespace-nowrap', mono && 'font-mono')
  if (active) return <span className={cn(className, TARGET)} title={title}>{children}</span>
  return <a href={to} aria-label={label} title={title ?? label} className={cn(className, TARGET)} onClick={event => follow(event, to, onFollow)}>{children}</a>
}

type LinkMaker = (to: string, active: boolean, label: string, children: string, options?: { title?: string; mono?: boolean }) => ReactNode

function Reference({ row, filters, hrefFor, canSeeOrders, link }: {
  row: InventoryTransaction; filters: HistoryFilters; hrefFor: (patch: HistoryPatch) => string; canSeeOrders: boolean; link: LinkMaker
}) {
  const kind = referenceKind(row)
  if (!kind || !row.referenceId) return <span className="text-muted-foreground">Không có</span>
  const name = REFERENCE_LABELS[kind]
  const what = kind === 'load' ? 'mọi hộp của phiếu nạp' : kind === 'order' ? 'mọi giao dịch của đơn' : 'mọi giao dịch có mã tham chiếu'
  const orderPath = `/admin/orders/${row.referenceId}`
  return <span className="grid @max-[680px]:justify-items-end">
    <span className="text-xs text-muted-foreground">{name}</span>
    {referenceFilterable(kind)
      ? link(hrefFor({ referenceId: row.referenceId }), filters.referenceId === row.referenceId, `Chỉ xem ${what} ${shortId(row.referenceId)}`, shortId(row.referenceId), { title: row.referenceId, mono: true })
      // A removal's id belongs to this row only: shown for support, not as a filter.
      : <span className="font-mono whitespace-nowrap" title={row.referenceId}>{shortId(row.referenceId)}</span>}
    {kind === 'order' && canSeeOrders && <a href={orderPath} className={cn('text-xs whitespace-nowrap', TARGET)} aria-label={`Mở đơn hàng ${shortId(row.referenceId)}`}
      onClick={event => follow(event, orderPath)}>Mở đơn hàng</a>}
  </span>
}

/**
 * Id filter: a pasted full id applies at once; otherwise Enter or leaving the field applies it. A value that is not a
 * full UUID stays in the field with an error and is never sent (no raw 400).
 */
function IdFilter({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value)
  const [error, setError] = useState('')
  const commit = (raw: string) => {
    const parsed = parseIdInput(raw)
    if (!parsed.ok) { setError(parsed.error); return }
    setError('')
    if (parsed.value !== value) onCommit(parsed.value)
  }
  const change = (raw: string) => {
    setText(raw)
    const parsed = parseIdInput(raw)
    if (parsed.ok && parsed.value) commit(raw)
    else if (parsed.ok || !raw.trim()) setError('')
  }
  const key = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); commit(text) } }
  return <FormField label={label} error={error} className="max-w-[340px] min-w-[240px]! flex-1">
    <Input type="search" value={text} maxLength={60} autoComplete="off" spellCheck={false} placeholder="Dán mã đầy đủ (UUID)" className="font-mono text-[13px] placeholder:font-sans"
      onChange={event => change(event.target.value)} onBlur={() => commit(text)} onKeyDown={key} />
  </FormField>
}

export default InventoryHistoryPage
