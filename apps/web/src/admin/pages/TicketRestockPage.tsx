// O4 Thực hiện phiếu nạp hàng (FE 7.2), made for a phone at the machine (390 px): one step per screen block with a
// progress bar: (1) start the ticket and open the refill door (OPEN_REFILL, machine in MAINTENANCE), (2) take out
// expired or damaged bowls, (3) load each line, (4) close the door (CLOSE_REFILL), (5) reconcile plan and result, then
// complete; the server closes the related LOW_STOCK alerts and the screen says how many, with links.
// Route /admin/tickets/:id/restock (its own screen rather than a mode of the detail page: a phone needs the whole width
// for one step, a URL that resumes after a reload, and the detail page stays the same for every ticket type).
// The step always follows server data (ticket and lines, the machine's maintenance command history, the bowls of the
// lines' slots: restock.ts), so a reload lands on the right step; while the door is open the person may move between
// "Rút hộp", "Nạp theo dòng" and "Đóng cửa nạp". Bowls are taken out by hand while the door is open and recorded through
// the ticket (rules of POST /inventory/{id}/remove, FE 4.3), not with REMOVE_ITEM: that command needs the machine to drop
// the bottom bowl into the service tray one at a time, which it does not do while the refill door is open.
// Drafts: api-contract/drafts/work-tickets.yaml (BE 4.4) and machine-maintenance.yaml (BE 4.2). Nothing is deleted.
import { useEffect, useId, useRef, useState } from 'react'
import type { Ref } from 'react'
import { Check, Lock as LockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '../../api/client.ts'
import { alertsApi, batchesApi, inventoryApi, machinesApi, maintenanceCommandsApi, slotsApi, ticketsApi } from '../../api/resources.ts'
import type { Batch, InventoryItem, InventorySummary, MaintenanceCommand, MaintenanceCommandType, RestockLine, WorkTicket } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, NativeSelect, Textarea } from '../../components/ui/input.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { alertPath, alertTypeLabel } from '../alerts.ts'
import { countLoaded } from '../batches.ts'
import type { LoadedCount } from '../batches.ts'
import { CONNECTION_POLL_MS } from '../connection.ts'
import { ValidationError } from '../form-error.ts'
import { fitConflictText, parseBoxCount, quantityHint, roomLines } from '../inventory-load.ts'
import type { FitConflict, LoadRoom, Reload } from '../inventory-load.ts'
import { ConfirmDialog, ErrorState, Link, Loading, PageHead } from '../kit.tsx'
import {
  COMMAND_INFO, MAINTENANCE_IDLE_POLL_MS, MAINTENANCE_MISSING, MAINTENANCE_POLL_MS, commandStatusLabel, commandStatusText, failureText,
  isMaintenanceMissing, machineLock, needsRefresh, runningCommand, sendMaintenanceCommand,
} from '../maintenance-commands.ts'
import type { Lock } from '../maintenance-commands.ts'
import {
  NOTE_MAX, REMOVE_REASONS, RESTOCK_STEPS, STEP_LABELS, bowls, defaultQuantity, describeCompleteError, describeLineLoadError,
  describeLineRemoveError, hasRestockLines, leftToLoad, lineLoadBody, lineQuantityProblem, lineRemoveBody, reconcile, refillSince, refillText,
  removalPlan, resolvedText, restockCompleteBody, restockStep, shownStep, stepProgress, stepState,
} from '../restock.ts'
import type { RemovalPlan, RestockStep, RestockStepKey } from '../restock.ts'
import { TICKETS_MISSING, TICKET_NOT_FOUND, assigneeText, isMine, ticketActionError, ticketPath, ticketsAvailability } from '../tickets.ts'
import type { TicketViewer } from '../tickets.ts'
import { errorMessage, useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import { useConnection } from '../useConnection.ts'
import { useSession } from '../useSession.ts'
import { useTicketViewer } from '../useTicketViewer.ts'

const PANEL = 'min-w-0 rounded-xl border bg-card p-4 shadow-xs sm:p-5'
const ERROR_BOX = 'rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive'
const NOTE_BOX = 'rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]'
/** Touch targets of at least 44 px; full width on a phone. */
const BIG = 'h-11 w-full sm:w-auto'
const LINK = 'font-medium text-primary underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const MACHINE_POLL_MS = 10_000
/** Read in event handlers only (render stays pure). */
const clock = () => Date.now()

class TicketUnavailable extends Error {
  readonly kind: 'missing' | 'not-found'
  constructor(kind: 'missing' | 'not-found') { super(kind === 'missing' ? TICKETS_MISSING : TICKET_NOT_FOUND); this.kind = kind }
}
/** GET /work-tickets/{id}; on 404 one list probe tells an unknown (or someone else's) id from a backend without BE 4.3. */
async function loadTicket(ticketId: string, signal: AbortSignal): Promise<WorkTicket> {
  try { return await ticketsApi.get(ticketId, signal) } catch (error) {
    const code = error instanceof ApiError ? error.status : undefined
    if (code === 405 || code === 501) throw new TicketUnavailable('missing')
    if (code === 400) throw new TicketUnavailable('not-found')
    if (code !== 404) throw error
    let probe: unknown
    try { await ticketsApi.list({ page: 0, size: 1 }, signal) } catch (listError) { probe = listError }
    throw new TicketUnavailable(probe !== undefined && ticketsAvailability(probe) === 'missing' ? 'missing' : 'not-found')
  }
}

interface SlotStock { summary: InventorySummary; items: InventoryItem[] }
/** Free places and the AVAILABLE / EXPIRED bowls of every line's slot (the bowls that may be taken out). */
async function loadStock(machineId: string, lines: readonly RestockLine[], signal: AbortSignal): Promise<Record<string, SlotStock>> {
  const entries = await Promise.all(lines.map(async line => {
    const [summary, available, expired] = await Promise.all([
      slotsApi.summary(machineId, line.slotId, signal),
      inventoryApi.list({ machineId, slotId: line.slotId, status: 'AVAILABLE', page: 0, size: 100 }, signal),
      inventoryApi.list({ machineId, slotId: line.slotId, status: 'EXPIRED', page: 0, size: 100 }, signal),
    ])
    const stock: SlotStock = { summary, items: [...available.content, ...expired.content] }
    return [line.id, stock] as [string, SlotStock]
  }))
  return Object.fromEntries(entries)
}

interface LineBatches { byProduct: Record<string, Batch[]>; counts: Record<string, LoadedCount> }
/** Loadable batches of each line's product (earliest expiry first) and how many bowls each has already given. */
async function loadBatches(lines: readonly RestockLine[], now: number, signal: AbortSignal): Promise<LineBatches> {
  const products = [...new Set(lines.map(line => line.productId))]
  const pages = await Promise.all(products.map(productId => batchesApi.list({ productId, page: 0, size: 100, sort: 'expiresAt,asc' }, signal)))
  const byProduct = Object.fromEntries(products.map((productId, index) => [productId, pages[index].content.filter(batch => Date.parse(batch.expiresAt ?? '') > now)]))
  const counts = await countLoaded(Object.values(byProduct).flat().map(batch => batch.id!).filter(Boolean), signal)
  return { byProduct, counts }
}

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
  if (!hasRestockLines(ticket)) return <>
    <PageHead title={ticket.title} back={back} subtitle={`Máy ${ticket.machineCode}`} />
    <div role="status" className={cn(PANEL, 'grid gap-3 text-[14px]')}>
      <p>{ticket.type === 'RESTOCK'
        ? 'Phiếu này chưa có dòng nạp hàng (ngăn nào, bao nhiêu hộp) nên không làm theo từng bước được.'
        : 'Đây là phiếu bảo trì, không phải phiếu nạp hàng.'}</p>
      <p className="text-muted-foreground">Làm việc tại máy rồi bấm “Hoàn tất” ở trang chi tiết phiếu và ghi lại đã làm gì.</p>
      <p><Button asChild variant="outline" className={BIG}><Link to={back.to}>Về chi tiết phiếu</Link></Button></p>
    </div>
  </>
  return <RestockRun ticket={ticket} reloadTicket={state.reload} back={back} />
}

