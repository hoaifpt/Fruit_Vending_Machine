// O2 Cảnh báo (FE 6.3): every alert raised by the machines, newest first, with server-side filters kept on the URL. Staff
// and admins acknowledge an alert when they take it on and close it when it is fixed; both steps record who and when.
// No delete. API: draft contract api-contract/drafts/alerts.yaml (waiting for BE 3.6); on a backend without it (404)
// the screen says there is no data yet and stops refreshing. Refreshes every 30 s like the bell.
import { ApiError } from '../../api/client.ts'
import { alertsApi } from '../../api/resources.ts'
import type { Alert } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import { AcknowledgeDialog, HandledBy, ResolveSheet } from '../alert-parts.tsx'
import {
  ALERTS_MISSING, ALERT_FILTER_KEYS, ALERT_SEVERITIES, ALERT_SORT_RULE, ALERT_STATUSES, ALERT_TYPES, ALERT_TYPE_LABELS, BELL_POLL_MS,
  alertListQuery, alertPath, alertTypeLabel, alertsAvailability, canAcknowledge, canResolve, machinePath, readAlertFilters,
} from '../alerts.ts'
import { Badge, DataTable, DateFilter, Link, PAGE_SIZE, PageHead, Pagination, SelectFilter, enumOptions, useDialog } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useMachineOptions } from '../options.ts'
import { inventoryMapPath, shortId } from '../order-detail.ts'
import { LINK } from '../payment-parts.tsx'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

type Action = { kind: 'acknowledge' | 'resolve'; alert: Alert }
const isMissing = (error: unknown) => alertsAvailability(error) === 'missing'
const TYPE_OPTIONS = ALERT_TYPES.map(type => ({ value: type, label: ALERT_TYPE_LABELS[type] }))

