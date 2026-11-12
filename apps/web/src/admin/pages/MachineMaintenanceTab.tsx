// C3 tab "Bảo trì" (`?tab=maintenance`, FE 7.4, screen O6): maintenance commands sent to the machine and their history.
// - Lệnh cho cả máy: OPEN_REFILL, CLOSE_REFILL (sent at once) and RESET (asks first), each with what the machine will do.
// - Lệnh theo ngăn: pick a slot (`?maintenanceSlot=` in the URL), see its bowls, then REMOVE_ITEM (asks first) or
//   EMPTY_COLUMN (asks first, naming the slot and how many bowls will be taken out).
// - Lịch sử lệnh: newest first with the delivery status; reloads every 2 s while a command is unfinished, else 30 s.
// Every button stays focusable but locked (aria-disabled) with the reason and the next step while the machine is not in
// MAINTENANCE, OFFLINE, busy with another command, the account lacks MACHINE_MAINTENANCE, or the backend does not have
// the draft API yet (404/501 → "chưa có"). Rules and wording: ../maintenance-commands.ts (shared with FE 7.2).
// Draft contract api-contract/drafts/machine-maintenance.yaml (BE 4.2). Nothing is deleted from here.
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Lock as LockIcon, RotateCcw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '../../api/client.ts'
import { maintenanceCommandsApi, slotsApi } from '../../api/resources.ts'
import type { InventorySummary, Machine, MaintenanceCommand, MaintenanceCommandType, Page } from '../../api/resources.ts'
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
  COMMAND_INFO, MAINTENANCE_IDLE_POLL_MS, MAINTENANCE_MISSING, MAINTENANCE_PAGE_SIZE, MAINTENANCE_POLL_MS, REASON_MAX,
  commandDetail, commandLabel, commandStatusText, isMaintenanceMissing, machineLock, needsRefresh, refillState, runningCommand,
  sendMaintenanceCommand, slotPlan,
} from '../maintenance-commands.ts'
import type { Lock, SlotPlan } from '../maintenance-commands.ts'
import { useApi, errorMessage } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import { useConnection } from '../useConnection.ts'
import { useSession } from '../useSession.ts'

