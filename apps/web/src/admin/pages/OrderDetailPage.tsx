// T1 Chi tiết đơn (FE 6.1), read only: the order timeline (created → payment → dispensing → end), what needs a person,
// the payments (one click to the payment, ADMIN), the bowls held for the order (one click to their slot on the
// inventory map and to their history), the dispense commands and the lines at the price of the order.
// Order, bowls and payments come from GET /orders/{id} (real API). Dispense commands come from the DRAFT
// GET /orders/{orderId}/dispense-commands (api-contract/drafts/dispense-commands.yaml), mocked until backend issue 3.3
// ships; on the real backend that path answers 404 today and the section says "chưa có dữ liệu" without breaking the page.
// No action changes the order: status is driven by the kiosk, the payment webhook and the machine.
import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import { Circle, CircleCheck, CircleDot, CircleSlash, CircleX, TriangleAlert } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { dispenseCommandsApi, ordersApi, slotsApi } from '../../api/resources.ts'
import type { DispenseCommand, OrderDetail } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { Badge, DataTable, ErrorState, Forbidden, Link, Loading, PageHead } from '../kit.tsx'
import {
  DISPENSE_MISSING, LIVE_POLL_MS, STEP_STATE_TEXT, allocationRows, commandEndedAt, commandNote, dispenseAvailability, noCommandText, inventoryMapPath, isLiveOrder, orderAttention, orderTimeline,
  paymentPath, shortId, slotIdsByCode, wasPaid,
} from '../order-detail.ts'
import type { AllocationRow, StepState, TimelineStep } from '../order-detail.ts'
import { refundEntry, refundPathFor } from '../refunds.ts'
import { useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import { useSession } from '../useSession.ts'

const BACK = { to: '/admin/orders', label: 'Danh sách đơn hàng' }
const PANEL = 'mb-5 min-w-0 rounded-xl border bg-card p-5 shadow-xs max-[680px]:p-4'
const HEADING = 'mb-3! text-base font-semibold'
const HINT = 'mb-3! text-[13px] text-muted-foreground'
const LINK = 'font-medium whitespace-nowrap text-primary max-sm:inline-block max-sm:py-2.5 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function OrderDetailPage({ orderId }: { orderId: string }) {
  const { can } = useSession()
  const canPayments = can('PAYMENT_READ'), canInventory = can('INVENTORY_READ'), canMachines = can('MACHINE_READ')
  // A live order (waiting for payment or for the machine) is read again every 5 s while the tab is visible. Whether it is
  // live is only known after a load, so the flag follows the data (one extra read when it flips).
  const [live, setLive] = useState(false)
  const order = useApi(signal => ordersApi.get(orderId, signal), orderId, { pollMs: live ? LIVE_POLL_MS : undefined })
  const current = order.data
  const nowLive = !!current && isLiveOrder(current)
  // State adjusted during render (React's pattern for state derived from a previous render), not in an effect.
  if (nowLive !== live) setLive(nowLive)
  const paid = !!current && wasPaid(current)
  const status = current?.status ?? ''
  // DRAFT endpoint (backend 3.3): asked only once the order was paid; an unpaid order has no command by definition.
  // Once the backend has said the endpoint does not exist (404/405/501), stop asking: latched for this order.
  const [commandsMissing, setCommandsMissing] = useState(false)
  const commands = useApi(signal => (paid ? dispenseCommandsApi.listForOrder(orderId, signal) : Promise.resolve(undefined)),
    `${orderId}|commands|${paid}|${status}`, { pollMs: nowLive && paid && !commandsMissing ? LIVE_POLL_MS : undefined })
  if (!commandsMissing && !!commands.error && dispenseAvailability(commands.error) === 'missing') setCommandsMissing(true)
  // Allocations carry the slot code only: the machine's slots (first 100 by code) turn it into the slot id of the map link.
  const machineId = current?.machineId ?? ''
  const slots = useApi(signal => (canInventory && canMachines && machineId ? slotsApi.list(machineId, { page: 0, size: 100, sort: 'slotCode,asc' }, signal) : Promise.resolve(undefined)),
    `${machineId}|slots|${canInventory && canMachines}`)

  if (order.error && !current) {
    const code = order.error instanceof ApiError ? order.error.status : undefined
    if (code === 404 || code === 400) return <>
      <PageHead title="Không tìm thấy đơn" back={BACK} />
      <div role="alert" className="px-4 py-10 text-center text-muted-foreground">
        <p>Đơn này không tồn tại hoặc đường dẫn đã sai. Mở lại đơn từ danh sách.</p>
        <p className="mt-3!"><Button asChild variant="outline" size="sm"><Link to={BACK.to}>Về danh sách đơn hàng</Link></Button></p>
      </div>
    </>
    return <><PageHead title="Đơn hàng" back={BACK} /><ErrorState error={order.error} retry={order.reload} /></>
  }
  if (!current) return <><PageHead title="Đơn hàng" back={BACK} /><Loading label="Đang tải đơn hàng…" rows={6} /></>

  const commandList = commands.data
  const rows = allocationRows(current, commandList ?? [], slotIdsByCode(slots.data?.content))
  const attention = orderAttention(current, commandList)
  const steps = orderTimeline(current, commandList)
  const updatedAt = order.updatedAt
  return <>
    <PageHead title={`Đơn ${current.orderCode ?? ''}`} back={BACK}
      subtitle="Chỉ xem. Trạng thái đơn do kiosk, cổng thanh toán và máy cập nhật; web không sửa hoặc hủy đơn." />
    {attention.length > 0 && <section aria-labelledby="attention-title" className="mb-5 rounded-xl border border-destructive/40 bg-destructive/8 p-4">
      <h2 id="attention-title" className="mb-2! flex items-center gap-2 text-base font-semibold text-destructive"><TriangleAlert aria-hidden="true" className="size-4" />Cần xử lý</h2>
      <ul className="grid gap-1.5 pl-0">
        {attention.map(item => <li key={item.key} className="list-none text-[14px]">
          {item.text}{' '}
          {item.paymentId && canPayments && <Link to={paymentPath(item.paymentId)} className={LINK}>Mở thanh toán</Link>}
        </li>)}
      </ul>
      {/* FE 8.1: ADMIN only (REFUND_RECORD), when the order still has a payment to refund. */}
      {can('REFUND_RECORD') && refundEntry(current) === 'record' && <p className="mt-2! text-[14px]"><Link to={refundPathFor(current.id)} className={LINK}>Ghi nhận hoàn tiền</Link></p>}
    </section>}
    <div className="grid gap-x-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className={PANEL} aria-labelledby="timeline-title">
        <h2 id="timeline-title" className={HEADING}>Dòng thời gian</h2>
        <Timeline steps={steps} />
        <p className="mt-3! text-[13px] text-muted-foreground" aria-live="polite">
          {nowLive ? `Đơn đang xử lý: tự làm mới mỗi ${LIVE_POLL_MS / 1000} giây.` : 'Đơn đã kết thúc.'} Cập nhật {updatedAt ? formatDateTime(new Date(updatedAt).toISOString()) : '—'}.
        </p>
      </section>
      <section className={PANEL} aria-labelledby="info-title">
        <h2 id="info-title" className={HEADING}>Thông tin đơn</h2>
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px] [&_dt]:text-muted-foreground">
          <dt>Trạng thái</dt><dd><Badge domain="order" explain value={current.status} /></dd>
          <dt>Máy</dt><dd className="break-words">{current.machineCode ?? '—'}{canInventory && current.machineId ? <> · <Link to={inventoryMapPath(current.machineId)} className={LINK}>Sơ đồ ngăn của máy</Link></> : null}</dd>
          <dt>Tạm tính</dt><dd>{formatMoney(current.subtotal)}</dd>
          <dt>Tổng tiền</dt><dd className="font-semibold">{formatMoney(current.totalAmount)}</dd>
          <dt>Tạo lúc</dt><dd>{formatDateTime(current.createdAt)}</dd>
          <dt>Hết hạn thanh toán</dt><dd>{formatDateTime(current.expiresAt)}</dd>
          <dt>Thanh toán lúc</dt><dd>{formatDateTime(current.paidAt)}</dd>
          <dt>Hoàn tất lúc</dt><dd>{formatDateTime(current.completedAt)}</dd>
          <dt>Hủy lúc</dt><dd>{formatDateTime(current.cancelledAt)}</dd>
        </dl>
      </section>
    </div>
    <Payments order={current} canPayments={canPayments} />
    <Boxes rows={rows} canInventory={canInventory} commandsKnown={!!commandList} slotsFailed={!!slots.error} slotsPending={slots.loading && !slots.data && !slots.error} />
    <Commands state={commands} order={current} paid={paid} missing={commandsMissing} rows={rows} />
    <section className={PANEL} aria-labelledby="items-title">
      <h2 id="items-title" className={HEADING}>Sản phẩm (giá tại thời điểm đặt)</h2>
      <DataTable state={NONE} rows={current.items ?? []} rowKey={item => item.id ?? ''} caption="Sản phẩm của đơn" empty="Đơn không có dòng sản phẩm." columns={[
        { head: 'SKU', nowrap: true, cell: item => item.sku },
        { head: 'Sản phẩm', cell: item => item.productName },
        { head: 'Số hộp', cell: item => item.quantity },
        { head: 'Đơn giá', nowrap: true, cell: item => formatMoney(item.unitPrice) },
        { head: 'Thành tiền', nowrap: true, cell: item => formatMoney(item.totalPrice) },
      ]} />
    </section>
  </>
}

