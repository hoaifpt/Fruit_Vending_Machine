// T2 Chi tiết thanh toán (FE 6.2), ADMIN only, read only. Everything needed to settle one payment: what is abnormal
// (late, duplicate, amount mismatch) and the next step, the provider's references, the amount against the order, the
// other attempts of the order (one click each) and the provider's webhooks for this payment (one click each), each
// body's amount compared with the payment's.
// Sources (real API): GET /payments/{id}; GET /orders/{orderId} (status, total, every attempt); GET /payment-webhook-logs
// ?reference=<paymentReference> then GET /payment-webhook-logs/{id} for the amounts (the list carries no body). The
// reference is the provider's hint, equal to paymentReference for MOCK and payOS (backend gateways).
import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { ordersApi, paymentsApi, webhookLogsApi } from '../../api/resources.ts'
import type { OrderDetail, PaymentDetail, WebhookLogSummary } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { Badge, DataTable, ErrorState, Link, Loading, PageHead } from '../kit.tsx'
import { paymentPath, shortId } from '../order-detail.ts'
import { AmountCheckBadge, HEADING, HINT, LINK, PANEL, VerifiedBadge } from '../payment-parts.tsx'
import { amountVsOrder, isCheckedWebhook, isMismatch, payloadAmount, paymentFindings, webhookAmountCheck, webhookEventText, webhookLogPath, webhookLogsByReferencePath } from '../payments.ts'
import type { AmountCheck } from '../payments.ts'
import { useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import { useSession } from '../useSession.ts'

const BACK = { to: '/admin/payments', label: 'Danh sách thanh toán' }
/** Webhooks read for one payment (a payment normally has one to three). */
const HOOK_LIMIT = 20
const NONE = { loading: false, error: undefined, reload: () => {} }

/** `checked`: a verified SUCCESS/FAILED call, the only ones the backend compares (and whose body is read here). */
interface HookRow { log: WebhookLogSummary; checked: boolean; amount?: number; bodyFailed: boolean }
interface Hooks { rows: HookRow[]; total: number }

async function loadHooks(reference: string, signal: AbortSignal): Promise<Hooks> {
  const page = await webhookLogsApi.list({ reference, page: 0, size: HOOK_LIMIT, sort: 'receivedAt,desc' }, signal)
  const logs = page.content ?? []
  // Bodies only of the calls the backend applied: rejected calls and other events cannot be a mismatch.
  const bodies = await Promise.allSettled(logs.map(log => (isCheckedWebhook(log) ? webhookLogsApi.get(log.id ?? '', signal) : Promise.resolve(undefined))))
  return {
    total: page.totalElements ?? logs.length,
    rows: logs.map((log, index) => {
      const body = bodies[index]
      if (!isCheckedWebhook(log)) return { log, checked: false, bodyFailed: false }
      return body.status === 'fulfilled' ? { log, checked: true, amount: payloadAmount(body.value?.rawPayload), bodyFailed: false } : { log, checked: true, bodyFailed: true }
    }),
  }
}

function PaymentDetailPage({ paymentId }: { paymentId: string }) {
  const { can } = useSession()
  const canOrders = can('ORDER_READ'), canHooks = can('PAYMENT_WEBHOOK_LOG_READ')
  const payment = useApi(signal => paymentsApi.get(paymentId, signal), paymentId)
  const data = payment.data
  const orderId = data?.orderId ?? '', reference = data?.paymentReference ?? ''
  const order = useApi(signal => (canOrders && orderId ? ordersApi.get(orderId, signal) : Promise.resolve(undefined)), `${orderId}|${canOrders}`)
  const hooks = useApi(signal => (canHooks && reference ? loadHooks(reference, signal) : Promise.resolve(undefined)), `${reference}|${canHooks}`)

  if (payment.error && !data) {
    const code = payment.error instanceof ApiError ? payment.error.status : undefined
    if (code === 404 || code === 400) return <>
      <PageHead title="Không tìm thấy thanh toán" back={BACK} />
      <div role="alert" className="px-4 py-10 text-center text-muted-foreground">
        <p>Thanh toán này không tồn tại hoặc đường dẫn đã sai. Mở lại từ danh sách thanh toán hoặc từ đơn hàng.</p>
        <p className="mt-3!"><Button asChild variant="outline" size="sm"><Link to={BACK.to}>Về danh sách thanh toán</Link></Button></p>
      </div>
    </>
    return <><PageHead title="Thanh toán" back={BACK} /><ErrorState error={payment.error} retry={payment.reload} /></>
  }
  if (!data) return <><PageHead title="Thanh toán" back={BACK} /><Loading label="Đang tải thanh toán…" rows={6} /></>

  const hookRows = hooks.data?.rows ?? []
  const findings = paymentFindings(data, order.data, hookRows.filter(row => isMismatch(checkOf(row, data.amount))).length)
  const orderUnknown = canOrders && !!order.error && !order.data
  return <>
    <PageHead title={`Thanh toán ${data.provider ?? ''}`} back={BACK}
      subtitle="Chỉ xem. Không có thao tác đánh dấu đã thanh toán hay hoàn tiền trên web." />
    {findings.length > 0 && <section aria-labelledby="pay-attention" className="mb-5 rounded-xl border border-destructive/40 bg-destructive/8 p-4">
      <h2 id="pay-attention" className="mb-2! flex items-center gap-2 text-base font-semibold text-destructive"><TriangleAlert aria-hidden="true" className="size-4" />Cần xử lý</h2>
      <ul className="grid gap-1.5 pl-0">
        {findings.map(finding => <li key={finding.kind} data-finding={finding.kind} className="list-none text-[14px]">{finding.text}</li>)}
      </ul>
    </section>}
    {orderUnknown && data.status === 'SUCCESS' && <p role="status" className="mb-4! text-[13px] text-muted-foreground">Chưa đọc được đơn hàng nên chưa kiểm tra được thanh toán muộn hoặc trùng (xem mục Đơn hàng bên dưới).</p>}
    <div className="grid gap-x-5 lg:grid-cols-2">
      <section className={PANEL} aria-labelledby="pay-info">
        <h2 id="pay-info" className={HEADING}>Thông tin thanh toán</h2>
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px] [&_dt]:text-muted-foreground">
          <dt>Trạng thái</dt><dd><Badge domain="payment" explain value={data.status} /></dd>
          <dt>Nhà cung cấp</dt><dd>{data.provider ?? '—'}</dd>
          <dt>Số tiền</dt><dd className="font-semibold">{formatMoney(data.amount)}</dd>
          <dt>Mã tham chiếu</dt><dd><Mono value={data.paymentReference} /></dd>
          <dt>Mã giao dịch nhà cung cấp</dt><dd><Mono value={data.transactionId} empty={data.status === 'SUCCESS' ? '—' : 'Chưa có (chưa nhận được tiền)'} /></dd>
          <dt>Tạo lúc</dt><dd>{formatDateTime(data.createdAt)}</dd>
          <dt>Thanh toán lúc</dt><dd>{formatDateTime(data.paidAt)}</dd>
          <dt>Mã QR hết hạn lúc</dt><dd>{formatDateTime(data.expiredAt)}</dd>
          <dt>Nội dung mã QR</dt><dd><Mono value={data.qrCode} empty="— (chỉ có khi đang chờ thanh toán)" /></dd>
        </dl>
      </section>
      <OrderPanel payment={data} state={order} allowed={canOrders} />
    </div>
    <HooksPanel payment={data} state={hooks} allowed={canHooks} />
  </>
}

