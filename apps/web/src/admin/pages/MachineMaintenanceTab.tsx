// C3 tab "Bảo trì" (`?tab=maintenance`, FE 7.4, screen O6): maintenance commands sent to the machine and their history.
// - Lệnh theo ngăn: pick a column (`?maintenanceSlot=` in the URL), see its bowls and refill gate, then OPEN_REFILL /
//   CLOSE_REFILL (sent at once), REMOVE_ITEM or EMPTY_COLUMN (ask first, with the reason and how many bowls).
// - Lệnh cho cả máy: RESET of the controller (MACHINE_RESET, Admin), asks first.
// - Lịch sử lệnh: newest first; reloads every 2 s while a command is unfinished, else 30 s. A command waiting for
//   reconciliation (NEEDS_RECONCILIATION) gets "Đối soát": Staff say whether the machine did it.
// Every button stays focusable but locked (aria-disabled) with the reason and the next step while the machine is not in
// MAINTENANCE, OFFLINE, busy with another command, or the account lacks the permission. Every POST carries an
// Idempotency-Key (new per click, reused when retrying that click). Rules and wording: ../maintenance-commands.ts.
// API: api-contract/api.yaml (backend #64). Nothing is deleted from here.
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Lock as LockIcon, RotateCcw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '../../api/client.ts'
import { maintenanceCommandsApi, slotsApi } from '../../api/resources.ts'
import type { InventorySummary, Machine, MaintenanceCommand, MaintenanceOperation, MaintenanceReason, Page } from '../../api/resources.ts'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '../../components/ui/alert-dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { NativeSelect, Textarea } from '../../components/ui/input.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { statusMeta } from '../../lib/status.ts'
import type { ConnectionSource } from '../connection.ts'
import { unknownDetail } from '../connection.ts'
import { DataTable, ErrorState, Loading, Pagination } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import {
  COMMAND_INFO, MAINTENANCE_IDLE_POLL_MS, MAINTENANCE_MISSING, MAINTENANCE_PAGE_SIZE, MAINTENANCE_POLL_MS, NOTE_MAX, REASON_OPTIONS,
  commandDetail, commandLabel, commandStatusText, createAttempts, describeMaintenanceError, gateText, isMaintenanceMissing, isRemoval, machineLock,
  needsReconciliation, needsRefresh, reconcileBody, runningCommand, sendMaintenanceCommand, sendReset, slotPlan,
} from '../maintenance-commands.ts'
import type { ColumnOperation, Lock, SlotPlan } from '../maintenance-commands.ts'
import { useApi, errorMessage } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import { useConnection } from '../useConnection.ts'
import { useSession } from '../useSession.ts'
import { useReturnFocus } from '../return-focus.ts'
import { ReconcileDialog } from '../maintenance-parts.tsx'

const PANEL = 'min-w-0 rounded-xl border bg-card p-5 shadow-xs max-[680px]:p-4'
const ERROR_BOX = 'rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive'
const LOCKED = 'cursor-not-allowed border-dashed bg-card text-muted-foreground shadow-none hover:bg-card hover:text-muted-foreground'
const SLOT_OPERATIONS: readonly ColumnOperation[] = ['OPEN_REFILL', 'CLOSE_REFILL', 'REMOVE_ITEM', 'EMPTY_COLUMN']