const PANEL = 'min-w-0 rounded-xl border bg-card p-5 shadow-xs max-[680px]:p-4'
const ERROR_BOX = 'rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive'
const LOCKED = 'cursor-not-allowed border-dashed bg-card text-muted-foreground shadow-none hover:bg-card hover:text-muted-foreground'
const MACHINE_COMMANDS: readonly MaintenanceCommandType[] = ['OPEN_REFILL', 'CLOSE_REFILL', 'RESET']
const SLOT_COMMANDS: readonly MaintenanceCommandType[] = ['REMOVE_ITEM', 'EMPTY_COLUMN']

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
  const canMaintain = can('MACHINE_MAINTENANCE')
  const { params, update } = useQueryParams()
  const rawPage = Number(params.get('commandPage') ?? 0)
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0
  const slotId = params.get('maintenanceSlot') ?? ''
  const shown = useConnection(machine.lastSeenAt, connection)

  // The newest command decides the lock (the server runs one at a time, so only the newest can be unfinished).
  const [fast, setFast] = useState(false)
  const poll = { pollMs: fast ? MAINTENANCE_POLL_MS : MAINTENANCE_IDLE_POLL_MS, stopOn: isMaintenanceMissing }
  const head = useApi(signal => maintenanceCommandsApi.list(machineId, { page: 0, size: 1 }, signal), `${machineId}|maintenance-head`, poll)
  const history = useApi(signal => maintenanceCommandsApi.list(machineId, { page, size: MAINTENANCE_PAGE_SIZE }, signal), `${machineId}|maintenance|${page}`, poll)
  const running = runningCommand(head.data?.content)
  // Poll fast exactly while the newest command is unfinished (state adjusted during render, React's derived-state pattern).
  if (head.data && fast !== !!running) setFast(!!running)

  const slots = useApi(signal => slotsApi.list(machineId, { page: 0, size: 100 }, signal), `${machineId}|maintenance-slots`)
  const slot = slots.data?.content.find(candidate => candidate.id === slotId)
  const summary = useApi(signal => (slot ? slotsApi.summary(machineId, slot.id, signal) : Promise.resolve(undefined)), `${machineId}|maintenance-summary|${slot?.id ?? ''}`)

  // A command that just ended may have taken bowls out (or a 409 said the slot changed): read the counts again.
  const lastRunning = useRef<string | undefined>(undefined)
  const { reload: reloadHistory } = history
  const { reload: reloadSummary } = summary
  useEffect(() => {
    if (lastRunning.current && !running) { reloadSummary(); reloadHistory(); reloadMachine() }
    lastRunning.current = running?.id
  }, [running, reloadSummary, reloadHistory, reloadMachine])

  const missing = isMaintenanceMissing(head.error) && !head.data
  const lock = machineLock({
    canMaintain, canChangeStatus: !!openStatusChange, machineStatus: machine.status, connection: shown.shown,
    neverConnected: shown.never, running, missing,
  })
  const lockId = useId()
  const lockRef = useRef<HTMLDivElement>(null)
  const [sending, setSending] = useState<MaintenanceCommandType | null>(null)
  const [failure, setFailure] = useState('')
  const [asking, setAsking] = useState<MaintenanceCommandType | null>(null)

  const refreshAfter = (error: unknown) => {
    if (needsRefresh(error)) { reloadMachine(); head.reload(); reloadHistory(); reloadSummary() }
  }
  const sent = (command: MaintenanceCommand) => {
    toast.success(`Đã gửi lệnh “${commandLabel(command.type)}”`, { description: `Máy ${machine.code}${command.slotCode ? ` · ngăn ${command.slotCode}` : ''}. Theo dõi kết quả ở Lịch sử lệnh.` })
    head.reload(); reloadHistory()
    if (page) update({ commandPage: undefined })
  }
  async function sendNow(type: MaintenanceCommandType) {
    if (sending) return
    setSending(type); setFailure('')
    try { sent(await sendMaintenanceCommand(machineId, type)) } catch (error) {
      setFailure(errorMessage(error)); refreshAfter(error)
    } finally { setSending(null) }
  }
  const run = (type: MaintenanceCommandType) => {
    if (lock) { lockRef.current?.focus(); return }
    if (COMMAND_INFO[type].confirm) { setFailure(''); setAsking(type) } else void sendNow(type)
  }

  const plans: Record<string, SlotPlan> = {
    REMOVE_ITEM: slot ? slotPlan('REMOVE_ITEM', summary.data) : { count: 0, blocked: 'Chọn ngăn trước.' },
    EMPTY_COLUMN: slot ? slotPlan('EMPTY_COLUMN', summary.data) : { count: 0, blocked: 'Chọn ngăn trước.' },
  }
  const summaryPending = !!slot && !summary.data
  const refill = refillState(history.data && page === 0 ? history.data.content : head.data?.content)

  return <section aria-labelledby="maintenance-title" className="grid gap-5">
    <div>
      <h2 id="maintenance-title" className="text-base font-semibold">Bảo trì máy</h2>
      <p className="mt-1! max-w-[75ch] text-[13px] text-muted-foreground">Gửi lệnh điều khiển xuống máy. Lệnh chỉ gửi được khi máy ở trạng thái Bảo trì và đang kết nối; mỗi máy chạy một lệnh một lúc. Không lệnh nào xóa dữ liệu: hộp được rút chuyển sang Đã rút và ghi vào lịch sử kho.</p>
    </div>

    {lock && <LockNotice ref={lockRef} id={lockId} lock={lock} openStatusChange={lock.code === 'status' ? openStatusChange : undefined} />}
    {!lock && shown.shown === 'UNKNOWN' && <p role="status" className="rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3.5 py-2.5 text-[13px] text-status-warning-foreground">
      {unknownDetail(shown.staleSince)}. Lệnh vẫn gửi được, nhưng nếu máy đã mất kết nối thì lệnh sẽ dừng sau 60 giây (Quá thời gian).
    </p>}
    {failure && <p role="alert" className={ERROR_BOX}>{failure}</p>}

    <section aria-labelledby="maintenance-machine-title" className={PANEL}>
      <h3 id="maintenance-machine-title" className="text-sm font-semibold">Lệnh cho cả máy</h3>
      <p className="mt-1! mb-3! text-[13px] text-muted-foreground">
        Cửa nạp: {refill.state === 'open' ? <strong className="font-medium text-foreground">đang mở</strong> : refill.state === 'closed' ? 'đã đóng' : 'chưa rõ'}
        {refill.at ? ` (theo lệnh thành công lúc ${formatDateTime(refill.at)})` : ' (chưa có lệnh mở/đóng nào thành công)'}.
      </p>
      <ul className="grid gap-3" aria-label="Lệnh cho cả máy">
        {MACHINE_COMMANDS.map(type => <CommandRow key={type} type={type} lock={lock} lockId={lockId} sending={sending === type} busy={!!sending} onRun={() => run(type)} />)}
      </ul>
    </section>

    <section aria-labelledby="maintenance-slot-title" className={PANEL}>
      <h3 id="maintenance-slot-title" className="text-sm font-semibold">Lệnh theo ngăn</h3>
      <p className="mt-1! mb-3! text-[13px] text-muted-foreground">Chọn ngăn rồi gửi lệnh. Chỉ rút được hộp Sẵn sàng hoặc Hết hạn; hộp đang giữ cho đơn hay nhả hàng thất bại cần xử lý đơn trước.</p>
      {slots.error && !slots.data ? <ErrorState error={slots.error} retry={slots.reload} />
        : !slots.data ? <Loading label="Đang tải danh sách ngăn…" rows={2} />
        : slots.data.content.length === 0 ? <p className="text-[13px] text-muted-foreground">Máy chưa có ngăn nào nên chưa có lệnh theo ngăn. Thêm ngăn ở thẻ Ngăn.</p>
        : <>
          <div className="mb-3 grid max-w-sm gap-3">
            <FormField label="Ngăn">
              <NativeSelect value={slot ? slot.id : ''} data-focus-key="maintenance-slot" onChange={event => update({ maintenanceSlot: event.target.value || undefined })}>
                <option value="">Chọn ngăn…</option>
                {slots.data.content.map(candidate => <option key={candidate.id} value={candidate.id}>Ngăn {candidate.slotCode} ({statusMeta('slot', candidate.status).label})</option>)}
              </NativeSelect>
            </FormField>
          </div>
          {slot && <SlotFacts summary={summary.data} error={summary.error} retry={summary.reload} />}
          <ul className="mt-3 grid gap-3" aria-label="Lệnh theo ngăn">
            {SLOT_COMMANDS.map(type => <CommandRow key={type} type={type} lock={lock} lockId={lockId} sending={false} busy={!!sending}
              blocked={summaryPending ? 'Đang kiểm tra số hộp trong ngăn…' : plans[type].blocked} onRun={() => run(type)} />)}
          </ul>
        </>}
    </section>

    <HistoryPanel state={history} page={page} missing={isMaintenanceMissing(history.error) && !history.data}
      onPage={next => update({ commandPage: next ? String(next) : undefined })} />

    {asking && <CommandDialog machine={machine} type={asking} slotCode={slot?.slotCode} plan={SLOT_COMMANDS.includes(asking) ? plans[asking] : undefined}
      close={() => setAsking(null)}
      send={async reason => {
        try {
          sent(await sendMaintenanceCommand(machineId, asking, { slotId: slot?.id, reason }))
        } catch (error) { refreshAfter(error); throw error }
      }} />}
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

