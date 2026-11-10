// I2 Tồn kho: map of a machine (`?machineId=`, default view) where each slot is a column of stacked boxes, the bottom
// one (the head) being the box sold next. A head that is expired or failed to dispense blocks the slot: it says
// "Đang chặn ngăn" and, when the API allows it, offers "Rút hộp" (INVENTORY_WRITE). `?view=list` keeps the list of
// boxes with its filters. Rules: ../inventory-map.ts. Load and the full remove Sheet are issue FE 4.3; history is 4.4.
import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDownToLine, CircleAlert, Lock, PackageMinus, RefreshCw } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { inventoryApi, machinesApi, slotsApi } from '../../api/resources.ts'
import type { InventoryItem } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime, parseInteger } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { statusMeta } from '../../lib/status.ts'
import {
  REMOVE_LOCKED, blockedText, boxDescription, boxStatusText, columnLabel, columnSaleText, describeRemoveError, headLabel, loadMachineMap,
  lockedNextStep, mapColumns, mapOverview, overviewText, readMapQuery,
} from '../inventory-map.ts'
import type { InventoryView, MachineMap, SlotColumn } from '../inventory-map.ts'
import { Badge, DataTable, ErrorState, Field, FormDialog, Link, Loading, PAGE_SIZE, PageHead, Pagination, SelectFilter, Toolbar, enumOptions, pageParam, useDialog, useForm } from '../kit.tsx'
import { useBatchOptions, useMachineOptions, useSlotOptions } from '../options.ts'
import { focusByKey, focusLost } from '../return-focus.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

export const ITEM_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'EXPIRED', 'REMOVED', 'DISPENSE_FAILED'] as const
const REMOVABLE = new Set(['AVAILABLE', 'EXPIRED'])
const SORTS = [{ value: 'loadedAt,desc', label: 'Nạp gần nhất' }, { value: 'updatedAt,desc', label: 'Cập nhật gần nhất' }, { value: 'status,asc', label: 'Trạng thái' }]
const VIEW_LABELS: Record<InventoryView, string> = { map: 'Sơ đồ ngăn', list: 'Danh sách hộp' }

export function InventoryTabs({ current }: { current: 'items' | 'history' }) {
  return <nav className="a-tabs" aria-label="Tồn kho">
    <Link to="/admin/inventory" className={current === 'items' ? 'is-current' : ''}>Hộp hàng</Link>
    <Link to="/admin/inventory/history" className={current === 'history' ? 'is-current' : ''}>Lịch sử</Link>
  </nav>
}

/** Box to take out, with where it sits (for the dialog text). */
interface RemoveTarget { item: InventoryItem; slotCode?: string; head?: boolean }

function InventoryPage() {
  const { params, update } = useQueryParams()
  const { view } = readMapQuery(params)
  const canWrite = useSession().can('INVENTORY_WRITE')
  const [loading, setLoading] = useState(false)
  const [changes, setChanges] = useState(0)

  return <>
    <PageHead title="Tồn kho"
      subtitle={`Mỗi ngăn là một cột hộp xếp chồng: hộp dưới cùng (hộp đáy) được bán và đẩy ra tiếp theo. Hộp đáy hết hạn hoặc nhả hàng thất bại chặn cả ngăn cho tới khi được rút ra.${canWrite ? '' : ' Bạn chỉ xem; nạp và rút hộp do người có quyền thực hiện.'}`}
      actions={canWrite ? <Button type="button" data-focus-key="inventory-load" onClick={() => setLoading(true)}><ArrowDownToLine aria-hidden="true" />Nạp hàng</Button> : undefined} />
    <InventoryTabs current="items" />
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span id="inventory-view-label" className="text-[13px] text-muted-foreground">Cách xem</span>
      <div role="group" aria-labelledby="inventory-view-label" className="inline-flex gap-1 rounded-lg border bg-muted p-1">
        {(Object.keys(VIEW_LABELS) as InventoryView[]).map(name => <Button key={name} type="button" size="sm" variant={view === name ? 'outline' : 'ghost'} aria-pressed={view === name}
          className={cn(view === name ? 'shadow-xs' : 'border border-transparent text-muted-foreground')}
          onClick={() => update({ view: name === 'map' ? undefined : name })}>{VIEW_LABELS[name]}</Button>)}
      </div>
    </div>
    {view === 'map' ? <MapView canWrite={canWrite} changes={changes} /> : <ListView canWrite={canWrite} changes={changes} changed={() => setChanges(count => count + 1)} />}
    {loading && <LoadDialog close={() => setLoading(false)} done={() => setChanges(count => count + 1)} />}
  </>
}

