// T4 Nhật ký webhook (FE 6.2), ADMIN only, read only: every call a payment provider made, with server-side filters on the
// URL. `?reference=` is the link target from a payment ("every call about this payment"). Items carry no body: the
// payload is on the detail screen.
import { webhookLogsApi } from '../../api/resources.ts'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import { DataTable, DateFilter, Link, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter } from '../kit.tsx'
import { WEBHOOK_FILTER_KEYS, WEBHOOK_SORT_RULE, readWebhookFilters, webhookEventText, webhookListQuery, webhookLogPath } from '../payments.ts'
import { LINK, VerifiedBadge } from '../payment-parts.tsx'
import { useApi } from '../useApi.ts'

function WebhookLogsPage() {
  const { params, update } = useQueryParams()
  const filters = readWebhookFilters(params)
  const state = useApi(signal => webhookLogsApi.list(webhookListQuery(filters, PAGE_SIZE), signal), params.toString())
  return <>
    <PageHead title="Webhook thanh toán" subtitle="Bằng chứng mọi lần nhà cung cấp gọi về hệ thống, kể cả lần bị từ chối. Chỉ xem." />
    <FilterBar activeCount={activeFilterCount(WEBHOOK_FILTER_KEYS.map(key => filters[key]))} onClear={() => update(clearFiltersPatch(WEBHOOK_FILTER_KEYS))}>
      <SearchFilter label="Nhà cung cấp" value={filters.provider} onCommit={value => update({ provider: value })} placeholder="Ví dụ: PAYOS" />
      <SelectFilter label="Xác thực" value={filters.verified} onChange={value => update({ verified: value })} options={[{ value: 'true', label: 'Đã xác thực' }, { value: 'false', label: 'Bị từ chối' }]} />
      <SearchFilter label="Mã tham chiếu" value={filters.reference} onCommit={value => update({ reference: value })} placeholder="Khớp chính xác" />
      <DateFilter label="Từ ngày" value={filters.from} onChange={value => update({ from: value })} />
      <DateFilter label="Đến ngày (gồm cả ngày này)" value={filters.to} onChange={value => update({ to: value })} />
    </FilterBar>
    <DataTable state={state} rows={state.data?.content} rowKey={log => log.id ?? ''} caption="Nhật ký webhook thanh toán, mới nhất ở trên"
      empty={filters.reference ? 'Chưa có lần gọi nào với mã tham chiếu này: nhà cung cấp chưa báo kết quả cho thanh toán đó.' : 'Không có lần gọi nào phù hợp. Hãy đổi hoặc xóa bộ lọc.'}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, WEBHOOK_SORT_RULE) })} columns={[
        { head: 'Nhận lúc', sortKey: 'receivedAt', firstDirection: 'desc', nowrap: true, cell: log => <Link to={webhookLogPath(log.id)} className={`${LINK} whitespace-nowrap`} label={`Mở webhook nhận lúc ${formatDateTime(log.receivedAt)}`}>{formatDateTime(log.receivedAt)}</Link> },
        { head: 'Nhà cung cấp', sortKey: 'provider', nowrap: true, cell: log => log.provider ?? '—' },
        { head: 'Sự kiện', cell: log => webhookEventText(log.eventType) },
        { head: 'Mã tham chiếu', cell: log => log.reference ? <span className="font-mono text-[13px] break-all">{log.reference}</span> : '—' },
        { head: 'Xác thực', cell: log => <VerifiedBadge verified={log.verified} /> },
      ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
  </>
}

export default WebhookLogsPage