function checkOf(row: HookRow, expected: number | undefined): AmountCheck {
  return row.bodyFailed ? 'unknown' : webhookAmountCheck(row.log, row.amount, expected)
}

function Mono({ value, empty = '—' }: { value: string | null | undefined; empty?: string }) {
  return value ? <span className="font-mono text-[13px] break-all">{value}</span> : <span className="text-muted-foreground">{empty}</span>
}

function OrderPanel({ payment, state, allowed }: { payment: PaymentDetail; state: ApiState<OrderDetail | undefined>; allowed: boolean }) {
  const order = state.data
  const orderLink = payment.orderId
    ? <Link to={`/admin/orders/${payment.orderId}`} className={LINK} label={`Mở đơn ${payment.orderCode ?? ''}`}>{payment.orderCode ?? shortId(payment.orderId)}</Link>
    : '—'
  let body: ReactNode = null
  if (!allowed) body = <p className={HINT}>Tài khoản của bạn không xem được đơn hàng nên không đối chiếu được số tiền với đơn.</p>
  else if (state.error && !order) body = <ErrorState error={state.error} retry={state.reload} />
  else if (!order) body = <Loading label="Đang tải đơn hàng…" rows={3} />
  else {
    const check = amountVsOrder(payment.amount, order.totalAmount)
    body = <>
      <dl className="mb-4 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px] [&_dt]:text-muted-foreground">
        <dt>Trạng thái đơn</dt><dd><Badge domain="order" value={order.status} /></dd>
        <dt>Tổng tiền đơn</dt><dd>{formatMoney(order.totalAmount)}</dd>
        <dt>So với thanh toán</dt><dd>{check === 'unknown' ? '—' : <AmountCheckBadge check={check} label={check === 'match' ? 'Bằng tổng tiền đơn' : `Lệch ${formatMoney(Math.abs((payment.amount ?? 0) - (order.totalAmount ?? 0)))}`} />}</dd>
      </dl>
      <h3 className="mb-2! text-[14px] font-semibold">Các lần thanh toán của đơn</h3>
      <DataTable state={NONE} rows={order.payments ?? []} rowKey={row => row.id ?? ''} caption="Các lần thanh toán của đơn" empty="Đơn chưa có lần thanh toán nào." columns={[
        { head: 'Lần thanh toán', nowrap: true, cell: row => row.id === payment.id
          ? <span aria-current="page" className="font-medium">{row.provider ?? 'Thanh toán'} {shortId(row.id)} <span className="text-xs text-muted-foreground">(đang xem)</span></span>
          : <Link to={paymentPath(row.id)} className={`${LINK} whitespace-nowrap`} label={`Mở thanh toán ${row.provider ?? ''} ${shortId(row.id)}`}>{row.provider ?? 'Thanh toán'} {shortId(row.id)}</Link> },
        { head: 'Trạng thái', cell: row => <Badge domain="payment" value={row.status} /> },
        { head: 'Số tiền', nowrap: true, cell: row => formatMoney(row.amount) },
        { head: 'Thanh toán lúc', cell: row => formatDateTime(row.paidAt) },
      ]} />
    </>
  }
  return <section className={PANEL} aria-labelledby="pay-order">
    <h2 id="pay-order" className={HEADING}>Đơn hàng</h2>
    <p className="mb-3! text-[14px]">Đơn {orderLink}{payment.machineCode ? <> · máy {payment.machineCode}</> : null}</p>
    {body}
  </section>
}