function RestockRun({ ticket, reloadTicket, back }: { ticket: WorkTicket; reloadTicket: () => void; back: { to: string; label: string } }) {
  const viewer = useTicketViewer()
  const { can } = useSession()
  const machineId = ticket.machineId
  const lines = ticket.restockLines ?? []
  const mine = isMine(ticket, viewer)
  const lineKey = lines.map(line => `${line.id}:${line.loadedQuantity}:${line.removedQuantity}`).join(',')

  // Maintenance command history: every 2 s while a command runs, else every 30 s.
  const [fast, setFast] = useState(false)
  const commands = useApi(signal => maintenanceCommandsApi.list(machineId, { page: 0, size: 10 }, signal), `restock-commands|${machineId}`,
    { pollMs: fast ? MAINTENANCE_POLL_MS : MAINTENANCE_IDLE_POLL_MS, stopOn: isMaintenanceMissing })
  const [sent, setSent] = useState<MaintenanceCommand | null>(null)
  const listed = !!sent && !!commands.data?.content.some(command => command.id === sent.id || command.createdAt > sent.createdAt)
  const running = runningCommand(commands.data?.content.slice(0, 1)) ?? (sent && !listed ? sent : undefined)
  if (commands.data && fast !== !!running) setFast(!!running)
  const missing = isMaintenanceMissing(commands.error) && !commands.data

  const machine = useApi(signal => machinesApi.get(machineId, signal), `restock-machine|${machineId}`, { pollMs: Math.min(MACHINE_POLL_MS, CONNECTION_POLL_MS) })
  const shown = useConnection(machine.data?.lastSeenAt, machine)
  const stock = useApi(signal => loadStock(machineId, lines, signal), `restock-stock|${ticket.id}|${lineKey}`)
  const [batchNow] = useState(() => Date.now())
  const batches = useApi(signal => loadBatches(lines, batchNow, signal), `restock-batches|${ticket.id}|${lineKey}`)

  // A command that just ended may have changed the door or the bowls: read everything again.
  const lastRunning = useRef<string | undefined>(undefined)
  const { reload: reloadCommands } = commands, { reload: reloadStock } = stock, { reload: reloadMachine } = machine
  useEffect(() => {
    if (lastRunning.current && !running) { reloadCommands(); reloadStock(); reloadMachine() }
    lastRunning.current = running?.id
  }, [running, reloadCommands, reloadStock, reloadMachine])

  const plans: Record<string, RemovalPlan> = Object.fromEntries(lines.map(line => [line.id, removalPlan(stock.data?.[line.id]?.items ?? [], stock.updatedAt ?? 0)]))
  const expiredLeft = stock.data ? Object.values(plans).reduce((total, plan) => total + plan.expired.length, 0) : undefined
  const derived = restockStep({ status: ticket.status, startedAt: ticket.startedAt, lines, commands: commands.data?.content, expiredLeft, doorByHand: missing })
  const [chosen, setChosen] = useState<RestockStepKey | null>(null)
  const step = shownStep(derived, chosen, missing)
  const waiting = ticket.status === 'IN_PROGRESS' && !commands.data && !missing
  const refill = refillSince(commands.data?.content, ticket.startedAt)

  const lock = machineLock({
    canMaintain: can('MACHINE_MAINTENANCE'), canChangeStatus: can('MACHINE_WRITE'), machineStatus: machine.data?.status ?? 'ACTIVE',
    connection: shown.shown, neverConnected: shown.never, running, missing,
  })
  const lockRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failureOf, setFailureOf] = useState<{ step: RestockStep; text: string } | null>(null)

  // Focus the step heading when the step changes (not on first render), so keyboard and screen reader users follow.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const previous = useRef<RestockStep | null>(null)
  useEffect(() => {
    if (previous.current && previous.current !== step) headingRef.current?.focus()
    previous.current = step
  }, [step])
  // A failure belongs to the step it happened on: moving to another step hides it.
  const failure = failureOf?.step === step ? failureOf.text : ''
  const setFailure = (text: string) => setFailureOf(text ? { step, text } : null)

  async function start() {
    if (busy) return
    setBusy('start'); setFailure('')
    try { await ticketsApi.start(ticket.id); toast.success('Đã bắt đầu phiếu', { description: `Máy ${ticket.machineCode}` }); reloadTicket() } catch (error) {
      setFailure(errorMessage(ticketActionError(error, 'start', 'detail')))
      if (error instanceof ApiError && (error.status === 409 || error.status === 403)) reloadTicket()
    } finally { setBusy(null) }
  }
  async function send(type: MaintenanceCommandType) {
    if (busy) return
    if (lock) { lockRef.current?.focus(); return }
    setBusy(type); setFailure('')
    try {
      const command = await sendMaintenanceCommand(machineId, type, { reason: `Phiếu nạp hàng: ${ticket.title}` })
      setSent(command); reloadCommands()
      toast.success(`Đã gửi lệnh “${COMMAND_INFO[type].label}”`, { description: `Máy ${ticket.machineCode}. Chờ máy báo xong.` })
    } catch (error) {
      setFailure(errorMessage(error))
      if (needsRefresh(error)) { reloadMachine(); reloadCommands() }
    } finally { setBusy(null) }
  }
  const go = (next: RestockStepKey) => { setChosen(next) }
  const readOnly = !mine
  const progress = stepProgress(step)

  return <>
    <PageHead title={ticket.title} back={back} subtitle={`Nạp hàng · máy ${ticket.machineCode}${ticket.machineName ? ` · ${ticket.machineName}` : ''}`} />
    <div className="mx-auto grid max-w-2xl gap-4">
      <StepBar step={step} progress={progress} />
      {readOnly && <p role="status" className={NOTE_BOX}>
        Phiếu này giao cho <strong className="font-medium">{assigneeText(ticket)}</strong>; chỉ người được giao mới thực hiện các bước. Bạn đang xem tiến độ.
      </p>}
      {waiting
        ? <Loading label="Đang đọc lịch sử lệnh của máy để biết đang ở bước nào…" rows={3} />
        : <section className={PANEL} aria-labelledby="restock-step-title">
          <h2 id="restock-step-title" ref={headingRef} tabIndex={-1} className="mb-1 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {step === 'done' ? (ticket.status === 'CANCELLED' ? 'Phiếu đã hủy' : 'Phiếu đã hoàn tất') : `Bước ${progress.index}/${progress.total}: ${progress.label}`}
          </h2>
          {failure && <p role="alert" className={cn(ERROR_BOX, 'my-3')}>{failure}</p>}
          {step === 'open' && <OpenStep ticket={ticket} viewer={viewer} readOnly={readOnly} lock={lock} lockRef={lockRef} reloadMachine={reloadMachine}
            running={running} commands={commands.data?.content} busy={busy} start={start} open={() => send('OPEN_REFILL')} />}
          {step === 'remove' && <RemoveStep ticket={ticket} lines={lines} stock={stock} plans={plans} readOnly={readOnly}
            changed={() => { setChosen('remove'); reloadTicket(); reloadStock() }} next={() => go('load')} />}
          {step === 'load' && <LoadStep ticket={ticket} lines={lines} stock={stock} batches={batches} readOnly={readOnly}
            changed={() => { setChosen('load'); reloadTicket() }} refreshFigures={() => { reloadStock(); batches.reload() }}
            back={() => go('remove')} next={() => go('close')} />}
          {step === 'close' && <CloseStep ticket={ticket} lines={lines} readOnly={readOnly} lock={lock} lockRef={lockRef} reloadMachine={reloadMachine}
            running={running} commands={commands.data?.content} busy={busy} missing={missing} refill={refillText(refill)}
            close={() => send('CLOSE_REFILL')} back={() => go('load')} byHand={() => go('reconcile')} />}
          {step === 'reconcile' && <ReconcileStep ticket={ticket} lines={lines} readOnly={readOnly} missing={missing} busy={busy}
            reopen={() => { setChosen(null); void send('OPEN_REFILL') }} back={missing ? () => go('load') : undefined} completed={reloadTicket} />}
          {step === 'done' && <DoneStep ticket={ticket} lines={lines} />}
        </section>}
      <p className="text-[13px] text-muted-foreground">
        Mỗi bước được lưu trên máy chủ: tải lại trang hoặc mở lại phiếu trên máy khác sẽ tiếp tục đúng bước. <Link to={back.to} className={LINK}>Xem chi tiết phiếu</Link>
      </p>
    </div>
  </>
}

