// O4 Thực hiện phiếu nạp hàng (FE 7.2), made for a phone at the machine (390 px): one step per block with a progress bar:
// (1) start the work order (the machine goes MAINTENANCE), (2) take the old bowls out with maintenance commands linked to
// the work order (REMOVE_ITEM / EMPTY_COLUMN with a reason), (3) load each planned line from one batch (opening the refill
// gate of the column when needed), (4) close every refill gate (CLOSE_REFILL), (5) compare plan and result, give a reason
// for every line loaded ≠ planned, and complete. Route /admin/tickets/:id/restock.
// API (api-contract/api.yaml, backend #64/#66/#68): GET /work-orders/{id}/restock (lines, loads, linked commands, bowls
// removed by reason), POST .../restock-lines/{lineId}/loads (RESTOCK_EXECUTE, IN_PROGRESS, the assignee or an Admin),
// POST /machines/{machineId}/slots/{slotId}/maintenance-commands with workOrderId and an Idempotency-Key, POST /complete
// with lineVariances. RESTOCK_PLAN (Admin) also plans the lines here (add, change, take out while nothing was loaded).
// The step always follows server data (work order, lines, the machine's slots and running command: restock.ts), so a
// reload lands on the right step. Nothing is deleted: bowls taken out stay in the history as REMOVED.
import { useEffect, useId, useRef, useState } from 'react'
import type { Ref } from 'react'
import { Check, Lock as LockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '../../api/client.ts'
import { batchesApi, machinesApi, maintenanceCommandsApi, restockApi, slotsApi, workOrdersApi } from '../../api/resources.ts'
import type { Batch, InventorySummary, LinkedMaintenanceCommand, Machine, MaintenanceCommand, MaintenanceReason, RestockLine, RestockView, Slot, WorkOrder } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, NativeSelect, Textarea } from '../../components/ui/input.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { alertPath, alertTypeLabel, machinePath } from '../alerts.ts'
import { countLoaded } from '../batches.ts'
import type { LoadedCount } from '../batches.ts'
import { CONNECTION_POLL_MS } from '../connection.ts'
import { CHECK_FIELDS, INVALID_REQUEST, ValidationError } from '../form-error.ts'
import { fitConflictText, parseBoxCount, quantityHint, roomLines } from '../inventory-load.ts'
import type { FitConflict, LoadRoom, Reload } from '../inventory-load.ts'
import { ConfirmDialog, ErrorState, Link, Loading, PageHead, useForm } from '../kit.tsx'
import {
  COMMAND_INFO, MAINTENANCE_IDLE_POLL_MS, MAINTENANCE_POLL_MS, REASON_OPTIONS, commandLabel, commandStatusLabel, commandStatusText, createAttempts,
  isMaintenanceMissing, machineLock, needsRefresh, reasonLabel, runningCommand, sendMaintenanceCommand, slotPlan,
} from '../maintenance-commands.ts'
import type { ColumnOperation, Lock } from '../maintenance-commands.ts'
import { ReconcileDialog } from '../maintenance-parts.tsx'
import { useProductOptions } from '../options.ts'
import {
  NEW_LINE, RESTOCK_STEPS, STEP_LABELS, bowls, columnState, columnText, defaultQuantity, describeCompleteError, describeLineLoadError, describePlanError,
  differenceText, leftToLoad, lineInputBody, lineLoadBody, lineQuantityProblem, linkedAttention, openGates, reconcile, removedText, restockCompleteBody,
  restockStep, shownStep, stepProgress, stepState, updateLineBody, validateLine, varianceField,
} from '../restock.ts'
import type { LineValues, RestockStep, RestockStepKey } from '../restock.ts'
import { TICKET_LIMITS, assigneeText, isClosed, mayExecute, ticketActionError, ticketPath } from '../tickets.ts'
import type { TicketViewer } from '../tickets.ts'
import { errorMessage, useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import { useConnection } from '../useConnection.ts'
import { useSession } from '../useSession.ts'
import { useTicketViewer } from '../useTicketViewer.ts'
import { TicketUnavailable, loadTicket } from '../work-order-load.ts'

const PANEL = 'min-w-0 rounded-xl border bg-card p-4 shadow-xs sm:p-5'
const ERROR_BOX = 'rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive'
const NOTE_BOX = 'rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]'
const CARD = 'grid gap-3 rounded-lg border px-3.5 py-3'
/** Touch targets of at least 44 px; full width on a phone. */
const BIG = 'h-11 w-full sm:w-auto'
const LINK = 'font-medium text-primary underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const HEADING = 'font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const MACHINE_POLL_MS = 10_000
/** Read in event handlers only (render stays pure). */
const clock = () => Date.now()
/** Focus fell back to the page (the focused control was removed from the screen). */
const lostFocus = () => !document.activeElement || document.activeElement === document.body

/** Free places and old bowls of every line's slot. */
async function loadSummaries(machineId: string, slotIds: readonly string[], signal: AbortSignal): Promise<Record<string, InventorySummary>> {
  const entries = await Promise.all(slotIds.map(async slotId => [slotId, await slotsApi.summary(machineId, slotId, signal)] as const))
  return Object.fromEntries(entries)
}
interface LineBatches { byProduct: Record<string, Batch[]>; counts: Record<string, LoadedCount> }
/** Loadable batches of each line's product (earliest expiry first) and how many bowls each has already given. */
async function loadBatches(productIds: readonly string[], now: number, signal: AbortSignal): Promise<LineBatches> {
  const pages = await Promise.all(productIds.map(productId => batchesApi.list({ productId, page: 0, size: 100, sort: 'expiresAt,asc' }, signal)))
  const byProduct = Object.fromEntries(productIds.map((productId, index) => [productId, pages[index].content.filter(batch => Date.parse(batch.expiresAt ?? '') > now)]))
  const counts = await countLoaded(Object.values(byProduct).flat().map(batch => batch.id!).filter(Boolean), signal)
  return { byProduct, counts }
}
const unique = <T,>(values: T[]) => [...new Set(values)]

const BACK_LIST = { to: '/admin/tickets', label: 'Danh sách phiếu công việc' }

function TicketRestockPage({ ticketId }: { ticketId: string }) {
  const state = useApi(signal => loadTicket(ticketId, signal), `restock|${ticketId}`)
  const ticket = state.data
  if (state.error && !ticket) {
    if (state.error instanceof TicketUnavailable) return <>
      <PageHead title={state.error.kind === 'missing' ? 'Chưa có dữ liệu phiếu công việc' : 'Không tìm thấy phiếu'} back={BACK_LIST} />
      <div role="alert" className="px-4 py-10 text-center text-muted-foreground">
        <p>{state.error.message}</p>
        <p className="mt-3!"><Button asChild variant="outline" className="h-11"><Link to={BACK_LIST.to}>Về danh sách phiếu</Link></Button></p>
      </div>
    </>
    return <><PageHead title="Thực hiện nạp hàng" back={BACK_LIST} /><ErrorState error={state.error} retry={state.reload} /></>
  }
  if (!ticket) return <><PageHead title="Thực hiện nạp hàng" back={BACK_LIST} /><Loading label="Đang tải phiếu nạp hàng…" rows={5} /></>
  const back = { to: ticketPath(ticket.id), label: 'Chi tiết phiếu' }
  if (ticket.type !== 'RESTOCK') return <>
    <PageHead title={ticket.title ?? 'Phiếu công việc'} back={back} subtitle={`Máy ${ticket.machineCode}`} />
    <div role="status" className={cn(PANEL, 'grid gap-3 text-[14px]')}>
      <p>Đây không phải phiếu nạp hàng nên không làm theo từng bước ở đây.</p>
      <p className="text-muted-foreground">Làm việc tại máy rồi bấm “Hoàn tất” ở trang chi tiết phiếu và ghi lại đã làm gì.</p>
      <p><Button asChild variant="outline" className={BIG}><Link to={back.to}>Về chi tiết phiếu</Link></Button></p>
    </div>
  </>
  return <RestockRun ticket={ticket} reloadTicket={state.reload} back={back} />
}

function RestockRun({ ticket, reloadTicket, back }: { ticket: WorkOrder; reloadTicket: () => void; back: { to: string; label: string } }) {
  const viewer = useTicketViewer()
  const { can } = useSession()
  const ticketId = ticket.id!, machineId = ticket.machineId!
  // Bumped after every change at the machine: everything below reads again.
  const [tick, setTick] = useState(0)
  const refresh = () => setTick(value => value + 1)
  const view = useApi(signal => restockApi.view(ticketId, signal), `restock-view|${ticketId}|${ticket.version}|${ticket.updatedAt}|${tick}`)
  const lines = view.data?.lines ?? []
  const lineKey = lines.map(line => `${line.id}:${line.loadedQuantity}:${line.plannedQuantity}:${line.productId}`).join(',')

  // The machine's newest maintenance command: every 2 s while one runs, else every 30 s.
  const [fast, setFast] = useState(false)
  const commands = useApi(signal => maintenanceCommandsApi.list({ machineId, page: 0, size: 1 }, signal), `restock-commands|${machineId}`,
    { pollMs: fast ? MAINTENANCE_POLL_MS : MAINTENANCE_IDLE_POLL_MS, stopOn: isMaintenanceMissing })
  const [sent, setSent] = useState<MaintenanceCommand | null>(null)
  const listed = !!sent && !!commands.data?.content.some(command => command.id === sent.id || (command.createdAt ?? '') > (sent.createdAt ?? ''))
  const running = runningCommand(commands.data?.content) ?? (sent && !listed ? sent : undefined)
  if (commands.data && fast !== !!running) setFast(!!running)
  const missing = isMaintenanceMissing(commands.error) && !commands.data

  const machine = useApi(signal => machinesApi.get(machineId, signal), `restock-machine|${machineId}|${tick}`, { pollMs: Math.min(MACHINE_POLL_MS, CONNECTION_POLL_MS) })
  const shown = useConnection(machine.data?.lastSeenAt, machine, machine.data?.connectivity)
  const slots = useApi(signal => slotsApi.list(machineId, { page: 0, size: 100 }, signal), `restock-slots|${machineId}|${tick}`)
  const slotIds = unique(lines.map(line => line.slotId ?? '')).filter(Boolean)
  const summaries = useApi(signal => loadSummaries(machineId, slotIds, signal), `restock-summaries|${slotIds.join(',')}|${lineKey}|${tick}`)
  const [batchNow] = useState(() => Date.now())
  const productIds = unique(lines.map(line => line.productId ?? '')).filter(Boolean)
  const batches = useApi(signal => loadBatches(productIds, batchNow, signal), `restock-batches|${productIds.join(',')}|${lineKey}|${tick}`)

  // A command that just ended may have changed the gates or the bowls: read everything again, and put focus back on the
  // step heading when the block that had it ("Đang chờ máy…") went away. The control that has focus may also go away a
  // moment later, when the figures read again remove it (a column emptied loses its command buttons): until those
  // figures are back, focus that falls to the page goes to the step heading too.
  const lastRunning = useRef<string | undefined>(undefined)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const recoverSince = useRef<number | null>(null)
  useEffect(() => {
    if (recoverSince.current === null) return
    if (lostFocus()) { recoverSince.current = null; headingRef.current?.focus() }
    else if ((summaries.updatedAt ?? 0) > recoverSince.current && !summaries.loading) recoverSince.current = null
  })
  useEffect(() => {
    if (lastRunning.current && !running) {
      setTick(value => value + 1)
      recoverSince.current = Date.now()
      if (lostFocus()) headingRef.current?.focus()
    }
    lastRunning.current = running?.id
  }, [running])

  const gates = openGates(slots.data?.content)
  const derived = restockStep({ status: ticket.status, lines, gatesOpen: gates.length, running })
  const [chosen, setChosen] = useState<RestockStepKey | null>(null)
  const step = shownStep(derived, chosen, gates.length)
  const executes = mayExecute(ticket, viewer) && !!ticket.assignee?.id
  const canLoad = executes && can('RESTOCK_EXECUTE')
  const canPlan = can('RESTOCK_PLAN') && !isClosed(ticket)
  const lock = machineLock({
    canMaintain: can('MAINTENANCE_COMMAND_EXECUTE'), canChangeStatus: can('MACHINE_WRITE'), machineStatus: machine.data?.status ?? 'ACTIVE',
    connection: shown.shown, neverConnected: shown.never, running, missing,
  })
  const lockRef = useRef<HTMLDivElement>(null)
  const waitRef = useRef<HTMLParagraphElement>(null)
  const [attempts] = useState(createAttempts)
  const [busy, setBusy] = useState<string | null>(null)
  const [failureOf, setFailureOf] = useState<{ step: RestockStep; text: string } | null>(null)
  const [reconciling, setReconciling] = useState<LinkedMaintenanceCommand | null>(null)

  // Focus the step heading when the step changes (not on first render), so keyboard and screen reader users follow.
  const previous = useRef<RestockStep | null>(null)
  useEffect(() => {
    if (previous.current && previous.current !== step) headingRef.current?.focus()
    previous.current = step
  }, [step])
  const focusWait = useRef(false)
  useEffect(() => { if (focusWait.current && waitRef.current) { focusWait.current = false; waitRef.current.focus() } })
  // A failure belongs to the step it happened on: moving to another step hides it.
  const failure = failureOf?.step === step ? failureOf.text : ''
  const setFailure = (text: string) => setFailureOf(text ? { step, text } : null)

  async function start() {
    if (busy) return
    setBusy('start'); setFailure('')
    try {
      await workOrdersApi.start(ticketId)
      toast.success('Đã bắt đầu phiếu', { description: `Máy ${ticket.machineCode} chuyển sang Bảo trì.` })
      reloadTicket(); refresh()
    } catch (error) {
      setFailure(errorMessage(ticketActionError(error, 'start', 'detail')))
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) reloadTicket()
    } finally { setBusy(null) }
  }
  /** One column command linked to this work order (old bowls out, refill gate). Returns whether it was sent. */
  async function send(operation: ColumnOperation, slot: { id?: string; slotCode?: string }, reason?: MaintenanceReason, note?: string): Promise<boolean> {
    if (busy) return false
    if (lock) { lockRef.current?.focus(); return false }
    setBusy(`${operation}|${slot.id}`); setFailure('')
    try {
      const command = await sendMaintenanceCommand(attempts, machineId, slot.id!, operation, { reason, note, workOrderId: ticketId })
      focusWait.current = true; setSent(command); commands.reload()
      toast.success(`Đã gửi lệnh “${COMMAND_INFO[operation].label}”`, { description: `Ngăn ${slot.slotCode}. Chờ máy báo xong.` })
      return true
    } catch (error) {
      setFailure(errorMessage(error))
      if (needsRefresh(error)) { machine.reload(); commands.reload(); refresh(); reloadTicket() }
      return false
    } finally { setBusy(null) }
  }
  const go = (next: RestockStepKey) => setChosen(next)
  const progress = stepProgress(step)
  const attention = linkedAttention(view.data?.maintenanceCommands)
  const commandBlock = { lock, lockRef, reloadMachine: machine.reload, running, waitRef, attention, reconcile: setReconciling }

  const readOnly = !executes
  return <>
    <PageHead title={ticket.title ?? 'Phiếu nạp hàng'} back={back} subtitle={`Nạp hàng · ${ticket.code ?? ''} · máy ${ticket.machineCode}${ticket.machineName ? ` · ${ticket.machineName}` : ''}`} />
    <div className="mx-auto grid max-w-2xl gap-4">
      <StepBar step={step} progress={progress} />
      {readOnly && !isClosed(ticket) && <p role="status" className={NOTE_BOX}>
        {ticket.assignee?.id
          ? <>Phiếu này giao cho <strong className="font-medium">{assigneeText(ticket)}</strong>; chỉ người được giao (hoặc quản trị viên) thực hiện các bước. Bạn đang xem tiến độ.</>
          : 'Phiếu chưa có người phụ trách nên chưa thực hiện được. Quản trị viên phân công ở trang chi tiết phiếu.'}
      </p>}
      {canPlan && view.data && <PlanPanel ticket={ticket} machineId={machineId} lines={lines} slots={slots.data?.content} changed={() => { refresh(); reloadTicket() }} />}
      {view.error && !view.data ? <section className={PANEL} aria-labelledby="restock-view-error">
        <h2 id="restock-view-error" ref={headingRef} tabIndex={-1} className={cn('mb-1 text-base font-semibold', HEADING)}>Chưa đọc được kế hoạch nạp</h2>
        <ErrorState error={view.error} retry={view.reload} />
      </section>
        : !view.data || (!slots.data && !slots.error) ? <Loading label="Đang đọc kế hoạch nạp và các ngăn của máy…" rows={3} />
        : <section className={PANEL} aria-labelledby="restock-step-title">
          <h2 id="restock-step-title" ref={headingRef} tabIndex={-1} className={cn('mb-1 text-base font-semibold', HEADING)}>
            {step === 'done' ? (ticket.status === 'CANCELLED' ? 'Phiếu đã hủy' : 'Phiếu đã hoàn tất') : `Bước ${progress.index}/${progress.total}: ${progress.label}`}
          </h2>
          {failure && <p role="alert" className={cn(ERROR_BOX, 'my-3')}>{failure}</p>}
          {step === 'start' && <StartStep ticket={ticket} viewer={viewer} lines={lines} executes={executes} busy={busy} start={start} />}
          {step === 'remove' && <RemoveStep lines={lines} view={view.data} slots={slots.data?.content} summaries={summaries} readOnly={readOnly} busy={busy}
            send={send} next={() => go('load')} block={commandBlock} />}
          {step === 'load' && <LoadStep ticketId={ticketId} lines={lines} slots={slots.data?.content} summaries={summaries} batches={batches} readOnly={!canLoad} busy={busy}
            send={send} block={commandBlock} changed={() => { setChosen('load'); refresh(); reloadTicket() }} refreshFigures={refresh}
            back={() => go('remove')} next={() => go('close')} />}
          {step === 'close' && <CloseStep lines={lines} gates={gates} readOnly={readOnly} busy={busy} send={send} block={commandBlock}
            back={() => go('load')} next={() => go('reconcile')} />}
          {step === 'reconcile' && <ReconcileStep ticket={ticket} lines={lines} readOnly={readOnly} back={() => go('load')}
            completed={() => { reloadTicket(); refresh() }} stale={() => { setChosen(null); reloadTicket(); refresh() }} />}
          {step === 'done' && <DoneStep ticket={ticket} lines={lines} view={view.data} machine={machine.data} />}
        </section>}
      <p className="text-[13px] text-muted-foreground">
        Mỗi bước được lưu trên máy chủ: tải lại trang hoặc mở lại phiếu trên máy khác sẽ tiếp tục đúng bước. <Link to={back.to} className={LINK}>Xem chi tiết phiếu</Link>
      </p>
    </div>
    {reconciling && <ReconcileDialog command={reconciling} close={() => setReconciling(null)} done={() => { commands.reload(); refresh() }} />}
  </>
}

