import { ordersApi } from '../../api/resources.ts'
import { dateRangeToInstants, formatDateTime, formatMoney } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { Badge, DataTable, DateFilter, Link, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter, Toolbar, enumOptions, pageParam } from '../kit.tsx'
import { useMachineOptions } from '../options.ts'
import { useApi } from '../useApi.ts'

export const ORDER_STATUSES = ['PENDING_PAYMENT', 'PAID', 'DISPENSING', 'COMPLETED', 'CANCELLED', 'PAYMENT_FAILED', 'DISPENSE_FAILED', 'REFUNDED'] as const
const SORTS = [{ value: 'createdAt,desc', label: 'Mới nhất' }, { value: 'createdAt,asc', label: 'Cũ nhất' }, { value: 'totalAmount,desc', label: 'Giá trị giảm dần' }, { value: 'orderCode,asc', label: 'Mã đơn' }]

function OrdersPage() {
  const { params, update } = useQueryParams()
  const status = params.get('status') ?? '', machineId = params.get('machineId') ?? '', search = params.get('search') ?? ''
  const from = params.get('from') ?? '', to = params.get('to') ?? '', sort = params.get('sort') ?? 'createdAt,desc', page = pageParam(params)
  const machines = useMachineOptions()
  const range = dateRangeToInstants(from, to)
  const state = useApi(signal => ordersApi.list({
    page, size: PAGE_SIZE, status: (status || undefined) as 'PAID' | undefined, machineId: machineId || undefined, search: search || undefined,
    createdFrom: range.from, createdTo: range.to, sort,
  }, signal), params.toString())
  return <>
    <PageHead title="Đơn hàng" subtitle="Chỉ xem. Trạng thái đơn do hệ thống xử lý; web không sửa hoặc hủy đơn." />
    <Toolbar>
      <SearchFilter label="Mã đơn" value={search} onCommit={value => update({ search: value })} />
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ status: value })} options={enumOptions(ORDER_STATUSES)} />
      <SelectFilter label="Máy" value={machineId} onChange={value => update({ machineId: value })} options={machines} />
      <DateFilter label="Từ ngày" value={from} onChange={value => update({ from: value })} />
      <DateFilter label="Đến ngày (gồm cả ngày này)" value={to} onChange={value => update({ to: value })} />
      <SelectFilter label="Sắp xếp" value={sort} onChange={value => update({ sort: value })} options={SORTS} empty="Mặc định" />
    </Toolbar>
    <DataTable state={state} rows={state.data?.content} rowKey={order => order.id ?? ''} columns={[
      { head: 'Mã đơn', cell: order => <Link to={`/admin/orders/${order.id}`}>{order.orderCode}</Link> },
      { head: 'Máy', cell: order => order.machineCode },
      { head: 'Trạng thái', cell: order => <Badge value={order.status} /> },
      { head: 'Số dòng / số hộp', cell: order => `${order.itemCount ?? 0} / ${order.totalQuantity ?? 0}` },
      { head: 'Tổng tiền', cell: order => formatMoney(order.totalAmount) },
      { head: 'Tạo lúc', cell: order => formatDateTime(order.createdAt) },
      { head: 'Hết hạn thanh toán', cell: order => formatDateTime(order.expiresAt) },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
  </>
}

export default OrdersPage