// ---- map

function MapView({ canWrite, changes }: { canWrite: boolean; changes: number }) {
  const { params, update } = useQueryParams()
  const { machineId, slotId } = readMapQuery(params)
  const machines = useMachineOptions()
  const state = useApi(signal => machineId ? loadMachineMap(machineId, signal) : Promise.resolve(undefined), `${machineId}|${changes}`)
  // While another machine loads, the previous one's map (and its slots in the Ngăn filter) is not shown.
  const data = machineId && state.data?.machine.id === machineId ? state.data : undefined
  const [target, setTarget] = useState<RemoveTarget | null>(null)
  // After a removal the "Rút hộp" button may disappear with the new data: focus goes to the slot instead of <body>.
  const focusAfter = useRef<string[] | null>(null)
  useEffect(() => {
    const keys = focusAfter.current
    if (!keys || state.loading) return
    focusAfter.current = null
    if (focusLost(document)) keys.some(key => focusByKey(document, key))
  }, [state.loading, state.updatedAt])

  const forbidden = state.error instanceof ApiError && state.error.status === 403
  const slotOptions = (data?.slots ?? []).map(slot => ({ value: slot.id, label: `Ngăn ${slot.slotCode}` }))
  return <>
    {!forbidden && <FilterBar activeCount={slotId ? 1 : 0} onClear={() => update({ slotId: undefined })}>
      <SelectFilter label="Máy" value={machineId} empty="Chọn máy…" onChange={value => update({ machineId: value || undefined, slotId: undefined })} options={machines} />
      {machineId && <SelectFilter label="Ngăn" value={slotId} empty="Tất cả ngăn" onChange={value => update({ slotId: value || undefined })} options={slotOptions} />}
    </FilterBar>}
    {!machineId
      ? <MachinePicker choose={id => update({ machineId: id })} />
      : <MapBody state={state} data={data} slotId={slotId} canWrite={canWrite} remove={setTarget} showAll={() => update({ slotId: undefined })} />}
    {target && <RemoveDialog target={target} close={() => setTarget(null)} stale={state.reload} done={() => {
      const slot = target.item.slotId ?? ''
      focusAfter.current = [`head-remove-${slot}`, `slot-${slot}`]
      state.reload()
    }} />}
  </>
}

/** No machine in the URL yet: the machines to choose from, as buttons. */
function MachinePicker({ choose }: { choose: (machineId: string) => void }) {
  const state = useApi(signal => machinesApi.list({ page: 0, size: 100, sort: 'name,asc' }, signal), 'inventory-machines')
  const titleId = useId()
  if (state.error && !state.data) return <ErrorState error={state.error} retry={state.reload} />
  if (!state.data) return <Loading label="Đang tải danh sách máy…" rows={3} />
  const machines = state.data.content
  return <section aria-labelledby={titleId} className="rounded-xl border bg-card p-5 shadow-xs max-[680px]:p-4">
    <h2 id={titleId}>Chọn máy để xem sơ đồ ngăn</h2>
    {machines.length
      ? <>
        <p className="mt-1! text-[13px] text-muted-foreground">Sơ đồ hiện từng ngăn của máy, hộp nào sẽ bán tiếp theo và hộp nào đang chặn ngăn.</p>
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
          {machines.map(machine => <li key={machine.id}>
            <Button type="button" variant="outline" className="h-auto w-full justify-between gap-3 px-3 py-2.5 text-left whitespace-normal" onClick={() => choose(machine.id)}>
              <span className="grid min-w-0 gap-0.5"><span className="font-medium">{machine.name}</span><span className="font-mono text-xs text-muted-foreground">{machine.code}</span></span>
              <StatusBadge domain="machine" value={machine.status} describe={false} />
            </Button>
          </li>)}
        </ul>
      </>
      : <p className="mt-1! text-[13px] text-muted-foreground">Chưa có máy nào. Quản trị viên đăng ký máy và thêm ngăn ở mục Máy bán hàng trước khi nạp hộp.</p>}
  </section>
}