/** Rows already loaded with the order: no loading or error of their own. */
const NONE = { loading: false, error: undefined, reload: () => {} }

// ---- timeline

const STEP_LOOK: Record<StepState, { icon: typeof Circle; className: string }> = {
  done: { icon: CircleCheck, className: 'bg-status-success text-status-success-foreground' },
  current: { icon: CircleDot, className: 'bg-status-info text-status-info-foreground' },
  failed: { icon: CircleX, className: 'bg-status-danger text-status-danger-foreground' },
  stopped: { icon: CircleSlash, className: 'bg-status-neutral text-status-neutral-foreground' },
  upcoming: { icon: Circle, className: 'border border-dashed border-muted-foreground/60 bg-transparent text-muted-foreground' },
}

function Timeline({ steps }: { steps: TimelineStep[] }) {
  return <ol className="grid gap-0 pl-0" aria-label="Các bước của đơn">
    {steps.map((step, index) => {
      const look = STEP_LOOK[step.state]
      const Icon = look.icon
      const last = index === steps.length - 1
      return <li key={step.key} aria-current={step.state === 'current' ? 'step' : undefined} data-step={step.key} data-state={step.state}
        className="relative grid list-none grid-cols-[28px_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
        {!last && <span aria-hidden="true" className="absolute top-7 bottom-0 left-[13px] w-0.5 bg-border" />}
        <span aria-hidden="true" className={cn('relative grid size-7 place-items-center rounded-full', look.className)}><Icon className="size-4" /></span>
        <div className="min-w-0 pt-0.5">
          <p className={cn('flex flex-wrap items-baseline gap-x-2 font-medium', step.state === 'upcoming' && 'text-muted-foreground')}>
            <span>{step.label}</span>
            <span className="sr-only">({STEP_STATE_TEXT[step.state]})</span>
            {step.at && <time dateTime={step.at} className="text-[13px] font-normal text-muted-foreground">{formatDateTime(step.at)}</time>}
          </p>
          <p className="mt-0.5! text-[13px] text-muted-foreground">{step.detail}</p>
        </div>
      </li>
    })}
  </ol>
}