/** Five numbered steps with the current one marked (aria-current) and named in words, plus a bar. */
function StepBar({ step, progress }: { step: RestockStep; progress: { index: number; total: number; label: string } }) {
  const percent = step === 'done' ? 100 : Math.round(((progress.index - 1) / progress.total) * 100)
  return <nav aria-label="Tiến độ nạp hàng" className="grid gap-2">
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
  </nav>
}

function LockNotice({ lock, lockRef, reloadMachine }: { lock: Lock; lockRef: Ref<HTMLDivElement>; reloadMachine: () => void }) {
  return <div ref={lockRef} tabIndex={-1} data-lock={lock.code}
    className="my-3 flex gap-3 rounded-xl border border-status-warning-foreground/30 bg-status-warning px-4 py-3.5 text-[13px] text-status-warning-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
    <LockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <div className="grid min-w-0 gap-1">
      <p className="font-semibold">Chưa gửi lệnh được</p>
      <p>{lock.reason}</p>
      <p><strong className="font-semibold">Việc cần làm:</strong> {lock.next}</p>
      {(lock.code === 'status' || lock.code === 'offline') && <p className="mt-1!">
        <Button type="button" variant="outline" className="h-11" onClick={reloadMachine}>Kiểm tra lại trạng thái máy</Button>
      </p>}
    </div>
  </div>
}

