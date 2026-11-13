// T3 / W-12 Hoàn tiền (FE 8.1), ADMIN only (draft permission REFUND_RECORD; never STAFF, BR-19/20). The admin gives the
// money back by bank transfer, then records the transfer reference here; a payment can be recorded once only.
// "Cần hoàn tiền" (default, `?view=pending`) lists the cases from existing APIs: paid orders the machine did not serve
// (GET /orders?status=DISPENSE_FAILED) and late or duplicate payments (GET /payments?requiresAttention=true).
// "Đã hoàn tiền" (`?view=refunded`) lists the recorded refunds (GET /refunds, draft). `?orderId=` narrows the screen to
// one order (entry from the order and payment detail screens). Filters and pages live in the URL. No delete.
// FE 8.3: "Cần hoàn tiền" starts with the customer reports naming a paid order (GET /incident-reports?flagged=true,
// draft), shown as soon as they arrive; a DISPENSE_FAILED row of the same order is marked "Khách báo sự cố INC-…".
import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { incidentReportsApi, ordersApi, paymentsApi, refundsApi } from '../../api/resources.ts'
import type { IncidentReport, OrderSummary, Payment, Refund } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import { Badge, DataTable, DateFilter, ErrorState, Forbidden, Link, Loading, PAGE_SIZE, PageHead, Pagination, SelectFilter, useDialog } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useMachineOptions } from '../options.ts'
import { paymentPath, shortId } from '../order-detail.ts'
import { LINK as BASE_LINK } from '../payment-parts.tsx'
import { listAnomalies } from '../payments.ts'
import { RefundDialog } from '../refund-parts.tsx'
import type { RefundTarget } from '../refund-parts.tsx'
import {
  REFUNDS_MISSING, REFUND_FILTER_KEYS, REFUND_REASONS, REFUND_REASON_LABELS, REFUND_SORT_RULE, REPORTS_MISSING, REPORT_CHECK_MACHINE, REPORT_NOTHING,
  attentionPaymentsQuery, blockedText, failedOrdersQuery, flaggedReportsQuery, pageValue, paymentRowAction, readRefundFilters, refundCase, refundListQuery,
  refundOf, refundReasonLabel, refundsMissing, reportMark, reportRowAction, reportsByOrder,
} from '../refunds.ts'
import { incidentTypeLabel, ticketPath } from '../tickets.ts'
import type { RefundFilters } from '../refunds.ts'
import { useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'

const LINK = `${BASE_LINK} whitespace-nowrap`
const SECTION = 'mb-6 min-w-0'
const HEADING = 'mb-1! text-base font-semibold'
const HINT = 'mb-3! text-[13px] text-muted-foreground'
const REASON_OPTIONS = REFUND_REASONS.map(reason => ({ value: reason, label: REFUND_REASON_LABELS[reason] }))
const is403 = (state: ApiState<unknown>) => state.error instanceof ApiError && state.error.status === 403 && !state.data

function RecordButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button type="button" size="sm" variant="outline" className="whitespace-nowrap max-sm:h-11" aria-label={label} onClick={onClick}>Ghi nhận hoàn tiền</Button>
}

