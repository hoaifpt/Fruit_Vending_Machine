// C3 Chi tiết máy: three tabs kept in the URL (`?tab=overview|slots|kiosk`).
// - Tổng quan: whether the kiosk sells and why, what it still needs (active slots, a kiosk key) before switching the
//   machine to ACTIVE, status changes with a confirmation, configuration (edited in a Sheet).
// - Ngăn: slots with server paging/sort/status filter in the URL; add a slot, change its capacity or status.
// - Khóa kiosk (ADMIN, KIOSK_CREDENTIAL_MANAGE): key history by prefix; issue a key (shown once, with a copy button, and
//   never stored anywhere), revoke with a confirmation.
// No delete anywhere. STAFF (MACHINE_READ) sees the overview and the slots, read only.
import { useEffect, useId, useRef, useState } from 'react'
import { CircleCheck, CircleDashed, CircleX, Copy, KeyRound, Pencil, Plus, Power, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '../../api/client.ts'
import { kioskCredentialsApi, machinesApi, slotsApi } from '../../api/resources.ts'
import type { KioskCredential, Machine, Slot } from '../../api/resources.ts'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '../../components/ui/alert-dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, Textarea } from '../../components/ui/input.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { navigate, useQueryParams } from '../../lib/router.ts'
import { statusMeta } from '../../lib/status.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import { ConfirmDialog, DataTable, ErrorState, FormSheet, Link, Loading, PAGE_SIZE, PageHead, Pagination, SelectFilter, enumOptions, useDialog, useForm } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useApi, errorMessage } from '../useApi.ts'
import { useSession } from '../useSession.ts'
import { focusByKey, focusLost, useReturnFocus } from '../return-focus.ts'
import { lastContact, saleState } from '../machines.ts'
import type { MachineStatus } from '../machines.ts'
import {
  MACHINE_STATUS_ACTIONS, SLOT_FILTER_KEYS, SLOT_LIMITS, SLOT_SORT, SLOT_STATUSES, SLOT_STATUS_HELP, TAB_LABELS, createSlotBody,
  KEY_NOT_RETURNED, describeKeyError, describeSlotError, describeSlotStatusError, describeStatusError, hasActiveKey, issuedKey, issuePrompt, maskedKey, missingForSale,
  readDetailTab, readSlotFilters, readiness, slotListQuery, statusTargets, tabSearch, updateSlotBody, validateSlot, visibleTabs,
} from '../machine-detail.ts'
import type { DetailTab, ReadinessItem, SlotStatus, SlotValues } from '../machine-detail.ts'
import { MachineSheet } from './MachinesPage.tsx'

const BACK = { to: '/admin/machines', label: 'Danh sách máy' }
const PANEL = 'mb-5 min-w-0 rounded-xl border bg-card p-5 shadow-xs max-[680px]:p-4'
const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })

function MachineDetailPage({ machineId }: { machineId: string }) {
  const { can } = useSession()
  const canWrite = can('MACHINE_WRITE'), canKeys = can('KIOSK_CREDENTIAL_MANAGE'), canInventory = can('INVENTORY_READ')
  const { pathname, params, update } = useQueryParams()
  const tab = readDetailTab(params, canKeys)
  const rawTab = params.get('tab')
  const machine = useApi(signal => machinesApi.get(machineId, signal), machineId)
  const [editing, setEditing] = useState(false)
  const tabsRef = useRef<HTMLDivElement>(null)
  // A checklist button that opens another tab names the control to land on there (its data-focus-key).
  const jumpTarget = useRef<string | null>(null)
  const [jumps, setJumps] = useState(0)
  const data = machine.data

  // `?tab=` that this person may not open (STAFF on kiosk) or that does not exist: the URL follows the tab shown.
  useEffect(() => {
    if (rawTab !== null && rawTab !== (tab === 'overview' ? null : tab)) update({ tab: tab === 'overview' ? undefined : tab })
  }, [rawTab, tab, update])

  // After a jump the old panel is unmounted, so focus would fall to <body>: put it on the selected tab right away, then
  // on the target control once its panel has rendered it (it may wait for a list to load), unless the person moved on.
  useEffect(() => {
    const key = jumpTarget.current
    if (!key || !jumps) return
    const trigger = () => tabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null
    if (focusByKey(document, key)) { jumpTarget.current = null; return }
    trigger()?.focus()
    let frames = 0
    let frame = 0
    const tick = () => {
      const selected = trigger()
      if (!jumpTarget.current || (selected && document.activeElement !== selected && !focusLost(document))) { jumpTarget.current = null; return }
      if (focusByKey(document, key) || ++frames > 240) { jumpTarget.current = null; return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [jumps, tab])

  if (machine.error && !data) {
    const status = machine.error instanceof ApiError ? machine.error.status : undefined
    // 404, or 400 for an id that is not a UUID: the address points at no machine.
    if (status === 404 || status === 400) return <>
      <PageHead title="Không tìm thấy máy" back={BACK} />
      <div role="alert" className="px-4 py-10 text-center text-muted-foreground">
        <p>Máy này không tồn tại hoặc đường dẫn đã sai. Mở lại máy từ danh sách.</p>
        <p className="mt-3!"><Button asChild variant="outline" size="sm"><Link to={BACK.to}>Về danh sách máy</Link></Button></p>
      </div>
    </>
    return <><PageHead title="Máy bán hàng" back={BACK} /><ErrorState error={machine.error} retry={machine.reload} /></>
  }
  if (!data) return <><PageHead title="Máy bán hàng" back={BACK} /><Loading label="Đang tải thông tin máy…" rows={6} /></>

  const openTab = (next: DetailTab) => navigate(`${pathname}${tabSearch(next)}`, { replace: true })
  const jumpTo = (next: DetailTab, focusKey: string) => { jumpTarget.current = focusKey; setJumps(count => count + 1); openTab(next) }
  return <>
    <PageHead title={data.name} back={BACK}
      subtitle={`Mã ${data.code} · ${data.location || 'Chưa có vị trí'}.${canWrite ? '' : ' Bạn chỉ xem; thêm ngăn, cấp khóa và đổi trạng thái do Quản trị viên thực hiện.'}`}
      actions={canWrite ? <Button type="button" variant="outline" data-focus-key="machine-edit" onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Sửa cấu hình</Button> : undefined} />
    <Tabs ref={tabsRef} value={tab} onValueChange={value => openTab(value as DetailTab)}>
      <TabsList aria-label="Thông tin máy">
        {visibleTabs(canKeys).map(name => <TabsTrigger key={name} value={name}>{TAB_LABELS[name]}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="overview"><Overview machine={data} canWrite={canWrite} canKeys={canKeys} canInventory={canInventory} reload={machine.reload} jumpTo={jumpTo} /></TabsContent>
      <TabsContent value="slots"><SlotsTab machine={data} canWrite={canWrite} canKeys={canKeys} canInventory={canInventory} jumpTo={jumpTo} /></TabsContent>
      {canKeys && <TabsContent value="kiosk"><KioskTab machine={data} /></TabsContent>}
    </Tabs>
    {editing && <MachineSheet machine={data} close={() => setEditing(false)} done={machine.reload} />}
  </>
}

// ---- Tổng quan

type JumpTo = (tab: DetailTab, focusKey: string) => void
/** Control each readiness item leads to in its tab. */
const READINESS_FOCUS: Record<ReadinessItem['key'], string> = { slots: 'slot-create', key: 'key-issue' }

/** Retry of a failed readiness check; none for 401 (on its way to login) or 403 (retrying will not help). */
function retryOf(state: { error?: unknown; reload: () => void }): (() => void) | undefined {
  if (!state.error) return undefined
  const status = state.error instanceof ApiError ? state.error.status : undefined
  return status === 401 || status === 403 ? undefined : state.reload
}

function Overview({ machine, canWrite, canKeys, canInventory, reload, jumpTo }: {
  machine: Machine; canWrite: boolean; canKeys: boolean; canInventory: boolean; reload: () => void; jumpTo: JumpTo
}) {
  const slots = useApi(signal => slotsApi.list(machine.id, { page: 0, size: 1, status: 'ACTIVE' }, signal), `${machine.id}|active-slots`)
  const keys = useApi(signal => (canKeys ? kioskCredentialsApi.list(machine.id, signal) : Promise.resolve(undefined)), `${machine.id}|keys|${canKeys}`)
  const [target, setTarget] = useState<MachineStatus | null>(null)
  const items = readiness({ activeSlots: slots.data?.totalElements, activeKey: hasActiveKey(keys.data), canSeeKeys: canKeys })
  const missing = missingForSale(items)
  const sale = saleState(machine, canWrite)
  const range = (min: number, max: number, unit: string) => `${number.format(min)} – ${number.format(max)} ${unit}`
  const retries: Record<ReadinessItem['key'], (() => void) | undefined> = { slots: retryOf(slots), key: retryOf(keys) }
  // After a status change the button that was used disappears with the reload (e.g. "Bật bán" once ACTIVE): focus would
  // fall to <body>, so it goes to the first remaining status button, else the sale heading.
  const statusChanged = useRef(false)
  const saleTitle = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!statusChanged.current) return
    statusChanged.current = false
    const frame = requestAnimationFrame(() => {
      if (!focusLost(document) && document.activeElement !== document.getElementById('admin-main')) return
      const next = statusTargets(machine.status).find(status => focusByKey(document, `machine-status-${status}`))
      if (!next) saleTitle.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [machine.status])

  return <>
    <section className={PANEL} aria-labelledby="sale-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <h2 id="sale-title" ref={saleTitle} tabIndex={-1} className="text-base font-semibold focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">Bán hàng</h2>
          <StatusBadge domain="machine" value={machine.status} describe={false} />
          <p className={cn('text-sm', sale.selling ? 'text-muted-foreground' : 'font-medium')}>{sale.summary}</p>
          {/* The list's "next step" points here; on this page ADMIN has the checklist and buttons, STAFF gets who to ask. */}
          {!canWrite && sale.next && <p className="text-[13px] text-muted-foreground">{sale.next}</p>}
        </div>
        {canWrite && <div className="flex flex-wrap gap-2">
          {statusTargets(machine.status).map(status => <Button key={status} type="button" variant={status === 'ACTIVE' ? 'default' : 'outline'}
            data-focus-key={`machine-status-${status}`} onClick={() => setTarget(status)}>
            {status === 'ACTIVE' && <Power aria-hidden="true" />}{MACHINE_STATUS_ACTIONS[status].label}
          </Button>)}
        </div>}
      </div>
      <h3 className="mb-2 text-sm font-medium">Kiosk cần gì để bán</h3>
      <ul className="grid gap-2" aria-label="Điều kiện bán hàng">
        {items.map(item => <ReadinessRow key={item.key} item={item} canWrite={canWrite} retry={retries[item.key]} jumpTo={jumpTo} />)}
      </ul>
      {machine.status !== 'ACTIVE' && canWrite && missing.length > 0 && <p className="mt-3! rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3.5 py-2.5 text-[13px] text-status-warning-foreground">
        Còn thiếu: {missing.map(item => item.label.toLowerCase()).join(', ')}. Máy chủ vẫn cho bật Hoạt động ngay, nhưng kiosk chưa bán được cho tới khi đủ.
      </p>}
      <p className="mt-3! text-[13px] text-muted-foreground">
        Sau khi có ngăn, nạp hộp vào ngăn{canInventory ? <> ở <Link to={`/admin/inventory?machineId=${machine.id}`}>Tồn kho</Link></> : ' ở màn Tồn kho'} để kiosk có hàng bán.
      </p>
    </section>

    <section className={PANEL} aria-labelledby="config-title">
      <h2 id="config-title" className="mb-3 text-base font-semibold">Cấu hình</h2>
      <dl className="grid grid-cols-[minmax(120px,220px)_1fr] gap-x-4 gap-y-2.5 text-sm max-[680px]:grid-cols-1 max-[680px]:gap-y-1 [&_dd]:min-w-0 [&_dd]:break-words max-[680px]:[&_dd]:mb-2 [&_dt]:text-[13px] [&_dt]:text-muted-foreground">
        <dt>Mã máy</dt><dd className="font-mono">{machine.code}</dd>
        <dt>Vị trí</dt><dd>{machine.location || 'Chưa có vị trí'}</dd>
        <dt>Nhiệt độ cho phép</dt><dd>{range(machine.minTemperature, machine.maxTemperature, '°C')}</dd>
        <dt>Độ ẩm cho phép</dt><dd>{range(machine.minHumidity, machine.maxHumidity, '%')}</dd>
        <dt>Liên lạc gần nhất</dt><dd>{lastContact(machine)} <span className="text-[13px] text-muted-foreground">(không ảnh hưởng việc bán)</span></dd>
        <dt>Đăng ký lúc</dt><dd>{formatDateTime(machine.createdAt)}</dd>
        <dt>Cập nhật lúc</dt><dd>{formatDateTime(machine.updatedAt)}</dd>
      </dl>
    </section>

    {target && <MachineStatusConfirm machine={machine} target={target} missing={target === 'ACTIVE' ? missing : []} close={() => setTarget(null)}
      done={() => { statusChanged.current = true; reload() }} />}
  </>
}

function ReadinessRow({ item, canWrite, retry, jumpTo }: { item: ReadinessItem; canWrite: boolean; retry?: () => void; jumpTo: JumpTo }) {
  const Icon = item.done === true ? CircleCheck : item.done === false ? CircleX : CircleDashed
  const state = item.done === true ? 'Đã có' : item.done === false ? 'Còn thiếu' : 'Chưa rõ'
  const action = item.key === 'slots' ? 'Thêm ngăn' : 'Cấp khóa'
  return <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5">
    <Icon aria-hidden="true" className={cn('size-5 shrink-0', item.done === true ? 'text-status-success-foreground' : item.done === false ? 'text-destructive' : 'text-muted-foreground')} />
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="text-sm font-medium">{item.label}: <span className={item.done === false ? 'text-destructive' : undefined}>{state}</span></span>
      <span className="text-[13px] text-muted-foreground">{item.detail}</span>
    </span>
    {canWrite && item.done === false && <Button type="button" size="sm" variant="outline" onClick={() => jumpTo(item.tab, READINESS_FOCUS[item.key])}>{action}</Button>}
    {item.done === undefined && retry && <Button type="button" size="sm" variant="outline" aria-label={`Thử lại: ${item.label.toLowerCase()}`} onClick={retry}>Thử lại</Button>}
  </li>
}

/**
 * PATCH /machines/{id}/status after a confirmation. Switching to ACTIVE lists what the kiosk still lacks; the server
 * does not require it, so the person may go ahead. A 404/409 refreshes the page data behind the dialog.
 */
function MachineStatusConfirm({ machine, target, missing, close, done }: { machine: Machine; target: MachineStatus; missing: ReadinessItem[]; close: () => void; done: () => void }) {
  const action = MACHINE_STATUS_ACTIONS[target]
  return <ConfirmDialog title={`${action.title} ${machine.code}?`} confirmLabel={action.confirm} danger={target !== 'ACTIVE'} close={close}
    successDescription={`Máy ${machine.code} đã chuyển sang ${statusMeta('machine', target).label}.`}
    message={<div className="grid gap-2">
      <p>{action.explain}</p>
      <p>Trạng thái hiện tại: <strong className="font-medium text-foreground">{statusMeta('machine', machine.status).label}</strong>.</p>
      {missing.length > 0 && <div className="rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3 py-2 text-status-warning-foreground">
        <p className="font-medium">Kiosk chưa bán được ngay vì còn thiếu:</p>
        <ul className="mt-1 list-disc pl-5">{missing.map(item => <li key={item.key}>{item.detail}</li>)}</ul>
        <p className="mt-1">Bạn vẫn có thể bật bây giờ và bổ sung sau.</p>
      </div>}
    </div>}
    onConfirm={async () => {
      try { await machinesApi.setStatus(machine.id, target) } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 409)) done()
        throw describeStatusError(error)
      }
      done()
    }} />
}

// ---- Ngăn

type SlotTarget = { kind: 'create' } | { kind: 'capacity'; slot: Slot } | { kind: 'status'; slot: Slot }

function SlotsTab({ machine, canWrite, canKeys, canInventory, jumpTo }: { machine: Machine; canWrite: boolean; canKeys: boolean; canInventory: boolean; jumpTo: JumpTo }) {
  const machineId = machine.id
  const { params, update } = useQueryParams()
  const filters = readSlotFilters(params)
  const query = slotListQuery(filters, PAGE_SIZE)
  const state = useApi(signal => slotsApi.list(machineId, query, signal), `${machineId}|${query.status}|${query.sort}|${query.page}`)
  const dialog = useDialog<SlotTarget>()
  const target = dialog.value
  const data = state.data
  const filterCount = activeFilterCount([filters.status])
  const forbidden = state.error instanceof ApiError && state.error.status === 403
  const pastEnd = !!data && data.content.length === 0 && data.totalElements > 0
  const clearFilters = () => update(clearFiltersPatch(SLOT_FILTER_KEYS))

  const columns: Column<Slot>[] = [
    { head: 'Mã ngăn', sortKey: 'slotCode', nowrap: true, cell: slot => <span className="font-mono text-[13px] font-medium">{slot.slotCode}</span> },
    { head: 'Sức chứa', sortKey: 'capacity', nowrap: true, cell: slot => <span className="tabular-nums">{slot.capacity} hộp</span> },
    // The inventory summary is an inventory endpoint (INVENTORY_READ), not a machine one.
    ...(canInventory ? [{ head: 'Tồn kho', cell: (slot: Slot) => <SlotSummary machineId={machineId} slot={slot} /> }] : []),
    { head: 'Trạng thái', sortKey: 'status', cell: slot => <StatusBadge domain="slot" value={slot.status} /> },
    { head: 'Cập nhật', secondary: true, nowrap: true, cell: slot => formatDateTime(slot.updatedAt) },
    ...(canWrite || canInventory ? [{ head: 'Thao tác', cell: (slot: Slot) => <div className="flex flex-wrap justify-end gap-1.5 @min-[681px]:justify-start">
      {canWrite && <>
        <Button type="button" size="sm" variant="outline" data-focus-key={`slot-capacity-${slot.id}`} aria-label={`Sửa sức chứa ngăn ${slot.slotCode}`} onClick={() => dialog.open({ kind: 'capacity', slot })}><Pencil aria-hidden="true" />Sức chứa</Button>
        <Button type="button" size="sm" variant="outline" data-focus-key={`slot-status-${slot.id}`} aria-label={`Đổi trạng thái ngăn ${slot.slotCode}`} onClick={() => dialog.open({ kind: 'status', slot })}>Đổi trạng thái</Button>
      </>}
      {canInventory && <Button asChild size="sm" variant="ghost"><Link to={`/admin/inventory?machineId=${machineId}&slotId=${slot.id}`}>Xem hộp</Link></Button>}
    </div> }] : []),
  ]

  const empty = pastEnd
    ? <>Trang này không còn ngăn nào. <Button type="button" variant="link" className="h-auto p-0" onClick={() => update({ page: undefined })}>Về trang đầu</Button></>
    : filterCount
      ? <>Không có ngăn nào ở trạng thái này. <Button type="button" variant="link" className="h-auto p-0" onClick={clearFilters}>Xóa bộ lọc</Button></>
      : canWrite
        ? <>Máy chưa có ngăn nào. Bấm “Thêm ngăn” để khai báo vị trí chứa hộp, ví dụ A1, A2.</>
        : 'Máy chưa có ngăn nào. Quản trị viên sẽ thêm ngăn.'

  return <section aria-labelledby="slots-title">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="slots-title" className="text-base font-semibold">Ngăn của máy</h2>
        <p className="mt-1! max-w-[70ch] text-[13px] text-muted-foreground">Mỗi ngăn là một vị trí chứa hộp; sức chứa là số hộp tối đa, không phải tồn kho. Mã ngăn cố định sau khi tạo; không xóa ngăn, chuyển Ngừng hoạt động khi không dùng.</p>
      </div>
      {canWrite && !forbidden && <Button type="button" data-focus-key="slot-create" onClick={() => dialog.open({ kind: 'create' })}><Plus aria-hidden="true" />Thêm ngăn</Button>}
    </div>
    {!forbidden && <FilterBar activeCount={filterCount} onClear={clearFilters}>
      <SelectFilter label="Trạng thái ngăn" value={filters.status} onChange={value => update({ slotStatus: value || undefined })} options={enumOptions('slot')} />
    </FilterBar>}
    {/* The machine has slots but does not sell yet: say what comes next, with a way there. */}
    {canWrite && machine.status !== 'ACTIVE' && !!data?.totalElements && <div role="note" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/25 bg-primary/8 px-3.5 py-2.5 text-[13px]">
      <p className="min-w-0 flex-1">Máy đã có ngăn nhưng chưa bán. Tiếp theo: {canKeys ? 'kiểm tra khóa kiosk (cấp nếu chưa có), rồi ' : ''}bật bán ở Tổng quan để kiosk nhận đơn.</p>
      <span className="flex flex-wrap gap-2">
        {canKeys && <Button type="button" size="sm" variant="outline" onClick={() => jumpTo('kiosk', 'key-issue')}>Mở Khóa kiosk</Button>}
        <Button type="button" size="sm" variant="outline" onClick={() => jumpTo('overview', 'machine-status-ACTIVE')}>Mở Tổng quan</Button>
      </span>
    </div>}
    <DataTable state={state} rows={data?.content} rowKey={slot => slot.id} columns={columns} caption="Danh sách ngăn" empty={empty}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, SLOT_SORT) })} />
    {data && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} onPage={next => update({ page: next ? String(next) : undefined })} />}
    {target?.kind === 'create' && <SlotSheet machineId={machineId} close={dialog.close} done={state.reload} />}
    {target?.kind === 'capacity' && <SlotSheet machineId={machineId} slot={target.slot} close={dialog.close} done={state.reload} />}
    {target?.kind === 'status' && <SlotStatusSheet machineId={machineId} slot={target.slot} close={dialog.close} done={state.reload} />}
  </section>
}