function HooksPanel({ payment, state, allowed }: { payment: PaymentDetail; state: ApiState<Hooks | undefined>; allowed: boolean }) {
  const reference = payment.paymentReference
  let body: ReactNode
  if (!allowed) body = <p className={HINT}>Tài khoản của bạn không xem được nhật ký webhook.</p>
  else if (!reference) body = <p className={HINT}>Thanh toán chưa có mã tham chiếu nên không tìm được webhook của nhà cung cấp.</p>
  else if (state.error && !state.data) body = <ErrorState error={state.error} retry={state.reload} />
  else if (!state.data) body = <Loading label="Đang tải webhook…" rows={3} />
  else {
    const { rows, total } = state.data
    body = <>
      <DataTable state={state} rows={rows} rowKey={row => row.log.id ?? ''} caption="Webhook của nhà cung cấp cho thanh toán này"
        empty="Nhà cung cấp chưa gọi về cho thanh toán này." columns={[
          { head: 'Nhận lúc', nowrap: true, cell: row => <Link to={webhookLogPath(row.log.id)} className={`${LINK} whitespace-nowrap`} label={`Mở webhook nhận lúc ${formatDateTime(row.log.receivedAt)}`}>{formatDateTime(row.log.receivedAt)}</Link> },
          { head: 'Sự kiện', cell: row => webhookEventText(row.log.eventType) },
          { head: 'Xác thực', cell: row => <VerifiedBadge verified={row.log.verified} /> },
          { head: 'Số tiền báo về', nowrap: true, cell: row => row.bodyFailed ? <span className="text-muted-foreground">Không đọc được nội dung</span> : row.checked ? formatMoney(row.amount) : '—' },
          { head: 'Đối chiếu', cell: row => <AmountCheckBadge check={checkOf(row, payment.amount)} /> },
        ]} />
      {total > rows.length && <p className="mt-2! text-[13px] text-muted-foreground">Đang hiện {rows.length} trong {total} lần gọi mới nhất.</p>}
    </>
  }
  return <section className={PANEL} aria-labelledby="pay-hooks">
    <h2 id="pay-hooks" className={HEADING}>Đối chiếu webhook</h2>
    {allowed && reference && <p className={HINT}>
      Các lần nhà cung cấp gọi về với mã tham chiếu <span className="font-mono">{reference}</span>. Như máy chủ, chỉ đối chiếu lần đã xác thực báo thành công hoặc thất bại với {formatMoney(payment.amount)}; báo thành công mà không có số tiền cũng tính là lệch.{' '}
      <Link to={webhookLogsByReferencePath(reference)} className={LINK}>Mở trong nhật ký webhook</Link>
    </p>}
    {body}
  </section>
}

export default PaymentDetailPage