function RefundsPage() {
  const { params, update } = useQueryParams()
  const filters = readRefundFilters(params)
  const machines = useMachineOptions()
  const dialog = useDialog<RefundTarget>()
  const pendingView = filters.view === 'pending' && !filters.orderId
  const refundedView = filters.view === 'refunded' && !filters.orderId
  const listKey = `${filters.machineId}|${filters.view}|${filters.orderId}`
  const failed = useApi(signal => (pendingView ? ordersApi.list(failedOrdersQuery(filters, PAGE_SIZE), signal) : Promise.resolve(undefined)), `${listKey}|${filters.failedPage}`)
  const attention = useApi(signal => (pendingView ? paymentsApi.list(attentionPaymentsQuery(filters, PAGE_SIZE), signal) : Promise.resolve(undefined)), `${listKey}|${filters.paymentPage}`)
  const reports = useApi(signal => (pendingView ? incidentReportsApi.list(flaggedReportsQuery(filters, PAGE_SIZE), signal) : Promise.resolve(undefined)), `${listKey}|${filters.reportPage}`,
    { stopOn: refundsMissing })
  const refunded = useApi(signal => (refundedView ? refundsApi.list(refundListQuery(filters, PAGE_SIZE), signal) : Promise.resolve(undefined)),
    `${listKey}|${filters.reason}|${filters.from}|${filters.to}|${filters.sort.field},${filters.sort.direction}|${filters.page}`)
  const [focusTick, setFocusTick] = useState(0)
  const changed = () => { failed.reload(); attention.reload(); reports.reload(); refunded.reload(); setFocusTick(tick => tick + 1) }
  const open = (target: RefundTarget) => dialog.open(target)
  const setView = (view: RefundFilters['view']) => update({ view, orderId: undefined, page: undefined, failedPage: undefined, paymentPage: undefined, reportPage: undefined })

  const forbidden = pendingView ? is403(failed) || is403(attention) : refundedView ? is403(refunded) : false
  const filterKeys = refundedView ? REFUND_FILTER_KEYS : (['machineId'] as const)

  return <>
    <PageHead title="Hoàn tiền" subtitle="Chuyển khoản trả tiền cho khách trước, rồi ghi nhận mã giao dịch tại đây. Mỗi khoản thanh toán chỉ ghi nhận hoàn tiền một lần; không sửa hay xóa được." />
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
      <span id="refunds-quick" className="text-muted-foreground">Lọc nhanh</span>
      <div role="group" aria-labelledby="refunds-quick" className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={filters.view === 'pending' && !filters.orderId ? 'default' : 'outline'} aria-pressed={filters.view === 'pending' && !filters.orderId} className="max-sm:h-11"
          onClick={() => setView('pending')}>Cần hoàn tiền</Button>
        <Button type="button" size="sm" variant={refundedView ? 'default' : 'outline'} aria-pressed={refundedView} className="max-sm:h-11"
          onClick={() => setView('refunded')}>Đã hoàn tiền</Button>
      </div>
    </div>

    {filters.orderId
      ? <OrderFocus key={`${filters.orderId}|${focusTick}`} orderId={filters.orderId} open={open} clear={() => update({ orderId: undefined })} />
      : forbidden ? <Forbidden />
      : <>
        <FilterBar activeCount={activeFilterCount(filterKeys.map(key => filters[key]))} onClear={() => update({ ...clearFiltersPatch(filterKeys), failedPage: undefined, paymentPage: undefined, reportPage: undefined })}>
          <SelectFilter label="Máy" value={filters.machineId} onChange={value => update({ machineId: value, failedPage: undefined, paymentPage: undefined, reportPage: undefined })} options={machines} />
          {refundedView && <>
            <SelectFilter label="Trường hợp" value={filters.reason} onChange={value => update({ reason: value })} options={REASON_OPTIONS} />
            <DateFilter label="Hoàn từ ngày" value={filters.from} onChange={value => update({ from: value })} />
            <DateFilter label="Đến ngày (gồm cả ngày này)" value={filters.to} onChange={value => update({ to: value })} />
          </>}
        </FilterBar>
        {pendingView && <>
          <FlaggedReports state={reports} open={open} onPage={next => update({ reportPage: pageValue(next) })} />
          <FailedOrders state={failed} open={open} reports={reportsByOrder(reports.data?.content)} onPage={next => update({ failedPage: pageValue(next) })} />
          <AttentionPayments state={attention} open={open} onPage={next => update({ paymentPage: pageValue(next) })} />
        </>}
        {refundedView && <RefundedList state={refunded} filters={filters} update={update} />}
      </>}
    {dialog.value && <RefundDialog target={dialog.value} close={dialog.close} changed={changed} />}
  </>
}

// ---- "Cần hoàn tiền"