function SlotSummary({ machineId, slot }: { machineId: string; slot: Slot }) {
  const summary = useApi(signal => slotsApi.summary(machineId, slot.id, signal), `${machineId}|${slot.id}|${slot.updatedAt}`)
  if (summary.error) return <span className="text-[13px] text-muted-foreground">Không tải được tồn kho</span>
  const data = summary.data
  if (!data) return <span className="text-[13px] text-muted-foreground">Đang tải…</span>
  return <span className="grid gap-0.5 text-[13px]">
    <span className="tabular-nums">{data.occupiedCount ?? 0}/{data.capacity ?? slot.capacity} hộp</span>
    <span className="text-muted-foreground">bán được {data.sellableCount ?? 0}{data.expiredCount ? ` · hết hạn ${data.expiredCount}` : ''}{data.reservedCount ? ` · giữ chỗ ${data.reservedCount}` : ''}</span>
  </span>
}

/** Add a slot (code + capacity, starts ACTIVE) or change the capacity of one (the code is fixed). */
function SlotSheet({ machineId, slot, close, done }: { machineId: string; slot?: Slot; close: () => void; done: () => void }) {
  const editing = !!slot
  const form = useForm<SlotValues>({ slotCode: slot?.slotCode ?? '', capacity: slot ? String(slot.capacity) : '' })
  const { values, errors } = form
  return <FormSheet title={editing ? `Sức chứa ngăn ${slot.slotCode}` : 'Thêm ngăn'} submitLabel={editing ? 'Lưu sức chứa' : 'Thêm ngăn'}
    successMessage={editing ? 'Đã lưu sức chứa' : 'Đã thêm ngăn'} close={close} onFieldErrors={form.setErrors}
    successDescription={`Ngăn ${editing ? slot.slotCode : values.slotCode.trim().toUpperCase()}: sức chứa ${values.capacity.trim()} hộp.`}
    description={editing
      ? 'Sức chứa là số hộp tối đa ngăn chứa được. Hộp đang có trong ngăn không bị thay đổi.'
      : 'Ngăn mới ở trạng thái Hoạt động. Mã ngăn không đổi được sau khi tạo.'}
    onSubmit={async () => {
      const mode = editing ? 'edit' : 'create'
      const problems = validateSlot(values, mode)
      if (Object.keys(problems).length) form.fail(problems)
      try {
        if (slot) await slotsApi.update(machineId, slot.id, updateSlotBody(values))
        else await slotsApi.create(machineId, createSlotBody(values))
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) done()
        throw describeSlotError(error, mode)
      }
      done()
    }}>
    {editing
      ? <FormField label="Mã ngăn" hint="Mã ngăn cố định để tồn kho và đơn hàng luôn trỏ đúng vị trí." className="mb-4"><Input value={slot.slotCode} readOnly className="font-mono" /></FormField>
      : <FormField label="Mã ngăn" required error={errors.slotCode} hint={`Duy nhất trong máy này, tự chuyển thành chữ in hoa, ví dụ A1. Tối đa ${SLOT_LIMITS.slotCode} ký tự.`} className="mb-4">
        <Input value={values.slotCode} maxLength={SLOT_LIMITS.slotCode} autoComplete="off" spellCheck={false} autoCapitalize="characters" className="font-mono" onChange={event => form.set('slotCode')(event.target.value)} /></FormField>}
    <FormField label="Sức chứa (số hộp)" required error={errors.capacity} hint="Số nguyên lớn hơn 0, ví dụ 6." className="mb-4">
      <Input value={values.capacity} inputMode="numeric" autoComplete="off" onChange={event => form.set('capacity')(event.target.value)} /></FormField>
  </FormSheet>
}