export default function MachineMaintenanceTab({ machine, connection, reloadMachine, openStatusChange }: {
  machine: Machine
  /** The page's load state of the machine (same connectivity as the header). */
  connection: ConnectionSource
  reloadMachine: () => void
  /** Opens the overview with focus on "Chuyển sang Bảo trì"; only for accounts that may change the machine status. */
  openStatusChange?: () => void
}) {
  const machineId = machine.id
  const { can } = useSession()
  const canMaintain = can('MAINTENANCE_COMMAND_EXECUTE'), canReset = can('MACHINE_RESET')
  const { params, update } = useQueryParams()
  const rawPage = Number(params.get('commandPage') ?? 0)
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0
  const slotId = params.get('maintenanceSlot') ?? ''
  const shown = useConnection(machine.lastSeenAt, connection, machine.connectivity)
  const [attempts] = useState(createAttempts)

  // The newest command decides the lock (the server runs one at a time, so only the newest can be unfinished).
  const [fast, setFast] = useState(false)
  const poll = { pollMs: fast ? MAINTENANCE_POLL_MS : MAINTENANCE_IDLE_POLL_MS, stopOn: isMaintenanceMissing }
  // On later pages of the history a one-row query of page 0 follows the newest command.
  const head = useApi(signal => (page === 0 ? Promise.resolve(undefined) : maintenanceCommandsApi.list({ machineId, page: 0, size: 1 }, signal)), `${machineId}|maintenance-head|${page === 0}`, poll)
  const history = useApi(signal => maintenanceCommandsApi.list({ machineId, page, size: MAINTENANCE_PAGE_SIZE }, signal), `${machineId}|maintenance|${page}`, poll)
  const newest = page === 0 ? history.data : head.data
  // The command just sent counts as running until the reloaded history shows it (no second click in between).
  const [justSent, setJustSent] = useState<MaintenanceCommand | null>(null)
  const listed = !!justSent && !!newest?.content.some(command => command.id === justSent.id || (command.createdAt ?? '') > (justSent.createdAt ?? ''))
  const running = runningCommand(newest?.content.slice(0, 1)) ?? (justSent && !listed ? justSent : undefined)
  // Poll fast exactly while the newest command is unfinished (state adjusted during render, React's derived-state pattern).
  if (newest && fast !== !!running) setFast(!!running)

  const slots = useApi(signal => slotsApi.list(machineId, { page: 0, size: 100, sort: 'slotCode,asc' }, signal), `${machineId}|maintenance-slots`)
  const slot = slots.data?.content.find(candidate => candidate.id === slotId)
  const summary = useApi(signal => (slot ? slotsApi.summary(machineId, slot.id, signal) : Promise.resolve(undefined)), `${machineId}|maintenance-summary|${slot?.id ?? ''}`)

  // A command that just ended may have taken bowls out or moved a gate (or a 409 said the slot changed): read again.
  const lastRunning = useRef<string | undefined>(undefined)
  const { reload: reloadHistory } = history
  const { reload: reloadSummary } = summary
  const { reload: reloadSlots } = slots
  useEffect(() => {
    if (lastRunning.current && !running) { reloadSummary(); reloadHistory(); reloadSlots(); reloadMachine() }
    lastRunning.current = running?.id
  }, [running, reloadSummary, reloadHistory, reloadSlots, reloadMachine])

  const missing = isMaintenanceMissing(history.error) && !history.data
  const lock = machineLock({
    canMaintain, canChangeStatus: !!openStatusChange, machineStatus: machine.status!, connection: shown.shown,
    neverConnected: shown.never, running, missing,
  })
  const resetLock: Lock | null = lock?.code === 'permission' && canReset ? null : lock
  const lockId = useId()
  const lockRef = useRef<HTMLDivElement>(null)
  const [sending, setSending] = useState<MaintenanceOperation | null>(null)
  const [failure, setFailure] = useState('')
  const [asking, setAsking] = useState<MaintenanceOperation | null>(null)
  const [reconciling, setReconciling] = useState<MaintenanceCommand | null>(null)

  const refreshAfter = (error: unknown) => {
    if (needsRefresh(error)) { reloadMachine(); head.reload(); reloadHistory(); reloadSummary(); reloadSlots() }
  }
  const sent = (command: MaintenanceCommand) => {
    setJustSent(command)
    toast.success(`Đã gửi lệnh “${commandLabel(command.operation)}”`, { description: `Máy ${machine.code}${command.slotCode ? ` · ngăn ${command.slotCode}` : ''}. Theo dõi kết quả ở Lịch sử lệnh.` })
    head.reload(); reloadHistory()
    if (page) update({ commandPage: undefined })
  }
  async function sendNow(operation: ColumnOperation) {
    if (sending || !slot) return
    setSending(operation); setFailure('')
    try { sent(await sendMaintenanceCommand(attempts, machineId!, slot.id!, operation)) } catch (error) {
      setFailure(errorMessage(error)); refreshAfter(error)
    } finally { setSending(null) }
  }
  const run = (operation: MaintenanceOperation) => {
    const blocking = operation === 'RESET' ? resetLock : lock
    if (blocking) { lockRef.current?.focus(); return }
    if (COMMAND_INFO[operation].confirm) { setFailure(''); setAsking(operation) } else void sendNow(operation as ColumnOperation)
  }

  const gateOpen = !!slot?.refillGateOpen
  const plans: Record<ColumnOperation, SlotPlan> = Object.fromEntries(SLOT_OPERATIONS.map(operation =>
    [operation, slot ? slotPlan(operation, summary.data, gateOpen) : { count: 0, blocked: 'Chọn ngăn trước.' }])) as Record<ColumnOperation, SlotPlan>
  const summaryPending = !!slot && !summary.data
  const openGates = (slots.data?.content ?? []).filter(candidate => candidate.refillGateOpen)

  return <section aria-labelledby="maintenance-title" className="grid gap-5">
    <div>
      <h2 id="maintenance-title" className="text-base font-semibold">Bảo trì máy</h2>
      <p className="mt-1! max-w-[75ch] text-[13px] text-muted-foreground">Gửi lệnh điều khiển xuống máy. Lệnh chỉ gửi được khi máy ở trạng thái Bảo trì và đang kết nối; mỗi máy chạy một lệnh một lúc. Tồn kho chỉ đổi khi máy báo đã làm xong; không lệnh nào xóa dữ liệu.</p>
    </div>

    {lock && <LockNotice ref={lockRef} id={lockId} lock={lock} openStatusChange={lock.code === 'status' ? openStatusChange : undefined} />}
    {!lock && shown.shown === 'UNKNOWN' && <p role="status" className="rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3.5 py-2.5 text-[13px] text-status-warning-foreground">
      {unknownDetail(shown.staleSince)}. Lệnh vẫn gửi được, nhưng nếu máy đã mất kết nối thì lệnh sẽ thất bại sau 30 giây.
    </p>}
    {failure && <p role="alert" className={ERROR_BOX}>{failure}</p>}

    <section aria-labelledby="maintenance-slot-title" className={PANEL}>
      <h3 id="maintenance-slot-title" className="text-sm font-semibold">Lệnh theo ngăn</h3>
      <p className="mt-1! mb-3! text-[13px] text-muted-foreground">
        Chọn ngăn rồi gửi lệnh. Rút hộp cần cổng nạp đóng và không có hộp đang giữ cho đơn.
        {openGates.length ? <> <strong className="font-medium text-foreground">Đang mở cổng nạp: ngăn {openGates.map(candidate => candidate.slotCode).join(', ')}.</strong></> : null}
      </p>
      {slots.error && !slots.data ? <ErrorState error={slots.error} retry={slots.reload} />
        : !slots.data ? <Loading label="Đang tải danh sách ngăn…" rows={2} />
        : slots.data.content.length === 0 ? <p className="text-[13px] text-muted-foreground">Máy chưa có ngăn nào nên chưa có lệnh theo ngăn. Thêm ngăn ở thẻ Ngăn.</p>
        : <>
          <div className="mb-3 grid max-w-sm gap-3">
            <FormField label="Ngăn cần thao tác">
              <NativeSelect value={slot ? slot.id : ''} data-focus-key="maintenance-slot" onChange={event => update({ maintenanceSlot: event.target.value || undefined })}>
                <option value="">Chọn ngăn…</option>
                {slots.data.content.map(candidate => <option key={candidate.id} value={candidate.id}>Ngăn {candidate.slotCode} ({statusMeta('slot', candidate.status ?? '').label}{candidate.refillGateOpen ? ', cổng nạp mở' : ''})</option>)}
              </NativeSelect>
            </FormField>
          </div>
          {slot && <SlotFacts summary={summary.data} gateOpen={gateOpen} error={summary.error} retry={summary.reload} />}
          <ul className="mt-3 grid gap-3" aria-label="Lệnh theo ngăn">
            {SLOT_OPERATIONS.map(operation => <CommandRow key={operation} operation={operation} lock={lock} lockId={lockId} sending={sending === operation} busy={!!sending}
              blocked={!slot ? 'Chọn ngăn trước.' : summaryPending && operation !== 'CLOSE_REFILL' ? 'Đang kiểm tra số hộp trong ngăn…' : plans[operation].blocked} onRun={() => run(operation)} />)}
          </ul>
        </>}
    </section>

    <section aria-labelledby="maintenance-machine-title" className={PANEL}>
      <h3 id="maintenance-machine-title" className="text-sm font-semibold">Lệnh cho cả máy</h3>
      {canReset
        ? <ul className="mt-3 grid gap-3" aria-label="Lệnh cho cả máy">
          <CommandRow operation="RESET" lock={resetLock} lockId={lockId} sending={sending === 'RESET'} busy={!!sending} onRun={() => run('RESET')} />
        </ul>
        : <p className="mt-1! text-[13px] text-muted-foreground">Khởi động lại bộ điều khiển (xóa lỗi FAULT) chỉ dành cho Quản trị viên. Báo Quản trị viên nếu thẻ Cảm biến & Sự kiện báo FAULT.</p>}
    </section>

    <HistoryPanel state={history} page={page} missing={isMaintenanceMissing(history.error) && !history.data} canReconcile={canMaintain}
      reconcile={setReconciling} onPage={next => update({ commandPage: next ? String(next) : undefined })} />

    {asking && <CommandDialog machine={machine} operation={asking} slotCode={slot?.slotCode} plan={isRemoval(asking) ? plans[asking as ColumnOperation] : undefined}
      close={() => setAsking(null)}
      send={async (reason, note) => {
        try {
          sent(asking === 'RESET'
            ? await sendReset(attempts, machineId!, note)
            : await sendMaintenanceCommand(attempts, machineId!, slot!.id!, asking as ColumnOperation, { reason, note }))
        } catch (error) { refreshAfter(error); throw error }
      }} />}
    {reconciling && <ReconcileDialog command={reconciling} close={() => setReconciling(null)} done={() => { reloadHistory(); head.reload(); reloadSummary(); reloadSlots() }} />}
  </section>
}