function AlertsPage() {
  const { params, update } = useQueryParams()
  const filters = readAlertFilters(params)
  const { can } = useSession()
  const canWrite = can('ALERT_WRITE'), canMachines = can('MACHINE_READ'), canInventory = can('INVENTORY_READ'), canOrders = can('ORDER_READ')
  const machines = useMachineOptions()
  // A backend without BE 3.6 answers 404: polling ends on that answer itself (no extra request), the screen explains.
  const state = useApi(signal => alertsApi.list(alertListQuery(filters, PAGE_SIZE), signal), params.toString(), { pollMs: BELL_POLL_MS, stopOn: isMissing })
  const missing = !state.data && !!state.error && isMissing(state.error)
  const action = useDialog<Action>()
  const rows = state.data?.content
  const forbidden = state.error instanceof ApiError && state.error.status === 403 && !rows
  const openOnly = filters.status === 'OPEN' && !filters.severity
  const criticalOpen = filters.status === 'OPEN' && filters.severity === 'CRITICAL'

  const columns: Column<Alert>[] = [
    { head: 'Mức độ', cell: alert => <Badge domain="alertSeverity" value={alert.severity} /> },
    { head: 'Cảnh báo', cell: alert => <span className="grid max-w-[46ch] gap-0.5">
      <Link to={alertPath(alert.id)} className={LINK}>{alertTypeLabel(alert.type)}: {alert.title}</Link>
      {alert.message && <span className="line-clamp-2 text-xs text-muted-foreground">{alert.message}</span>}
    </span> },
    { head: 'Máy · ngăn · đơn', cell: alert => <span className="grid gap-0.5 text-[13px]">
      {canMachines && machinePath(alert.machineId)
        ? <Link to={machinePath(alert.machineId)} className={`${LINK} font-mono`} label={`Máy ${alert.machineCode}, mở chi tiết máy`}>{alert.machineCode}</Link>
        : <span className="font-mono">{alert.machineCode}</span>}
      {alert.slotCode && (canInventory
        ? <Link to={inventoryMapPath(alert.machineId, alert.slotId ?? undefined)} className={LINK} label={`Ngăn ${alert.slotCode}, mở trên sơ đồ tồn kho`}>Ngăn {alert.slotCode}</Link>
        : <span>Ngăn {alert.slotCode}</span>)}
      {alert.orderId && (canOrders
        ? <Link to={`/admin/orders/${encodeURIComponent(alert.orderId)}`} className={LINK} label={`Đơn ${alert.orderCode ?? shortId(alert.orderId)}, mở đơn hàng`}>Đơn {alert.orderCode ?? shortId(alert.orderId)}</Link>
        : <span>Đơn {alert.orderCode ?? shortId(alert.orderId)}</span>)}
    </span> },
    { head: 'Trạng thái', cell: alert => <span className="grid gap-1"><Badge domain="alert" value={alert.status} /><HandledBy alert={alert} /></span> },
    { head: 'Phát sinh lúc', sortKey: 'triggeredAt', firstDirection: 'desc', nowrap: true, cell: alert => formatDateTime(alert.triggeredAt) },
    ...(canWrite ? [{ head: 'Thao tác', cell: (alert: Alert) => {
      if (!canResolve(alert)) return <span className="text-xs text-muted-foreground">Đã đóng</span>
      const what = `${alertTypeLabel(alert.type)} máy ${alert.machineCode}`
      return <span className="flex flex-wrap gap-1.5">
        {canAcknowledge(alert) && <Button type="button" size="sm" variant="outline" className="max-sm:h-11" aria-label={`Xác nhận cảnh báo ${what}`}
          onClick={() => action.open({ kind: 'acknowledge', alert })}>Xác nhận</Button>}
        <Button type="button" size="sm" variant="outline" className="max-sm:h-11" aria-label={`Đóng cảnh báo ${what}`}
          onClick={() => action.open({ kind: 'resolve', alert })}>Đóng</Button>
      </span>
    } }] : []),
  ]

  const subtitle = 'Cảnh báo do máy gửi về: nhiệt độ, độ ẩm, mất kết nối, hộp hết hạn, nhả hàng lỗi, sắp hết hàng. Xác nhận khi bắt đầu xử lý, đóng khi đã xử lý xong; hệ thống ghi người và thời điểm. Cảnh báo không xóa được.'
  if (missing) return <>
    <PageHead title="Cảnh báo" subtitle={subtitle} />
    <p role="status" className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-muted-foreground">{ALERTS_MISSING}</p>
  </>

  return <>
    <PageHead title="Cảnh báo" subtitle={subtitle} />
    {!forbidden && <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <span id="alerts-quick" className="text-muted-foreground">Lọc nhanh</span>
        <div role="group" aria-labelledby="alerts-quick" className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={openOnly ? 'default' : 'outline'} aria-pressed={openOnly} className="max-sm:h-11"
            onClick={() => update({ status: openOnly ? undefined : 'OPEN', severity: undefined })}>Đang mở, chưa ai tiếp nhận</Button>
          <Button type="button" size="sm" variant={criticalOpen ? 'default' : 'outline'} aria-pressed={criticalOpen} className="max-sm:h-11"
            onClick={() => update(criticalOpen ? { status: undefined, severity: undefined } : { status: 'OPEN', severity: 'CRITICAL' })}>Nghiêm trọng đang mở</Button>
        </div>
      </div>
      <FilterBar activeCount={activeFilterCount(ALERT_FILTER_KEYS.map(key => filters[key]))} onClear={() => update(clearFiltersPatch(ALERT_FILTER_KEYS))}>
        <SelectFilter label="Trạng thái" value={filters.status} onChange={value => update({ status: value })} options={enumOptions('alert', ALERT_STATUSES)} />
        <SelectFilter label="Mức độ" value={filters.severity} onChange={value => update({ severity: value })} options={enumOptions('alertSeverity', ALERT_SEVERITIES)} />
        <SelectFilter label="Loại" value={filters.type} onChange={value => update({ type: value })} options={TYPE_OPTIONS} />
        <SelectFilter label="Máy" value={filters.machineId} onChange={value => update({ machineId: value })} options={machines} />
        <DateFilter label="Từ ngày" value={filters.from} onChange={value => update({ from: value })} />
        <DateFilter label="Đến ngày (gồm cả ngày này)" value={filters.to} onChange={value => update({ to: value })} />
      </FilterBar>
    </>}
    <DataTable state={state} rows={rows} rowKey={alert => alert.id} caption="Danh sách cảnh báo"
      empty={activeFilterCount(ALERT_FILTER_KEYS.map(key => filters[key]))
        ? 'Không có cảnh báo khớp bộ lọc. Hãy đổi hoặc xóa bộ lọc.'
        : 'Chưa có cảnh báo nào. Máy sẽ gửi cảnh báo khi nhiệt độ, độ ẩm, kết nối hoặc hàng trong ngăn bất thường.'}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, ALERT_SORT_RULE) })} columns={columns} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
    {action.value?.kind === 'acknowledge' && <AcknowledgeDialog alert={action.value.alert} close={action.close} changed={state.reload} />}
    {action.value?.kind === 'resolve' && <ResolveSheet alert={action.value.alert} close={action.close} changed={state.reload} />}
  </>
}

export default AlertsPage