/** Five numbered steps with the current one marked (aria-current) and named in words, plus a bar. */
function StepBar({ step, progress }: { step: RestockStep; progress: { index: number; total: number; label: string } }) {
  const percent = step === 'done' ? 100 : Math.round(((progress.index - 1) / progress.total) * 100)
  return <div role="group" aria-label="Tiến độ nạp hàng" className="grid gap-2">
    <div role="progressbar" aria-label="Tiến độ nạp hàng" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={step === 'done' ? progress.total : progress.index - 1}
      aria-valuetext={step === 'done' ? 'Đã xong cả 5 bước' : `Bước ${progress.index}/${progress.total}: ${progress.label}`}
      className="h-2 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary motion-safe:transition-[width]" style={{ width: `${percent}%` }} />
    </div>
    <ol className="grid grid-cols-5 gap-1 text-center text-[11px] leading-tight sm:text-xs">
      {RESTOCK_STEPS.map((key, index) => {
        const state = stepState(key, step)
        return <li key={key} aria-current={state === 'current' ? 'step' : undefined} className={cn('grid justify-items-center gap-1', state === 'todo' ? 'text-muted-foreground' : 'text-foreground', state === 'current' && 'font-semibold')}>
          <span aria-hidden="true" className={cn('grid size-7 place-items-center rounded-full border text-xs',
            state === 'done' && 'border-primary bg-primary text-primary-foreground', state === 'current' && 'border-primary text-primary ring-2 ring-primary/30')}>
            {state === 'done' ? <Check className="size-3.5" /> : index + 1}
          </span>
          <span>{STEP_LABELS[key]}<span className="sr-only">{state === 'done' ? ' (đã xong)' : state === 'current' ? ' (bước hiện tại)' : ''}</span></span>
        </li>
      })}
    </ol>
  </div>
}

