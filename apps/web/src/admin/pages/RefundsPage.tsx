// T3 / W-12 Hoàn tiền (FE 8.1), ADMIN only (REFUND_READ to read, PAYMENT_REFUND to record; never STAFF). The admin gives
// the money back by bank transfer, then records the transfer reference here; a payment can be recorded once only.
// "Cần hoàn tiền" (default, `?view=pending`) is the server's own list (GET /refunds/candidates): failed dispenses, late
// and duplicate payments and orders a customer reported, oldest waiting first, with the payer's bank account to
// transfer to and the customer report / INCIDENT work order of the order. "Đã hoàn tiền" (`?view=refunded`) lists the
// recorded refunds (GET /refunds) under their totals by reason (GET /refunds/summary). `?orderId=` narrows the screen
// to one order (entry from the order, payment and customer report screens; `workOrderId` notes the refund on that
// INCIDENT work order). Filters and pages live in the URL; from/to are Vietnam days. No delete.
import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { ordersApi, refundsApi } from '../../api/resources.ts'
import type { Refund, RefundCandidate, RefundSummary } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch } from '../../lib/table-query.ts'
import { Badge, DataTable, DateFilter, ErrorState, Forbidden, Link, Loading, PAGE_SIZE, PageHead, Pagination, SelectFilter, useDialog } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { customerReportPath, verdictLabel } from '../customer-reports.ts'
import { useMachineOptions } from '../options.ts'
import { paymentPath, shortId } from '../order-detail.ts'
import { LINK as BASE_LINK } from '../payment-parts.tsx'
import { RefundDialog } from '../refund-parts.tsx'
import type { RefundTarget } from '../refund-parts.tsx'
import {
  CANDIDATE_TYPES, CANDIDATE_TYPE_LABELS, NO_PAYER, PENDING_FILTER_KEYS, REFUNDED_FILTER_KEYS, REFUND_REASONS, REFUND_REASON_LABELS, blockedText, candidateQuery,
  candidateTypeLabel, pageValue, payerLines, readRefundFilters, refundCase, refundListQuery, refundOf, refundReasonLabel, summaryQuery, summaryRows,
} from '../refunds.ts'
import type { RefundFilters } from '../refunds.ts'
import { ticketPath } from '../tickets.ts'
import { useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import { useSession } from '../useSession.ts'

const LINK = `${BASE_LINK} whitespace-nowrap`
const SECTION = 'mb-6 min-w-0'
const HEADING = 'mb-1! text-base font-semibold'
const HINT = 'mb-3! text-[13px] text-muted-foreground'
const TYPE_OPTIONS = CANDIDATE_TYPES.map(type => ({ value: type, label: CANDIDATE_TYPE_LABELS[type] }))
const REASON_OPTIONS = REFUND_REASONS.map(reason => ({ value: reason, label: REFUND_REASON_LABELS[reason] }))
const is403 = (state: ApiState<unknown>) => state.error instanceof ApiError && state.error.status === 403 && !state.data
type PageOf<T> = { content: T[]; page: number; totalPages: number; totalElements: number }

function RecordButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <Button type="button" size="sm" variant="outline" className="whitespace-nowrap max-sm:h-11" aria-label={label} disabled={disabled} onClick={onClick}>Ghi nhận hoàn tiền</Button>
}