// ---- payments

function Payments({ order, canPayments }: { order: OrderDetail; canPayments: boolean }) {
  return <section className={PANEL} aria-labelledby="pay-title">
    <h2 id="pay-title" className={HEADING}>Thanh toán</h2>
    {!canPayments && (order.payments?.length ?? 0) > 0 && <p className={HINT}>Chi tiết từng lần thanh toán (mã giao dịch, nhật ký) chỉ Quản trị viên xem được.</p>}
    <DataTable state={NONE} rows={order.payments ?? []} rowKey={payment => payment.id ?? ''} caption="Các lần thanh toán của đơn"
      empty="Chưa có lần thanh toán nào: khách chưa tạo mã QR cho đơn này." columns={[
        { head: 'Lần thanh toán', nowrap: true, cell: payment => canPayments && payment.id
          ? <Link to={paymentPath(payment.id)} className={LINK} label={`Mở thanh toán ${payment.provider ?? ''} ${shortId(payment.id)}`}>{payment.provider ?? 'Thanh toán'} {shortId(payment.id)}</Link>
          : <>{payment.provider ?? '—'} <span className="text-muted-foreground">{shortId(payment.id)}</span></> },
        { head: 'Trạng thái', cell: payment => <Badge domain="payment" value={payment.status} /> },
        { head: 'Số tiền', nowrap: true, cell: payment => formatMoney(payment.amount) },
        { head: 'Tạo lúc', cell: payment => formatDateTime(payment.createdAt) },
        { head: 'Thanh toán lúc', cell: payment => formatDateTime(payment.paidAt) },
        { head: 'Hết hạn mã QR', secondary: true, cell: payment => formatDateTime(payment.expiredAt) },
      ]} />
  </section>
}