interface CommandBlock {
  lock: Lock | null; lockRef: Ref<HTMLDivElement>; reloadMachine: () => void; running?: Pick<MaintenanceCommand, 'operation' | 'status' | 'slotCode'>
  waitRef: Ref<HTMLParagraphElement>; attention?: LinkedMaintenanceCommand; reconcile: (command: LinkedMaintenanceCommand) => void
}
type Send = (operation: ColumnOperation, slot: { id?: string; slotCode?: string }, reason?: MaintenanceReason, note?: string) => Promise<boolean>

/** What blocks the commands now (lock with the next step), the command the machine is running, and a linked one in trouble. */
function CommandState({ block, readOnly }: { block: CommandBlock; readOnly: boolean }) {
  const { lock, lockRef, reloadMachine, running, waitRef, attention, reconcile } = block
  return <>
    {running && <p ref={waitRef} tabIndex={-1} role="status" className={cn(NOTE_BOX, 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring')}>
      <strong className="font-medium">Đang chờ máy: “{commandLabel(running.operation)}”{running.slotCode ? ` ngăn ${running.slotCode}` : ''}</strong> ({commandStatusLabel(running.status).toLowerCase()}). {commandStatusText(running.status)} Trang tự cập nhật mỗi 2 giây.
    </p>}
    {!running && attention && <div role="alert" className={cn(ERROR_BOX, 'grid gap-2')}>
      <p>Lệnh “{commandLabel(attention.operation)}”{attention.slotCode ? ` ngăn ${attention.slotCode}` : ''} gửi lúc {formatDateTime(attention.createdAt)}: {commandStatusLabel(attention.status).toLowerCase()}.{' '}
        {attention.status === 'NEEDS_RECONCILIATION' ? 'Máy đã nhận lệnh nhưng không báo kết quả: kiểm tra tại máy rồi đối soát trước khi tiếp tục.' : 'Không có gì thay đổi; kiểm tra tại máy rồi gửi lại.'}</p>
      {attention.status === 'NEEDS_RECONCILIATION' && !readOnly && <p><Button type="button" variant="outline" className="h-11" onClick={() => reconcile(attention)}>Đối soát lệnh này</Button></p>}
    </div>}
    {!running && !readOnly && lock && <div ref={lockRef} tabIndex={-1} data-lock={lock.code}
      className="flex gap-3 rounded-xl border border-status-warning-foreground/30 bg-status-warning px-4 py-3.5 text-[13px] text-status-warning-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
      <LockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="grid min-w-0 gap-1">
        <p className="font-semibold">Chưa gửi lệnh được</p>
        <p>{lock.reason}</p>
        <p><strong className="font-semibold">Việc cần làm:</strong> {lock.next}</p>
        {(lock.code === 'status' || lock.code === 'offline') && <p className="mt-1!"><Button type="button" variant="outline" className="h-11" onClick={reloadMachine}>Kiểm tra lại trạng thái máy</Button></p>}
      </div>
    </div>}
  </>
}
function CommandButton({ label, busyLabel, pending, blocked, locked, onClick, variant = 'outline' }: {
  label: string; busyLabel?: string; pending: boolean; blocked?: string; locked: boolean; onClick: () => void; variant?: 'outline' | 'default' | 'destructive'
}) {
  const hintId = useId()
  return <span className="grid gap-1">
    <Button type="button" variant={locked ? 'outline' : variant} className={cn(BIG, locked && 'border-dashed')} aria-disabled={locked || !!blocked || pending ? true : undefined}
      aria-describedby={blocked ? hintId : undefined} onClick={() => { if (!blocked && !pending) onClick() }}>
      {locked && <LockIcon aria-hidden="true" />}{pending ? (busyLabel ?? 'Đang gửi…') : label}
    </Button>
    {blocked && <span id={hintId} className="text-[13px] text-muted-foreground">{blocked}</span>}
  </span>
}

function StartStep({ ticket, viewer, lines, executes, busy, start }: { ticket: WorkOrder; viewer: TicketViewer; lines: readonly RestockLine[]; executes: boolean; busy: string | null; start: () => void }) {
  return <div className="grid gap-3 text-[14px]">
    <p className="text-muted-foreground">Tới máy <strong className="font-medium text-foreground">{ticket.machineCode}</strong> rồi bắt đầu phiếu: máy chuyển sang Bảo trì để kiosk không bán trong lúc rút và nạp hộp.</p>
    {lines.length > 0 && <ul className="grid gap-1.5 text-[13px]" aria-label="Kế hoạch nạp">
      {lines.map(line => <li key={line.id} className="rounded-md bg-muted/40 px-3 py-2">Ngăn {line.slotCode} · {line.productName}: nạp {bowls(line.plannedQuantity ?? 0)}</li>)}
    </ul>}
    {!lines.length && <p className={NOTE_BOX}>Phiếu chưa có dòng nạp (ngăn, sản phẩm, số hộp) nên chưa bắt đầu được. Quản trị viên lập kế hoạch ở khối “Kế hoạch nạp” phía trên.</p>}
    {ticket.status === 'OPEN' && <p className={NOTE_BOX}>Phiếu chưa có người phụ trách. Quản trị viên phân công ở trang chi tiết phiếu.</p>}
    {ticket.status === 'ASSIGNED' && (executes
      ? <Button type="button" className={BIG} disabled={!!busy || !lines.length} onClick={start}>{busy === 'start' ? 'Đang bắt đầu…' : 'Bắt đầu phiếu'}</Button>
      : <p className="text-[13px] text-muted-foreground">Chờ {assigneeText(ticket, viewer)} bắt đầu tại máy.</p>)}
  </div>
}

/** Step 2: per column, what is there now and the two ways to take bowls out (linked to the work order). */
function RemoveStep({ lines, view, slots, summaries, readOnly, busy, send, next, block }: {
  lines: readonly RestockLine[]; view: RestockView; slots?: readonly Slot[]; summaries: ApiState<Record<string, InventorySummary>>; readOnly: boolean; busy: string | null
  send: Send; next: () => void; block: CommandBlock
}) {
  const columns = unique(lines.map(line => line.slotId ?? '')).filter(Boolean)
  const [asking, setAsking] = useState<{ slotId: string; slotCode: string; count: number; reason: MaintenanceReason } | null>(null)
  if (summaries.error && !summaries.data) return <ErrorState error={summaries.error} retry={summaries.reload} />
  if (!summaries.data) return <Loading label="Đang đọc các hộp trong ngăn…" rows={3} />
  return <div className="grid gap-4 text-[14px]">
    <p className="text-muted-foreground">Lấy hộp hết hạn, hỏng hoặc nhả lỗi ra trước khi nạp: máy mở cổng dưới cho hộp rơi ra. Hộp rút ra không bị xóa, được ghi Đã rút kèm lý do.</p>
    <CommandState block={block} readOnly={readOnly} />
    {columns.map(slotId => {
      const slot = slots?.find(candidate => candidate.id === slotId)
      const slotCode = slot?.slotCode ?? lines.find(line => line.slotId === slotId)?.slotCode ?? ''
      return <RemoveCard key={slotId} slotId={slotId} slotCode={slotCode} gateOpen={!!slot?.refillGateOpen} summary={summaries.data?.[slotId]} readOnly={readOnly}
        busy={busy} locked={!!block.lock || !!block.running} send={send} askEmpty={setAsking} />
    })}
    <p className={NOTE_BOX}>{removedText(view.removedByReason)}</p>
    {!readOnly && <Button type="button" className={BIG} disabled={!!block.running} onClick={next}>Tiếp tục: Nạp theo dòng</Button>}
    {asking && <ConfirmDialog title={`Xả cả ngăn ${asking.slotCode}?`} confirmLabel="Xả cả ngăn" danger close={() => setAsking(null)}
      successMessage="Đã gửi lệnh xả ngăn" successDescription={`Ngăn ${asking.slotCode} · ${reasonLabel(asking.reason)}`}
      message={<p>{COMMAND_INFO.EMPTY_COLUMN.does} Ngăn đang có {bowls(asking.count)}. Lý do ghi lại: “{reasonLabel(asking.reason)}”.</p>}
      onConfirm={async () => { if (!(await send('EMPTY_COLUMN', { id: asking.slotId, slotCode: asking.slotCode }, asking.reason))) throw new Error('Chưa gửi được lệnh. Xem thông báo phía trên rồi thử lại.') }} />}
  </div>
}

function RemoveCard({ slotId, slotCode, gateOpen, summary, readOnly, busy, locked, send, askEmpty }: {
  slotId: string; slotCode: string; gateOpen: boolean; summary?: InventorySummary; readOnly: boolean; busy: string | null; locked: boolean
  send: Send; askEmpty: (target: { slotId: string; slotCode: string; count: number; reason: MaintenanceReason }) => void
}) {
  const state = columnState(summary)
  const reasonId = useId()
  const [reason, setReason] = useState<MaintenanceReason | ''>('')
  const chosen: MaintenanceReason = reason || (state?.toRemove ? 'EXPIRED' : 'RESTOCK')
  const head = slotPlan('REMOVE_ITEM', summary, gateOpen), all = slotPlan('EMPTY_COLUMN', summary, gateOpen)
  return <section aria-labelledby={`remove-${slotId}`} className={CARD}>
    <h3 id={`remove-${slotId}`} tabIndex={-1} className={HEADING}>Ngăn {slotCode}</h3>
    <p className="text-[13px] text-muted-foreground">{columnText(state)}</p>
    {!readOnly && state && state.present > 0 && <>
      <FormField label="Lý do rút" hint="Ghi vào lịch sử hộp.">
        <NativeSelect id={reasonId} value={chosen} className="h-11 text-base sm:text-sm" onChange={event => setReason(event.target.value as MaintenanceReason)}>
          {REASON_OPTIONS.filter(option => option.value !== 'OTHER').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <CommandButton label={`Rút hộp đáy ngăn ${slotCode}`} pending={busy === `REMOVE_ITEM|${slotId}`} blocked={head.blocked} locked={locked}
          onClick={() => void send('REMOVE_ITEM', { id: slotId, slotCode }, chosen)} />
        <CommandButton label={`Xả cả ngăn ${slotCode}`} pending={busy === `EMPTY_COLUMN|${slotId}`} blocked={all.blocked} locked={locked} variant="destructive"
          onClick={() => askEmpty({ slotId, slotCode, count: all.count, reason: chosen })} />
      </div>
    </>}
  </section>
}

/** Step 3: load every line from a batch; the refill gate of a column can be opened from here. */
function LoadStep({ ticketId, lines, slots, summaries, batches, readOnly, busy, send, block, changed, refreshFigures, back, next }: {
  ticketId: string; lines: readonly RestockLine[]; slots?: readonly Slot[]; summaries: ApiState<Record<string, InventorySummary>>; batches: ApiState<LineBatches>
  readOnly: boolean; busy: string | null; send: Send; block: CommandBlock; changed: () => void; refreshFigures: () => void; back: () => void; next: () => void
}) {
  const short = lines.reduce((total, line) => total + leftToLoad(line), 0)
  return <div className="grid gap-4 text-[14px]">
    <p className="text-muted-foreground">Xếp hộp vào từng ngăn rồi ghi số hộp thực tế theo lô. Số mặc định là phần còn lại của kế hoạch, không vượt chỗ trống của ngăn.</p>
    <CommandState block={block} readOnly={readOnly} />
    {(summaries.error && !summaries.data) ? <ErrorState error={summaries.error} retry={summaries.reload} />
      : lines.map(line => <LineLoadCard key={line.id} ticketId={ticketId} line={line} slot={slots?.find(slot => slot.id === line.slotId)} summary={summaries.data?.[line.slotId ?? '']}
        batches={batches} readOnly={readOnly} busy={busy} locked={!!block.lock || !!block.running} send={send} changed={changed} refreshFigures={refreshFigures} />)}
    {short > 0 && <p className={NOTE_BOX}>Còn {bowls(short)} chưa nạp theo kế hoạch. Nếu không đủ hộp, vẫn tiếp tục được và ghi lý do ở bước Đối chiếu.</p>}
    {!readOnly && <div className="grid gap-2 sm:flex sm:flex-wrap">
      <Button type="button" className={BIG} onClick={next}>Tiếp tục: Đóng cổng nạp</Button>
      <Button type="button" variant="outline" className={BIG} onClick={back}>Quay lại: Rút hộp cũ</Button>
    </div>}
  </div>
}

function LineLoadCard({ ticketId, line, slot, summary, batches, readOnly, busy, locked, send, changed, refreshFigures }: {
  ticketId: string; line: RestockLine; slot?: Slot; summary?: InventorySummary; batches: ApiState<LineBatches>; readOnly: boolean; busy: string | null; locked: boolean
  send: Send; changed: () => void; refreshFigures: () => void
}) {
  const titleId = useId()
  const [picked, setPicked] = useState('')
  const [typed, setTyped] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ batchId?: string; quantity?: string }>({})
  const [failure, setFailure] = useState('')
  const [inversion, setInversion] = useState('')
  const [pending, setPending] = useState(false)
  const [more, setMore] = useState(false)
  const [conflict, setConflict] = useState<(FitConflict & { since: number }) | null>(null)
  const options = batches.data?.byProduct[line.productId ?? ''] ?? []
  const batchId = options.some(batch => batch.id === picked) ? picked : options[0]?.id ?? ''
  const batch = options.find(candidate => candidate.id === batchId)
  const count = batchId ? batches.data?.counts[batchId] : undefined
  const room: LoadRoom = {
    slotCode: line.slotCode, free: summary?.remainingCapacity, capacity: summary?.capacity,
    batchCode: batch?.batchCode, declared: batch?.quantity, loaded: count?.ok ? count.loaded : undefined,
  }
  const quantity = typed ?? defaultQuantity(line, room)
  const reload: Reload = !conflict ? 'ok' : batches.loading ? 'pending' : batches.error ? 'failed' : (batches.updatedAt ?? 0) > conflict.since ? 'ok' : 'pending'
  const quantityError = errors.quantity ? (conflict ? fitConflictText(conflict, room, reload) : errors.quantity) : lineQuantityProblem(quantity, room)
  const full = (line.loadedQuantity ?? 0) >= (line.plannedQuantity ?? 0)
  const lineFacts = roomLines(room)
  const gateOpen = !!slot?.refillGateOpen

  async function submit(acknowledge = false) {
    if (pending) return
    setFailure(''); setConflict(null); if (!acknowledge) setInversion('')
    let body
    try { body = lineLoadBody(batchId, quantity, room, acknowledge) } catch (error) {
      if (error instanceof ValidationError) { setErrors(error.fieldErrors); return }
      throw error
    }
    setPending(true); setErrors({})
    try {
      const result = await restockApi.load(ticketId, line.id!, body)
      toast.success(`Đã nạp ${bowls(result.loaded ?? body.quantity)} vào ngăn ${line.slotCode}`, { description: `Lô ${batch?.batchCode ?? ''}. Đã ghi vào lịch sử kho.` })
      setTyped(null); setMore(false); setInversion('')
      changed()
      // When the line is now full its form gives way to "Nạp thêm": keep keyboard focus on the line.
      document.getElementById(titleId)?.focus()
    } catch (error) {
      const described = describeLineLoadError(error, parseBoxCount(quantity), room)
      if (described.refresh) refreshFigures()
      if (described.stale) changed()
      if (described.conflict) setConflict({ ...described.conflict, since: clock() })
      if (described.inversion) setInversion(described.inversion)
      else if (described.error instanceof ValidationError) setErrors(described.error.fieldErrors)
      else setFailure(errorMessage(described.error))
    } finally { setPending(false) }
  }

  return <section aria-labelledby={titleId} className={CARD}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 id={titleId} tabIndex={-1} className={HEADING}>Ngăn {line.slotCode} · {line.productName}</h3>
      <span className={cn('text-[13px]', full ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        {full ? <><Check aria-hidden="true" className="mr-1 inline size-4 text-primary" />Đã nạp đủ</> : `Còn ${bowls(leftToLoad(line))}`}
      </span>
    </div>
    <dl className="grid grid-cols-3 gap-2 text-center text-[13px]">
      <div className="rounded-md bg-muted/40 px-2 py-1.5"><dt className="text-muted-foreground">Kế hoạch</dt><dd className="font-semibold">{bowls(line.plannedQuantity ?? 0)}</dd></div>
      <div className="rounded-md bg-muted/40 px-2 py-1.5"><dt className="text-muted-foreground">Đã nạp</dt><dd className="font-semibold">{bowls(line.loadedQuantity ?? 0)}</dd></div>
      <div className="rounded-md bg-muted/40 px-2 py-1.5"><dt className="text-muted-foreground">Chỗ trống</dt><dd className="font-semibold">{summary ? `${summary.remainingCapacity ?? '—'}/${summary.capacity ?? '—'}` : '…'}</dd></div>
    </dl>
    {(line.loads ?? []).length > 0 && <ul className="grid gap-1 text-[13px] text-muted-foreground" aria-label={`Các lần nạp ngăn ${line.slotCode}`}>
      {(line.loads ?? []).map((load, index) => <li key={`${load.loadedAt}-${index}`}>{formatDateTime(load.loadedAt)} · {bowls(load.quantity ?? 0)} lô {load.batchCode}{load.actorName ? ` · ${load.actorName}` : ''}</li>)}
    </ul>}
    <p className="text-[13px]">{gateOpen ? 'Cổng nạp đang mở: ngăn không bán cho tới khi đóng.' : 'Cổng nạp đang đóng.'}</p>
    {!readOnly && !gateOpen && <CommandButton label={`Mở cổng nạp ngăn ${line.slotCode}`} pending={busy === `OPEN_REFILL|${line.slotId}`} locked={locked}
      blocked={slotPlan('OPEN_REFILL', summary, gateOpen).blocked} onClick={() => void send('OPEN_REFILL', { id: line.slotId, slotCode: line.slotCode })} />}
    {readOnly ? null : full && !more
      ? <Button type="button" variant="outline" className={BIG} onClick={() => setMore(true)}>Nạp thêm vào ngăn {line.slotCode}</Button>
      : <div className="grid gap-3">
        <FormField label="Lô hàng" required error={errors.batchId}
          hint={batches.error && !batches.data ? 'Không tải được danh sách lô. Bấm Tải lại số liệu.' : !batches.data ? 'Đang tải lô còn hạn…' : options.length ? (batch ? `Hạn dùng ${formatDateTime(batch.expiresAt)}.` : undefined) : 'Không còn lô nào của sản phẩm này còn hạn. Tạo lô mới ở màn Lô hàng hoặc ghi lý do ở bước Đối chiếu.'}>
          <NativeSelect value={batchId} className="h-11 text-base sm:text-sm" onChange={event => { setPicked(event.target.value); setErrors({}); setConflict(null); setTyped(null); setInversion('') }}>
            {!options.length && <option value="">Không có lô còn hạn</option>}
            {options.map(option => <option key={option.id} value={option.id}>{option.batchCode} · HSD {formatDateTime(option.expiresAt)}</option>)}
          </NativeSelect>
        </FormField>
        <FormField label="Số hộp nạp lần này" required error={quantityError || undefined} hint={quantityHint(room)}>
          <Input value={quantity} inputMode="numeric" autoComplete="off" className="h-11 text-base sm:text-sm"
            onChange={event => { setTyped(event.target.value); setErrors(previous => ({ ...previous, quantity: undefined })); setConflict(null); setInversion('') }} />
        </FormField>
        {(lineFacts.slot || lineFacts.batch) && <p className="text-[13px] text-muted-foreground">{[lineFacts.slot, lineFacts.batch, lineFacts.max].filter(Boolean).join('. ')}</p>}
        {inversion && <div role="alert" className="grid gap-2 rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3.5 py-2.5 text-[13px] text-status-warning-foreground">
          <p>{inversion}</p>
          <p><Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => void submit(true)}>Vẫn nạp lô này</Button></p>
        </div>}
        {failure && <p role="alert" className={ERROR_BOX}>{failure}</p>}
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button type="button" className={BIG} disabled={pending} onClick={() => void submit()}>{pending ? 'Đang ghi nhận…' : `Nạp ${quantity && parseBoxCount(quantity) ? bowls(parseBoxCount(quantity)!) : 'hộp'} vào ngăn ${line.slotCode}`}</Button>
          {(conflict || failure) && <Button type="button" variant="outline" className={BIG} onClick={refreshFigures}>Tải lại số liệu</Button>}
        </div>
      </div>}
  </section>
}

/** Step 4: every refill gate of the machine closed (completion is refused while one is open). */
function CloseStep({ lines, gates, readOnly, busy, send, block, back, next }: {
  lines: readonly RestockLine[]; gates: readonly Slot[]; readOnly: boolean; busy: string | null; send: Send; block: CommandBlock; back: () => void; next: () => void
}) {
  const loaded = lines.reduce((total, line) => total + (line.loadedQuantity ?? 0), 0)
  return <div className="grid gap-3 text-[14px]">
    <p className="text-muted-foreground">Đã nạp {bowls(loaded)} trong phiếu này. Kiểm tra các ngăn đã xếp gọn rồi đóng cổng nạp: ngăn có cổng mở không bán được và phiếu chưa hoàn tất được.</p>
    <CommandState block={block} readOnly={readOnly} />
    {gates.length
      ? <ul className="grid gap-2" aria-label="Ngăn đang mở cổng nạp">
        {gates.map(slot => <li key={slot.id} className={CARD}>
          <span>Ngăn {slot.slotCode}: cổng nạp đang mở.</span>
          {!readOnly && <CommandButton label={`Đóng cổng nạp ngăn ${slot.slotCode}`} variant="default" pending={busy === `CLOSE_REFILL|${slot.id}`} locked={!!block.lock || !!block.running}
            onClick={() => void send('CLOSE_REFILL', slot)} />}
        </li>)}
      </ul>
      : <p role="status" className={NOTE_BOX}><Check aria-hidden="true" className="mr-1 inline size-4 text-primary" />Mọi cổng nạp của máy đã đóng.</p>}
    {!readOnly && <div className="grid gap-2 sm:flex sm:flex-wrap">
      {!gates.length && <Button type="button" className={BIG} onClick={next}>Tiếp tục: Đối chiếu</Button>}
      <Button type="button" variant="outline" className={BIG} onClick={back}>Quay lại: Nạp theo dòng</Button>
    </div>}
  </div>
}

function ReconcileTable({ lines, reasons }: { lines: readonly RestockLine[]; reasons?: boolean }) {
  const result = reconcile(lines)
  return <table className="w-full table-fixed border-collapse text-[13px]">
    <caption className="sr-only">Đối chiếu kế hoạch và thực tế theo ngăn</caption>
    <thead><tr className="border-b text-left text-muted-foreground">
      <th scope="col" className="py-2 pr-2 font-medium">Ngăn</th>
      <th scope="col" className="py-2 pr-2 text-right font-medium">Kế hoạch</th>
      <th scope="col" className="py-2 pr-2 text-right font-medium">Đã nạp</th>
      <th scope="col" className="py-2 text-right font-medium">Chênh lệch</th>
    </tr></thead>
    <tbody>
      {result.rows.map(row => <tr key={row.lineId} className="border-b align-top">
        <th scope="row" className="py-2 pr-2 text-left font-medium">{row.slotCode}<span className="block text-xs font-normal text-muted-foreground">{row.productName}</span>
          {reasons && row.savedReason && <span className="block text-xs font-normal break-words whitespace-pre-wrap">Lý do: {row.savedReason}</span>}</th>
        <td className="py-2 pr-2 text-right tabular-nums">{row.planned}</td>
        <td className="py-2 pr-2 text-right tabular-nums">{row.loaded}</td>
        <td className={cn('py-2 text-right', row.difference !== 0 && 'font-semibold')}>{row.text}</td>
      </tr>)}
    </tbody>
    <tfoot><tr>
      <th scope="row" className="py-2 pr-2 text-left">Tổng</th>
      <td className="py-2 pr-2 text-right font-semibold tabular-nums">{result.planned}</td>
      <td className="py-2 pr-2 text-right font-semibold tabular-nums">{result.loaded}</td>
      <td className="py-2 text-right font-semibold">{result.varianceLines && result.difference === 0 ? 'Lệch theo ngăn' : result.difference === 0 ? 'Khớp' : differenceText(result.difference)}</td>
    </tr></tfoot>
  </table>
}

/** Step 5: plan against result, a reason for every line loaded ≠ planned, the result note, then complete. */
function ReconcileStep({ ticket, lines, readOnly, back, completed, stale }: {
  ticket: WorkOrder; lines: readonly RestockLine[]; readOnly: boolean; back: () => void; completed: () => void; stale: () => void
}) {
  const result = reconcile(lines)
  const [note, setNote] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const focusFirst = () => requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  async function complete() {
    if (pending) return
    setFailure('')
    const { body, errors: problems } = restockCompleteBody(note, result.rows, reasons)
    if (!body) { setErrors(problems ?? {}); focusFirst(); return }
    setPending(true); setErrors({})
    try {
      await workOrdersApi.complete(ticket.id!, body)
      toast.success('Đã hoàn tất phiếu nạp hàng', { description: 'Cảnh báo liên kết đã được đóng; cảnh báo tồn kho của ngăn đã nạp tự đóng khi đủ hàng.' })
      completed()
    } catch (error) {
      const shown = describeCompleteError(error, result.rows, body.lineVariances)
      if (shown.error instanceof ValidationError) { setErrors(shown.error.fieldErrors); focusFirst() } else setFailure(errorMessage(shown.error))
      if (shown.stale) stale()
      setPending(false)
    }
  }
  const differing = result.rows.filter(row => row.difference !== 0)
  return <div ref={formRef} className="grid gap-4 text-[14px]">
    <p className="text-muted-foreground">Mọi cổng nạp đã đóng. So số hộp đã nạp với kế hoạch; dòng nào lệch phải có lý do để quản trị viên đối chiếu.</p>
    <ReconcileTable lines={lines} reasons />
    {!readOnly && <>
      {differing.map(row => <FormField key={row.lineId} label={`Lý do lệch ngăn ${row.slotCode} (${row.text.toLowerCase()})`} required={!row.savedReason}
        error={errors[varianceField(row.lineId)] || undefined} hint={row.savedReason ? `Đã có lý do: “${row.savedReason}”. Nhập để thay.` : 'Bắt buộc vì số hộp đã nạp khác kế hoạch. Tối đa 500 ký tự.'}>
        <Input value={reasons[row.lineId] ?? ''} maxLength={500} className="h-11 text-base sm:text-sm"
          onChange={event => { const value = event.target.value; setReasons(previous => ({ ...previous, [row.lineId]: value })); setErrors(previous => ({ ...previous, [varianceField(row.lineId)]: '' })) }} />
      </FormField>)}
      <FormField label="Kết quả nạp hàng" required error={errors.resultNote || undefined} hint={`Đã làm gì tại máy. ${note.trim().length}/${TICKET_LIMITS.note} ký tự.`}>
        <Textarea value={note} maxLength={TICKET_LIMITS.note} rows={3} className="text-base sm:text-sm" onChange={event => { setNote(event.target.value); setErrors(previous => ({ ...previous, resultNote: '' })) }} />
      </FormField>
      {failure && <p role="alert" className={ERROR_BOX}>{failure}</p>}
      <p className="text-[13px] text-muted-foreground">Hoàn tất xong, cảnh báo liên kết với phiếu được đóng và hệ thống kiểm tra lại tồn kho của máy. Máy vẫn ở Bảo trì cho tới khi quản trị viên bật lại. Phiếu đã hoàn tất không mở lại được.</p>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Button type="button" className={BIG} disabled={pending} onClick={complete}>{pending ? 'Đang hoàn tất…' : 'Hoàn tất phiếu'}</Button>
        <Button type="button" variant="outline" className={BIG} disabled={pending} onClick={back}>Quay lại: Nạp thêm</Button>
      </div>
    </>}
  </div>
}

function DoneStep({ ticket, lines, view, machine }: { ticket: WorkOrder; lines: readonly RestockLine[]; view: RestockView; machine?: Machine }) {
  const { can } = useSession()
  const inMaintenance = machine?.status === 'MAINTENANCE'
  const overview = can('MACHINE_WRITE') ? machinePath(ticket.machineId) : ''
  const canAlerts = can('ALERT_READ')
  if (ticket.status === 'CANCELLED') return <div className="grid gap-2 text-[14px]">
    <p>Phiếu đã bị hủy lúc {formatDateTime(ticket.cancelledAt)}{ticket.cancelledBy?.fullName ? ` bởi ${ticket.cancelledBy.fullName}` : ''}.</p>
    {ticket.cancelReason && <p className="whitespace-pre-wrap break-words">Lý do: {ticket.cancelReason}</p>}
    <p className="text-muted-foreground">Không còn bước nào. Các hộp đã nạp hoặc đã rút trước khi hủy vẫn được giữ trong lịch sử kho.</p>
  </div>
  const alerts = ticket.linkedAlerts ?? []
  return <div className="grid gap-4 text-[14px]">
    <p>Hoàn tất lúc {formatDateTime(ticket.completedAt)}{ticket.completedBy?.fullName ? ` bởi ${ticket.completedBy.fullName}` : ''}.</p>
    <ReconcileTable lines={lines} reasons />
    <p className={NOTE_BOX}>{removedText(view.removedByReason)}</p>
    {ticket.resultNote && <p className={cn(NOTE_BOX, 'whitespace-pre-wrap break-words')}><span className="text-muted-foreground">Kết quả: </span>{ticket.resultNote}</p>}
    {alerts.length > 0 && <div role="status" className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-3">
      <p className="font-medium">Cảnh báo liên kết với phiếu</p>
      <ul className="grid gap-1">
        {alerts.map(alert => {
          const label = `${alertTypeLabel(alert.type)}${alert.title ? ` · ${alert.title}` : ''} (${alert.status === 'RESOLVED' ? 'đã đóng' : 'chưa đóng'})`
          return <li key={alert.id}>{canAlerts && alert.id ? <Link to={alertPath(alert.id)} className={cn(LINK, 'inline-flex min-h-11 items-center')}>{label}</Link> : label}</li>
        })}
      </ul>
    </div>}
    {inMaintenance && <div className={cn(NOTE_BOX, 'grid gap-2')}>
      <p><strong className="font-medium">Máy {ticket.machineCode} vẫn ở trạng thái Bảo trì</strong> nên kiosk chưa bán hàng. Xong việc tại máy thì chuyển máy về Hoạt động{overview ? ' ở thẻ Tổng quan của máy.' : ': nhờ Quản trị viên đổi trạng thái máy.'}</p>
      {overview && <p><Button asChild variant="outline" className={BIG}><Link to={overview}>Mở thẻ Tổng quan của máy {ticket.machineCode}</Link></Button></p>}
    </div>}
    <p><Button asChild variant="outline" className={BIG}><Link to="/admin/tickets">Về danh sách phiếu</Link></Button></p>
  </div>
}

/** RESTOCK_PLAN: the planned lines; a line is changed or taken out only while nothing was loaded against it. */
function PlanPanel({ ticket, machineId, lines, slots, changed }: { ticket: WorkOrder; machineId: string; lines: readonly RestockLine[]; slots?: readonly Slot[]; changed: () => void }) {
  const [open, setOpen] = useState(!lines.length)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<RestockLine | null>(null)
  const panelId = useId()
  return <section aria-labelledby={`${panelId}-title`} className={cn(PANEL, 'grid gap-3 text-[14px]')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={`${panelId}-title`} className="text-base font-semibold">Kế hoạch nạp ({lines.length} dòng)</h2>
      <Button type="button" variant="ghost" className="max-sm:h-11" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>{open ? 'Thu gọn' : 'Sửa kế hoạch'}</Button>
    </div>
    {open && <div id={panelId} className="grid gap-3">
      <p className="text-[13px] text-muted-foreground">Mỗi dòng là một ngăn, một sản phẩm và số hộp dự kiến. Dòng đã có hộp nạp vào thì không đổi được nữa (ghi chênh lệch ở bước Đối chiếu).</p>
      {lines.map(line => <PlanLine key={line.id} ticketId={ticket.id!} line={line} capacity={slots?.find(slot => slot.id === line.slotId)?.capacity} changed={changed} remove={() => setRemoving(line)} />)}
      {adding
        ? <AddLine ticketId={ticket.id!} machineId={machineId} slots={slots} close={() => setAdding(false)} changed={changed} />
        : <Button type="button" variant="outline" className={BIG} onClick={() => setAdding(true)}>Thêm dòng nạp</Button>}
    </div>}
    {removing && <ConfirmDialog title={`Bỏ dòng ngăn ${removing.slotCode} khỏi kế hoạch?`} confirmLabel="Bỏ khỏi kế hoạch" close={() => setRemoving(null)}
      successMessage="Đã bỏ dòng khỏi kế hoạch" successDescription={`Ngăn ${removing.slotCode} · ${removing.productName}`}
      message={<p>Dòng “{removing.productName}, {bowls(removing.plannedQuantity ?? 0)}” chưa có hộp nào được nạp nên có thể bỏ khỏi kế hoạch. Tồn kho và lịch sử không thay đổi.</p>}
      onConfirm={async () => {
        try { await restockApi.removeLine(ticket.id!, removing.id!) } catch (error) {
          const shown = describePlanError(error)
          if (shown.stale) changed()
          throw shown.error
        }
        changed()
      }} />}
  </section>
}

function PlanLine({ ticketId, line, capacity, changed, remove }: { ticketId: string; line: RestockLine; capacity?: number; changed: () => void; remove: () => void }) {
  const [value, setValue] = useState(String(line.plannedQuantity ?? ''))
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const loaded = (line.loadedQuantity ?? 0) > 0
  const inputId = useId()
  async function save() {
    if (pending) return
    const problems = validateLine({ slotId: line.slotId ?? '', productId: line.productId ?? '', plannedQuantity: value }, capacity)
    if (problems.plannedQuantity) { setError(problems.plannedQuantity); return }
    const body = updateLineBody(line, { plannedQuantity: value, productId: line.productId ?? '' })
    if (!body) { setError('Số hộp chưa đổi.'); return }
    setPending(true); setError('')
    try {
      await restockApi.updateLine(ticketId, line.id!, body)
      toast.success('Đã lưu dòng nạp', { description: `Ngăn ${line.slotCode} · ${bowls(body.plannedQuantity ?? line.plannedQuantity ?? 0)}` })
      changed()
    } catch (failure) {
      const shown = describePlanError(failure)
      setError(shown.error instanceof ValidationError ? shown.error.fieldErrors.plannedQuantity ?? INVALID_REQUEST : errorMessage(shown.error))
      if (shown.stale) changed()
    } finally { setPending(false) }
  }
  return <div className="grid gap-2 rounded-lg border px-3.5 py-3 sm:grid-cols-[1fr_auto] sm:items-end">
    <div className="grid gap-1">
      <span className="font-medium">Ngăn {line.slotCode} · {line.productName}</span>
      {loaded
        ? <span className="text-[13px] text-muted-foreground">Kế hoạch {bowls(line.plannedQuantity ?? 0)}, đã nạp {bowls(line.loadedQuantity ?? 0)}: không đổi được nữa.</span>
        : <FormField label="Số hộp dự kiến" error={error || undefined} hint={capacity ? `Tối đa ${bowls(capacity)} (sức chứa ngăn).` : undefined}>
          <Input id={inputId} value={value} inputMode="numeric" className="h-11 text-base sm:w-32 sm:text-sm" onChange={event => { setValue(event.target.value); setError('') }} />
        </FormField>}
    </div>
    {!loaded && <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={save}>{pending ? 'Đang lưu…' : 'Lưu'}</Button>
      <Button type="button" variant="ghost" className="h-11" aria-label={`Bỏ dòng ngăn ${line.slotCode} khỏi kế hoạch`} onClick={remove}>Bỏ khỏi kế hoạch</Button>
    </div>}
  </div>
}

function AddLine({ ticketId, machineId, slots, close, changed }: { ticketId: string; machineId: string; slots?: readonly Slot[]; close: () => void; changed: () => void }) {
  const products = useProductOptions(true)
  const form = useForm<LineValues>({ ...NEW_LINE })
  const { values, errors } = form
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)
  const usable = (slots ?? []).filter(slot => slot.machineId === machineId && slot.status !== 'INACTIVE')
  const capacity = usable.find(slot => slot.id === values.slotId)?.capacity
  async function add() {
    if (pending) return
    setFailure('')
    const problems = validateLine(values, capacity)
    if (Object.keys(problems).length) { form.setErrors(problems); return }
    setPending(true)
    try {
      await restockApi.addLine(ticketId, lineInputBody(values))
      toast.success('Đã thêm dòng nạp')
      changed(); close()
    } catch (error) {
      const shown = describePlanError(error)
      if (shown.error instanceof ValidationError) { form.setErrors(shown.error.fieldErrors); setFailure(CHECK_FIELDS) } else setFailure(errorMessage(shown.error))
      if (shown.stale) changed()
      setPending(false)
    }
  }
  return <div className="grid gap-3 rounded-lg border border-dashed px-3.5 py-3">
    <div className="grid gap-3 sm:grid-cols-3">
      <FormField label="Ngăn" required error={errors.slotId || undefined}>
        <NativeSelect value={values.slotId} className="h-11 text-base sm:text-sm" onChange={event => form.set('slotId')(event.target.value)}>
          <option value="">Chọn ngăn…</option>
          {usable.map(slot => <option key={slot.id} value={slot.id}>Ngăn {slot.slotCode} (sức chứa {slot.capacity})</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Sản phẩm" required error={errors.productId || undefined}>
        <NativeSelect value={values.productId} className="h-11 text-base sm:text-sm" onChange={event => form.set('productId')(event.target.value)}>
          <option value="">Chọn sản phẩm…</option>
          {products.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Số hộp dự kiến" required error={errors.plannedQuantity || undefined}>
        <Input value={values.plannedQuantity} inputMode="numeric" className="h-11 text-base sm:text-sm" onChange={event => form.set('plannedQuantity')(event.target.value)} />
      </FormField>
    </div>
    {failure && <p role="alert" className={ERROR_BOX}>{failure}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" className="h-11" disabled={pending} onClick={add}>{pending ? 'Đang thêm…' : 'Thêm dòng'}</Button>
      <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={close}>Hủy</Button>
    </div>
  </div>
}

export default TicketRestockPage