/** The newest attempt of a door command for this ticket, when it failed or timed out (shown with what to do). */
function failedAttempt(commands: readonly MaintenanceCommand[] | undefined, type: MaintenanceCommandType, since: string | null | undefined): MaintenanceCommand | undefined {
  const start = Date.parse(since ?? '')
  const last = commands?.find(command => command.type === type && Date.parse(command.createdAt) >= start)
  return last && (last.status === 'FAILED' || last.status === 'TIMEOUT') ? last : undefined
}

function CommandWait({ command }: { command: MaintenanceCommand }) {
  return <p role="status" className={cn(NOTE_BOX, 'my-3')}>
    <strong className="font-medium">Đang chờ máy: “{COMMAND_INFO[command.type].label}”</strong> ({commandStatusLabel(command.status).toLowerCase()}). {commandStatusText(command.status)} Trang tự cập nhật mỗi 2 giây.
  </p>
}
function CommandFailure({ command }: { command: MaintenanceCommand }) {
  return <p role="alert" className={cn(ERROR_BOX, 'my-3')}>
    Lệnh “{COMMAND_INFO[command.type].label}” gửi lúc {formatDateTime(command.createdAt)} không thành công: {command.status === 'FAILED' ? failureText(command.failureCode) : commandStatusText(command.status)} Kiểm tra tại máy rồi gửi lại.
  </p>
}

function OpenStep({ ticket, viewer, readOnly, lock, lockRef, reloadMachine, running, commands, busy, start, open }: {
  ticket: WorkTicket; viewer: TicketViewer; readOnly: boolean; lock: Lock | null; lockRef: Ref<HTMLDivElement>; reloadMachine: () => void
  running?: MaintenanceCommand; commands?: readonly MaintenanceCommand[]; busy: string | null; start: () => void; open: () => void
}) {
  const started = ticket.status === 'IN_PROGRESS'
  const failed = started && !running ? failedAttempt(commands, 'OPEN_REFILL', ticket.startedAt) : undefined
  return <div className="grid gap-3 text-[14px]">
    <p className="text-muted-foreground">Tới máy <strong className="font-medium text-foreground">{ticket.machineCode}</strong>, bắt đầu phiếu rồi mở cửa nạp. Máy phải ở trạng thái Bảo trì để kiosk không bán hàng khi cửa nạp đang mở.</p>
    <ol className="grid gap-3">
      <li className="grid gap-2 rounded-lg border px-3.5 py-3">
        <span className="font-medium">1. Bắt đầu phiếu</span>
        {started
          ? <span className="text-[13px] text-muted-foreground"><Check aria-hidden="true" className="mr-1 inline size-4 text-primary" />Đã bắt đầu lúc {formatDateTime(ticket.startedAt)}.</span>
          : readOnly ? <span className="text-[13px] text-muted-foreground">Chờ {assigneeText(ticket, viewer)} bắt đầu tại máy.</span>
          : <>
            <span className="text-[13px] text-muted-foreground">Hệ thống ghi tên bạn và thời điểm bắt đầu.</span>
            <Button type="button" className={BIG} disabled={!!busy} onClick={start}>{busy === 'start' ? 'Đang bắt đầu…' : 'Bắt đầu phiếu'}</Button>
          </>}
      </li>
      <li className={cn('grid gap-2 rounded-lg border px-3.5 py-3', !started && 'text-muted-foreground')}>
        <span className="font-medium">2. Mở cửa nạp</span>
        <span className="text-[13px] text-muted-foreground">{COMMAND_INFO.OPEN_REFILL.does.replace(' Tồn kho không đổi; nhập số hộp đã nạp ở màn Tồn kho.', '')}</span>
        {started && running && <CommandWait command={running} />}
        {started && failed && <CommandFailure command={failed} />}
        {started && !running && !readOnly && lock && <LockNotice lock={lock} lockRef={lockRef} reloadMachine={reloadMachine} />}
        {started && !running && !readOnly && <Button type="button" className={cn(BIG, lock && 'border-dashed')} variant={lock ? 'outline' : 'default'}
          aria-disabled={lock || busy ? true : undefined} onClick={open}>
          {lock && <LockIcon aria-hidden="true" />}{busy === 'OPEN_REFILL' ? 'Đang gửi…' : failed ? 'Gửi lại lệnh mở cửa nạp' : 'Mở cửa nạp hàng'}
        </Button>}
        {!started && <span className="text-[13px]">Bắt đầu phiếu trước.</span>}
      </li>
    </ol>
  </div>
}