function RefundsPage() {
  const { params, update } = useQueryParams()
  const { can } = useSession()
  const canRecord = can('PAYMENT_REFUND')
  const filters = readRefundFilters(params)
  const machines = useMachineOptions()
  const dialog = useDialog<RefundTarget>()
  const pendingView = filters.view === 'pending' && !filters.orderId
  const refundedView = filters.view === 'refunded' && !filters.orderId
  const range = `${filters.machineId}|${filters.from}|${filters.to}`
  const candidates = useApi(signal => (pendingView ? refundsApi.candidates(candidateQuery(filters, PAGE_SIZE), signal) : Promise.resolve(undefined)),
    `${pendingView}|${range}|${filters.type}|${filters.page}`)
  const refunded = useApi(signal => (refundedView ? refundsApi.list(refundListQuery(filters, PAGE_SIZE), signal) : Promise.resolve(undefined)),
    `${refundedView}|${range}|${filters.reason}|${filters.refundedBy}|${filters.page}`)
  const summary = useApi(signal => (refundedView ? refundsApi.summary(summaryQuery(filters), signal) : Promise.resolve(undefined)), `${refundedView}|${range}`)
  const [focusTick, setFocusTick] = useState(0)
  const changed = () => { candidates.reload(); refunded.reload(); summary.reload(); setFocusTick(tick => tick + 1) }
  const open = (target: RefundTarget) => dialog.open(target)
  // Switching view clears the other view's filters (from/to mean paidAt in one, refundedAt in the other).
  const setView = (view: RefundFilters['view']) => update({ view, orderId: undefined, workOrderId: undefined, page: undefined, type: undefined, reason: undefined, refundedBy: undefined, from: undefined, to: undefined })
  const set = (patch: Record<string, string | undefined>) => update({ ...patch, page: undefined })

  const forbidden = pendingView ? is403(candidates) : refundedView ? is403(refunded) : false
  const filterKeys = refundedView ? REFUNDED_FILTER_KEYS : PENDING_FILTER_KEYS

  return <>
    <PageHead title="Hoàn tiền" subtitle="Chuyển khoản trả toàn bộ số tiền cho khách trước, rồi ghi nhận mã giao dịch tại đây. Mỗi khoản thanh toán chỉ ghi nhận hoàn tiền một lần; không sửa hay xóa được." />
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
      <span id="refunds-quick" className="text-muted-foreground">Lọc nhanh</span>
      <div role="group" aria-labelledby="refunds-quick" className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={pendingView ? 'default' : 'outline'} aria-pressed={pendingView} className="max-sm:h-11" onClick={() => setView('pending')}>Cần hoàn tiền</Button>
        <Button type="button" size="sm" variant={refundedView ? 'default' : 'outline'} aria-pressed={refundedView} className="max-sm:h-11" onClick={() => setView('refunded')}>Đã hoàn tiền</Button>
      </div>
    </div>

    {filters.orderId
      ? <OrderFocus key={`${filters.orderId}|${focusTick}`} orderId={filters.orderId} workOrderId={filters.workOrderId} canRecord={canRecord} open={open}
        clear={() => update({ orderId: undefined, workOrderId: undefined })} />
      : forbidden ? <Forbidden permission="REFUND_READ" />
      : <>
        <FilterBar activeCount={activeFilterCount(filterKeys.map(key => filters[key]))} onClear={() => update({ ...clearFiltersPatch(filterKeys), page: undefined })}>
          <SelectFilter label="Máy" value={filters.machineId} onChange={value => set({ machineId: value })} options={machines} />
          {pendingView && <SelectFilter label="Trường hợp" value={filters.type} onChange={value => set({ type: value })} options={TYPE_OPTIONS} />}
          {refundedView && <SelectFilter label="Lý do" value={filters.reason} onChange={value => set({ reason: value })} options={REASON_OPTIONS} />}
          <DateFilter label={pendingView ? 'Tiền về từ ngày' : 'Hoàn từ ngày'} value={filters.from} onChange={value => set({ from: value })} />
          <DateFilter label="Đến ngày (gồm cả ngày này)" value={filters.to} onChange={value => set({ to: value })} />
        </FilterBar>
        {pendingView && <Candidates state={candidates} filters={filters} canRecord={canRecord} open={open} onPage={next => update({ page: pageValue(next) })} />}
        {refundedView && <>
          <SummaryBlock state={summary} filters={filters} />
          <RefundedList state={refunded} filters={filters} update={update} />
        </>}
      </>}
    {dialog.value && <RefundDialog target={dialog.value} close={dialog.close} changed={changed} />}
  </>
}

// ---- "Cần hoàn tiền"

function PayerCell({ payer }: { payer: RefundCandidate['payer'] | null }) {
  const lines = payerLines(payer)
  if (!lines) return <span className="block max-w-[28ch] text-xs text-muted-foreground">{NO_PAYER}</span>
  return <span className="grid gap-0.5"><span className="font-medium">{lines.name}</span><span className="font-mono text-[13px] break-all">{lines.account}</span>
    <span className="text-xs text-muted-foreground">{lines.bank}</span></span>
}

