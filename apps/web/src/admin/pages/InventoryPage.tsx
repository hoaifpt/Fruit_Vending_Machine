// I2/I3 Tồn kho: map of a machine (`?machineId=`, default view) where each slot is a column of stacked boxes, the bottom
// one (the head) being the box sold next. A head that is expired or failed to dispense blocks the slot: it says
// "Đang chặn ngăn" and, when the API allows it, offers "Rút hộp". `?view=list` keeps the list of boxes with its filters.
// INVENTORY_WRITE: load N boxes in a Sheet (from the page header, or "Nạp hộp" on a slot column with machine and slot
// filled in) showing the free places and what the batch can still take, and take a box out in a Sheet with a required
// reason. Rules: ../inventory-map.ts (map), ../inventory-load.ts (load/remove). Each slot links to its history and a
// blocking head to the history of that box (screen I4, ./InventoryHistoryPage.tsx).
import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDownToLine, CircleAlert, Lock, Minus, PackageMinus, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { inventoryApi, machinesApi, slotsApi } from '../../api/resources.ts'
import type { InventoryItem } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, NativeSelect, Textarea } from '../../components/ui/input.tsx'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { linkHandler, useQueryParams } from '../../lib/router.ts'
import { statusMeta } from '../../lib/status.ts'
import { countLoaded } from '../batches.ts'
import {
  NEW_LOAD, QUICK_REASONS, REASON_MAX, describeLoadError, describeRemoveFailure, fitConflictText, loadBody, loadLoadableBatches, loadMax, parseBoxCount,
  quantityHint, quantityProblem, reasonProblem, removeBody, roomLines, selectionProblems, validateLoad,
} from '../inventory-load.ts'
import type { FitConflict, LoadRoom, LoadValues, Reload } from '../inventory-load.ts'
import {
  ITEM_STATUSES, LIST_FILTER_KEYS, LIST_PARAM_LABELS, LIST_SORT, REMOVE_LOCKED, blockedText, boxDescription, boxStatusText, columnLabel, columnSaleText,
  headLabel, isExpiredBox, listApiQuery, listFilterCount, listRemoveState, loadMachineMap, lockedNextStep, mapColumns, mapOverview, overviewText,
  readListQuery, readMapQuery,
} from '../inventory-map.ts'
import type { InventoryView, MachineMap, SlotColumn } from '../inventory-map.ts'
import { Badge, DataTable, ErrorState, FormSheet, Link, Loading, PAGE_SIZE, PageHead, Pagination, SelectFilter, enumOptions, pageParam, useDialog, useForm } from '../kit.tsx'
import { useBatchOptions, useMachineOptions, useSlotOptions } from '../options.ts'
import { focusByKey, focusLost } from '../return-focus.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

const SORTS = [{ value: 'loadedAt,desc', label: 'Nạp gần nhất' }, { value: 'updatedAt,desc', label: 'Cập nhật gần nhất' }, { value: 'status,asc', label: 'Trạng thái' }]
const VIEW_LABELS: Record<InventoryView, string> = { map: 'Sơ đồ ngăn', list: 'Danh sách hộp' }

export function InventoryTabs({ current }: { current: 'items' | 'history' }) {
  return <nav className="a-tabs" aria-label="Tồn kho">
    <Link to="/admin/inventory" className={current === 'items' ? 'is-current' : ''}>Hộp hàng</Link>
    <Link to="/admin/inventory/history" className={current === 'history' ? 'is-current' : ''}>Lịch sử</Link>
  </nav>
}

/** History screen (I4) filtered to one slot of a machine, or to one box. */
const slotHistoryPath = (machineId: string | undefined, slotId: string | undefined) => `/admin/inventory/history?machineId=${machineId ?? ''}&slotId=${slotId ?? ''}`
const boxHistoryPath = (itemId: string | undefined) => `/admin/inventory/history?inventoryItemId=${itemId ?? ''}`

/** Box to take out, with where it sits (for the Sheet text). */
interface RemoveTarget { item: InventoryItem; slotCode?: string; head?: boolean }
/** What the load Sheet starts with: the machine and slot of a column, and the batch of its newest loadable box. */
interface LoadPrefill { machineId?: string; slotId?: string; batchId?: string }
/** Current time, read in event handlers only (after a refused load). */
const clock = () => Date.now()

/** Where focus goes once the map has reloaded after a load or a removal (the button used may be gone by then). */
interface FocusAfter { set: (keys: string[]) => void; take: () => string[] | null }

function useFocusAfter(): FocusAfter {
  const keys = useRef<string[] | null>(null)
  const [api] = useState<FocusAfter>(() => ({
    set: next => { keys.current = next },
    take: () => { const next = keys.current; keys.current = null; return next },
  }))
  return api
}