function RemoveStep({ ticket, lines, stock, plans, readOnly, changed, next }: {
  ticket: WorkTicket; lines: readonly RestockLine[]; stock: ApiState<Record<string, SlotStock>>; plans: Record<string, RemovalPlan>; readOnly: boolean
  changed: () => void; next: () => void
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ itemId: string; text: string } | null>(null)
  const [asking, setAsking] = useState<{ line: RestockLine; item: InventoryItem } | null>(null)
  const left = Object.values(plans).reduce((total, plan) => total + plan.expired.length, 0)
  async function remove(line: RestockLine, item: InventoryItem, reason: string) {
    try {
      await ticketsApi.removeItem(ticket.id, line.id, lineRemoveBody(item.id ?? '', reason))
      toast.success(`Đã ghi nhận rút 1 hộp ở ngăn ${line.slotCode}`, { description: `Lý do: ${reason}. Hộp chuyển sang Đã rút và được ghi vào lịch sử kho.` })
      changed()
      // The button of the bowl just taken out disappears: keep keyboard focus in its slot.
      document.getElementById(`remove-${line.id}`)?.focus()
    } catch (error) {
      const { error: shown, stale } = describeLineRemoveError(error)
      if (stale) changed()
      throw shown
    }
  }
  async function removeExpired(line: RestockLine, item: InventoryItem) {
    if (pending) return
    setPending(item.id ?? ''); setProblem(null)
    try { await remove(line, item, REMOVE_REASONS.expired) } catch (error) { setProblem({ itemId: item.id ?? '', text: errorMessage(error) }) } finally { setPending(null) }
  }
  if (stock.error && !stock.data) return <ErrorState error={stock.error} retry={stock.reload} />
  if (!stock.data) return <Loading label="Đang đọc các hộp trong ngăn…" rows={3} />
  return <div className="grid gap-4 text-[14px]">
    <p className="text-muted-foreground">Cửa nạp đang mở. Lấy ra các hộp hết hạn (và hộp dập, hỏng nếu thấy) rồi xác nhận từng hộp ở đây. Hộp rút ra không bị xóa: hộp chuyển sang Đã rút và được ghi vào lịch sử kho kèm lý do.</p>
    {lines.map(line => {
      const plan = plans[line.id]
      return <section key={line.id} aria-labelledby={`remove-${line.id}`} className="grid gap-2 rounded-lg border px-3.5 py-3">
        <h3 id={`remove-${line.id}`} tabIndex={-1} className="font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Ngăn {line.slotCode}</h3>
        <p className="text-[13px] text-muted-foreground">
          {plan.expired.length ? `${bowls(plan.expired.length)} hết hạn cần rút.` : 'Không còn hộp hết hạn.'}
          {line.removedQuantity ? ` Đã rút ${bowls(line.removedQuantity)} trong phiếu này.` : ''}
          {plan.locked ? ` ${bowls(plan.locked)} đang giữ cho đơn hoặc nhả lỗi: không rút ở đây.` : ''}
        </p>
        {plan.expired.length > 0 && <ul className="grid gap-2" aria-label={`Hộp hết hạn ở ngăn ${line.slotCode}`}>
          {plan.expired.map((item, index) => <li key={item.id} className="grid gap-2 rounded-md bg-muted/40 px-3 py-2.5">
            <span className="text-[13px]"><strong className="font-medium">Hộp {index + 1}{index === 0 ? ' (đáy ngăn)' : ''}</strong> · lô {item.batchCode ?? '—'} · hết hạn {formatDateTime(item.expiresAt)}</span>
            {problem && problem.itemId === item.id && <span role="alert" className="text-[13px] text-destructive">{problem.text}</span>}
            {!readOnly && <Button type="button" variant="outline" className={BIG} disabled={!!pending} aria-label={`Đã rút hộp này: hộp ${index + 1} hết hạn ở ngăn ${line.slotCode}`}
              onClick={() => removeExpired(line, item)}>{pending === item.id ? 'Đang ghi nhận…' : 'Đã rút hộp này'}</Button>}
          </li>)}
        </ul>}
        {!readOnly && plan.others.length > 0 && <details className="text-[13px]">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">Rút hộp dập, hỏng ({bowls(plan.others.length)} còn bán được)</summary>
          <ul className="mt-2 grid gap-2" aria-label={`Hộp còn bán được ở ngăn ${line.slotCode}`}>
            {plan.others.map((item, index) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
              <span>Hộp {index + 1} · lô {item.batchCode ?? '—'} · hạn {formatDateTime(item.expiresAt)}</span>
              <Button type="button" variant="outline" className="h-11" aria-label={`Rút vì hỏng: hộp ${index + 1} ở ngăn ${line.slotCode}`} onClick={() => setAsking({ line, item })}>Rút vì hỏng</Button>
            </li>)}
          </ul>
        </details>}
      </section>
    })}
    {left > 0 && <p className={NOTE_BOX}>Còn {bowls(left)} hết hạn trong các ngăn: ngăn có hộp hết hạn ở đáy không bán được. Nếu không tìm thấy hộp, vẫn có thể tiếp tục và ghi lại ở bước Đối chiếu.</p>}
    {!readOnly && <Button type="button" className={BIG} onClick={next}>Tiếp tục: Nạp theo dòng</Button>}
    {asking && <ConfirmDialog title={`Rút 1 hộp hỏng ở ngăn ${asking.line.slotCode}?`} confirmLabel="Rút hộp" danger close={() => setAsking(null)}
      successMessage="Đã rút hộp" successDescription={`Ngăn ${asking.line.slotCode} · lý do “${REMOVE_REASONS.damaged}”`}
      message={<p>Hộp lô {asking.item.batchCode ?? '—'} chuyển sang Đã rút với lý do “{REMOVE_REASONS.damaged}” và không bán lại được. Hộp không bị xóa: lịch sử kho giữ lại.</p>}
      onConfirm={() => remove(asking.line, asking.item, REMOVE_REASONS.damaged)} />}
  </div>
}