type PageOf<T> = { content: T[]; page: number; totalPages: number; totalElements: number }

/** FE 8.3: customer reports naming a paid order, newest first, listed as soon as they arrive. */
function FlaggedReports({ state, open, onPage }: { state: ApiState<PageOf<IncidentReport> | undefined>; open: (target: RefundTarget) => void; onPage: (page: number) => void }) {
  const columns: Column<IncidentReport>[] = [
    { head: 'Báo cáo', cell: report => <span className="grid gap-0.5">
      {report.ticketId
        ? <Link to={ticketPath(report.ticketId)} className={`${LINK} font-mono`} label={`${report.reportCode}, mở phiếu sự cố`}>{report.reportCode}</Link>
        : <span className="font-mono">{report.reportCode}</span>}
      <span className="text-xs text-muted-foreground">{incidentTypeLabel(report.type)}</span>
    </span> },
    { head: 'Đơn hàng', nowrap: true, cell: report => report.orderId
      ? <span className="grid justify-items-start gap-1"><Link to={`/admin/orders/${report.orderId}`} className={LINK} label={`Mở đơn ${report.orderCode ?? ''}`}>{report.orderCode ?? shortId(report.orderId)}</Link>
        {report.orderStatus && <Badge domain="order" value={report.orderStatus} />}</span>
      : '—' },
    { head: 'Máy', nowrap: true, secondary: true, cell: report => report.machineCode },
    { head: 'Số tiền', nowrap: true, cell: report => report.orderTotalAmount === null || report.orderTotalAmount === undefined ? '—' : formatMoney(report.orderTotalAmount) },
    { head: 'Gửi lúc', cell: report => formatDateTime(report.createdAt) },
    { head: 'Thao tác', cell: report => {
      const action = reportRowAction(report)
      if (action === 'record') return <RecordButton label={`Ghi nhận hoàn tiền đơn ${report.orderCode ?? ''} (báo cáo ${report.reportCode})`}
        onClick={() => open({ orderId: report.orderId ?? '', orderCode: report.orderCode ?? undefined })} />
      return <span data-report-action={action} className="block max-w-[34ch] text-[13px] text-muted-foreground">{action === 'check-machine' ? REPORT_CHECK_MACHINE : REPORT_NOTHING}</span>
    } },
  ]
  const head = <>
    <h2 id="refund-reports" className={HEADING}>Khách báo sự cố về đơn đã trả tiền</h2>
    <p className={HINT}>Báo cáo gửi qua mã QR trên máy, hiện ngay khi khách gửi. Báo cáo không tự đổi trạng thái đơn: đơn còn “Đã thanh toán” thì kiểm tra máy trước (mở phiếu sự cố); đơn nhả hàng thất bại thì hoàn tiền như bình thường.</p>
  </>
  if (state.error && !state.data && refundsMissing(state.error)) return <section className={SECTION} aria-labelledby="refund-reports">
    {head}
    <p role="status" className="rounded-lg border bg-muted/40 px-4 py-4 text-center text-[13px] text-muted-foreground">{REPORTS_MISSING}</p>
  </section>
  return <section className={SECTION} aria-labelledby="refund-reports">
    {head}
    <DataTable state={state} rows={state.data?.content} rowKey={report => report.id} caption="Báo cáo sự cố của khách cần kiểm tra hoàn tiền" columns={columns}
      empty="Không có báo cáo nào của khách đang chờ kiểm tra hoàn tiền." />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={onPage} />}
  </section>
}

