import { webhookLogsApi } from '../../api/resources.ts'
import { dateRangeToInstants, formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { DataTable, DateFilter, Link, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter, Toolbar, pageParam } from '../kit.tsx'
import { useApi } from '../useApi.ts'

const SORTS = [{ value: 'receivedAt,desc', label: 'Mới nhất' }, { value: 'receivedAt,asc', label: 'Cũ nhất' }, { value: 'provider,asc', label: 'Nhà cung cấp' }]

function WebhookLogsPage() {
  const { params, update } = useQueryParams()
  const provider = params.get('provider') ?? '', verified = params.get('verified') ?? '', reference = params.get('reference') ?? ''
  const from = params.get('from') ?? '', to = params.get('to') ?? '', sort = params.get('sort') ?? 'receivedAt,desc', page = pageParam(params)
  const range = dateRangeToInstants(from, to)
  const state = useApi(signal => webhookLogsApi.list({
    page, size: PAGE_SIZE, provider: provider || undefined, verified: verified ? verified === 'true' : undefined, reference: reference || undefined,
    receivedFrom: range.from, receivedTo: range.to, sort,
  }, signal), params.toString())
  return <>
    <PageHead title="Webhook thanh toán" subtitle="Bằng chứng mọi lần nhà cung cấp gọi về hệ thống. Chỉ xem." />
    <Toolbar>
      <SearchFilter label="Nhà cung cấp" value={provider} onCommit={value => update({ provider: value })} placeholder="Ví dụ: PAYOS" />
      <SelectFilter label="Xác thực" value={verified} onChange={value => update({ verified: value })} options={[{ value: 'true', label: 'Đã xác thực' }, { value: 'false', label: 'Bị từ chối' }]} />
      <SearchFilter label="Mã tham chiếu" value={reference} onCommit={value => update({ reference: value })} />
      <DateFilter label="Từ ngày" value={from} onChange={value => update({ from: value })} />
      <DateFilter label="Đến ngày (gồm cả ngày này)" value={to} onChange={value => update({ to: value })} />
      <SelectFilter label="Sắp xếp" value={sort} onChange={value => update({ sort: value })} options={SORTS} empty="Mặc định" />
    </Toolbar>
    <DataTable state={state} rows={state.data?.content} rowKey={log => log.id ?? ''} columns={[
      { head: 'Nhận lúc', cell: log => <Link to={`/admin/webhook-logs/${log.id}`}>{formatDateTime(log.receivedAt)}</Link> },
      { head: 'Nhà cung cấp', cell: log => log.provider },
      { head: 'Sự kiện', cell: log => log.eventType || '—' },
      { head: 'Tham chiếu', cell: log => log.reference || '—' },
      { head: 'Xác thực', cell: log => log.verified ? 'Đã xác thực' : 'Bị từ chối' },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
  </>
}

export default WebhookLogsPage