/** PATCH slot status: pick the new status, each with what it means for selling. */
function SlotStatusSheet({ machineId, slot, close, done }: { machineId: string; slot: Slot; close: () => void; done: () => void }) {
  const [status, setStatus] = useState<SlotStatus>(SLOT_STATUSES.find(value => value !== slot.status) ?? 'ACTIVE')
  const name = useId()
  return <FormSheet title={`Trạng thái ngăn ${slot.slotCode}`} submitLabel="Đổi trạng thái" successMessage="Đã đổi trạng thái ngăn" close={close}
    successDescription={`Ngăn ${slot.slotCode} chuyển sang ${statusMeta('slot', status).label}.`}
    description={<>Hiện tại: {statusMeta('slot', slot.status).label}. Không xóa ngăn; lịch sử hộp và đơn hàng được giữ nguyên.</>}
    onSubmit={async () => {
      try { await slotsApi.setStatus(machineId, slot.id, status) } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 409)) done()
        throw describeSlotStatusError(error)
      }
      done()
    }}>
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-[13px] font-medium">Trạng thái mới</legend>
      {SLOT_STATUSES.map(value => {
        const id = `${name}-${value}`
        const current = value === slot.status
        return <label key={value} htmlFor={id} className={cn('flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/40', current && 'cursor-not-allowed opacity-70')}>
          <input id={id} type="radio" name={name} value={value} checked={status === value} disabled={current} onChange={() => setStatus(value)} className="mt-1 size-4 accent-primary" />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{statusMeta('slot', value).label}{current ? ' (hiện tại)' : ''}</span>
            <span className="text-[13px] text-muted-foreground">{SLOT_STATUS_HELP[value]}</span>
          </span>
        </label>
      })}
    </fieldset>
  </FormSheet>
}