function FailedOrders({ state, open, reports, onPage }: { state: ApiState<PageOf<OrderSummary> | undefined>; open: (target: RefundTarget) => void; reports: Map<string, IncidentReport>; onPage: (page: number) => void }) {
  const columns: Column<OrderSummary>[] = [
    { head: 'Đơn hàng', nowrap: true, cell: order => {
      const report = reports.get(order.id ?? '')
      const link = <Link to={`/admin/orders/${order.id}`} className={LINK} label={`Mở đơn ${order.orderCode ?? ''}`}>{order.orderCode ?? shortId(order.id)}</Link>
      if (!report) return link
      return <span className="grid justify-items-start gap-0.5">{link}{report.ticketId
        ? <Link to={ticketPath(report.ticketId)} className={`${BASE_LINK} text-xs`}>{reportMark(report)}</Link>
        : <span className="text-xs font-medium">{reportMark(report)}</span>}</span>
    } },
    { head: 'Máy', nowrap: true, cell: order => order.machineCode ?? '—' },
    { head: 'Số tiền', nowrap: true, cell: order => formatMoney(order.totalAmount) },
    { head: 'Tạo lúc', cell: order => formatDateTime(order.createdAt) },
    { head: 'Thao tác', cell: order => <RecordButton label={`Ghi nhận hoàn tiền đơn ${order.orderCode ?? ''}`} onClick={() => open({ orderId: order.id ?? '', orderCode: order.orderCode })} /> },
  ]
  return <section className={SECTION} aria-labelledby="refund-failed">
    <h2 id="refund-failed" className={HEADING}>Đơn nhả hàng thất bại</h2>
    <p className={HINT}>Khách đã trả tiền nhưng máy không nhả được hộp. Hoàn toàn bộ số tiền của đơn; đơn chuyển sang “Đã hoàn tiền”.</p>
    <DataTable state={state} rows={state.data?.content} rowKey={order => order.id ?? ''} caption="Đơn nhả hàng thất bại cần hoàn tiền" columns={columns}
      empty="Không có đơn nhả hàng thất bại nào cần hoàn tiền." />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={onPage} />}
  </section>
}

function AttentionPayments({ state, open, onPage }: { state: ApiState<{ content: Payment[]; page: number; totalPages: number; totalElements: number } | undefined>; open: (target: RefundTarget) => void; onPage: (page: number) => void }) {
  const rows = state.data?.content
  const anomalies = rows ? listAnomalies(rows) : undefined
  const columns: Column<Payment>[] = [
    { head: 'Lần thanh toán', nowrap: true, cell: payment => <Link to={paymentPath(payment.id)} className={LINK} label={`Mở thanh toán ${payment.provider ?? ''} ${shortId(payment.id)}`}>{payment.provider ?? 'Thanh toán'} {shortId(payment.id)}</Link> },
    { head: 'Trường hợp', cell: payment => {
      const info = anomalies?.get(payment.id ?? '')
      if (info?.kind === 'duplicate') return <span className="grid gap-0.5"><span className="font-medium">Thanh toán trùng</span>
        <span className="text-xs text-muted-foreground">{info.refundCandidate ? 'Khoản đến sau: cần hoàn' : 'Khoản đến trước: tính cho đơn'}</span></span>
      return <span className="grid gap-0.5"><span className="font-medium">Thanh toán muộn hoặc trùng</span><span className="text-xs text-muted-foreground">Hộp thoại kiểm tra đơn trước khi ghi nhận</span></span>
    } },
    { head: 'Đơn hàng', nowrap: true, cell: payment => payment.orderId ? <Link to={`/admin/orders/${payment.orderId}`} className={LINK} label={`Mở đơn ${payment.orderCode ?? ''}`}>{payment.orderCode ?? shortId(payment.orderId)}</Link> : '—' },
    { head: 'Máy', nowrap: true, secondary: true, cell: payment => payment.machineCode ?? '—' },
    { head: 'Số tiền', nowrap: true, cell: payment => formatMoney(payment.amount) },
    { head: 'Mã giao dịch', secondary: true, cell: payment => payment.transactionId ? <span className="font-mono text-[13px] break-all">{payment.transactionId}</span> : '—' },
    { head: 'Thanh toán lúc', cell: payment => formatDateTime(payment.paidAt) },
    { head: 'Thao tác', cell: payment => paymentRowAction(anomalies?.get(payment.id ?? '')) === 'kept'
      ? <span className="text-xs text-muted-foreground">Không hoàn: khoản này được tính cho đơn</span>
      : <RecordButton label={`Ghi nhận hoàn tiền thanh toán ${payment.provider ?? ''} ${shortId(payment.id)} của đơn ${payment.orderCode ?? ''}`}
        onClick={() => open({ orderId: payment.orderId ?? '', paymentId: payment.id, orderCode: payment.orderCode })} /> },
  ]
  return <section className={SECTION} aria-labelledby="refund-payments">
    <h2 id="refund-payments" className={HEADING}>Thanh toán muộn hoặc trùng</h2>
    <p className={HINT}>Tiền về khi đơn đã hủy (khách không nhận hộp), hoặc một đơn có hai khoản thành công: hoàn khoản đến sau, giữ khoản đến trước cho đơn. Trạng thái đơn giữ nguyên.</p>
    <DataTable state={state} rows={rows} rowKey={payment => payment.id ?? ''} caption="Thanh toán muộn hoặc trùng cần hoàn tiền" columns={columns}
      empty="Không có thanh toán muộn hoặc trùng nào cần hoàn tiền." />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={onPage} />}
  </section>
}

