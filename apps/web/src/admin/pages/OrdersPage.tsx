import { ordersApi } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { dateRangeToInstants, formatDateTime, formatMoney } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, formatSort, oneOf, parseSort, sortParam, uuidParam } from '../../lib/table-query.ts'
import type { SortRule } from '../../lib/table-query.ts'
import { Badge, DataTable, DateFilter, Link, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter, enumOptions, pageParam } from '../kit.tsx'
import { useMachineOptions } from '../options.ts'
import { useApi } from '../useApi.ts'

export const ORDER_STATUSES = ['PENDING_PAYMENT', 'PAID', 'DISPENSING', 'COMPLETED', 'CANCELLED', 'PAYMENT_FAILED', 'DISPENSE_FAILED', 'REFUNDED'] as const
/** The only sorts `GET /orders` approves in the contract. */
const SORT_RULE: SortRule = { fields: ['createdAt', 'totalAmount', 'orderCode'], fallback: 'createdAt,desc' }
const FILTER_KEYS = ['search', 'status', 'machineId', 'from', 'to'] as const

function OrdersPage() {
  const { params, update } = useQueryParams()
  const status = oneOf(params.get('status'), ORDER_STATUSES), machineId = uuidParam(params.get('machineId')), search = params.get('search') ?? ''
  const from = params.get('from') ?? '', to = params.get('to') ?? '', sort = parseSort(params.get('sort'), SORT_RULE), page = pageParam(params)
  const machines = useMachineOptions()
  const range = dateRangeToInstants(from, to)
  const state = useApi(signal => ordersApi.list({
    page, size: PAGE_SIZE, status: (status || undefined) as 'PAID' | undefined, machineId: machineId || undefined, search: search || undefined,
    createdFrom: range.from, createdTo: range.to, sort: formatSort(sort),
  }, signal), params.toString())
  return <>
    <PageHead title="Đơn hàng" subtitle="Chỉ xem. Trạng thái đơn do hệ thống xử lý; web không sửa hoặc hủy đơn." />
    {/* Quick filter: paid orders the machine could not serve (the customer waits for a refund). Same URL key as the select. */}
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
      <span id="orders-quick" className="text-muted-foreground">Lọc nhanh</span>
      <div role="group" aria-labelledby="orders-quick">
        <Button type="button" size="sm" variant={status === 'DISPENSE_FAILED' ? 'default' : 'outline'} aria-pressed={status === 'DISPENSE_FAILED'} className="max-sm:h-11"
          onClick={() => update({ status: status === 'DISPENSE_FAILED' ? undefined : 'DISPENSE_FAILED' })}>Cần xử lý: nhả hàng thất bại</Button>
      </div>
    </div>
    <FilterBar activeCount={activeFilterCount([search, status, machineId, from, to])} onClear={() => update(clearFiltersPatch(FILTER_KEYS))}>
      <SearchFilter label="Mã đơn" value={search} onCommit={value => update({ search: value })} />
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ status: value })} options={enumOptions('order', ORDER_STATUSES)} />
      <SelectFilter label="Máy" value={machineId} onChange={value => update({ machineId: value })} options={machines} />
      <DateFilter label="Từ ngày" value={from} onChange={value => update({ from: value })} />
      <DateFilter label="Đến ngày (gồm cả ngày này)" value={to} onChange={value => update({ to: value })} />
    </FilterBar>
    <DataTable state={state} rows={state.data?.content} rowKey={order => order.id ?? ''} caption="Danh sách đơn hàng" empty="Không có đơn hàng phù hợp. Hãy đổi hoặc xóa bộ lọc."
      sort={sort} onSort={next => update({ sort: sortParam(next, SORT_RULE) })} columns={[
        { head: 'Mã đơn', sortKey: 'orderCode', nowrap: true, cell: order => <Link to={`/admin/orders/${order.id}`}>{order.orderCode}</Link> },
        { head: 'Máy', nowrap: true, cell: order => order.machineCode },
        { head: 'Trạng thái', cell: order => <Badge domain="order" value={order.status} /> },
        { head: 'Số dòng / số hộp', secondary: true, cell: order => `${order.itemCount ?? 0} / ${order.totalQuantity ?? 0}` },
        { head: 'Tổng tiền', sortKey: 'totalAmount', firstDirection: 'desc', nowrap: true, cell: order => formatMoney(order.totalAmount) },
        { head: 'Tạo lúc', sortKey: 'createdAt', firstDirection: 'desc', cell: order => formatDateTime(order.createdAt) },
        { head: 'Hết hạn thanh toán', secondary: true, cell: order => formatDateTime(order.expiresAt) },
      ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
  </>
}

export default OrdersPage