function Candidates({ state, filters, canRecord, open, onPage }: {
  state: ApiState<PageOf<RefundCandidate> | undefined>; filters: RefundFilters; canRecord: boolean; open: (target: RefundTarget) => void; onPage: (page: number) => void
}) {
  const columns: Column<RefundCandidate>[] = [
    { head: 'Đơn hàng', cell: row => <span className="grid justify-items-start gap-1">
      {row.order?.id ? <Link to={`/admin/orders/${row.order.id}`} className={LINK} label={`Mở đơn ${row.order.orderCode ?? ''}`}>{row.order.orderCode ?? shortId(row.order.id)}</Link> : '—'}
      {row.order?.status && <Badge domain="order" value={row.order.status} />}
    </span> },
    { head: 'Trường hợp', cell: row => <span className="grid gap-0.5">
      <span className="font-medium">{candidateTypeLabel(row.type)}</span>
      {row.customerReport?.id && <Link to={customerReportPath(row.customerReport.id)} className={`${BASE_LINK} text-xs`} label={`Mở phản ánh ${row.customerReport.reportCode ?? ''}`}>
        Phản ánh {row.customerReport.reportCode}{row.customerReport.verdict ? ` · ${verdictLabel(row.customerReport.verdict)}` : ''}</Link>}
      {row.relatedWorkOrder?.id && <Link to={ticketPath(row.relatedWorkOrder.id)} className={`${BASE_LINK} text-xs`}>Phiếu {row.relatedWorkOrder.code ?? shortId(row.relatedWorkOrder.id)}</Link>}
    </span> },
    { head: 'Máy', nowrap: true, secondary: true, cell: row => row.order?.machineCode ?? '—' },
    { head: 'Số tiền', nowrap: true, cell: row => <span className="font-semibold">{formatMoney(row.amount)}</span> },
    { head: 'Chuyển khoản tới', cell: row => <PayerCell payer={row.payer} /> },
    { head: 'Chờ từ', cell: row => <span className="grid gap-0.5">{formatDateTime(row.waitingSince ?? row.paidAt)}
      {row.paymentId && <Link to={paymentPath(row.paymentId)} className={`${BASE_LINK} text-xs`}>Mở thanh toán</Link>}</span> },
    { head: 'Thao tác', cell: row => canRecord && row.paymentId && row.order?.id
      ? <RecordButton label={`Ghi nhận hoàn tiền đơn ${row.order.orderCode ?? ''}`} onClick={() => open({
        orderId: row.order!.id!, paymentId: row.paymentId!, orderCode: row.order!.orderCode, candidateType: row.type, payer: row.payer ?? null,
        workOrder: row.relatedWorkOrder?.id ? { id: row.relatedWorkOrder.id, code: row.relatedWorkOrder.code } : undefined,
      })} />
      : <span className="text-xs text-muted-foreground">Chỉ quản trị viên có quyền hoàn tiền ghi nhận được.</span> },
  ]
  const filtered = activeFilterCount(PENDING_FILTER_KEYS.map(key => filters[key])) > 0
  return <section className={SECTION} aria-labelledby="refund-pending">
    <h2 id="refund-pending" className={HEADING}>Cần hoàn tiền</h2>
    <p className={HINT}>Danh sách do hệ thống lập: khách đã trả tiền nhưng không nhận hộp, tiền về sau khi đơn hủy, thanh toán trùng, hoặc khách phản ánh về đơn. Chờ lâu nhất ở trên cùng. Chuyển khoản đúng số tiền tới tài khoản người trả rồi bấm “Ghi nhận hoàn tiền”.</p>
    <DataTable state={state} rows={state.data?.content} rowKey={row => row.paymentId ?? ''} caption="Các khoản thanh toán cần hoàn tiền" columns={columns}
      empty={filtered ? 'Không có khoản nào khớp bộ lọc. Hãy đổi hoặc xóa bộ lọc.' : 'Không có khoản nào cần hoàn tiền.'} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={onPage} />}
  </section>
}

// ---- "Đã hoàn tiền"