// ---- "Đã hoàn tiền"

function RefundedList({ state, filters, update }: { state: ApiState<{ content: Refund[]; page: number; totalPages: number; totalElements: number } | undefined>; filters: RefundFilters; update: (patch: Record<string, string | undefined>) => void }) {
  if (state.error && !state.data && refundsMissing(state.error)) return <p role="status" className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-muted-foreground">{REFUNDS_MISSING}</p>
  const columns: Column<Refund>[] = [
    { head: 'Đơn hàng', nowrap: true, cell: refund => <Link to={`/admin/orders/${refund.orderId}`} className={LINK} label={`Mở đơn ${refund.orderCode}`}>{refund.orderCode || shortId(refund.orderId)}</Link> },
    { head: 'Trường hợp', cell: refund => refundReasonLabel(refund.reason) },
    { head: 'Số tiền', sortKey: 'amount', firstDirection: 'desc', nowrap: true, cell: refund => formatMoney(refund.amount) },
    { head: 'Hoàn lúc', sortKey: 'refundedAt', firstDirection: 'desc', cell: refund => formatDateTime(refund.refundedAt) },
    { head: 'Mã chuyển khoản', cell: refund => <span className="font-mono text-[13px] break-all">{refund.transferRef}</span> },
    { head: 'Người ghi nhận', secondary: true, cell: refund => refund.refundedByName?.trim() || `Tài khoản …${refund.refundedById.slice(-8)}` },
    { head: 'Ghi chú', secondary: true, cell: refund => refund.note?.trim() ? <span className="line-clamp-2 max-w-[36ch] whitespace-pre-wrap">{refund.note}</span> : '—' },
    { head: 'Trạng thái', cell: refund => <span className="grid gap-0.5"><Badge domain="payment" value={refund.paymentStatus} />
      <span className="text-xs text-muted-foreground">Đã ghi nhận, không hoàn lần 2</span>
      <Link to={paymentPath(refund.paymentId)} className={`${BASE_LINK} text-xs`}>Thanh toán {refund.paymentProvider ?? ''} {shortId(refund.paymentId)}</Link></span> },
  ]
  const filtered = activeFilterCount(REFUND_FILTER_KEYS.map(key => filters[key])) > 0
  return <section className={SECTION} aria-labelledby="refund-done">
    <h2 id="refund-done" className="sr-only">Đã hoàn tiền</h2>
    <DataTable state={state} rows={state.data?.content} rowKey={refund => refund.id} caption="Các lần hoàn tiền đã ghi nhận" columns={columns}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, REFUND_SORT_RULE) })}
      empty={filtered ? 'Không có lần hoàn tiền nào khớp bộ lọc. Hãy đổi hoặc xóa bộ lọc.' : 'Chưa ghi nhận lần hoàn tiền nào.'} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
  </section>
}

