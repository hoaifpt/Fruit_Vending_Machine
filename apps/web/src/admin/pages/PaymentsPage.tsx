import { paymentsApi } from '../../api/resources.ts'
import { dateRangeToInstants, formatDateTime, formatMoney } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { Badge, DataTable, DateFilter, Link, Notice, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter, Toolbar, enumOptions, pageParam } from '../kit.tsx'
import { useMachineOptions } from '../options.ts'
import { useApi } from '../useApi.ts'

const STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED'] as const
const SORTS = [{ value: 'createdAt,desc', label: 'Mới nhất' }, { value: 'amount,desc', label: 'Số tiền giảm dần' }, { value: 'paidAt,desc', label: 'Thanh toán gần nhất' }]

function PaymentsPage() {
  const { params, update } = useQueryParams()
  const status = params.get('status') ?? '', provider = params.get('provider') ?? '', orderId = params.get('orderId') ?? '', machineId = params.get('machineId') ?? ''
  const from = params.get('from') ?? '', to = params.get('to') ?? '', sort = params.get('sort') ?? 'createdAt,desc', attention = params.get('requiresAttention') === 'true', page = pageParam(params)
  const machines = useMachineOptions()
  const range = dateRangeToInstants(from, to)
  const state = useApi(signal => paymentsApi.list({
    page, size: PAGE_SIZE, status: (status || undefined) as 'SUCCESS' | undefined, provider: provider || undefined, orderId: orderId || undefined, machineId: machineId || undefined,
    createdFrom: range.from, createdTo: range.to, requiresAttention: attention ? true : undefined, sort,
  }, signal), params.toString())
  return <>
    <PageHead title="Thanh toán" subtitle="Chỉ xem. Không có thao tác đánh dấu đã thanh toán hay hoàn tiền trên web." />
    <nav className="a-tabs" aria-label="Chế độ xem">
      <button type="button" className={`a-tab ${attention ? '' : 'is-current'}`} aria-pressed={!attention} onClick={() => update({ requiresAttention: '' })}>Tất cả</button>
      <button type="button" className={`a-tab ${attention ? 'is-current' : ''}`} aria-pressed={attention} onClick={() => update({ requiresAttention: 'true' })}>Cần xử lý</button>
    </nav>
    {attention && <Notice>Các khoản thanh toán thành công cần người kiểm tra: thanh toán đến muộn sau khi đơn đã hủy, hoặc đơn có nhiều khoản thành công. Đây là danh sách ứng viên hoàn tiền.</Notice>}
    <Toolbar>
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ status: value })} options={enumOptions(STATUSES)} />
      <SearchFilter label="Nhà cung cấp" value={provider} onCommit={value => update({ provider: value })} placeholder="Ví dụ: PAYOS" />
      <SelectFilter label="Máy" value={machineId} onChange={value => update({ machineId: value })} options={machines} />
      <SearchFilter label="Mã đơn (UUID)" value={orderId} onCommit={value => update({ orderId: value })} />
      <DateFilter label="Từ ngày" value={from} onChange={value => update({ from: value })} />
      <DateFilter label="Đến ngày (gồm cả ngày này)" value={to} onChange={value => update({ to: value })} />
      <SelectFilter label="Sắp xếp" value={sort} onChange={value => update({ sort: value })} options={SORTS} empty="Mặc định" />
    </Toolbar>
    <DataTable state={state} rows={state.data?.content} rowKey={payment => payment.id ?? ''} columns={[
      { head: 'Đơn hàng', cell: payment => <Link to={`/admin/orders/${payment.orderId}`}>{payment.orderCode}</Link> },
      { head: 'Máy', cell: payment => payment.machineCode },
      { head: 'Nhà cung cấp', cell: payment => <Link to={`/admin/payments/${payment.id}`}>{payment.provider}</Link> },
      { head: 'Trạng thái', cell: payment => <Badge value={payment.status} /> },
      { head: 'Số tiền', cell: payment => formatMoney(payment.amount) },
      { head: 'Tạo lúc', cell: payment => formatDateTime(payment.createdAt) },
      { head: 'Thanh toán lúc', cell: payment => formatDateTime(payment.paidAt) },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
  </>
}

export default PaymentsPage