function SummaryBlock({ state, filters }: { state: ApiState<RefundSummary | undefined>; filters: RefundFilters }) {
  const period = filters.from || filters.to ? `${filters.from ? `từ ${filters.from.split('-').reverse().join('/')}` : ''}${filters.to ? ` đến ${filters.to.split('-').reverse().join('/')}` : ''}`.trim() : 'mọi thời điểm'
  return <section className="mb-5 rounded-xl border bg-card p-4 shadow-xs" aria-labelledby="refund-summary">
    <h2 id="refund-summary" className={HEADING}>Tổng hoàn tiền ({period})</h2>
    {state.error && !state.data ? <ErrorState error={state.error} retry={state.reload} />
      : !state.data ? <Loading label="Đang tải tổng hoàn tiền…" rows={2} />
      : <>
        <p className="mb-3! text-[14px]"><strong className="text-lg" data-figure="refund-total">{formatMoney(state.data.totalAmount)}</strong> · {state.data.count ?? 0} lần hoàn tiền</p>
        <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          {summaryRows(state.data).map(row => <li key={row.reason} className="flex justify-between gap-3 border-b border-dashed py-1">
            <span className="text-muted-foreground">{row.label}</span><span className="whitespace-nowrap">{row.count} · {formatMoney(row.totalAmount)}</span>
          </li>)}
        </ul>
        <p className="mt-2! text-xs text-muted-foreground">Tính theo ngày hoàn (giờ Việt Nam) và máy đang lọc; không theo lý do hay người ghi nhận.</p>
      </>}
  </section>
}

function RefundedList({ state, filters, update }: { state: ApiState<PageOf<Refund> | undefined>; filters: RefundFilters; update: (patch: Record<string, string | undefined>) => void }) {
  const byName = filters.refundedBy ? state.data?.content.find(row => row.refundedBy?.id === filters.refundedBy)?.refundedBy?.fullName : undefined
  const columns: Column<Refund>[] = [
    { head: 'Đơn hàng', nowrap: true, cell: row => row.order?.id
      ? <Link to={`/admin/orders/${row.order.id}`} className={LINK} label={`Mở đơn ${row.order.orderCode ?? ''}`}>{row.order.orderCode ?? shortId(row.order.id)}</Link> : '—' },
    { head: 'Lý do', cell: row => refundReasonLabel(row.reason) },
    { head: 'Số tiền', nowrap: true, cell: row => formatMoney(row.amount) },
    { head: 'Hoàn lúc', cell: row => <span className="grid gap-0.5">{formatDateTime(row.refundedAt)}<span className="text-xs text-muted-foreground">Trả tiền lúc {formatDateTime(row.paidAt)}</span></span> },
    { head: 'Mã chuyển khoản', cell: row => <span className="font-mono text-[13px] break-all">{row.transferReference}</span> },
    { head: 'Người ghi nhận', secondary: true, cell: row => row.refundedBy?.id && row.refundedBy.id !== filters.refundedBy
      ? <Button type="button" variant="link" className="h-auto p-0 text-[13px]" aria-label={`Chỉ xem các lần do ${row.refundedBy.fullName ?? 'người này'} ghi nhận`}
        onClick={() => update({ refundedBy: row.refundedBy!.id, page: undefined })}>{row.refundedBy.fullName?.trim() || `Tài khoản …${row.refundedBy.id.slice(-8)}`}</Button>
      : (row.refundedBy?.fullName?.trim() || '—') },
    { head: 'Ghi chú', secondary: true, cell: row => row.note?.trim() ? <span className="line-clamp-2 max-w-[36ch] whitespace-pre-wrap">{row.note}</span> : '—' },
    { head: 'Thanh toán', cell: row => row.paymentId ? <Link to={paymentPath(row.paymentId)} className={`${BASE_LINK} text-xs`}>Mở thanh toán {shortId(row.paymentId)}</Link> : '—' },
  ]
  const filtered = activeFilterCount(REFUNDED_FILTER_KEYS.map(key => filters[key])) > 0
  return <section className={SECTION} aria-labelledby="refund-done">
    <h2 id="refund-done" className="sr-only">Đã hoàn tiền</h2>
    {filters.refundedBy && <p className="mb-3! flex flex-wrap items-center gap-2 text-[13px]">
      <span>Người ghi nhận: <strong className="font-medium">{byName ?? `Tài khoản …${filters.refundedBy.slice(-8)}`}</strong></span>
      <Button type="button" size="sm" variant="outline" className="max-sm:h-11" onClick={() => update({ refundedBy: undefined, page: undefined })}>Bỏ lọc người ghi nhận</Button>
    </p>}
    <DataTable state={state} rows={state.data?.content} rowKey={row => row.paymentId ?? ''} caption="Các lần hoàn tiền đã ghi nhận" columns={columns}
      empty={filtered ? 'Không có lần hoàn tiền nào khớp bộ lọc. Hãy đổi hoặc xóa bộ lọc.' : 'Chưa ghi nhận lần hoàn tiền nào.'} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: pageValue(next) })} />}
  </section>
}

// ---- one order (deep link ?orderId=)