// ---- bowls

function Boxes({ rows, canInventory, commandsKnown, slotsFailed, slotsPending }: {
  rows: AllocationRow[]; canInventory: boolean; commandsKnown: boolean; slotsFailed: boolean
  /** The machine's slots are still loading: a slot link now would open the whole machine, then change under the pointer. */
  slotsPending: boolean
}) {
  const hintId = useId()
  return <section className={PANEL} aria-labelledby="alloc-title" aria-describedby={hintId}>
    <h2 id="alloc-title" className={HEADING}>Hộp của đơn</h2>
    <p id={hintId} className={HINT}>
      {canInventory
        ? <>Bấm mã ngăn để mở ngăn trên sơ đồ tồn kho, bấm mã hộp để xem lịch sử của hộp.{slotsFailed ? ' Chưa đọc được danh sách ngăn của máy nên link ngăn mở sơ đồ cả máy.' : ''}</>
        : 'Tài khoản của bạn không xem được tồn kho nên ngăn và hộp chỉ hiện mã.'}
    </p>
    <DataTable state={NONE} rows={rows} rowKey={row => row.allocation.id ?? row.allocation.inventoryItemId ?? ''} caption="Hộp được giữ cho đơn"
      empty="Chưa có hộp nào được giữ cho đơn này." columns={[
        { head: 'Ngăn', nowrap: true, cell: row => canInventory && (row.slotId || !slotsPending)
          ? <Link to={row.slotPath} className={cn(LINK, 'inline-flex min-h-6 min-w-6 items-center justify-center')} label={`Mở trên sơ đồ ngăn ${row.allocation.slotCode ?? ''}`}>{row.allocation.slotCode ?? 'Ngăn'}</Link>
          : row.allocation.slotCode ?? '—' },
        { head: 'Hộp', nowrap: true, cell: row => canInventory && row.boxPath
          ? <Link to={row.boxPath} className={cn(LINK, 'font-mono text-[13px]')} label={`Lịch sử hộp ${shortId(row.allocation.inventoryItemId)}`}>{shortId(row.allocation.inventoryItemId)}</Link>
          : <span className="font-mono text-[13px]">{shortId(row.allocation.inventoryItemId)}</span> },
        { head: 'Sản phẩm', cell: row => row.productName ?? '—' },
        { head: 'Lô', secondary: true, cell: row => row.allocation.batchCode ?? '—' },
        { head: 'Hạn lô', secondary: true, cell: row => formatDateTime(row.allocation.batchExpiresAt) },
        { head: 'Giữ hộp', cell: row => <Badge domain="allocation" value={row.allocation.status} /> },
        ...(commandsKnown ? [{ head: 'Lệnh nhả hàng', cell: (row: AllocationRow) => row.command ? <Badge domain="dispense" value={row.command.status} /> : '—' }] : []),
        { head: 'Trả lại ngăn lúc', secondary: true, cell: row => formatDateTime(row.allocation.releasedAt) },
      ]} />
  </section>
}