// ---- Khóa kiosk

type KeyTarget = { kind: 'issue' } | { kind: 'revoke'; credential: KioskCredential; credentialId: string }

function KioskTab({ machine }: { machine: Machine }) {
  const state = useApi(signal => kioskCredentialsApi.list(machine.id, signal), machine.id)
  const dialog = useDialog<KeyTarget>()
  const target = dialog.value
  const forbidden = state.error instanceof ApiError && state.error.status === 403
  const active = state.data?.find(credential => credential.status === 'ACTIVE')

  const columns: Column<KioskCredential>[] = [
    { head: 'Khóa', nowrap: true, cell: credential => <span className="font-mono text-[13px]">{maskedKey(credential.keyPrefix)}</span> },
    { head: 'Trạng thái', cell: credential => <StatusBadge domain="kioskCredential" value={credential.status} /> },
    { head: 'Cấp lúc', nowrap: true, cell: credential => formatDateTime(credential.createdAt) },
    { head: 'Thu hồi lúc', nowrap: true, cell: credential => credential.revokedAt ? formatDateTime(credential.revokedAt) : <span className="text-muted-foreground">Chưa thu hồi</span> },
    { head: 'Thao tác', cell: credential => {
      const id = credential.credentialId
      if (credential.status !== 'ACTIVE') return <span className="text-[13px] text-muted-foreground">Không còn hiệu lực</span>
      // Without its id the key cannot be revoked on its own; issuing a new key still revokes it.
      if (!id) return <span className="text-[13px] text-muted-foreground">Thu hồi bằng cách cấp khóa mới</span>
      return <Button type="button" size="sm" variant="outline" className="text-destructive" data-focus-key={`key-revoke-${id}`}
        aria-label={`Thu hồi khóa ${maskedKey(credential.keyPrefix)}`} onClick={() => dialog.open({ kind: 'revoke', credential, credentialId: id })}><ShieldOff aria-hidden="true" />Thu hồi</Button>
    } },
  ]

  return <section aria-labelledby="keys-title">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="keys-title" className="text-base font-semibold">Khóa kiosk</h2>
        <p className="mt-1! max-w-[70ch] text-[13px] text-muted-foreground">Kiosk của máy dùng khóa này để gọi hệ thống; mỗi máy có tối đa một khóa đang dùng. Khóa chỉ hiện một lần lúc cấp, hệ thống chỉ lưu phần đầu (tiền tố). Mất khóa thì cấp khóa mới.</p>
      </div>
      {!forbidden && state.data && <Button type="button" data-focus-key="key-issue" onClick={() => dialog.open({ kind: 'issue' })}>
        <KeyRound aria-hidden="true" />{active ? 'Cấp khóa mới' : 'Cấp khóa'}</Button>}
    </div>
    <DataTable state={state} rows={state.data} rowKey={credential => credential.credentialId ?? credential.keyPrefix ?? ''} columns={columns} caption="Lịch sử khóa kiosk"
      empty="Máy chưa có khóa nào. Bấm “Cấp khóa” để tạo khóa cho kiosk của máy." />
    {/* `current` follows the latest list, so after a reload (409, or a key issued without being returned) the dialog warns
        about the key a click would revoke now, not the one in use when it opened. */}
    {target?.kind === 'issue' && <IssueKeyDialog machine={machine} current={active} listLoading={state.loading} close={dialog.close} done={state.reload} />}
    {target?.kind === 'revoke' && <ConfirmDialog title={`Thu hồi khóa ${maskedKey(target.credential.keyPrefix)}?`} confirmLabel="Thu hồi khóa" danger close={dialog.close}
      successDescription={`Kiosk của máy ${machine.code} không dùng được khóa ${maskedKey(target.credential.keyPrefix)} nữa.`}
      message={<>Kiosk của máy <strong className="font-medium text-foreground">{machine.code}</strong> đang dùng khóa này sẽ bị từ chối ngay và không bán được cho tới khi nhập khóa mới. Khóa đã thu hồi được giữ trong lịch sử, không bật lại được.</>}
      onConfirm={async () => {
        try { await kioskCredentialsApi.revoke(machine.id, target.credentialId) } catch (error) {
          if (error instanceof ApiError && (error.status === 404 || error.status === 409)) state.reload()
          throw describeKeyError(error, 'revoke')
        }
        state.reload()
      }} />}
  </section>
}