function CommandRow({ type, lock, lockId, blocked, sending, busy, onRun }: {
  type: MaintenanceCommandType; lock: Lock | null; lockId: string; blocked?: string; sending: boolean; busy: boolean; onRun: () => void
}) {
  const info = COMMAND_INFO[type]
  const doesId = useId(), blockedId = useId()
  const locked = !!lock || !!blocked
  const describedBy = [doesId, lock ? lockId : undefined, !lock && blocked ? blockedId : undefined].filter(Boolean).join(' ')
  const Icon = type === 'RESET' ? RotateCcw : Send
  return <li className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border px-3.5 py-3 max-sm:flex-col">
    <Button type="button" variant="outline" data-focus-key={`maintenance-${type}`} data-command={type}
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

function SlotFacts({ summary, error, retry }: { summary: InventorySummary | undefined; error: unknown; retry: () => void }) {
  if (error && !summary) return <div className={cn(ERROR_BOX, 'flex flex-wrap items-center gap-2')} role="alert">Không tải được số hộp của ngăn: {errorMessage(error)}
    {!(error instanceof ApiError && (error.status === 401 || error.status === 403)) && <Button type="button" size="sm" variant="outline" onClick={retry}>Thử lại</Button>}</div>
  if (!summary) return <p className="text-[13px] text-muted-foreground" role="status">Đang kiểm tra số hộp trong ngăn…</p>
  const removable = (summary.availableCount ?? 0) + (summary.expiredCount ?? 0)
  return <p className="text-[13px]" role="status">
    Đang có <strong className="font-semibold">{summary.occupiedCount ?? 0} hộp</strong> (sức chứa {summary.capacity ?? '—'}): {summary.availableCount ?? 0} sẵn sàng, {summary.expiredCount ?? 0} hết hạn, {summary.reservedCount ?? 0} đang giữ cho đơn.
    {' '}Rút được {removable} hộp.
    {summary.headStatus ? <> Hộp ở đáy ngăn: {statusMeta('box', summary.headStatus).label.toLowerCase()}{summary.headExpired && summary.headStatus !== 'EXPIRED' ? ' (đã hết hạn)' : ''}.</> : null}
  </p>
}

/**
 * Asks before REMOVE_ITEM, EMPTY_COLUMN and RESET: what the machine will do, on which slot and how many bowls, with an
 * optional note (sent as `reason`). Stays open while sending; a failure is shown inside so the person can retry.
 */
function CommandDialog({ machine, type, slotCode, plan, close, send }: {
  machine: Machine; type: MaintenanceCommandType; slotCode?: string; plan?: SlotPlan; close: () => void; send: (reason: string) => Promise<void>
}) {
  const info = COMMAND_INFO[type]
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [reasonError, setReasonError] = useState('')
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const count = plan?.count ?? 0
  const title = type === 'EMPTY_COLUMN' ? `Rút hết ${count} hộp ở ngăn ${slotCode}?` : type === 'REMOVE_ITEM' ? `Rút hộp đáy ngăn ${slotCode}?` : `Khởi động lại bộ nhả hàng của máy ${machine.code}?`
  const confirmLabel = type === 'EMPTY_COLUMN' ? `Rút ${count} hộp` : type === 'REMOVE_ITEM' ? 'Rút 1 hộp' : 'Khởi động lại'
  async function confirm() {
    if (pending) return
    if (reason.trim().length > REASON_MAX) { setReasonError(`Tối đa ${REASON_MAX} ký tự.`); reasonRef.current?.focus(); return }
    setPending(true); setFailure(''); setReasonError('')
    try { await send(reason); close() } catch (error) {
      const fieldError = error instanceof ApiError ? error.fieldErrors?.reason : undefined
      if (fieldError) { setReasonError(fieldError); reasonRef.current?.focus() }
      setFailure(errorMessage(error)); setPending(false)
    }
  }
  return <AlertDialog open onOpenChange={open => { if (!open && !pending) close() }}>
    <AlertDialogContent aria-busy={pending} onEscapeKeyDown={event => { if (pending) event.preventDefault() }}>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      <AlertDialogDescription asChild><div className="grid gap-2">
        <p>{info.does}</p>
        {type === 'EMPTY_COLUMN' && <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive">
          Máy <strong className="font-semibold">{machine.code}</strong>, ngăn <strong className="font-semibold">{slotCode}</strong>: <strong className="font-semibold">{count} hộp</strong> sẽ bị rút và chuyển sang Đã rút. Không hoàn tác được; muốn bán lại phải nạp hộp mới.
        </p>}
        {type === 'REMOVE_ITEM' && <p>Máy <strong className="font-medium text-foreground">{machine.code}</strong>, ngăn <strong className="font-medium text-foreground">{slotCode}</strong>: 1 hộp ở đáy ngăn sẽ bị rút.</p>}
        {type === 'RESET' && <p>Dùng khi thẻ Cảm biến & Sự kiện báo FAULT và bạn đã kiểm tra hai cửa, khay tại máy.</p>}
        <p>Tồn kho chỉ thay đổi khi máy báo đã làm xong; nếu máy báo thất bại hoặc không phản hồi, không hộp nào bị đổi.</p>
      </div></AlertDialogDescription>
      <FormField label="Ghi chú (không bắt buộc)" hint={`Lý do gửi lệnh, tối đa ${REASON_MAX} ký tự. Được ghi vào lịch sử lệnh${type === 'RESET' ? '' : ' và lịch sử kho'}.`} error={reasonError}>
        <Textarea ref={reasonRef} value={reason} rows={2} disabled={pending} onChange={event => { setReason(event.target.value); setReasonError('') }} />
      </FormField>
      {failure && <p className={ERROR_BOX} role="alert">{failure}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Hủy</AlertDialogCancel>
        <Button type="button" variant={info.danger ? 'destructive' : 'default'} disabled={pending} onClick={confirm}>{pending ? 'Đang gửi…' : confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

function HistoryPanel({ state, page, missing, onPage }: {
  state: ApiState<Page<MaintenanceCommand>>; page: number; missing: boolean; onPage: (page: number) => void
}) {
  const titleId = useId()
  const data = state.data
  const columns: Column<MaintenanceCommand>[] = [
    { head: 'Gửi lúc', nowrap: true, cell: command => formatDateTime(command.createdAt) },
    { head: 'Lệnh', cell: command => <span className="grid justify-items-start gap-0.5 text-left">
      <span className="font-medium">{commandLabel(command.type)}</span>
      <span className="font-mono text-xs text-muted-foreground">{command.commandCode}</span>
    </span> },
    { head: 'Trạng thái', cell: command => <span className="grid justify-items-start gap-1 text-left">
      <StatusBadge domain="dispense" value={command.status} describe={false} />
      <span className="text-xs text-muted-foreground">{commandStatusText(command.status)}{command.completedAt ? ` Kết thúc ${formatDateTime(command.completedAt)}.` : ''}</span>
    </span> },
    { head: 'Chi tiết', cell: command => <span className="grid justify-items-start gap-0.5 text-left text-[13px]">
      {commandDetail(command) && <span>{commandDetail(command)}</span>}
      {command.reason && <span className="text-muted-foreground">Ghi chú: {command.reason}</span>}
      {!commandDetail(command) && !command.reason && <span className="text-muted-foreground">—</span>}
    </span> },
    { head: 'Người gửi', cell: command => command.requestedByName },
  ]
  let body: ReactNode
  if (missing) body = <p role="status" className="rounded-lg border border-dashed px-4 py-4 text-[13px] text-muted-foreground">{MAINTENANCE_MISSING}</p>
  else body = <>
    <DataTable state={{ ...state, error: data ? undefined : state.error }} rows={data?.content} rowKey={command => command.id} columns={columns} caption="Lịch sử lệnh bảo trì"
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