function MapBody({ state, data, slotId, canWrite, remove, showAll }: {
  state: { loading: boolean; refreshing: boolean; error?: unknown; updatedAt?: number; reload: () => void }
  data?: MachineMap; slotId: string; canWrite: boolean; remove: (target: RemoveTarget) => void; showAll: () => void
}) {
  if (state.error && !data) {
    const status = state.error instanceof ApiError ? state.error.status : undefined
    if (status === 404 || status === 400) return <div role="alert" className="px-4 py-10 text-center text-muted-foreground">
      <p>Không tìm thấy máy này. Máy có thể đã sai đường dẫn; hãy chọn lại máy ở ô Máy phía trên.</p>
    </div>
    return <ErrorState error={state.error} retry={state.reload} />
  }
  if (!data) return <MapSkeleton />
  const all = mapColumns(data)
  const columns = slotId ? all.filter(column => column.slot.id === slotId) : all
  const overview = mapOverview(all)
  const machineMeta = statusMeta('machine', data.machine.status)
  return <section aria-labelledby="map-title" aria-busy={state.loading || state.refreshing} data-updated-at={state.updatedAt}>
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id="map-title">Sơ đồ ngăn · {data.machine.name} <span className="font-mono text-[13px] font-normal text-muted-foreground">({data.machine.code})</span></h2>
        <p className="mt-1! text-[13px] text-muted-foreground">
          {overviewText(overview)}{' · '}Cập nhật {formatDateTime(new Date(data.asOf).toISOString())}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={state.loading} onClick={state.reload}>
        <RefreshCw aria-hidden="true" className={cn(state.loading && 'motion-safe:animate-spin')} />{state.loading ? 'Đang tải…' : 'Tải lại'}
      </Button>
    </div>
    {state.error ? <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">Không tải lại được sơ đồ; đang hiện dữ liệu cũ. Bấm Tải lại để thử lần nữa.</p> : null}
    {data.machine.status !== 'ACTIVE' && <p role="note" className="mb-3 rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3.5 py-2.5 text-[13px] text-status-warning-foreground">
      Máy đang ở trạng thái <strong>{machineMeta.label}</strong>: kiosk không bán hộp nào, kể cả ở ngăn có hộp đáy sẵn sàng.
    </p>}
    {data.incomplete && <p role="note" className="mb-3 text-[13px] text-muted-foreground">Máy có quá nhiều ngăn hoặc hộp để hiện hết; sơ đồ có thể thiếu một phần. Dùng “Danh sách hộp” để lọc chi tiết.</p>}
    <Legend />
    {!all.length
      ? <div className="rounded-xl border border-dashed px-4 py-10 text-center text-muted-foreground">
        <p>Máy chưa có ngăn nào nên chưa có hộp để hiện.</p>
        <p className="mt-3!"><Button asChild variant="outline" size="sm"><Link to={`/admin/machines/${data.machine.id}?tab=slots`}>Mở danh sách ngăn của máy</Link></Button></p>
      </div>
      : !columns.length
        ? <div className="rounded-xl border border-dashed px-4 py-10 text-center text-muted-foreground">
          <p>Ngăn đã chọn không thuộc máy này. <Button type="button" variant="link" className="h-auto p-0" onClick={showAll}>Xem tất cả ngăn</Button></p>
        </div>
        // Columns of a row stretch to the same height and stack from the bottom, so the heads share one floor line.
        : <ul aria-label="Các ngăn của máy" className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] items-stretch gap-3">
          {columns.map(column => <li key={column.slot.id} className="flex min-w-0"><Column column={column} canWrite={canWrite} remove={remove} /></li>)}
        </ul>}
  </section>
}

function Legend() {
  return <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm border-2 border-primary bg-primary/10" />Hộp đáy (bán tiếp theo)</span>
    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm border-2 border-destructive bg-destructive/10" />Đang chặn ngăn</span>
    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm border border-status-warning-foreground/40 bg-status-warning" />Đang giữ cho đơn</span>
    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm border border-dashed border-muted-foreground/50" />Chỗ trống</span>
  </p>
}

function MapSkeleton() {
  return <div role="status" className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
    <span className="sr-only">Đang tải sơ đồ ngăn…</span>
    {Array.from({ length: 3 }, (_, column) => <div key={column} className="grid gap-2 rounded-xl border bg-card p-3">
      <Skeleton className="h-5 w-24" /><Skeleton className="h-3 w-40" />
      {Array.from({ length: 5 }, (_, row) => <Skeleton key={row} className="h-11" style={{ opacity: 1 - row * 0.15 }} />)}
    </div>)}
  </div>
}