function LoadStep({ ticket, lines, stock, batches, readOnly, changed, refreshFigures, back, next }: {
  ticket: WorkTicket; lines: readonly RestockLine[]; stock: ApiState<Record<string, SlotStock>>; batches: ApiState<LineBatches>; readOnly: boolean
  changed: () => void; refreshFigures: () => void; back: () => void; next: () => void
}) {
  const short = lines.reduce((total, line) => total + leftToLoad(line), 0)
  return <div className="grid gap-4 text-[14px]">
    <p className="text-muted-foreground">Xếp hộp vào từng ngăn rồi ghi số hộp thực tế. Số mặc định là phần còn lại của kế hoạch, không vượt chỗ trống của ngăn.</p>
    {(stock.error && !stock.data) ? <ErrorState error={stock.error} retry={stock.reload} />
      : lines.map(line => <LineLoadCard key={line.id} ticket={ticket} line={line} stock={stock} batches={batches} readOnly={readOnly} changed={changed} refreshFigures={refreshFigures} />)}
    {short > 0 && <p className={NOTE_BOX}>Còn {bowls(short)} chưa nạp theo kế hoạch. Nếu không đủ hộp, vẫn có thể đóng cửa nạp và ghi lý do ở bước Đối chiếu.</p>}
    {!readOnly && <div className="grid gap-2 sm:flex sm:flex-wrap">
      <Button type="button" className={BIG} onClick={next}>Tiếp tục: Đóng cửa nạp</Button>
      <Button type="button" variant="outline" className={BIG} onClick={back}>Quay lại: Rút hộp hỏng</Button>
    </div>}
  </div>
}