function LockNotice({ ref, id, lock, openStatusChange }: { ref: Ref<HTMLDivElement>; id: string; lock: Lock; openStatusChange?: () => void }) {
  return <div ref={ref} id={id} tabIndex={-1} data-lock={lock.code}
    className="flex gap-3 rounded-xl border border-status-warning-foreground/30 bg-status-warning px-4 py-3.5 text-[13px] text-status-warning-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
    <LockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <div className="grid min-w-0 gap-1">
      <p className="font-semibold">Các nút lệnh đang khóa</p>
      <p>{lock.reason}</p>
      <p><strong className="font-semibold">Việc cần làm:</strong> {lock.next}</p>
      {openStatusChange && <p className="mt-1!"><Button type="button" size="sm" variant="outline" className="max-sm:h-11" onClick={openStatusChange}>Mở thẻ Tổng quan để chuyển sang Bảo trì</Button></p>}
    </div>
  </div>
}

function CommandRow({ operation, lock, lockId, blocked, sending, busy, onRun }: {
  operation: MaintenanceOperation; lock: Lock | null; lockId: string; blocked?: string; sending: boolean; busy: boolean; onRun: () => void
}) {
  const info = COMMAND_INFO[operation]
  const doesId = useId(), blockedId = useId()
  const locked = !!lock || !!blocked
  const describedBy = [doesId, lock ? lockId : undefined, !lock && blocked ? blockedId : undefined].filter(Boolean).join(' ')
  const Icon = operation === 'RESET' ? RotateCcw : Send
  return <li className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border px-3.5 py-3 max-sm:flex-col">
    <Button type="button" variant="outline" data-focus-key={`maintenance-${operation}`} data-command={operation}
      aria-disabled={locked || busy || undefined} aria-describedby={describedBy}
      className={cn('min-w-56 justify-start max-sm:h-11 max-sm:w-full', (locked || busy) && LOCKED, info.danger && !locked && 'border-destructive/50 text-destructive hover:bg-destructive/8 hover:text-destructive')}
      onClick={event => { if (lock) { onRun(); return } if (blocked || busy) { event.preventDefault(); return } onRun() }}>
      {locked ? <LockIcon aria-hidden="true" /> : <Icon aria-hidden="true" />}{sending ? 'Đang gửi…' : info.label}
    </Button>
    <div className="grid min-w-0 flex-1 gap-1 text-[13px]">
      <p id={doesId} className="text-muted-foreground">{info.does}</p>
      {!lock && blocked && <p id={blockedId} className="font-medium text-foreground">Chưa gửi được: {blocked}</p>}
    </div>
  </li>
}