const SALE_TONE: Record<SlotColumn['state']['kind'], string> = {
  ready: 'text-muted-foreground', empty: 'text-muted-foreground', reserved: 'text-status-warning-foreground', blocked: 'font-medium text-destructive',
}

/** One slot: code, fill, whether it sells, then its boxes stacked bottom-up (the head at the bottom). */
function Column({ column, canWrite, remove }: { column: SlotColumn; canWrite: boolean; remove: (target: RemoveTarget) => void }) {
  const titleId = useId()
  const { slot, summary } = column
  const inactive = slot.status !== 'ACTIVE'
  const removable = canWrite && column.state.kind === 'blocked' && column.state.removable
  return <section aria-labelledby={titleId} tabIndex={-1} data-focus-key={removable ? undefined : `slot-${slot.id}`} data-slot-column={slot.slotCode}
    className={cn('flex w-full flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/40', column.state.kind === 'blocked' && !inactive && 'border-destructive/50')}>
    <header className="grid gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-[15px] font-semibold"><span className="sr-only">Ngăn </span><span className="font-mono">{slot.slotCode}</span></h3>
        <span className="text-[13px] tabular-nums text-muted-foreground">{column.occupied}/{slot.capacity} hộp</span>
      </div>
      {inactive && <StatusBadge domain="slot" value={slot.status} />}
      <p className={cn('flex items-start gap-1.5 text-[13px]', inactive ? 'text-muted-foreground' : SALE_TONE[column.state.kind], column.state.kind === 'ready' && !column.selling && 'font-medium text-foreground')}>
        {column.state.kind === 'blocked' && !inactive && <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />}
        {column.state.kind === 'reserved' && !inactive && <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />}
        <span>{columnSaleText(column)}</span>
      </p>
      {summary && <p className="text-xs text-muted-foreground">Bán được {summary.sellableCount ?? 0}{summary.expiredCount ? ` · hết hạn ${summary.expiredCount}` : ''}{summary.reservedCount ? ` · đang giữ ${summary.reservedCount}` : ''}</p>}
      {column.summaryFailed && <p className="text-xs text-muted-foreground">Không tải được số liệu tóm tắt của ngăn; các hộp bên dưới vẫn đúng theo danh sách.</p>}
      {column.outOfSync && <p className="text-xs text-muted-foreground">Ngăn vừa thay đổi trong lúc tải. Bấm Tải lại để xem bản mới nhất.</p>}
    </header>
    <ol aria-label={`${columnLabel(column)} Các hộp, từ đáy lên`} className="mt-auto flex flex-col-reverse gap-1.5">
      {column.visibleBoxes.map((item, index) => <Box key={item.id} item={item} position={index + 1} column={column} canWrite={canWrite} remove={remove} />)}
      {column.hiddenBoxes > 0 && <li className="rounded-md border border-dashed px-2 py-1.5 text-center text-xs text-muted-foreground">+{column.hiddenBoxes} hộp phía trên</li>}
      {Array.from({ length: column.emptyCells }, (_, index) => <li key={`empty-${index}`} aria-hidden="true" className="h-7 rounded-md border border-dashed border-muted-foreground/40" />)}
      {column.free > 0 && <li className={cn('text-center text-xs text-muted-foreground', column.hiddenFree ? '' : 'sr-only')}>
        {column.hiddenFree ? `+${column.hiddenFree} chỗ trống nữa` : `Còn trống ${column.free} chỗ`}{column.hiddenFree ? <span className="sr-only"> (còn trống {column.free} chỗ)</span> : null}
      </li>}
      {!column.occupied && <li className="py-1 text-center text-xs text-muted-foreground">Chưa có hộp nào.</li>}
    </ol>
  </section>
}

/**
 * One box. The head (position 1) carries the marker of what happens next; a blocking head explains why and offers
 * "Rút hộp" when the API allows it. The discount slot on the right is reserved (empty for now) so a "-50%" label can
 * be added later without moving anything.
 */