function OrderFocus({ orderId, workOrderId, canRecord, open, clear }: {
  orderId: string; workOrderId: string; canRecord: boolean; open: (target: RefundTarget) => void; clear: () => void
}) {
  const order = useApi(signal => ordersApi.get(orderId, signal), `focus|${orderId}`)
  const back = <p className="mt-3! text-[13px]"><Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={clear}>Xem tất cả trường hợp cần hoàn tiền</Button></p>
  const data = order.data
  if (order.error && !data) {
    const code = order.error instanceof ApiError ? order.error.status : undefined
    if (code === 404 || code === 400) return <div role="alert" className="px-4 py-10 text-center text-muted-foreground"><p>Không tìm thấy đơn này: đường dẫn có thể đã sai. Mở lại từ danh sách cần hoàn tiền.</p>{back}</div>
    return <ErrorState error={order.error} retry={order.reload} />
  }
  if (!data) return <Loading label="Đang tải đơn hàng…" rows={4} />
  const payments = (data.payments ?? []).filter(payment => payment.status === 'SUCCESS' || payment.status === 'REFUNDED')
  const workOrder = workOrderId ? { id: workOrderId } : undefined
  return <section className={SECTION} aria-labelledby="refund-order">
    <h2 id="refund-order" className={HEADING}>Đơn {data.orderCode ?? shortId(data.id)}</h2>
    <p className="mb-3! flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      <Badge domain="order" value={data.status} /><span>Máy {data.machineCode ?? '—'} · tổng {formatMoney(data.totalAmount)}</span>
      <Link to={`/admin/orders/${data.id}`} className={BASE_LINK}>Mở chi tiết đơn</Link>
    </p>
    {workOrderId && <p className="mb-3! text-[13px]">Lần hoàn tiền ghi nhận ở đây sẽ được ghi chú vào <Link to={ticketPath(workOrderId)} className={BASE_LINK}>phiếu sự cố liên quan</Link>.</p>}
    {payments.length > 0 && payments.every(payment => payment.status === 'REFUNDED') && <p className="mb-3! text-[14px]" role="status">Đơn này không còn khoản nào cần hoàn tiền.</p>}
    {!payments.length && <p className="mb-3! flex items-center gap-1.5 text-[14px]" role="status"><TriangleAlert aria-hidden="true" className="size-4 text-muted-foreground" />Đơn chưa có khoản thanh toán thành công nào nên không có tiền để hoàn.</p>}
    {payments.length > 0 && <DataTable state={order} rows={payments} rowKey={payment => payment.id ?? ''} caption={`Các khoản đã nhận tiền của đơn ${data.orderCode ?? ''}`} columns={[
      { head: 'Lần thanh toán', nowrap: true, cell: payment => <Link to={paymentPath(payment.id)} className={LINK} label={`Mở thanh toán ${payment.provider ?? ''} ${shortId(payment.id)}`}>{payment.provider ?? 'Thanh toán'} {shortId(payment.id)}</Link> },
      { head: 'Trạng thái', cell: payment => <Badge domain="payment" value={payment.status} /> },
      { head: 'Số tiền', nowrap: true, cell: payment => formatMoney(payment.amount) },
      { head: 'Thanh toán lúc', cell: payment => formatDateTime(payment.paidAt) },
      { head: 'Hoàn tiền', cell: payment => {
        const found = refundCase(data, payment.id)
        if (found.kind === 'ready') return canRecord
          ? <span className="grid justify-items-start gap-1">
            <RecordButton label={`Ghi nhận hoàn tiền thanh toán ${payment.provider ?? ''} ${shortId(payment.id)} của đơn ${data.orderCode ?? ''}`}
              onClick={() => open({ orderId: data.id ?? orderId, paymentId: payment.id ?? '', orderCode: data.orderCode, workOrder })} />
            {!found.expected && <span className="max-w-[40ch] text-xs text-muted-foreground">Đơn đã giao hộp: chỉ hoàn khi khách phản ánh chất lượng hoặc có lý do khác.</span>}
          </span>
          : <span className="text-xs text-muted-foreground">Chỉ quản trị viên có quyền hoàn tiền ghi nhận được.</span>
        return <span data-refund-blocked={found.why} className="block max-w-[48ch] text-[13px] text-muted-foreground">{blockedText(found, refundOf(data.refunds, payment.id))}</span>
      } },
    ]} />}
    {back}
  </section>
}

export default RefundsPage