function SlotFacts({ summary, gateOpen, error, retry }: { summary: InventorySummary | undefined; gateOpen: boolean; error: unknown; retry: () => void }) {
  if (error && !summary) return <div className={cn(ERROR_BOX, 'flex flex-wrap items-center gap-2')} role="alert">Không tải được số hộp của ngăn: {errorMessage(error)}
    {!(error instanceof ApiError && (error.status === 401 || error.status === 403)) && <Button type="button" size="sm" variant="outline" onClick={retry}>Thử lại</Button>}</div>
  if (!summary) return <p className="text-[13px] text-muted-foreground" role="status">Đang kiểm tra số hộp trong ngăn…</p>
  const failed = Math.max(0, (summary.occupiedCount ?? 0) - (summary.availableCount ?? 0) - (summary.expiredCount ?? 0) - (summary.reservedCount ?? 0))
  return <p className="text-[13px]" role="status">
    {gateText(gateOpen)} Đang có <strong className="font-semibold">{summary.occupiedCount ?? 0} hộp</strong> (sức chứa {summary.capacity ?? '—'}): {summary.availableCount ?? 0} sẵn sàng, {summary.expiredCount ?? 0} hết hạn, {summary.reservedCount ?? 0} đang giữ cho đơn{failed ? `, ${failed} nhả hàng thất bại` : ''}.
    {summary.headStatus ? <> Hộp ở đáy ngăn: {statusMeta('box', summary.headStatus).label.toLowerCase()}{summary.headExpired && summary.headStatus !== 'EXPIRED' ? ' (đã hết hạn)' : ''}.</> : null}
  </p>
}

