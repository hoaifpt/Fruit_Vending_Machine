// Phản ánh của khách: customer reports sent from the machines' QR (backend #74, GET /customer-reports). Newest first,
// server-side paging, filters in the URL (status, type, verdict, machine, Vietnam days of createdAt, with/without a
// verified order). CUSTOMER_REPORT_READ: ADMIN sees every report; STAFF only those of the work orders assigned to them
// (the server filters). Contact data is always masked in the list. Read only: decisions are taken on the detail.
import { ApiError } from '../../api/client.ts'
import { customerReportsApi } from '../../api/resources.ts'
import type { CustomerReport } from '../../api/resources.ts'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch } from '../../lib/table-query.ts'
import { Badge, DataTable, DateFilter, Forbidden, Link, PAGE_SIZE, PageHead, Pagination, SelectFilter, enumOptions } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import {
  REPORT_FILTER_KEYS, REPORT_VERDICTS, VERDICT_LABELS, contactText, customerReportPath, readReportFilters, reportListQuery, reportTypeLabel, resolutionLabel, verdictLabel,
} from '../customer-reports.ts'
import { REPORT_TYPES } from '../../features/incident/incident.ts'
import { LINK as BASE_LINK } from '../payment-parts.tsx'
import { useMachineOptions } from '../options.ts'
import { shortId } from '../order-detail.ts'
import { pageValue } from '../refunds.ts'
import { ticketPath } from '../tickets.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

const LINK = `${BASE_LINK} whitespace-nowrap`
const TYPE_OPTIONS = REPORT_TYPES.map(option => ({ value: option.value, label: option.label }))
const VERDICT_OPTIONS = REPORT_VERDICTS.map(verdict => ({ value: verdict, label: VERDICT_LABELS[verdict].label }))
const ORDER_OPTIONS = [{ value: 'true', label: 'Có đơn đã xác minh' }, { value: 'false', label: 'Không có đơn' }]

function CustomerReportsPage() {
  const { params, update } = useQueryParams()
  const { can } = useSession()
  const canManage = can('CUSTOMER_REPORT_MANAGE')
  const filters = readReportFilters(params)
  const machines = useMachineOptions()
  const key = REPORT_FILTER_KEYS.map(name => filters[name]).join('|')
  const state = useApi(signal => customerReportsApi.list(reportListQuery(filters, PAGE_SIZE), signal), `${key}|${filters.page}`)
  const set = (patch: Record<string, string | undefined>) => update({ ...patch, page: undefined })
  const forbidden = state.error instanceof ApiError && state.error.status === 403 && !state.data
  const filtered = activeFilterCount(REPORT_FILTER_KEYS.map(name => filters[name])) > 0

  const columns: Column<CustomerReport>[] = [
    { head: 'Phản ánh', cell: row => <span className="grid gap-0.5">
      <Link to={customerReportPath(row.id)} className={`${LINK} font-mono`} label={`Mở phản ánh ${row.code ?? ''}`}>{row.code ?? shortId(row.id)}</Link>
      <span className="text-xs text-muted-foreground">{reportTypeLabel(row.type)}</span>
    </span> },
    { head: 'Trạng thái', cell: row => <span className="grid justify-items-start gap-1"><Badge domain="customerReport" value={row.status} />
      {row.resolution && <span className="text-xs text-muted-foreground">{resolutionLabel(row.resolution)}</span>}</span> },
    { head: 'Đối chiếu đơn', cell: row => <span className="grid gap-0.5"><span>{verdictLabel(row.verdict)}</span>
      {row.orderId ? <Link to={`/admin/orders/${row.orderId}`} className={`${BASE_LINK} text-xs`} label={`Mở đơn ${row.orderCode ?? ''}`}>{row.orderCode ?? shortId(row.orderId)}</Link>
        : row.orderCode ? <span className="font-mono text-xs text-muted-foreground">{row.orderCode}</span> : null}</span> },
    { head: 'Máy', nowrap: true, cell: row => row.machineCode ?? '—' },
    { head: 'Liên hệ (đã che)', secondary: true, cell: row => <span className="text-[13px] break-words">{contactText(row.contact)}</span> },
    { head: 'Phiếu sự cố', nowrap: true, secondary: true, cell: row => row.workOrder?.id
      ? <span className="grid justify-items-start gap-1"><Link to={ticketPath(row.workOrder.id)} className={LINK}>{row.workOrder.code ?? shortId(row.workOrder.id)}</Link><Badge domain="ticket" value={row.workOrder.status} /></span> : '—' },
    { head: 'Gửi lúc', cell: row => formatDateTime(row.createdAt) },
  ]

  return <>
    <PageHead title="Phản ánh của khách" subtitle={canManage
      ? 'Báo cáo khách gửi qua mã QR trên máy, mới nhất ở trên. Mỗi phản ánh có một phiếu sự cố; mở phản ánh để nhận xử lý, giải quyết, từ chối hoặc hoàn tiền.'
      : 'Các phản ánh thuộc phiếu sự cố được giao cho bạn. Liên hệ của khách được che; quản trị viên giải quyết phản ánh.'} />
    {forbidden ? <Forbidden permission="CUSTOMER_REPORT_READ" /> : <>
      <FilterBar activeCount={activeFilterCount(REPORT_FILTER_KEYS.map(name => filters[name]))} onClear={() => update({ ...clearFiltersPatch(REPORT_FILTER_KEYS), page: undefined })}>
        <SelectFilter label="Trạng thái" value={filters.status} onChange={value => set({ status: value })} options={enumOptions('customerReport')} />
        <SelectFilter label="Loại" value={filters.type} onChange={value => set({ type: value })} options={TYPE_OPTIONS} />
        <SelectFilter label="Đối chiếu đơn" value={filters.verdict} onChange={value => set({ verdict: value })} options={VERDICT_OPTIONS} />
        <SelectFilter label="Đơn hàng" value={filters.hasOrder} onChange={value => set({ hasOrder: value })} options={ORDER_OPTIONS} />
        <SelectFilter label="Máy" value={filters.machineId} onChange={value => set({ machineId: value })} options={machines} />
        <DateFilter label="Gửi từ ngày" value={filters.from} onChange={value => set({ from: value })} />
        <DateFilter label="Đến ngày (gồm cả ngày này)" value={filters.to} onChange={value => set({ to: value })} />
      </FilterBar>
      <DataTable state={state} rows={state.data?.content} rowKey={row => row.id ?? ''} caption="Phản ánh của khách" columns={columns}
        empty={filtered ? 'Không có phản ánh nào khớp bộ lọc. Hãy đổi hoặc xóa bộ lọc.'
          : canManage ? 'Chưa có phản ánh nào. Khách gửi phản ánh bằng cách quét mã QR “Báo sự cố” trên máy.' : 'Chưa có phản ánh nào thuộc phiếu sự cố được giao cho bạn.'} />
      {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: pageValue(next) })} />}
    </>}
  </>
}

export default CustomerReportsPage
