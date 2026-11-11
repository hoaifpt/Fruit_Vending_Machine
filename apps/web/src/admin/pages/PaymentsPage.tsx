// T2 Thanh toán (FE 6.2), ADMIN only, read only: every payment attempt with server-side filters kept on the URL, and the
// "Cần xử lý" quick filter (`?requiresAttention=true`): SUCCESS payments with money to give back (late payment on a
// cancelled order, duplicate payment). Amount mismatches cannot be listed by the API (see payments.ts): the view says
// where to find them instead of pretending the list is complete.
import { TriangleAlert } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { paymentsApi } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import { Badge, DataTable, DateFilter, Link, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter, enumOptions } from '../kit.tsx'
import { shortId } from '../order-detail.ts'
import { useMachineOptions } from '../options.ts'
import { ATTENTION_PARAM, LIST_ANOMALY_TEXT, PAYMENT_FILTER_KEYS, PAYMENT_SORT_RULE, PAYMENT_STATUSES, listAnomalies, paymentListQuery, readPaymentFilters } from '../payments.ts'
import type { Payment } from '../../api/resources.ts'
import type { Column } from '../kit.tsx'
import { LINK as BASE_LINK } from '../payment-parts.tsx'
import { useApi } from '../useApi.ts'

const LINK = `${BASE_LINK} whitespace-nowrap`

function PaymentsPage() {
  const { params, update } = useQueryParams()
  const filters = readPaymentFilters(params)
  const machines = useMachineOptions()
  const state = useApi(signal => paymentsApi.list(paymentListQuery(filters, PAGE_SIZE), signal), params.toString())
  const rows = state.data?.content
  // 403: the explanation of the view and the filters are of no use; the table shows why and what to do.
  const forbidden = state.error instanceof ApiError && state.error.status === 403 && !rows
  const anomalies = filters.attention && rows ? listAnomalies(rows) : undefined

  const columns: Column<Payment>[] = [
    { head: 'Lần thanh toán', nowrap: true, cell: payment => <Link to={`/admin/payments/${payment.id}`} className={LINK} label={`Mở thanh toán ${payment.provider ?? ''} ${shortId(payment.id)}`}>{payment.provider ?? 'Thanh toán'} {shortId(payment.id)}</Link> },
    ...(anomalies ? [{ head: 'Bất thường', cell: (payment: Payment) => {
      const info = anomalies.get(payment.id ?? '')
      if (!info) return '—'
      return <span className="grid gap-0.5">
        <span className="inline-flex items-center gap-1 font-medium text-destructive"><TriangleAlert aria-hidden="true" className="size-3.5" />{LIST_ANOMALY_TEXT[info.kind]}</span>
        {info.refundCandidate && <span className="text-xs text-muted-foreground">Khoản đến sau: cần hoàn</span>}
        {info.kind === 'review' && <span className="text-xs text-muted-foreground">Mở chi tiết để biết loại</span>}
      </span>
    } }] : []),
    { head: 'Đơn hàng', nowrap: true, cell: payment => payment.orderId ? <Link to={`/admin/orders/${payment.orderId}`} className={LINK} label={`Mở đơn ${payment.orderCode ?? ''}`}>{payment.orderCode ?? shortId(payment.orderId)}</Link> : '—' },
    { head: 'Máy', nowrap: true, secondary: true, cell: payment => payment.machineCode ?? '—' },
    { head: 'Trạng thái', cell: payment => <Badge domain="payment" value={payment.status} /> },
    { head: 'Số tiền', sortKey: 'amount', firstDirection: 'desc', nowrap: true, cell: payment => formatMoney(payment.amount) },
    { head: 'Mã giao dịch', secondary: true, cell: payment => payment.transactionId ? <span className="font-mono text-[13px] break-all">{payment.transactionId}</span> : '—' },
    { head: 'Tạo lúc', sortKey: 'createdAt', firstDirection: 'desc', cell: payment => formatDateTime(payment.createdAt) },
    { head: 'Thanh toán lúc', sortKey: 'paidAt', firstDirection: 'desc', cell: payment => formatDateTime(payment.paidAt) },
  ]

  return <>
    <PageHead title="Thanh toán" subtitle="Chỉ xem. Không có thao tác đánh dấu đã thanh toán hay hoàn tiền trên web." />
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
      <span id="payments-quick" className="text-muted-foreground">Lọc nhanh</span>
      <div role="group" aria-labelledby="payments-quick">
        <Button type="button" size="sm" variant={filters.attention ? 'default' : 'outline'} aria-pressed={filters.attention} className="max-sm:h-11"
          onClick={() => update({ [ATTENTION_PARAM]: filters.attention ? undefined : 'true' })}>Cần xử lý: thanh toán muộn, trùng</Button>
      </div>
    </div>
    {filters.attention && !forbidden && <section aria-labelledby="attention-help" className="mb-4 rounded-lg border border-primary/25 bg-primary/8 px-3.5 py-3 text-[14px]">
      <h2 id="attention-help" className="mb-1! text-[14px] font-semibold">Cần xử lý: tiền đã về nhưng phải hoàn cho khách</h2>
      <ul className="grid gap-1 pl-4">
        <li><strong className="font-medium">Thanh toán muộn</strong>: tiền về khi đơn đã hủy, khách không nhận hộp.</li>
        <li><strong className="font-medium">Trùng khoản</strong>: một đơn có hai khoản thành công; cả hai hiện ở đây, khoản đến sau là khoản cần hoàn.</li>
        <li><strong className="font-medium">Lệch số tiền</strong> không có trong danh sách này: hệ thống giữ nguyên thanh toán và máy chủ chưa có API liệt kê.
          Chỉ xem được ở mục “Đối chiếu webhook” trong chi tiết từng thanh toán.</li>
      </ul>
      <p className="mt-1.5! text-[13px] text-muted-foreground">Đối soát với nhà cung cấp rồi hoàn tiền thủ công; web không có thao tác hoàn tiền.</p>
    </section>}
    {!forbidden && <FilterBar activeCount={activeFilterCount(PAYMENT_FILTER_KEYS.map(key => filters[key]))} onClear={() => update(clearFiltersPatch(PAYMENT_FILTER_KEYS))}>
      <SelectFilter label="Trạng thái" value={filters.status} onChange={value => update({ status: value })} options={enumOptions('payment', PAYMENT_STATUSES)} />
      <SearchFilter label="Nhà cung cấp" value={filters.provider} onCommit={value => update({ provider: value })} placeholder="Ví dụ: PAYOS" />
      <SelectFilter label="Máy" value={filters.machineId} onChange={value => update({ machineId: value })} options={machines} />
      <SearchFilter label="Mã đơn (UUID)" value={filters.orderId} onCommit={value => update({ orderId: value })} />
      <DateFilter label="Từ ngày" value={filters.from} onChange={value => update({ from: value })} />
      <DateFilter label="Đến ngày (gồm cả ngày này)" value={filters.to} onChange={value => update({ to: value })} />
    </FilterBar>}
    <DataTable state={state} rows={rows} rowKey={payment => payment.id ?? ''} caption={filters.attention ? 'Thanh toán cần xử lý' : 'Danh sách thanh toán'}
      empty={filters.attention ? 'Không có thanh toán muộn hoặc trùng nào khớp bộ lọc. Không có khoản nào cần hoàn.' : 'Không có thanh toán phù hợp. Hãy đổi hoặc xóa bộ lọc.'}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, PAYMENT_SORT_RULE) })} columns={columns} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
  </>
}

export default PaymentsPage