function InventoryPage() {
  const { params, update } = useQueryParams()
  const { view, machineId, slotId } = readMapQuery(params)
  const canWrite = useSession().can('INVENTORY_WRITE')
  const [load, setLoad] = useState<LoadPrefill | null>(null)
  const [changes, setChanges] = useState(0)
  const focusAfter = useFocusAfter()
  // The list view keeps its own filters; a slot there needs its machine too.
  const listSlot = view === 'list' ? readListQuery(params).query.slotId : ''
  // The header "Nạp hộp" is hidden while the view says loading makes no sense: no permission to read stock (403), or the
  // machine shown has no slot yet. Each view reports it (see useReportLoadable).
  const [loadHidden, setLoadHidden] = useState(false)

  return <>
    <PageHead title="Tồn kho"
      subtitle={`Mỗi ngăn là một cột hộp xếp chồng: hộp dưới cùng (hộp đáy) được bán và đẩy ra tiếp theo. Hộp đáy hết hạn hoặc nhả hàng thất bại chặn cả ngăn cho tới khi được rút ra.${canWrite ? '' : ' Bạn chỉ xem; nạp và rút hộp do người có quyền thực hiện.'}`}
      actions={canWrite && !loadHidden ? <Button type="button" data-focus-key="inventory-load" className="max-sm:h-11" onClick={() => setLoad({ machineId: machineId || undefined, slotId: (view === 'map' ? slotId : listSlot) || undefined })}>
        <ArrowDownToLine aria-hidden="true" />Nạp hộp</Button> : undefined} />
    <InventoryTabs current="items" />
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span id="inventory-view-label" className="text-[13px] text-muted-foreground">Cách xem</span>
      <div role="group" aria-labelledby="inventory-view-label" className="inline-flex gap-1 rounded-lg border bg-muted p-1">
        {(Object.keys(VIEW_LABELS) as InventoryView[]).map(name => <Button key={name} type="button" size="sm" variant={view === name ? 'outline' : 'ghost'} aria-pressed={view === name}
          className={cn(view === name ? 'shadow-xs' : 'border border-transparent text-muted-foreground')}
          onClick={() => update({ view: name === 'map' ? undefined : name })}>{VIEW_LABELS[name]}</Button>)}
      </div>
    </div>
    {view === 'map'
      ? <MapView canWrite={canWrite} changes={changes} focusAfter={focusAfter} load={setLoad} hideLoad={setLoadHidden} />
      : <ListView canWrite={canWrite} changes={changes} changed={() => setChanges(count => count + 1)} load={setLoad} hideLoad={setLoadHidden} />}
    {load && <LoadSheet prefill={load} close={() => setLoad(null)} done={slot => {
      if (view === 'map') focusAfter.set([`load-${slot}`, `slot-${slot}`, `head-remove-${slot}`])
      setChanges(count => count + 1)
    }} />}
  </>
}

/** Tells the page whether its header "Nạp hộp" should be hidden for what this view shows. */
function useReportLoadable(hidden: boolean, hideLoad: (hidden: boolean) => void) {
  useEffect(() => { hideLoad(hidden) }, [hidden, hideLoad])
}

// ---- map