// ---- dispense commands (DRAFT API, backend 3.3)

function Commands({ state, order, paid, missing, rows }: {
  state: ApiState<DispenseCommand[] | undefined>; order: OrderDetail; paid: boolean
  /** The backend has no commands endpoint yet (latched, so a reload in between does not flash a spinner). */
  missing: boolean; rows: AllocationRow[]
}) {
  // Overdue is judged against when the commands were read, not the render time (stable between renders).
  const now = state.updatedAt ?? 0
  let body: ReactNode
  if (!paid) body = <p className="text-[14px] text-muted-foreground">{noCommandText(order)}</p>
  else if (missing) body = <p role="status" className="text-[14px] text-muted-foreground">{DISPENSE_MISSING}</p>
  else if (state.error && !state.data) {
    const availability = dispenseAvailability(state.error)
    body = availability === 'missing' ? <p role="status" className="text-[14px] text-muted-foreground">{DISPENSE_MISSING}</p>
      : availability === 'forbidden' ? <Forbidden />
      : <ErrorState error={state.error} retry={state.reload} />
  } else if (!state.data) body = <Loading label="Đang tải lệnh nhả hàng…" rows={2} />
  else {
    const slotOf = (command: DispenseCommand) => rows.find(row => row.allocation.inventoryItemId === command.inventoryItemId)
    body = <DataTable state={state} rows={state.data} rowKey={command => command.id} caption="Lệnh nhả hàng của đơn"
      empty="Đơn đã thanh toán nhưng máy chủ chưa ghi lệnh nhả hàng nào." columns={[
        { head: 'Mã lệnh', nowrap: true, cell: command => <span className="font-mono text-[13px]">{command.commandCode}</span> },
        { head: 'Ngăn', nowrap: true, cell: command => command.slotCode ?? slotOf(command)?.allocation.slotCode ?? '—' },
        { head: 'Trạng thái', cell: command => <Badge domain="dispense" value={command.status} /> },
        { head: 'Tạo lúc', cell: command => formatDateTime(command.createdAt) },
        { head: 'Gửi lúc', secondary: true, cell: command => formatDateTime(command.sentAt) },
        { head: 'Máy nhận lúc', secondary: true, cell: command => formatDateTime(command.acknowledgedAt) },
        { head: 'Kết thúc lúc', cell: command => {
          const ended = commandEndedAt(command)
          return ended.approximate ? <>{formatDateTime(ended.at)} <span className="block text-xs text-muted-foreground">(lần cập nhật cuối; lệnh chưa từng gửi được)</span></> : formatDateTime(ended.at)
        } },
        { head: 'Diễn giải', cell: command => <span className="text-[13px]">{commandNote(command, now)}</span> },
      ]} />
  }
  return <section className={PANEL} aria-labelledby="dispense-title">
    <h2 id="dispense-title" className={HEADING}>Lệnh nhả hàng</h2>
    {paid && !missing && <p className={HINT}>Mỗi hộp đã trả tiền có một lệnh. Lệnh chưa được máy phản hồi được gửi lại sau mỗi 5 giây với cùng mã; quá 60 giây chưa xong thì chuyển “Quá thời gian”.</p>}
    {body}
  </section>
}

export default OrderDetailPage
