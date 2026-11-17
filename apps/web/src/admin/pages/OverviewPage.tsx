// O1 Tổng quan (FE 6.5 + 9.2): the landing screen, on GET /dashboard/overview (backend #76), polled every 30 s. Blocks
// answer "what needs someone now": machines that lost their connection, machines in maintenance, stock problems, open
// alerts and work orders; then (REPORT_SALES_READ only) sales of today and of the last 7 days, and every machine at a
// glance. Each row is one link to the exact place where it is handled. Rules: ../overview.ts.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { CircleCheck, ClipboardList, PackageMinus, RefreshCw, Siren, WifiOff, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import type { Alert, DashboardMachine, Page } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { DataTable } from '../../components/ui/data-table.tsx'
import type { DataTableColumn } from '../../components/ui/data-table.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { ALERTS_MISSING, alertPath, alertTypeLabel, alertsAvailability } from '../alerts.ts'
import { connectionDetail } from '../connection.ts'
import { ErrorState, Link, Loading, PageHead } from '../kit.tsx'
import {
  CRITICAL_LIST_PATH, EMPTY_TEXT, MAINTENANCE_LIST_PATH, OVERVIEW_POLL_MS, OVERVIEW_ROWS, alertRows, loadCritical, loadDashboard, machineDetailPath, machineFacts,
  machineSummary, maintenanceMachines, offlineMachines, sensorsPath, stockRows, temperatureText, visibleRows, workOrderRows,
} from '../overview.ts'
import type { CountRow } from '../overview.ts'
import { LINK } from '../payment-parts.tsx'
import { errorMessage, useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import { useSession } from '../useSession.ts'
import { OverviewRevenue } from './OverviewRevenue.tsx'

const isMissing = (error: unknown) => alertsAvailability(error) === 'missing'
const nothing = () => Promise.resolve(undefined)

function OverviewPage() {
  const { can } = useSession()
  const canAlerts = can('ALERT_READ'), canRevenue = can('REPORT_SALES_READ'), canTickets = can('WORK_ORDER_READ_ASSIGNED')
  const [tick, setTick] = useState(0)
  const state = useApi(signal => loadDashboard(signal), 'overview-dashboard', { pollMs: OVERVIEW_POLL_MS })
  // The newest OPEN CRITICAL alerts, so each one is a click away (the dashboard only counts them).
  const critical = useApi(signal => canAlerts ? loadCritical(signal) : nothing(), `overview-critical|${canAlerts}`, { pollMs: canAlerts ? OVERVIEW_POLL_MS : undefined, stopOn: isMissing })
  const reloadAll = () => { state.reload(); critical.reload(); setTick(value => value + 1) }
  const busy = state.loading || state.refreshing
  const data = state.data
  const dashboard = data?.dashboard

  const head = <PageHead title="Tổng quan"
    subtitle="Máy cần xử lý ngay: mất kết nối, đang bảo trì, tồn kho, cảnh báo và phiếu công việc. Bấm vào từng dòng để tới đúng chỗ xử lý. Tự làm mới mỗi 30 giây."
    actions={<Button type="button" variant="outline" onClick={reloadAll} disabled={busy} className="max-sm:h-11">
      <RefreshCw aria-hidden="true" className={cn(busy && 'motion-safe:animate-spin')} />Làm mới
    </Button>} />

  if (!dashboard) {
    return <>
      {head}
      {state.error && !state.loading ? <ErrorState error={state.error} retry={state.reload} /> : <Loading label="Đang tải tổng quan…" rows={6} />}
    </>
  }

  // OFFLINE is decided at the time the dashboard was received, on the server's clock (re-checked on every 30 s poll).
  const details = dashboard.machinesDetail ?? []
  const offline = offlineMachines(details, data.at)
  const maintenance = maintenanceMachines(details)
  const stock = stockRows(dashboard.stock)
  const stockAttention = stock.some(row => row.value > 0)
  const summary = machineSummary(dashboard.machines)
  const criticalCount = dashboard.alerts?.critical ?? 0
  const pendingTickets = (dashboard.workOrders?.open ?? 0) + (dashboard.workOrders?.inProgress ?? 0)

  return <>
    {head}
    <p className="-mt-2 mb-4 text-xs text-muted-foreground" data-generated>
      Số liệu lúc {formatDateTime(dashboard.generatedAt)} (giờ Việt Nam).
      {state.error && <span role="status" className="ml-1 text-destructive">Chưa làm mới được ({errorMessage(state.error)}); đang hiện số liệu lần trước.</span>}
    </p>
    <div className="grid gap-4 md:grid-cols-2">
      <Block id="offline" title="Mất kết nối" unit="máy" icon={WifiOff} tone="danger" count={offline.length} empty={EMPTY_TEXT.offline}
        hint="Máy đang bán hoặc đang bảo trì không gửi tín hiệu quá 180 giây. Mở tab Cảm biến & Sự kiện để xem tín hiệu cuối, Wi-Fi và lỗi."
        notes={[summary.connectivity]}
        rows={offline.map(({ machine, connection }) => ({
          key: machine.machineId ?? machine.code ?? '',
          link: <Link to={sensorsPath(machine.machineId)} className={LINK}><span className="font-mono">{machine.code}</span> · {machine.name}</Link>,
          detail: <>{connectionDetail(connection, machine.lastSeenAt)}{machine.status === 'MAINTENANCE' ? ' · Đang bảo trì' : ''}</>,
        }))} />

      <Block id="maintenance" title="Đang bảo trì" unit="máy" icon={Wrench} tone="warning" count={maintenance.length} empty={EMPTY_TEXT.maintenance}
        hint="Máy ở trạng thái Bảo trì không nhận đơn. Mở chi tiết máy để xem lý do và mở bán lại khi xong."
        notes={[summary.status]}
        more={maintenance.length > OVERVIEW_ROWS ? { to: MAINTENANCE_LIST_PATH, label: `Xem tất cả ${maintenance.length} máy đang bảo trì` } : undefined}
        rows={maintenance.map(machine => ({
          key: machine.machineId ?? machine.code ?? '',
          link: <Link to={machineDetailPath(machine.machineId)} className={LINK}><span className="font-mono">{machine.code}</span> · {machine.name}</Link>,
          detail: machineFacts(machine),
        }))} />

      <Block id="stock" title="Tồn kho cần xử lý" unit="ngăn sắp hết" icon={PackageMinus} tone="warning" count={dashboard.stock?.lowStockSlots ?? 0} attention={stockAttention} empty={EMPTY_TEXT.stock}
        hint="Máy không ở trạng thái Ngừng hoạt động. Mở sơ đồ tồn kho để nạp hộp, gỡ hộp lỗi hoặc hộp sắp hết hạn."
        body={stockAttention ? <Counts rows={stock} label="Tồn kho cần xử lý" /> : undefined} />

      <Block id="critical" title="Cảnh báo nghiêm trọng" unit="cảnh báo" icon={Siren} tone="danger" count={criticalCount} attention={criticalCount > 0} empty={EMPTY_TEXT.critical}
        hint="Cảnh báo chưa xử lý xong, theo mức độ. Danh sách dưới là cảnh báo Nghiêm trọng chưa có ai xác nhận; mở cảnh báo để xác nhận và xử lý."
        notes={[`${dashboard.alerts?.open ?? 0} cảnh báo chưa xử lý xong ở mọi mức.`]}
        body={<>
          <Counts rows={alertRows(dashboard.alerts)} label="Cảnh báo theo mức độ" />
          {canAlerts && <CriticalList state={critical} />}
        </>} />

      {canTickets && <Block id="work-orders" title="Phiếu công việc" unit="phiếu chưa xong" icon={ClipboardList} tone="warning" count={pendingTickets}
        attention={pendingTickets > 0 || (dashboard.workOrders?.overdue ?? 0) > 0} empty={EMPTY_TEXT.workOrders}
        hint="Phiếu mới, đã giao hoặc đang làm. Quá hạn: chưa xong mà đã qua hạn. Mở danh sách phiếu để nhận việc hoặc cập nhật."
        body={<Counts rows={workOrderRows(dashboard.workOrders)} label="Phiếu công việc" />} />}

      {canRevenue && <OverviewRevenue dashboard={dashboard} refresh={tick} />}

      <MachinesTable machines={details} />
    </div>
  </>
}

const TONE: Record<'danger' | 'warning', { icon: string; count: string }> = {
  danger: { icon: 'bg-status-danger text-status-danger-foreground', count: 'text-destructive' },
  warning: { icon: 'bg-status-warning text-status-warning-foreground', count: 'text-foreground' },
}

interface Row { key: string; link: ReactNode; detail: ReactNode }

/**
 * One block of the dashboard: title with the count, what counts and where a row leads, then the rows (a few, then all
 * in place), a custom body, or the positive empty state.
 */
function Block({ id, title, unit, icon: Icon, tone, hint, count, attention = count > 0, rows, body, empty, notes = [], more }: {
  id: string; title: string; unit: string; icon: LucideIcon; tone: 'danger' | 'warning'; hint: string
  count: number; attention?: boolean; rows?: Row[]; body?: ReactNode; empty: string
  notes?: string[]; more?: { to: string; label: string }
}) {
  const [expanded, setExpanded] = useState(false)
  const headingId = `overview-${id}`
  const shown = rows ? visibleRows(rows, expanded) : []

  let content: ReactNode
  if (!attention) content = <p className="flex items-start gap-2 text-[13px] text-status-success-foreground">
    <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span className="text-foreground">{empty}</span>
  </p>
  else if (body) content = body
  else content = <ul className="grid divide-y" aria-label={`${title}: danh sách cần xử lý`}>
    {shown.map(row => <li key={row.key} className="grid gap-0.5 py-2 first:pt-0 last:pb-0">
      <span className="min-w-0 break-words">{row.link}</span>
      <span className="text-xs text-muted-foreground">{row.detail}</span>
    </li>)}
  </ul>

  return <section aria-labelledby={headingId} data-block={id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
    <header className="flex items-start gap-3">
      <span aria-hidden="true" className={cn('grid size-9 shrink-0 place-items-center rounded-lg', attention ? TONE[tone].icon : 'bg-muted text-muted-foreground')}><Icon className="size-4.5" /></span>
      <div className="min-w-0 flex-1">
        <h2 id={headingId} className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5! text-xs text-muted-foreground">{hint}</p>
      </div>
      <p className="shrink-0 text-right" data-count={count}>
        <span className={cn('block text-2xl leading-none font-semibold tabular-nums', count > 0 ? TONE[tone].count : 'text-muted-foreground')}>{count}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </p>
    </header>
    {content}
    {notes.map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
    {attention && !body && (rows && rows.length > OVERVIEW_ROWS || more) && <div className="mt-auto flex flex-wrap gap-2 pt-1">
      {rows && rows.length > OVERVIEW_ROWS && <Button type="button" variant="link" className="h-auto p-0 max-sm:min-h-11" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>{expanded ? 'Thu gọn' : `Hiện tất cả ${rows.length} ${unit}`}</Button>}
      {more && <Link to={more.to} className={cn(LINK, 'text-[13px]')}>{more.label}</Link>}
    </div>}
  </section>
}

const COUNT_TONE = { danger: 'text-destructive', warning: 'text-foreground', neutral: 'text-muted-foreground' } as const

/** Figures of a block, each a link to the list where it is handled. */
function Counts({ rows, label }: { rows: CountRow[]; label: string }) {
  return <ul className="grid divide-y" aria-label={label}>
    {rows.map(row => <li key={row.key} data-figure={row.key} className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
      <span className="min-w-0">
        <Link to={row.to} className={cn(LINK, 'text-[13px]')}>{row.label}</Link>
        {row.hint && <span className="block text-xs text-muted-foreground">{row.hint}</span>}
      </span>
      <span className={cn('shrink-0 text-base font-semibold tabular-nums', row.value > 0 ? COUNT_TONE[row.tone] : 'text-muted-foreground')}>{row.value.toLocaleString('vi-VN')}</span>
    </li>)}
  </ul>
}

/** OPEN CRITICAL alerts (GET /alerts), its own loading / failure / refusal so the rest of the block still shows. */
function CriticalList({ state }: { state: ApiState<Page<Alert> | undefined> }) {
  const status = state.error instanceof ApiError ? state.error.status : undefined
  if (!state.data) {
    if (state.error && isMissing(state.error)) return <p role="status" className="text-xs text-muted-foreground">{ALERTS_MISSING}</p>
    if (status === 403) return <p role="alert" className="text-xs text-muted-foreground">Máy chủ từ chối: tài khoản của bạn không có quyền xem danh sách cảnh báo. Liên hệ quản trị viên nếu cần.</p>
    if (state.error) return <div role="alert" className="grid justify-items-start gap-1 text-xs text-destructive">
      <p>Không tải được danh sách cảnh báo: {errorMessage(state.error)}</p>
      <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={state.reload}>Thử lại</Button>
    </div>
    return <Loading label="Đang tải cảnh báo nghiêm trọng…" rows={2} />
  }
  const alerts = state.data.content
  if (!alerts.length) return <p className="text-xs text-muted-foreground">Không có cảnh báo nghiêm trọng nào đang chờ xác nhận.</p>
  return <div className="grid gap-1.5">
    <ul className="grid divide-y" aria-label="Cảnh báo nghiêm trọng chưa xác nhận">
      {alerts.map(alert => <li key={alert.id} className="grid gap-0.5 py-2 first:pt-0 last:pb-0">
        <span className="min-w-0 break-words"><Link to={alertPath(alert.id)} className={LINK}>{alertTypeLabel(alert.type)}: {alert.title}</Link></span>
        <span className="text-xs text-muted-foreground"><StatusBadge domain="alertSeverity" value={alert.severity} describe={false} className="mr-1.5 align-middle" />
          <span className="font-mono">{alert.machineCode}</span>{alert.slotCode ? ` · Ngăn ${alert.slotCode}` : ''} · {formatDateTime(alert.triggeredAt)}</span>
      </li>)}
    </ul>
    {state.data.totalElements > alerts.length && <Link to={CRITICAL_LIST_PATH} className={cn(LINK, 'text-[13px]')}>Xem tất cả {state.data.totalElements} cảnh báo nghiêm trọng đang mở</Link>}
  </div>
}

/** Every machine at a glance (machinesDetail): status, connection, temperature, sellable bowls, open alerts. */
function MachinesTable({ machines }: { machines: DashboardMachine[] }) {
  const columns: DataTableColumn<DashboardMachine>[] = [
    { head: 'Máy', cell: row => <Link to={machineDetailPath(row.machineId)} className={LINK}><span className="font-mono">{row.code}</span> · {row.name}</Link> },
    { head: 'Trạng thái', nowrap: true, cell: row => row.status ? <StatusBadge domain="machine" value={row.status} describe={false} /> : '—' },
    { head: 'Kết nối', nowrap: true, cell: row => row.connectivity ? <StatusBadge domain="connection" value={row.connectivity} describe={false} /> : '—' },
    { head: 'Tín hiệu cuối', nowrap: true, secondary: true, cell: row => formatDateTime(row.lastSeenAt) },
    { head: 'Nhiệt độ', nowrap: true, cell: row => <span className="tabular-nums">{temperatureText(row.temperature)}</span> },
    { head: 'Hộp sẵn bán', nowrap: true, cell: row => <span className="tabular-nums" data-sellable>{(row.sellableBowls ?? 0).toLocaleString('vi-VN')}</span> },
    { head: 'Cảnh báo mở', nowrap: true, cell: row => <span className={cn('tabular-nums', (row.openAlerts ?? 0) > 0 && 'font-semibold text-destructive')}>{(row.openAlerts ?? 0).toLocaleString('vi-VN')}</span> },
  ]
  return <section aria-labelledby="overview-machines" data-block="machines" className="min-w-0 rounded-xl border bg-card p-4 md:col-span-2">
    <h2 id="overview-machines" className="mb-1! text-base font-semibold">Tất cả máy</h2>
    <p className="mb-3! text-xs text-muted-foreground">Hộp sẵn bán: số hộp kiosk bán được ngay (máy đang bán, ngăn hoạt động, hộp còn hạn). Bấm tên máy để mở chi tiết.</p>
    <DataTable columns={columns} rows={machines} rowKey={row => row.machineId ?? row.code ?? ''} caption="Tất cả máy" empty="Chưa có máy nào được đăng ký." />
  </section>
}

export default OverviewPage