function MapView({ canWrite, changes, focusAfter, load, hideLoad }: {
  canWrite: boolean; changes: number; focusAfter: FocusAfter; load: (prefill: LoadPrefill) => void; hideLoad: (hidden: boolean) => void
}) {
  const { params, update } = useQueryParams()
  const { machineId, slotId } = readMapQuery(params)
  const machines = useMachineOptions()
  const state = useApi(signal => machineId ? loadMachineMap(machineId, signal) : Promise.resolve(undefined), `${machineId}|${changes}`)
  // While another machine loads, the previous one's map (and its slots in the Ngăn filter) is not shown.
  const data = machineId && state.data?.machine.id === machineId ? state.data : undefined
  const [target, setTarget] = useState<RemoveTarget | null>(null)
  // After a load or a removal the button used may disappear with the new data: focus goes to the slot, not <body>.
  useEffect(() => {
    if (state.loading) return
    const keys = focusAfter.take()
    if (keys && focusLost(document)) keys.some(key => focusByKey(document, key))
  }, [state.loading, state.updatedAt, focusAfter])

  const forbidden = state.error instanceof ApiError && state.error.status === 403
  useReportLoadable(forbidden || (!!data && !data.slots.length), hideLoad)
  const slotOptions = (data?.slots ?? []).map(slot => ({ value: slot.id, label: `Ngăn ${slot.slotCode}` }))
  return <>
    {!forbidden && <FilterBar activeCount={slotId ? 1 : 0} onClear={() => update({ slotId: undefined })}>
      <SelectFilter label="Máy" value={machineId} empty="Chọn máy…" onChange={value => update({ machineId: value || undefined, slotId: undefined })} options={machines} />
      {machineId && <SelectFilter label="Ngăn" value={slotId} empty="Tất cả ngăn" onChange={value => update({ slotId: value || undefined })} options={slotOptions} />}
    </FilterBar>}
    {!machineId
      ? <MachinePicker choose={id => update({ machineId: id })} />
      : <MapBody state={state} data={data} slotId={slotId} canWrite={canWrite} remove={setTarget} load={load} showAll={() => update({ slotId: undefined })} />}
    {target && <RemoveSheet target={target} close={() => setTarget(null)} stale={state.reload} done={() => {
      const slot = target.item.slotId ?? ''
      focusAfter.set([`head-remove-${slot}`, `slot-${slot}`])
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

function MapBody({ state, data, slotId, canWrite, remove, load, showAll }: {
  state: { loading: boolean; refreshing: boolean; error?: unknown; updatedAt?: number; reload: () => void }
  data?: MachineMap; slotId: string; canWrite: boolean; remove: (target: RemoveTarget) => void; load: (prefill: LoadPrefill) => void; showAll: () => void
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
          {all.length ? <>{overviewText(overview)}{' · '}</> : null}Cập nhật {formatDateTime(new Date(data.asOf).toISOString())}
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
    {all.length > 0 && <Legend />}
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
          {columns.map(column => <li key={column.slot.id} className="flex min-w-0"><Column column={column} canWrite={canWrite} remove={remove} load={load} /></li>)}
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

/**
 * One slot: code, fill, whether it sells, then its boxes stacked bottom-up (the head at the bottom). "Nạp hộp" opens the
 * load Sheet for this slot when it can take boxes (slot ACTIVE, machine not INACTIVE, free places), with the batch of
 * the newest box suggested when it can still be loaded.
 */
function Column({ column, canWrite, remove, load }: { column: SlotColumn; canWrite: boolean; remove: (target: RemoveTarget) => void; load: (prefill: LoadPrefill) => void }) {
  const titleId = useId()
  const { slot, summary } = column
  const inactive = slot.status !== 'ACTIVE'
  const removable = canWrite && column.state.kind === 'blocked' && column.state.removable
  const loadable = canWrite && !inactive && column.machineStatus !== 'INACTIVE' && column.free > 0
  const newest = column.boxes[column.boxes.length - 1]
  const suggested = newest && !isExpiredBox(newest) ? newest.batchId : undefined
  return <section aria-labelledby={titleId} tabIndex={-1} data-focus-key={removable ? undefined : `slot-${slot.id}`} data-slot-column={slot.slotCode}
    className={cn('flex w-full flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/40', column.state.kind === 'blocked' && !inactive && 'border-destructive/50')}>
    <header className="grid gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-[15px] font-semibold"><span className="sr-only">Ngăn </span><span className="font-mono">{slot.slotCode}</span></h3>
        <span className="flex items-center gap-2">
          <span className="text-[13px] tabular-nums text-muted-foreground">{column.occupied}/{slot.capacity} hộp</span>
          {loadable && <Button type="button" size="sm" variant="outline" className="max-sm:h-11" data-focus-key={`load-${slot.id}`} aria-label={`Nạp hộp vào ngăn ${slot.slotCode}`}
            onClick={() => load({ machineId: slot.machineId, slotId: slot.id, batchId: suggested })}><ArrowDownToLine aria-hidden="true" />Nạp hộp</Button>}
        </span>
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
    <a href={slotHistoryPath(slot.machineId, slot.id)} onClick={linkHandler(slotHistoryPath(slot.machineId, slot.id))} aria-label={`Lịch sử ngăn ${slot.slotCode}`}
      className="inline-flex min-h-6 items-center self-start text-xs font-medium text-primary no-underline hover:underline max-sm:min-h-11">Lịch sử ngăn</a>
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
      <a href={boxHistoryPath(item.id)} onClick={linkHandler(boxHistoryPath(item.id))} aria-label={`Lịch sử hộp đáy ngăn ${column.slot.slotCode}`}
        className="inline-flex min-h-6 items-center justify-self-start text-xs font-medium text-primary no-underline hover:underline max-sm:min-h-11">Lịch sử hộp</a>
      {state.removable
        ? canWrite
          ? <Button type="button" size="sm" variant="destructive" className="justify-self-start max-sm:h-11" data-focus-key={`head-remove-${column.slot.id}`}
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

// ---- list (boxes with filters)

const LIST_EXPIRED_OPTIONS = [{ value: 'true', label: 'Đã quá hạn' }, { value: 'false', label: 'Chưa quá hạn' }]

/**
 * Boxes with server-side filters kept in the URL. Values GET /inventory would refuse (non-UUID ids, unknown status,
 * expiry flag or sort) are not sent; a note lists them and can drop them from the URL (rules: readListQuery).
 */
function ListView({ canWrite, changes, changed, load, hideLoad }: {
  canWrite: boolean; changes: number; changed: () => void; load: (prefill: LoadPrefill) => void; hideLoad: (hidden: boolean) => void
}) {
  const { params, update } = useQueryParams()
  const { query, ignored } = readListQuery(params)
  const { machineId, slotId, batchId, status, expired, sort } = query
  const page = pageParam(params)
  const machines = useMachineOptions(), slots = useSlotOptions(machineId), batches = useBatchOptions()
  const apiQuery = listApiQuery(query, page, PAGE_SIZE)
  const state = useApi(signal => inventoryApi.list(apiQuery, signal), `${JSON.stringify(apiQuery)}|${changes}`)
  const dialog = useDialog<InventoryItem>()
  const target = dialog.value
  const forbidden = state.error instanceof ApiError && state.error.status === 403
  useReportLoadable(forbidden, hideLoad)
  const filters = listFilterCount(query)
  const clearFilters = () => update(Object.fromEntries(LIST_FILTER_KEYS.map(key => [key, undefined])))

  const empty = filters
    ? <>Không có hộp nào khớp bộ lọc. <Button type="button" variant="link" className="h-auto p-0" onClick={clearFilters}>Xóa bộ lọc</Button> để xem tất cả hộp.</>
    : <>
      <span className="block">Chưa có hộp nào trong kho. Hộp xuất hiện ở đây sau khi được nạp vào ngăn của một máy.</span>
      <span className="mt-3 flex flex-wrap justify-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => update({ view: undefined })}>Mở sơ đồ ngăn</Button>
        {canWrite && <Button type="button" size="sm" onClick={() => load({})}><ArrowDownToLine aria-hidden="true" />Nạp hộp</Button>}
      </span>
    </>

  return <>
    {ignored.length > 0 && <div role="note" className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3.5 py-2.5 text-[13px] text-status-warning-foreground">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p>Đường dẫn có bộ lọc không dùng được nên đã bỏ qua; danh sách dưới đây không áp dụng các giá trị này:</p>
        <ul className="mt-1 list-disc pl-5">
          {ignored.map(item => <li key={item.key} className="wrap-anywhere">{LIST_PARAM_LABELS[item.key]} “{item.value.length > 40 ? `${item.value.slice(0, 40)}…` : item.value}”: {item.reason}.</li>)}
        </ul>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => update(Object.fromEntries(ignored.map(item => [item.key, undefined])))}>Bỏ khỏi đường dẫn</Button>
    </div>}
    {!forbidden && <FilterBar activeCount={filters} onClear={clearFilters}>
      <SelectFilter label="Máy" value={machineId} onChange={value => update({ machineId: value || undefined, slotId: undefined })} options={machines} />
      <SelectFilter label="Ngăn" value={slotId} onChange={value => update({ slotId: value || undefined })} options={slots} empty={machineId ? 'Tất cả ngăn' : 'Chọn máy trước'} />
      <SelectFilter label="Lô hàng" value={batchId} onChange={value => update({ batchId: value || undefined })} options={batches} />
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ status: value || undefined })} options={enumOptions('box', ITEM_STATUSES)} />
      <SelectFilter label="Hạn dùng" value={expired} onChange={value => update({ expired: value || undefined })} options={LIST_EXPIRED_OPTIONS} />
      <SelectFilter label="Sắp xếp" value={sort} onChange={value => update({ sort: value && value !== LIST_SORT.fallback ? value : undefined })} options={SORTS} empty="Mặc định" />
    </FilterBar>}
    {!forbidden && machineId && slotId && <SlotSummaryPanel machineId={machineId} slotId={slotId} refresh={changes} />}
    <DataTable state={state} rows={state.data?.content} rowKey={item => item.id ?? ''} caption="Danh sách hộp" empty={empty} columns={[
      { head: 'Sản phẩm', cell: item => item.productName },
      { head: 'Lô', cell: item => item.batchCode },
      { head: 'Ngăn', cell: item => item.slotCode },
      { head: 'Trạng thái', cell: item => <Badge domain="box" value={item.status} /> },
      { head: 'Hết hạn', cell: item => <>{formatDateTime(item.expiresAt)}{item.expired && <> <Badge value="expired" /></>}</> },
      { head: 'Nạp lúc', cell: item => formatDateTime(item.loadedAt) },
      { head: 'Thao tác', cell: item => <div className="flex flex-wrap items-center gap-1.5">
        <Button asChild size="sm" variant="ghost"><a href={boxHistoryPath(item.id)} onClick={linkHandler(boxHistoryPath(item.id))}
          aria-label={['Lịch sử hộp', item.productName, item.slotCode && `ngăn ${item.slotCode}`, item.batchCode && `lô ${item.batchCode}`].filter(Boolean).join(', ')}>Lịch sử</a></Button>
        {canWrite && <RowRemove item={item} open={() => dialog.open(item)} />}
      </div> },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
    {target && <RemoveSheet target={{ item: target, slotCode: target.slotCode }} close={dialog.close} done={changed} stale={changed} />}
  </>
}

/**
 * "Rút hộp" of one row: a box the API refuses to take out (held for an order, failed to dispense) keeps a locked button
 * with the reason shown beside it, as on the map; a box no longer in the slot (sold, taken out) has no button.
 */
function RowRemove({ item, open }: { item: InventoryItem; open: () => void }) {
  const reasonId = useId()
  const removal = listRemoveState(item)
  if (removal.kind === 'hidden') return null
  if (removal.kind === 'ok') return <Button type="button" size="sm" variant="outline" onClick={open}>Rút hộp</Button>
  return <span className="grid max-w-56 gap-1">
    <Button type="button" size="sm" variant="outline" className="cursor-not-allowed justify-self-start opacity-60 hover:bg-card"
      aria-disabled="true" aria-describedby={reasonId} onClick={event => event.preventDefault()}>Rút hộp</Button>
    <span id={reasonId} className="text-xs text-muted-foreground">{removal.reason}</span>
  </span>
}

function SlotSummaryPanel({ machineId, slotId, refresh }: { machineId: string; slotId: string; refresh: number }) {
  const summary = useApi(signal => slotsApi.summary(machineId, slotId, signal), `${machineId}|${slotId}|${refresh}`)
  const data = summary.data
  if (!data) return null
  const cells: [string, number | undefined][] = [['Sức chứa', data.capacity], ['Đang có', data.occupiedCount], ['Sẵn sàng', data.availableCount], ['Quá hạn', data.expiredCount], ['Giữ chỗ', data.reservedCount], ['Còn trống', data.remainingCapacity]]
  return <section className="a-stats" aria-label="Tóm tắt ngăn">{cells.map(([label, value]) => <div key={label}><strong>{value}</strong><small>{label}</small></div>)}</section>
}

// ---- load

/** Why a list the Sheet needs did not load, and how to retry; a 403 says what permission is missing instead. */
function SourceProblem({ error, what, retry }: { error: unknown; what: string; retry: () => void }) {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 403) return <p className="mt-1.5 text-xs text-destructive">Bạn không có quyền xem {what}, nên chưa nạp hộp được. Nhờ quản trị viên cấp quyền.</p>
  return <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-destructive">
    Không tải được {what}.
    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={retry}>Thử lại</Button>
  </p>
}

/**
 * Load N boxes into one slot. Before sending it shows the free places of the slot and how many boxes the batch can
 * still take, and refuses a count above either as it is typed; a backend refusal (409) is explained under the field it
 * concerns and the figures are read again. Sends only { batchId, slotId, quantity }.
 */
function LoadSheet({ prefill, close, done }: { prefill: LoadPrefill; close: () => void; done: (slotId: string) => void }) {
  const form = useForm<LoadValues>({ ...NEW_LOAD, machineId: prefill.machineId ?? '', slotId: prefill.machineId ? prefill.slotId ?? '' : '' })
  const { values, errors } = form
  // Reference time for "expired"; read again with the figures after a refusal, so a batch that just expired goes away.
  const [now, setNow] = useState(() => Date.now())
  // Bumped after a refusal: free places, batch count and lists are read again.
  const [refresh, setRefresh] = useState(0)
  // A 409 "does not fit": its text follows the figures read again after it (fitConflictText).
  const [conflict, setConflict] = useState<(FitConflict & { since: number }) | null>(null)
  // Until the batch picker is used, the column's suggestion stands in for it, only if that batch can still be loaded.
  const [batchTouched, setBatchTouched] = useState(false)
  const pickedBatchId = batchTouched ? values.batchId : prefill.batchId ?? ''
  const machines = useApi(signal => machinesApi.list({ page: 0, size: 100, sort: 'name,asc' }, signal), `load-machines|${refresh}`)
  const slots = useApi(signal => values.machineId ? slotsApi.list(values.machineId, { page: 0, size: 100, sort: 'slotCode,asc' }, signal) : Promise.resolve(undefined), `load-slots|${values.machineId}|${refresh}`)
  const batches = useApi(signal => loadLoadableBatches(now, signal), `load-batches|${refresh}`)
  const summary = useApi(signal => values.machineId && values.slotId ? slotsApi.summary(values.machineId, values.slotId, signal) : Promise.resolve(undefined),
    `load-summary|${values.machineId}|${values.slotId}|${refresh}`)
  const loaded = useApi(signal => pickedBatchId ? countLoaded([pickedBatchId], signal) : Promise.resolve(undefined), `load-count|${pickedBatchId}|${refresh}`)

  const machine = machines.data?.content.find(candidate => candidate.id === values.machineId)
  const slotList = slots.data?.content.filter(candidate => candidate.machineId === values.machineId)
  const slot = slotList?.find(candidate => candidate.id === values.slotId)
  const eligible = batches.data?.batches ?? []
  const pickedCount = pickedBatchId ? loaded.data?.[pickedBatchId] : undefined
  const pickedBatch = eligible.find(candidate => candidate.id === pickedBatchId)
  const suggestionFits = !!pickedBatch && !!pickedCount?.ok && (pickedBatch.quantity ?? 0) > pickedCount.loaded
  const batchId = batchTouched || suggestionFits ? pickedBatchId : ''
  const batch = batchId ? pickedBatch : undefined
  const batchCount = batchId ? pickedCount : undefined
  const slotSummary = summary.data && summary.data.slotId === values.slotId ? summary.data : undefined
  const room: LoadRoom = {
    slotCode: slot?.slotCode, free: slotSummary?.remainingCapacity, capacity: slotSummary?.capacity ?? slot?.capacity,
    batchCode: batch?.batchCode, declared: batch?.quantity, loaded: batchCount?.ok ? batchCount.loaded : undefined,
  }
  const selection = { machine, slot, batch, room, now }
  // A prefilled slot or batch that is not offered (expired, other machine) counts as not chosen: never sent.
  const chosen: LoadValues = { ...values, slotId: slot ? values.slotId : '', batchId: batch ? batchId : '' }
  const live = selectionProblems(selection)
  const lines = roomLines(room)
  const { max } = loadMax(room)
  const quantity = parseBoxCount(values.quantity)
  const source = conflict?.kind === 'slot' ? summary : loaded
  const reload: Reload = !conflict ? 'ok'
    : source.loading || (!source.error && !((source.updatedAt ?? 0) > conflict.since)) ? 'pending'
      : source.error || (conflict.kind === 'batch' && !batchCount?.ok) ? 'failed' : 'ok'
  const quantityError = errors.quantity
    ? (conflict ? fitConflictText(conflict, room, reload) : errors.quantity)
    : quantityProblem(values.quantity, room)
  const knowsRoom = room.free !== undefined || room.declared !== undefined && room.loaded !== undefined
  // Another machine, slot or batch: a refusal about the previous one no longer applies.
  const clearQuantityError = () => { setConflict(null); form.setErrors(previous => (previous.quantity ? { ...previous, quantity: '' } : previous)) }
  const listNote = (shown: number, total: number | undefined, what: string) => total !== undefined && total > shown
    ? <p className="mt-1.5 text-xs text-muted-foreground">Chỉ hiện {shown} {what} đầu tiên; nếu không thấy, hãy mở từ sơ đồ của đúng máy.</p> : null

  const setQuantity = (next: number) => form.set('quantity')(String(Math.max(1, Math.min(next, Math.max(max, 1)))))
  const big = 'max-sm:h-11 max-sm:text-base'
  // Pickers stay enabled while their list loads (so the prefilled step can take focus at once); they say "Đang tải…".

  return <FormSheet title="Nạp hộp vào ngăn" submitLabel="Nạp hộp" close={close} onFieldErrors={form.setErrors}
    successMessage={quantity ? `Đã nạp ${quantity} hộp` : 'Đã nạp hộp'} successDescription={slot ? `Ngăn ${slot.slotCode}${machine ? ` · ${machine.name}` : ''}` : null}
    description="Xếp hộp vào ngăn trước, rồi ghi nhận số hộp đã xếp. Hộp nạp sau nằm phía trên, được bán sau các hộp đang có."
    onSubmit={async () => {
      setConflict(null)
      const problems = validateLoad(chosen, selection)
      if (Object.keys(problems).length) form.fail(problems)
      const body = loadBody(chosen)
      try { await inventoryApi.load(body) } catch (error) {
        const described = describeLoadError(error, body.quantity, room)
        const at = clock()
        if (described.refresh) { setRefresh(value => value + 1); setNow(at) }
        if (described.conflict) setConflict({ ...described.conflict, since: at })
        throw described.error
      }
      done(body.slotId)
    }}>
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <div className="mb-4">
        <FormField label="Máy" required error={errors.machineId || live.machineId}>
          <NativeSelect value={values.machineId} className={big} autoFocus={!prefill.machineId}
            onChange={event => { form.set('machineId')(event.target.value); form.set('slotId')(''); clearQuantityError() }}>
            <option value="">{machines.data ? 'Chọn máy…' : machines.error ? 'Không tải được danh sách máy' : 'Đang tải máy…'}</option>
            {machines.data?.content.map(option => <option key={option.id} value={option.id}>{option.name} ({option.code}){option.status === 'INACTIVE' ? ' · Ngừng hoạt động' : ''}</option>)}
          </NativeSelect>
        </FormField>
        {machines.error && <SourceProblem error={machines.error} what="danh sách máy" retry={machines.reload} />}
        {machines.data && listNote(machines.data.content.length, machines.data.totalElements, 'máy')}
      </div>
      <div className="mb-4">
        <FormField label="Ngăn" required error={errors.slotId || live.slotId} hint={values.machineId ? undefined : 'Chọn máy trước.'}>
          <NativeSelect value={chosen.slotId} className={big} autoFocus={!!prefill.machineId && !prefill.slotId} disabled={!values.machineId}
            onChange={event => { form.set('slotId')(event.target.value); clearQuantityError() }}>
            <option value="">{!values.machineId || slotList ? 'Chọn ngăn…' : slots.error ? 'Không tải được ngăn' : 'Đang tải ngăn…'}</option>
            {slotList?.map(option => <option key={option.id} value={option.id}>Ngăn {option.slotCode} · sức chứa {option.capacity}{option.status !== 'ACTIVE' ? ` · ${statusMeta('slot', option.status).label}` : ''}</option>)}
          </NativeSelect>
        </FormField>
        {slots.error && <SourceProblem error={slots.error} what="ngăn của máy" retry={slots.reload} />}
        {slots.data && listNote(slots.data.content.length, slots.data.totalElements, 'ngăn')}
        {slotList && !slotList.length && <p className="mt-1.5 text-xs text-muted-foreground">Máy chưa có ngăn nào. Quản trị viên thêm ngăn ở mục Máy bán hàng.</p>}
      </div>
    </div>
    <div className="mb-4">
      <FormField label="Lô hàng" required error={errors.batchId || live.batchId}
        hint={batch ? `${batch.productName} · HSD ${formatDateTime(batch.expiresAt)}` : 'Lô sắp hết hạn đứng đầu danh sách, nên nạp trước.'}>
        <NativeSelect value={chosen.batchId} className={big} autoFocus={!!prefill.slotId && !!prefill.machineId}
          onChange={event => { setBatchTouched(true); form.set('batchId')(event.target.value); clearQuantityError() }}>
          <option value="">{batches.data ? 'Chọn lô…' : batches.error ? 'Không tải được danh sách lô' : 'Đang tải lô…'}</option>
          {eligible.map(option => <option key={option.id} value={option.id}>{option.batchCode} · {option.productName} · HSD {formatDateTime(option.expiresAt)}</option>)}
        </NativeSelect>
      </FormField>
      {batches.error && <SourceProblem error={batches.error} what="danh sách lô" retry={batches.reload} />}
      {batches.data?.truncated && <p className="mt-1.5 text-xs text-muted-foreground">Chỉ hiện {eligible.length} lô còn hạn sớm hết hạn nhất; lô hết hạn muộn hơn chưa có trong danh sách.</p>}
      {batches.data && !eligible.length && <p className="mt-1.5 text-xs text-muted-foreground">
        Chưa có lô nào còn hạn để nạp. <Link to="/admin/batches" className="font-medium text-primary underline underline-offset-4">Tạo lô hàng</Link> trước rồi quay lại.
      </p>}
    </div>

    <div role="status" aria-live="polite" className="mb-4 grid gap-1 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">
      {!chosen.slotId && !batchId
        ? <span className="text-muted-foreground">Chọn ngăn và lô để biết còn nạp được bao nhiêu hộp.</span>
        : <>
          {chosen.slotId && (lines.slot
            ? <span>{lines.slot}</span>
            : <span className="text-muted-foreground">{summary.error ? 'Chưa biết số chỗ trống của ngăn; máy chủ vẫn kiểm tra khi nạp.' : 'Đang đọc số chỗ trống của ngăn…'}</span>)}
          {batch && (lines.batch
            ? <span>{lines.batch}</span>
            : <span className="text-muted-foreground">{batchCount && !batchCount.ok || loaded.error ? 'Chưa đếm được số hộp đã nạp từ lô; máy chủ vẫn kiểm tra khi nạp.' : 'Đang đếm số hộp đã nạp từ lô…'}</span>)}
          {lines.max && <strong className="font-semibold">{lines.max}</strong>}
        </>}
    </div>

    <FormField label="Số hộp đã xếp vào ngăn" required error={quantityError}
      hint={quantityHint(room)} className="mb-2">
      <Input value={values.quantity} inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" autoComplete="off" className={cn(big, 'tabular-nums')}
        onChange={event => form.set('quantity')(event.target.value)} />
    </FormField>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="icon" className="max-sm:size-11" aria-label="Bớt 1 hộp" disabled={!quantity || quantity <= 1}
        onClick={() => setQuantity((quantity ?? 1) - 1)}><Minus aria-hidden="true" /></Button>
      <Button type="button" variant="outline" size="icon" className="max-sm:size-11" aria-label="Thêm 1 hộp" disabled={knowsRoom && (quantity ?? 0) >= max}
        onClick={() => setQuantity((quantity ?? 0) + 1)}><Plus aria-hidden="true" /></Button>
      {knowsRoom && max > 0 && <Button type="button" variant="outline" className="max-sm:h-11" onClick={() => setQuantity(max)}>Tối đa {max} hộp</Button>}
    </div>
  </FormSheet>
}

// ---- remove

/**
 * Take one box out (only after it is physically out of the machine). The reason is required (1–500 characters, sent
 * trimmed as { reason }); common reasons fill it in one tap and can still be edited. 409/404: the box changed, the
 * caller reloads (`stale`) and the Sheet says so.
 */
function RemoveSheet({ target, close, done, stale }: { target: RemoveTarget; close: () => void; done: () => void; stale: () => void }) {
  const { item } = target
  const form = useForm({ reason: '' })
  const reason = form.values.reason
  const slotCode = target.slotCode ?? item.slotCode ?? '—'
  const status = boxStatusText(item)
  const quickId = useId()
  return <FormSheet title="Rút hộp khỏi ngăn" submitLabel="Rút hộp" danger close={close} onFieldErrors={form.setErrors}
    successMessage="Đã rút hộp" successDescription={`Ngăn ${slotCode} · ${item.productName ?? ''}`.trim()}
    description="Chỉ xác nhận sau khi đã lấy hộp ra khỏi máy. Hộp chuyển sang Đã rút và lý do được ghi vào lịch sử."
    onSubmit={async () => {
      const problem = reasonProblem(reason)
      if (problem) form.fail({ reason: problem })
      try { await inventoryApi.remove(item.id ?? '', removeBody(reason).reason) } catch (error) {
        const described = describeRemoveFailure(error)
        if (described.stale) stale()
        throw described.error
      }
      done()
    }}>
    <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">
      <dt className="text-muted-foreground">Ngăn</dt><dd><span className="font-mono font-medium">{slotCode}</span>{target.head ? ' · hộp đáy' : ''}</dd>
      <dt className="text-muted-foreground">Sản phẩm</dt><dd>{item.productName}</dd>
      <dt className="text-muted-foreground">Lô</dt><dd className="font-mono break-all">{item.batchCode}</dd>
      <dt className="text-muted-foreground">Hạn dùng</dt><dd>{formatDateTime(item.expiresAt)}{status && <> · <span className="font-medium text-destructive">{status}</span></>}</dd>
    </dl>
    <p id={quickId} className="mb-1.5 text-[13px] font-medium">Lý do thường gặp</p>
    <div role="group" aria-labelledby={quickId} className="mb-3 flex flex-wrap gap-2">
      {QUICK_REASONS.map(text => <Button key={text} type="button" variant="outline" size="sm" className="max-sm:h-11" aria-pressed={reason.trim() === text}
        onClick={() => form.set('reason')(text)}>{text}</Button>)}
    </div>
    <FormField label="Lý do rút hộp" required error={form.errors.reason} hint={`Chọn lý do ở trên hoặc tự nhập. ${reason.trim().length}/${REASON_MAX} ký tự.`} className="mb-2">
      <Textarea value={reason} maxLength={REASON_MAX} className="max-sm:text-base" onChange={event => form.set('reason')(event.target.value)} />
    </FormField>
  </FormSheet>
}

export default InventoryPage