/**
 * Asks before REMOVE_ITEM, EMPTY_COLUMN (with the reason, required) and RESET: what the machine will do, on which column
 * and how many bowls, with an optional note. Stays open while sending; a failure is shown inside so the person can retry
 * (the same click keeps its Idempotency-Key).
 */
function CommandDialog({ machine, operation, slotCode, plan, close, send }: {
  machine: Machine; operation: MaintenanceOperation; slotCode?: string; plan?: SlotPlan; close: () => void
  send: (reason: MaintenanceReason | '', note: string) => Promise<void>
}) {
  const info = COMMAND_INFO[operation]
  const removal = isRemoval(operation)
  const [reason, setReason] = useState<MaintenanceReason | ''>(operation === 'EMPTY_COLUMN' ? 'RESTOCK' : '')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const reasonRef = useRef<HTMLSelectElement>(null)
  const { onCloseAutoFocus } = useReturnFocus()
  const count = plan?.count ?? 0
  const title = operation === 'EMPTY_COLUMN' ? `Xả hết ${count} hộp ở ngăn ${slotCode}?` : operation === 'REMOVE_ITEM' ? `Rút hộp đáy ngăn ${slotCode}?` : `Khởi động lại bộ điều khiển của máy ${machine.code}?`
  const confirmLabel = operation === 'EMPTY_COLUMN' ? `Xả ${count} hộp` : operation === 'REMOVE_ITEM' ? 'Rút 1 hộp' : 'Khởi động lại'
  async function confirm() {
    if (pending) return
    const problems: Record<string, string> = {}
    if (removal && !reason) problems.reason = 'Chọn lý do rút hộp.'
    if (removal && reason === 'OTHER' && !note.trim()) problems.note = 'Ghi rõ lý do khác.'
    if (note.trim().length > NOTE_MAX) problems.note = `Tối đa ${NOTE_MAX} ký tự.`
    if (Object.keys(problems).length) { setErrors(problems); (problems.reason ? reasonRef : noteRef).current?.focus(); return }
    setPending(true); setFailure(''); setErrors({})
    try { await send(reason, note); close() } catch (error) {
      const fields = error instanceof ApiError ? error.fieldErrors : {}
      if (fields.reason || fields.note) { setErrors({ reason: fields.reason ?? '', note: fields.note ?? '' }); (fields.reason ? reasonRef : noteRef).current?.focus() }
      setFailure(errorMessage(error)); setPending(false)
    }
  }
  return <AlertDialog open onOpenChange={open => { if (!open && !pending) close() }}>
    <AlertDialogContent aria-busy={pending} onEscapeKeyDown={event => { if (pending) event.preventDefault() }} onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      <AlertDialogDescription asChild><div className="grid gap-2">
        <p>{info.does}</p>
        {operation === 'EMPTY_COLUMN' && <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive">
          Máy <strong className="font-semibold">{machine.code}</strong>, ngăn <strong className="font-semibold">{slotCode}</strong>: <strong className="font-semibold">{count} hộp</strong> sẽ bị rút và chuyển sang Đã rút. Không hoàn tác được; muốn bán lại phải nạp hộp mới.
        </p>}
        {operation === 'REMOVE_ITEM' && <p>Máy <strong className="font-medium text-foreground">{machine.code}</strong>, ngăn <strong className="font-medium text-foreground">{slotCode}</strong>: 1 hộp ở đáy ngăn sẽ bị rút.</p>}
        {operation === 'RESET' && <p>Dùng khi thẻ Cảm biến & Sự kiện báo FAULT và bạn đã kiểm tra hai cổng, khay tại máy.</p>}
        <p>Tồn kho chỉ thay đổi khi máy báo đã làm xong; nếu máy không phản hồi, lệnh chờ đối soát và không hộp nào bị đổi.</p>
      </div></AlertDialogDescription>
      {removal && <FormField label="Lý do rút" required error={errors.reason || undefined}>
        <NativeSelect ref={reasonRef} value={reason} disabled={pending} onChange={event => { setReason(event.target.value as MaintenanceReason | ''); setErrors({}) }}>
          <option value="">Chọn lý do…</option>
          {REASON_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>}
      <FormField label={removal && reason === 'OTHER' ? 'Ghi chú' : 'Ghi chú (không bắt buộc)'} required={removal && reason === 'OTHER'} error={errors.note || undefined}
        hint={`Tối đa ${NOTE_MAX} ký tự. Được ghi vào lịch sử lệnh${removal ? ' và lịch sử kho' : ''}.`}>
        <Textarea ref={noteRef} value={note} rows={2} disabled={pending} onChange={event => { setNote(event.target.value); setErrors(previous => ({ ...previous, note: '' })) }} />
      </FormField>
      {failure && <p className={ERROR_BOX} role="alert">{failure}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Hủy</AlertDialogCancel>
        <Button type="button" variant={info.danger ? 'destructive' : 'default'} disabled={pending} onClick={confirm}>{pending ? 'Đang gửi…' : confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

function HistoryPanel({ state, page, missing, canReconcile, reconcile, onPage }: {
  state: ApiState<Page<MaintenanceCommand>>; page: number; missing: boolean; canReconcile: boolean; reconcile: (command: MaintenanceCommand) => void; onPage: (page: number) => void
}) {
  const titleId = useId()
  const data = state.data
  const columns: Column<MaintenanceCommand>[] = [
    { head: 'Gửi lúc', nowrap: true, cell: command => formatDateTime(command.createdAt) },
    { head: 'Lệnh', cell: command => <span className="grid justify-items-start gap-0.5 text-left">
      <span className="font-medium">{commandLabel(command.operation)}</span>
      <span className="font-mono text-xs text-muted-foreground">{command.commandCode}</span>
    </span> },
    { head: 'Trạng thái', cell: command => <span className="grid justify-items-start gap-1 text-left">
      <StatusBadge domain="maintenanceCommand" value={command.status ?? ''} describe={false} />
      <span className="text-xs text-muted-foreground">{commandStatusText(command.status)}{command.finishedAt ? ` Kết thúc ${formatDateTime(command.finishedAt)}.` : ''}</span>
      {canReconcile && needsReconciliation(command) && <Button type="button" size="sm" variant="outline" className="max-sm:h-11" data-focus-key={`reconcile-${command.id}`}
        aria-label={`Đối soát lệnh ${commandLabel(command.operation)} gửi lúc ${formatDateTime(command.createdAt)}`} onClick={() => reconcile(command)}>Đối soát</Button>}
    </span> },
    { head: 'Chi tiết', cell: command => <span className="grid justify-items-start gap-0.5 text-left text-[13px]">
      {commandDetail(command) && <span>{commandDetail(command)}</span>}
      {command.note && <span className="text-muted-foreground">Ghi chú: {command.note}</span>}
      {!commandDetail(command) && !command.note && <span className="text-muted-foreground">—</span>}
    </span> },
    { head: 'Người gửi', cell: command => command.requestedBy?.fullName ?? '—' },
  ]
  let body: ReactNode
  if (missing) body = <p role="status" className="rounded-lg border border-dashed px-4 py-4 text-[13px] text-muted-foreground">{MAINTENANCE_MISSING}</p>
  else body = <>
    <DataTable state={{ ...state, error: data ? undefined : state.error }} rows={data?.content} rowKey={command => command.id!} columns={columns} caption="Lịch sử lệnh bảo trì"
      empty={data && data.totalElements > 0 ? <>Trang này không còn lệnh nào. <Button type="button" variant="link" className="h-auto p-0" onClick={() => onPage(0)}>Về trang đầu</Button></> : 'Máy chưa nhận lệnh bảo trì nào. Lệnh bạn gửi sẽ hiện ở đây kèm trạng thái.'} />
    {data && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} onPage={onPage} />}
    {data && state.error && <p role="alert" className="mt-3! flex flex-wrap items-center gap-2 text-[13px] text-destructive">
      Không tải lại được lịch sử; đang hiện dữ liệu cũ.<Button type="button" size="sm" variant="outline" onClick={state.reload}>Thử lại</Button></p>}
  </>
  return <section aria-labelledby={titleId} className={PANEL}>
    <h3 id={titleId} className="mb-1 text-sm font-semibold">Lịch sử lệnh</h3>
    <p className="mb-3! text-[13px] text-muted-foreground">Mới nhất trước{page ? ` · trang ${page + 1}` : ''}. Tự cập nhật mỗi 2 giây khi còn lệnh chưa xong.</p>
    {body}
  </section>
}