function Box({ item, position, column, canWrite, remove }: { item: InventoryItem; position: number; column: SlotColumn; canWrite: boolean; remove: (target: RemoveTarget) => void }) {
  const head = position === 1
  const state = column.state
  const blocking = head && state.kind === 'blocked'
  const status = boxStatusText(item)
  const describedBy = useId()
  const lockedId = useId()
  const isAdmin = useSession().roles.includes('ADMIN')
  const tone = blocking
    ? 'border-2 border-destructive bg-destructive/8'
    : head && state.kind === 'reserved' ? 'border-2 border-status-warning-foreground/50 bg-status-warning'
      : head && column.selling ? 'border-2 border-primary bg-primary/8'
        : head ? 'border-2 border-muted-foreground/50 bg-muted'
          : item.status === 'RESERVED' ? 'border border-status-warning-foreground/40 bg-status-warning'
            : status ? 'border border-destructive/40 bg-destructive/5' : 'border bg-background'
  const headTone = blocking ? 'text-destructive' : state.kind === 'reserved' ? 'text-status-warning-foreground' : column.selling ? 'text-primary' : 'text-foreground'
  return <li data-box-status={item.status} data-head={head || undefined} data-blocking={blocking || undefined} className={cn('grid gap-1 rounded-md px-2 py-1.5', tone)}>
    <span className="sr-only">{boxDescription(item, position, column)}</span>
    {head && <span aria-hidden="true" className={cn('text-[11px] font-semibold tracking-wide uppercase', headTone)}>{headLabel(column)}</span>}
    <div aria-hidden="true" className="flex items-start gap-1.5">
      <span className="min-w-5 pt-px text-[11px] tabular-nums text-muted-foreground">#{position}</span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-[13px] font-medium" title={item.productName}>{item.productName}</span>
        <span className="text-[11px] leading-tight whitespace-nowrap text-muted-foreground">HSD {formatDateTime(item.expiresAt)}</span>
        <span className="truncate font-mono text-[11px] leading-tight text-muted-foreground" title={item.batchCode}>{item.batchCode}</span>
      </span>
      <DiscountSlot />
    </div>
    {status && !head && <span aria-hidden="true" className={cn('justify-self-start rounded-full px-1.5 text-[11px] font-medium', item.status === 'RESERVED' ? 'bg-status-warning text-status-warning-foreground' : 'bg-status-danger text-status-danger-foreground')}>{status}</span>}
    {/* A held or plain head: its marker above already says it; an expired box behind a held head keeps its word. */}
    {head && status && !blocking && state.kind !== 'reserved' && <span aria-hidden="true" className="justify-self-start rounded-full bg-status-danger px-1.5 text-[11px] font-medium text-status-danger-foreground">{status}</span>}
    {blocking && <div className="mt-0.5 grid gap-1.5 border-t border-destructive/30 pt-1.5">
      <p id={describedBy} className="text-xs text-foreground"><strong className="text-destructive">{state.reason === 'expired' ? 'Hết hạn' : 'Nhả hàng thất bại'}.</strong> {blockedText(state, column.occupied - 1)}</p>
      {state.removable
        ? canWrite
          ? <Button type="button" size="sm" variant="destructive" className="justify-self-start" data-focus-key={`head-remove-${column.slot.id}`}
            aria-label={`Rút hộp đáy ngăn ${column.slot.slotCode}`} aria-describedby={describedBy}
            onClick={() => remove({ item, slotCode: column.slot.slotCode, head: true })}><PackageMinus aria-hidden="true" />Rút hộp</Button>
          : <p className="text-xs text-muted-foreground">Người có quyền nạp/rút hộp cần rút hộp này để ngăn bán lại.</p>
        : <>
          {/* The API refuses this removal today (see REMOVABLE_STATUSES): the button is shown locked, with why and what to do. */}
          {canWrite && <Button type="button" size="sm" variant="outline" className="cursor-not-allowed justify-self-start opacity-60 hover:bg-card"
            aria-disabled="true" aria-label={`Rút hộp đáy ngăn ${column.slot.slotCode}`} aria-describedby={`${describedBy} ${lockedId}`}
            onClick={event => event.preventDefault()}><PackageMinus aria-hidden="true" />Rút hộp</Button>}
          <p id={lockedId} className="text-xs text-muted-foreground">{REMOVE_LOCKED} {lockedNextStep(isAdmin)}</p>
        </>}
    </div>}
  </li>
}