// ---- one order (deep link ?orderId=)

function OrderFocus({ orderId, open, clear }: { orderId: string; open: (target: RefundTarget) => void; clear: () => void }) {
  const order = useApi(signal => ordersApi.get(orderId, signal), `focus|${orderId}`)
  const refunds = useApi(signal => refundsApi.list({ orderId, page: 0, size: 20, sort: 'refundedAt,desc' }, signal), `focus-refunds|${orderId}`)
  const back = <p className="mt-3! text-[13px]"><Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={clear}>Xem tất cả trường hợp cần hoàn tiền</Button></p>
  const data = order.data
  if (order.error && !data) {
    const code = order.error instanceof ApiError ? order.error.status : undefined
    if (code === 404 || code === 400) return <div role="alert" className="px-4 py-10 text-center text-muted-foreground"><p>Không tìm thấy đơn này: đường dẫn có thể đã sai. Mở lại từ danh sách cần hoàn tiền.</p>{back}</div>
    return <ErrorState error={order.error} retry={order.reload} />
  }
  if (!data) return <Loading label="Đang tải đơn hàng…" rows={4} />
  const payments = (data.payments ?? []).filter(payment => payment.status === 'SUCCESS' || payment.status === 'REFUNDED')
  const anyReady = payments.some(payment => refundCase(data, payment.id).kind === 'ready')
  return <section className={SECTION} aria-labelledby="refund-order">
    <h2 id="refund-order" className={HEADING}>Đơn {data.orderCode ?? shortId(data.id)}</h2>
    <p className="mb-3! flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      <Badge domain="order" value={data.status} /><span>Máy {data.machineCode ?? '—'} · tổng {formatMoney(data.totalAmount)}</span>
      <Link to={`/admin/orders/${data.id}`} className={BASE_LINK}>Mở chi tiết đơn</Link>
    </p>
    {!anyReady && payments.length > 0 && payments.every(payment => payment.status === 'REFUNDED') && <p className="mb-3! flex items-center gap-1.5 text-[14px]" role="status">Đơn này không còn khoản nào cần hoàn tiền.</p>}
    {!payments.length && <p className="mb-3! flex items-center gap-1.5 text-[14px]" role="status"><TriangleAlert aria-hidden="true" className="size-4 text-muted-foreground" />Đơn chưa có khoản thanh toán thành công nào nên không có tiền để hoàn.</p>}
    {payments.length > 0 && <DataTable state={order} rows={payments} rowKey={payment => payment.id ?? ''} caption={`Các khoản đã nhận tiền của đơn ${data.orderCode ?? ''}`} columns={[
      { head: 'Lần thanh toán', nowrap: true, cell: payment => <Link to={paymentPath(payment.id)} className={LINK} label={`Mở thanh toán ${payment.provider ?? ''} ${shortId(payment.id)}`}>{payment.provider ?? 'Thanh toán'} {shortId(payment.id)}</Link> },
      { head: 'Trạng thái', cell: payment => <Badge domain="payment" value={payment.status} /> },
      { head: 'Số tiền', nowrap: true, cell: payment => formatMoney(payment.amount) },
      { head: 'Thanh toán lúc', cell: payment => formatDateTime(payment.paidAt) },
      { head: 'Hoàn tiền', cell: payment => {
        const found = refundCase(data, payment.id)
        if (found.kind === 'ready') return <RecordButton label={`Ghi nhận hoàn tiền thanh toán ${payment.provider ?? ''} ${shortId(payment.id)} của đơn ${data.orderCode ?? ''}`}
          onClick={() => open({ orderId: data.id ?? orderId, paymentId: payment.id, orderCode: data.orderCode })} />
        return <span data-refund-blocked={found.why} className="block max-w-[48ch] text-[13px] text-muted-foreground">{blockedText(found, refundOf(refunds.data?.content, payment.id))}</span>
      } },
    ]} />}
    {back}
  </section>
}

export default RefundsPage