function LineLoadCard({ ticket, line, stock, batches, readOnly, changed, refreshFigures }: {
  ticket: WorkTicket; line: RestockLine; stock: ApiState<Record<string, SlotStock>>; batches: ApiState<LineBatches>; readOnly: boolean
  changed: () => void; refreshFigures: () => void
}) {
  const titleId = useId()
  const [picked, setPicked] = useState(line.batchId ?? '')
  const [typed, setTyped] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ batchId?: string; quantity?: string }>({})
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)
  const [more, setMore] = useState(false)
  const [conflict, setConflict] = useState<(FitConflict & { since: number }) | null>(null)
  const options = batches.data?.byProduct[line.productId] ?? []
  const batchId = options.some(batch => batch.id === picked) ? picked : options[0]?.id ?? ''
  const batch = options.find(candidate => candidate.id === batchId)
  const count = batchId ? batches.data?.counts[batchId] : undefined
  const summary = stock.data?.[line.id]?.summary
  const room: LoadRoom = {
    slotCode: line.slotCode, free: summary?.remainingCapacity, capacity: summary?.capacity,
    batchCode: batch?.batchCode, declared: batch?.quantity, loaded: count?.ok ? count.loaded : undefined,
  }
  const quantity = typed ?? defaultQuantity(line, room)
  const source = conflict?.kind === 'slot' ? stock : batches
  const reload: Reload = !conflict ? 'ok' : source.loading || (!source.error && !((source.updatedAt ?? 0) > conflict.since)) ? 'pending' : source.error ? 'failed' : 'ok'
  const quantityError = errors.quantity ? (conflict ? fitConflictText(conflict, room, reload) : errors.quantity) : lineQuantityProblem(quantity, room)
  const full = line.loadedQuantity >= line.plannedQuantity
  const lineFacts = roomLines(room)

  async function submit() {
    if (pending) return
    setFailure(''); setConflict(null)
    let body
    try { body = lineLoadBody(batchId, quantity, room) } catch (error) {
      if (error instanceof ValidationError) { setErrors(error.fieldErrors); return }
      throw error
    }
    setPending(true); setErrors({})
    try {
      await ticketsApi.loadLine(ticket.id, line.id, body)
      toast.success(`Đã nạp ${bowls(body.quantity)} vào ngăn ${line.slotCode}`, { description: `Lô ${batch?.batchCode ?? ''}. Đã ghi vào lịch sử kho.` })
      setTyped(null); setMore(false)
      changed()
      // When the line is now full its form gives way to "Nạp thêm": keep keyboard focus on the line.
      document.getElementById(titleId)?.focus()
    } catch (error) {
      const described = describeLineLoadError(error, parseBoxCount(quantity), room)
      if (described.refresh) refreshFigures()
      if (described.stale) changed()
      if (described.conflict) setConflict({ ...described.conflict, since: clock() })
      if (described.error instanceof ValidationError) setErrors(described.error.fieldErrors)
      else setFailure(errorMessage(described.error))
    } finally { setPending(false) }
  }

  return <section aria-labelledby={titleId} className="grid gap-3 rounded-lg border px-3.5 py-3">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 id={titleId} tabIndex={-1} className="font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Ngăn {line.slotCode} · {line.productName}</h3>
      <span className={cn('text-[13px]', full ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        {full ? <><Check aria-hidden="true" className="mr-1 inline size-4 text-primary" />Đã nạp đủ</> : `Còn ${bowls(leftToLoad(line))}`}
      </span>
    </div>
    <dl className="grid grid-cols-3 gap-2 text-center text-[13px]">
      <div className="rounded-md bg-muted/40 px-2 py-1.5"><dt className="text-muted-foreground">Kế hoạch</dt><dd className="font-semibold">{bowls(line.plannedQuantity)}</dd></div>
      <div className="rounded-md bg-muted/40 px-2 py-1.5"><dt className="text-muted-foreground">Đã nạp</dt><dd className="font-semibold">{bowls(line.loadedQuantity)}</dd></div>
      <div className="rounded-md bg-muted/40 px-2 py-1.5"><dt className="text-muted-foreground">Chỗ trống</dt><dd className="font-semibold">{summary ? `${summary.remainingCapacity ?? '—'}/${summary.capacity ?? '—'}` : '…'}</dd></div>
    </dl>
    {readOnly ? null : full && !more
      ? <Button type="button" variant="outline" className={BIG} onClick={() => setMore(true)}>Nạp thêm vào ngăn {line.slotCode}</Button>
      : <div className="grid gap-3">
        <FormField label="Lô hàng" required error={errors.batchId}
          hint={batches.error && !batches.data ? 'Không tải được danh sách lô. Bấm Tải lại số liệu.' : !batches.data ? 'Đang tải lô còn hạn…' : options.length ? (batch ? `Hạn dùng ${formatDateTime(batch.expiresAt)}${batch.id === line.batchId ? ' · lô gợi ý của phiếu' : ''}.` : undefined) : 'Không còn lô nào của sản phẩm này còn hạn. Tạo lô mới ở màn Lô hàng hoặc ghi lý do ở bước Đối chiếu.'}>
          <NativeSelect value={batchId} className="h-11 text-base sm:text-sm" onChange={event => { setPicked(event.target.value); setErrors({}); setConflict(null); setTyped(null) }}>
            {!options.length && <option value="">Không có lô còn hạn</option>}
            {options.map(option => <option key={option.id} value={option.id}>{option.batchCode} · HSD {formatDateTime(option.expiresAt)}{option.id === line.batchId ? ' (gợi ý)' : ''}</option>)}
          </NativeSelect>
        </FormField>
        <FormField label="Số hộp nạp lần này" required error={quantityError || undefined} hint={quantityHint(room)}>
          <Input value={quantity} inputMode="numeric" autoComplete="off" className="h-11 text-base sm:text-sm"
            onChange={event => { setTyped(event.target.value); setErrors(previous => ({ ...previous, quantity: undefined })); setConflict(null) }} />
        </FormField>
        {(lineFacts.slot || lineFacts.batch) && <p className="text-[13px] text-muted-foreground">{[lineFacts.slot, lineFacts.batch, lineFacts.max].filter(Boolean).join('. ')}</p>}
        {failure && <p role="alert" className={ERROR_BOX}>{failure}</p>}
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button type="button" className={BIG} disabled={pending} onClick={submit}>{pending ? 'Đang ghi nhận…' : `Nạp ${quantity && parseBoxCount(quantity) ? bowls(parseBoxCount(quantity)!) : 'hộp'} vào ngăn ${line.slotCode}`}</Button>
          {(conflict || failure) && <Button type="button" variant="outline" className={BIG} onClick={refreshFigures}>Tải lại số liệu</Button>}
        </div>
      </div>}
  </section>
}

function CloseStep({ ticket, lines, readOnly, lock, lockRef, reloadMachine, running, commands, busy, missing, refill, close, back, byHand }: {
  ticket: WorkTicket; lines: readonly RestockLine[]; readOnly: boolean; lock: Lock | null; lockRef: Ref<HTMLDivElement>; reloadMachine: () => void
  running?: MaintenanceCommand; commands?: readonly MaintenanceCommand[]; busy: string | null; missing: boolean; refill: string
  close: () => void; back: () => void; byHand: () => void
}) {
  const loaded = lines.reduce((total, line) => total + line.loadedQuantity, 0)
  const failed = !running ? failedAttempt(commands, 'CLOSE_REFILL', ticket.startedAt) : undefined
  return <div className="grid gap-3 text-[14px]">
    <p className="text-muted-foreground">Đã nạp {bowls(loaded)} trong phiếu này. Kiểm tra các ngăn đã xếp gọn rồi đóng cửa nạp: máy khóa cửa và bật lại cảm biến khay.</p>
    {missing
      ? <>
        <p role="status" className={NOTE_BOX}>{MAINTENANCE_MISSING}</p>
        {!readOnly && <Button type="button" className={BIG} onClick={byHand}>Đã đóng cửa tại máy, tiếp tục đối chiếu</Button>}
      </>
      : <>
        <p className="text-[13px]">{refill}</p>
        {running && <CommandWait command={running} />}
        {failed && <CommandFailure command={failed} />}
        {!running && !readOnly && lock && <LockNotice lock={lock} lockRef={lockRef} reloadMachine={reloadMachine} />}
        {!running && !readOnly && <Button type="button" className={cn(BIG, lock && 'border-dashed')} variant={lock ? 'outline' : 'default'} aria-disabled={lock || busy ? true : undefined} onClick={close}>
          {lock && <LockIcon aria-hidden="true" />}{busy === 'CLOSE_REFILL' ? 'Đang gửi…' : failed ? 'Gửi lại lệnh đóng cửa nạp' : 'Đóng cửa nạp hàng'}
        </Button>}
      </>}
    {!readOnly && !running && <Button type="button" variant="outline" className={BIG} onClick={back}>Quay lại: Nạp theo dòng</Button>}
  </div>
}

function ReconcileTable({ lines }: { lines: readonly RestockLine[] }) {
  const result = reconcile(lines)
  return <div className="grid gap-2">
    <table className="w-full table-fixed border-collapse text-[13px]">
      <caption className="sr-only">Đối chiếu kế hoạch và thực tế theo ngăn</caption>
      <thead><tr className="border-b text-left text-muted-foreground">
        <th scope="col" className="py-2 pr-2 font-medium">Ngăn</th>
        <th scope="col" className="py-2 pr-2 text-right font-medium">Kế hoạch</th>
        <th scope="col" className="py-2 pr-2 text-right font-medium">Đã nạp</th>
        <th scope="col" className="py-2 text-right font-medium">Chênh lệch</th>
      </tr></thead>
      <tbody>
        {result.rows.map(row => <tr key={row.lineId} className="border-b align-top">
          <th scope="row" className="py-2 pr-2 text-left font-medium">{row.slotCode}<span className="block text-xs font-normal text-muted-foreground">{row.productName}</span></th>
          <td className="py-2 pr-2 text-right tabular-nums">{row.planned}</td>
          <td className="py-2 pr-2 text-right tabular-nums">{row.loaded}</td>
          <td className={cn('py-2 text-right', row.difference !== 0 && 'font-semibold')}>{row.text}</td>
        </tr>)}
      </tbody>
      <tfoot><tr>
        <th scope="row" className="py-2 pr-2 text-left">Tổng</th>
        <td className="py-2 pr-2 text-right font-semibold tabular-nums">{result.planned}</td>
        <td className="py-2 pr-2 text-right font-semibold tabular-nums">{result.loaded}</td>
        <td className="py-2 text-right font-semibold">{result.noteRequired && result.difference === 0 ? 'Lệch theo ngăn' : reconcileTotal(result.difference)}</td>
      </tr></tfoot>
    </table>
    <p className="text-[13px] text-muted-foreground">Đã rút {bowls(result.removed)} hết hạn hoặc hỏng trong phiếu này.</p>
  </div>
}
const reconcileTotal = (difference: number) => difference === 0 ? 'Khớp' : difference < 0 ? `Thiếu ${-difference}` : `Thừa ${difference}`

function ReconcileStep({ ticket, lines, readOnly, missing, busy, reopen, back, completed }: {
  ticket: WorkTicket; lines: readonly RestockLine[]; readOnly: boolean; missing: boolean; busy: string | null
  reopen: () => void; back?: () => void; completed: () => void
}) {
  const result = reconcile(lines)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  async function complete() {
    if (pending) return
    setFailure('')
    const { body, error } = restockCompleteBody(note, result.noteRequired)
    if (!body) { setNoteError(error ?? ''); noteRef.current?.focus(); return }
    setPending(true); setNoteError('')
    try {
      const done = await ticketsApi.complete(ticket.id, body)
      toast.success('Đã hoàn tất phiếu nạp hàng', { description: resolvedText(done.resolvedAlertIds?.length ?? 0) })
      completed()
    } catch (error) {
      const shown = describeCompleteError(error)
      if (shown instanceof ValidationError) { setNoteError(shown.fieldErrors.note ?? ''); noteRef.current?.focus() } else setFailure(errorMessage(shown))
      if (error instanceof ApiError && (error.status === 409 || error.status === 403)) completed()
      setPending(false)
    }
  }
  return <div className="grid gap-4 text-[14px]">
    <p className="text-muted-foreground">Cửa nạp đã đóng. So số hộp đã nạp với kế hoạch; nếu lệch, ghi lý do để quản trị viên đối chiếu.</p>
    <ReconcileTable lines={lines} />
    {!readOnly && <>
      <FormField label={result.noteRequired ? 'Ghi chú đối chiếu' : 'Ghi chú (không bắt buộc)'} required={result.noteRequired} error={noteError || undefined}
        hint={`${result.noteRequired ? 'Bắt buộc vì số hộp đã nạp khác kế hoạch. ' : ''}${note.trim().length}/${NOTE_MAX} ký tự.`}>
        <Textarea ref={noteRef} value={note} maxLength={NOTE_MAX} rows={3} className="text-base sm:text-sm" onChange={event => { setNote(event.target.value); setNoteError('') }} />
      </FormField>
      {failure && <p role="alert" className={ERROR_BOX}>{failure}</p>}
      <p className="text-[13px] text-muted-foreground">Hoàn tất xong, hệ thống tự đóng các cảnh báo Ngăn sắp hết hàng của những ngăn đã nạp đủ. Phiếu đã hoàn tất không mở lại được.</p>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Button type="button" className={BIG} disabled={pending} onClick={complete}>{pending ? 'Đang hoàn tất…' : 'Hoàn tất phiếu'}</Button>
        {missing && back
          ? <Button type="button" variant="outline" className={BIG} onClick={back}>Quay lại: Nạp theo dòng</Button>
          : <Button type="button" variant="outline" className={BIG} disabled={!!busy || pending} onClick={reopen}>{busy === 'OPEN_REFILL' ? 'Đang gửi…' : 'Mở lại cửa nạp để nạp thêm'}</Button>}
      </div>
    </>}
  </div>
}

function DoneStep({ ticket, lines }: { ticket: WorkTicket; lines: readonly RestockLine[] }) {
  const { can } = useSession()
  const ids = ticket.resolvedAlertIds ?? []
  const canAlerts = can('ALERT_READ')
  const alerts = useApi(signal => (canAlerts && ids.length ? Promise.all(ids.map(alertId => alertsApi.get(alertId, signal))) : Promise.resolve([])), `restock-alerts|${ids.join(',')}|${canAlerts}`)
  if (ticket.status === 'CANCELLED') return <div className="grid gap-2 text-[14px]">
    <p>Phiếu đã bị hủy lúc {formatDateTime(ticket.cancelledAt)}{ticket.cancelledByName ? ` bởi ${ticket.cancelledByName}` : ''}.</p>
    {ticket.cancelReason && <p className="whitespace-pre-wrap break-words">Lý do: {ticket.cancelReason}</p>}
    <p className="text-muted-foreground">Không còn bước nào. Các hộp đã nạp hoặc đã rút trước khi hủy vẫn được giữ trong lịch sử kho.</p>
  </div>
  return <div className="grid gap-4 text-[14px]">
    <p>Hoàn tất lúc {formatDateTime(ticket.completedAt)}{ticket.completedByName ? ` bởi ${ticket.completedByName}` : ''}.</p>
    <ReconcileTable lines={lines} />
    {ticket.completionNote && <p className={cn(NOTE_BOX, 'whitespace-pre-wrap break-words')}><span className="text-muted-foreground">Ghi chú: </span>{ticket.completionNote}</p>}
    <div role="status" className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-3">
      <p className="font-medium">{resolvedText(ids.length)}</p>
      {ids.length > 0 && <ul className="grid gap-1">
        {ids.map((alertId, index) => {
          const alert = alerts.data?.find(candidate => candidate.id === alertId)
          const label = alert ? `${alertTypeLabel(alert.type)}${alert.slotCode ? ` · ngăn ${alert.slotCode}` : ''} (đã đóng)` : `Cảnh báo đã đóng ${index + 1}`
          return <li key={alertId}>{canAlerts ? <Link to={alertPath(alertId)} className={cn(LINK, 'inline-flex min-h-11 items-center')}>{label}</Link> : label}</li>
        })}
      </ul>}
    </div>
    <p><Button asChild variant="outline" className={BIG}><Link to="/admin/tickets">Về danh sách phiếu</Link></Button></p>
  </div>
}

export default TicketRestockPage