/**
 * Issue a key in one dialog: confirm (warns when the key in use will be revoked), then show the new key once with a copy
 * button. The plain key lives only in this component's state: never in storage, the URL, a toast or a log, and it is
 * gone when the dialog closes. Esc and clicks outside cannot close it while the key is shown.
 */
function IssueKeyDialog({ machine, current, listLoading, close, done }: {
  machine: Machine; current?: KioskCredential; listLoading: boolean; close: () => void; done: () => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('')
  const copyRef = useRef<HTMLButtonElement>(null)
  const keyRef = useRef<HTMLTextAreaElement>(null)
  const { onCloseAutoFocus } = useReturnFocus()
  const shown = !!apiKey
  // The key in use when the dialog opened; if the list reloads with another one, say so before the next click.
  const [openedWith] = useState(() => current?.credentialId ?? null)
  const prompt = issuePrompt(current, openedWith, listLoading)
  useEffect(() => { if (shown) copyRef.current?.focus() }, [shown])

  async function issue() {
    if (pending) return
    setPending(true); setFailure('')
    try {
      const result = await kioskCredentialsApi.issue(machine.id)
      const key = issuedKey(result)
      // A 201 without the key: the new key is ACTIVE but nobody can see it; say so and let them issue again.
      if (!key) setFailure(KEY_NOT_RETURNED)
      setApiKey(key)
      done()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) done()
      setFailure(errorMessage(describeKeyError(error, 'issue')))
    } finally { setPending(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(apiKey); setCopied('ok') } catch {
      // Clipboard refused (permissions, insecure context): select the key so Ctrl+C works.
      keyRef.current?.focus()
      keyRef.current?.select()
      setCopied('fail')
    }
  }
  function finish() {
    setApiKey('')
    close()
    toast.success('Đã cấp khóa kiosk', { description: `Máy ${machine.code}` })
  }

  return <AlertDialog open onOpenChange={open => { if (!open && !pending && !shown) close() }}>
    <AlertDialogContent aria-busy={pending} className="max-w-lg" onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={event => { if (pending || shown) event.preventDefault() }}>
      {!shown ? <>
        <AlertDialogTitle>{prompt.revokes ? `Cấp khóa mới cho máy ${machine.code}?` : `Cấp khóa kiosk cho máy ${machine.code}?`}</AlertDialogTitle>
        <AlertDialogDescription asChild><div className="grid gap-2">
          {prompt.changed && <p className="font-medium text-foreground">Khóa đang dùng của máy đã thay đổi so với lúc mở hộp thoại; đọc lại cảnh báo bên dưới.</p>}
          {prompt.revokes && <p className="rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3 py-2 text-status-warning-foreground">
            Khóa đang dùng <span className="font-mono">{prompt.revokes}</span> sẽ bị thu hồi ngay. Kiosk đang dùng khóa cũ ngừng hoạt động cho tới khi nhập khóa mới.</p>}
          <p>Khóa mới chỉ hiện một lần ngay sau khi cấp. Chuẩn bị sẵn chỗ lưu (cấu hình kiosk hoặc trình quản lý mật khẩu).</p>
        </div></AlertDialogDescription>
        {failure && <p className="my-1! rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-destructive" role="alert">{failure}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Hủy</AlertDialogCancel>
          {/* Not while the list reloads: the warning above must match the key a click would revoke. */}
          <Button type="button" variant={prompt.danger ? 'destructive' : 'default'} disabled={pending || !prompt.canConfirm} onClick={issue}>
            {pending ? 'Đang cấp…' : prompt.confirmLabel}</Button>
        </AlertDialogFooter>
      </> : <>
        <AlertDialogTitle>Khóa kiosk mới của máy {machine.code}</AlertDialogTitle>
        <AlertDialogDescription asChild><div className="grid gap-2">
          <p className="rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3 py-2 font-medium text-status-warning-foreground">
            Sao chép và lưu khóa ngay. Khóa chỉ hiện lần này; sau khi đóng, không ai xem lại được. Mất khóa thì cấp khóa mới.</p>
        </div></AlertDialogDescription>
        <FormField label="Khóa kiosk">
          <Textarea ref={keyRef} value={apiKey} readOnly rows={2} spellCheck={false} onFocus={event => event.currentTarget.select()}
            className="min-h-0 resize-none border-dashed border-primary font-mono text-[13px] break-all read-only:bg-primary/5 read-only:text-foreground" />
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          <Button ref={copyRef} type="button" onClick={copy}><Copy aria-hidden="true" />Sao chép khóa</Button>
          <span role="status" className="text-[13px] text-muted-foreground">
            {copied === 'ok' ? 'Đã sao chép vào bộ nhớ tạm.' : copied === 'fail' ? 'Không tự sao chép được; khóa đã được bôi đen, nhấn Ctrl+C để sao chép.' : ''}</span>
        </div>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={finish}>Tôi đã lưu khóa, đóng</Button>
        </AlertDialogFooter>
      </>}
    </AlertDialogContent>
  </AlertDialog>
}

export default MachineDetailPage