/** Reserved place for a discount label such as "-50%" (pricing comes later): keeps box layout stable when it appears. */
function DiscountSlot({ label }: { label?: string }) {
  if (!label) return <span data-discount-slot="" aria-hidden="true" className="h-5 w-10 shrink-0" />
  return <span data-discount-slot="" className="inline-flex h-5 w-10 shrink-0 items-center justify-center rounded-full bg-status-danger text-[11px] font-semibold text-status-danger-foreground">{label}</span>
}

// ---- list (boxes with filters; rebuilt with the load/remove Sheets in FE 4.3)

function ListView({ canWrite, changes, changed }: { canWrite: boolean; changes: number; changed: () => void }) {
  const { params, update } = useQueryParams()
  const machineId = params.get('machineId') ?? '', slotId = params.get('slotId') ?? '', batchId = params.get('batchId') ?? ''
  const status = params.get('status') ?? '', expired = params.get('expired') ?? '', sort = params.get('sort') ?? 'loadedAt,desc', page = pageParam(params)
  const machines = useMachineOptions(), slots = useSlotOptions(machineId), batches = useBatchOptions()
  const state = useApi(signal => inventoryApi.list({
    page, size: PAGE_SIZE, machineId: machineId || undefined, slotId: slotId || undefined, batchId: batchId || undefined,
    status: (status || undefined) as 'AVAILABLE' | undefined, expired: expired ? expired === 'true' : undefined, sort,
  }, signal), `${params.toString()}|${changes}`)
  const dialog = useDialog<InventoryItem>()
  const target = dialog.value

  return <>
    <Toolbar>
      <SelectFilter label="Máy" value={machineId} onChange={value => update({ machineId: value, slotId: '' })} options={machines} />
      <SelectFilter label="Ngăn" value={slotId} onChange={value => update({ slotId: value })} options={slots} empty={machineId ? 'Tất cả ngăn' : 'Chọn máy trước'} />
      <SelectFilter label="Lô hàng" value={batchId} onChange={value => update({ batchId: value })} options={batches} />
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ status: value })} options={enumOptions('box', ITEM_STATUSES)} />
      <SelectFilter label="Hạn dùng" value={expired} onChange={value => update({ expired: value })} options={[{ value: 'true', label: 'Đã quá hạn' }, { value: 'false', label: 'Chưa quá hạn' }]} />
      <SelectFilter label="Sắp xếp" value={sort} onChange={value => update({ sort: value })} options={SORTS} empty="Mặc định" />
    </Toolbar>
    {machineId && slotId && <SlotSummaryPanel machineId={machineId} slotId={slotId} refresh={changes} />}
    <DataTable state={state} rows={state.data?.content} rowKey={item => item.id ?? ''} caption="Danh sách hộp" columns={[
      { head: 'Sản phẩm', cell: item => item.productName },
      { head: 'Lô', cell: item => item.batchCode },
      { head: 'Ngăn', cell: item => item.slotCode },
      { head: 'Trạng thái', cell: item => <Badge domain="box" value={item.status} /> },
      { head: 'Hết hạn', cell: item => <>{formatDateTime(item.expiresAt)}{item.expired && <> <Badge value="expired" /></>}</> },
      { head: 'Nạp lúc', cell: item => formatDateTime(item.loadedAt) },
      { head: 'Thao tác', cell: item => <div className="flex flex-wrap items-center gap-1.5">
        <Button asChild size="sm" variant="ghost"><Link to={`/admin/inventory/history?inventoryItemId=${item.id}`}>Lịch sử</Link></Button>
        {canWrite && <Button type="button" size="sm" variant="outline" disabled={!REMOVABLE.has(item.status ?? '')} title={REMOVABLE.has(item.status ?? '') ? undefined : 'Chỉ rút được hộp Sẵn sàng hoặc Hết hạn'} onClick={() => dialog.open(item)}>Rút hộp</Button>}
      </div> },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
    {target && <RemoveDialog target={{ item: target, slotCode: target.slotCode }} close={dialog.close} done={changed} stale={changed} />}
  </>
}

function SlotSummaryPanel({ machineId, slotId, refresh }: { machineId: string; slotId: string; refresh: number }) {
  const summary = useApi(signal => slotsApi.summary(machineId, slotId, signal), `${machineId}|${slotId}|${refresh}`)
  const data = summary.data
  if (!data) return null
  const cells: [string, number | undefined][] = [['Sức chứa', data.capacity], ['Đang có', data.occupiedCount], ['Sẵn sàng', data.availableCount], ['Quá hạn', data.expiredCount], ['Giữ chỗ', data.reservedCount], ['Còn trống', data.remainingCapacity]]
  return <section className="a-stats" aria-label="Tóm tắt ngăn">{cells.map(([label, value]) => <div key={label}><strong>{value}</strong><small>{label}</small></div>)}</section>
}

function LoadDialog({ close, done }: { close: () => void; done: () => void }) {
  const [machineId, setMachineId] = useState('')
  const machines = useMachineOptions(), slots = useSlotOptions(machineId), batches = useBatchOptions()
  const form = useForm({ batchId: '', slotId: '', quantity: '' })
  const { values, errors } = form
  return <FormDialog title="Nạp hàng vào ngăn" submitLabel="Nạp hàng" close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    const problems: Record<string, string> = {}
    if (!values.batchId) problems.batchId = 'Vui lòng chọn lô hàng.'
    if (!values.slotId) problems.slotId = 'Vui lòng chọn ngăn.'
    const quantity = parseInteger(values.quantity)
    if (quantity === undefined || quantity < 1) problems.quantity = 'Số lượng phải là số nguyên lớn hơn 0.'
    if (Object.keys(problems).length || quantity === undefined) return form.fail(problems)
    await inventoryApi.load({ batchId: values.batchId, slotId: values.slotId, quantity })
    done()
  }}>
    <Field label="Lô hàng" error={errors.batchId}><select value={values.batchId} onChange={event => form.set('batchId')(event.target.value)}>
      <option value="">Chọn lô…</option>{batches.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
    <Field label="Máy"><select value={machineId} onChange={event => { setMachineId(event.target.value); form.set('slotId')('') }}>
      <option value="">Chọn máy…</option>{machines.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
    <Field label="Ngăn" error={errors.slotId}><select value={values.slotId} disabled={!machineId} onChange={event => form.set('slotId')(event.target.value)}>
      <option value="">Chọn ngăn…</option>{slots.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
    <Field label="Số hộp nạp" error={errors.quantity} hint="Vượt sức chứa ngăn hoặc số lượng khai báo của lô sẽ bị từ chối."><input inputMode="numeric" value={values.quantity} onChange={event => form.set('quantity')(event.target.value)} /></Field>
  </FormDialog>
}

/** Take one box out (reason required, stored in the history). The full remove Sheet comes with FE 4.3. */
function RemoveDialog({ target, close, done, stale }: { target: RemoveTarget; close: () => void; done: () => void; stale: () => void }) {
  const { item } = target
  const form = useForm({ reason: '' })
  return <FormDialog title="Rút hộp khỏi ngăn" submitLabel="Rút hộp" danger close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    const reason = form.values.reason.trim()
    if (!reason) return form.fail({ reason: 'Vui lòng nhập lý do rút hộp.' })
    if (reason.length > 500) return form.fail({ reason: 'Lý do tối đa 500 ký tự.' })
    try { await inventoryApi.remove(item.id ?? '', reason) } catch (error) {
      // 409/404: the box changed since the map loaded; reload it and say so in the dialog.
      const described = describeRemoveError(error)
      if (described.stale) stale()
      throw described.error
    }
    done()
  }}>
    <p className="mb-3! text-[13px]">
      {target.head ? 'Hộp đáy' : 'Hộp'} ngăn <strong className="font-mono">{target.slotCode ?? item.slotCode ?? '—'}</strong> · {item.productName} · lô <span className="font-mono">{item.batchCode}</span> · HSD {formatDateTime(item.expiresAt)}
    </p>
    <p className="mb-3! text-[13px] text-muted-foreground">Chỉ xác nhận sau khi đã lấy hộp ra khỏi máy. Hộp chuyển sang Đã gỡ và lý do được ghi vào lịch sử.</p>
    <Field label="Lý do rút hộp" error={form.errors.reason} hint="Ví dụ: Hộp hết hạn, đã lấy ra khi kiểm tra máy. Tối đa 500 ký tự.">
      <textarea value={form.values.reason} maxLength={500} onChange={event => form.set('reason')(event.target.value)} /></Field>
  </FormDialog>
}

export default InventoryPage
