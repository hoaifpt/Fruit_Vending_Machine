// O1 Tổng quan (FE 6.5, bước 1): the landing screen. Four blocks answer "which machine needs someone now": machines
// that lost their connection, machines in maintenance, slots about to run out, open CRITICAL alerts. Every row is one
// link to the exact place where it is handled. Each block loads, fails, and is refused (403) on its own, and refreshes
// every 30 s. Data is assembled from existing endpoints until the dashboard API of BE 6.1 exists (see overview.ts).
import { useState } from 'react'
import type { ReactNode } from 'react'
import { CircleCheck, PackageMinus, RefreshCw, Siren, WifiOff, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { Button } from '../../components/ui/button.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { ALERTS_MISSING, alertPath, alertTypeLabel, alertsAvailability } from '../alerts.ts'
import { connectionDetail } from '../connection.ts'
import { Link, Loading, PageHead } from '../kit.tsx'
import {
  CRITICAL_LIST_PATH, EMPTY_TEXT, LOW_STOCK_MACHINE_LIMIT, LOW_STOCK_THRESHOLD, MACHINE_SCAN_SIZE, MAINTENANCE_LIST_PATH, OVERVIEW_POLL_MS, OVERVIEW_ROWS,
  loadCritical, loadLowStock, loadMachineScan, loadMaintenance, lowStockPath, lowStockText, machineDetailPath, offlineMachines, sensorsPath, visibleRows,
} from '../overview.ts'
import { LINK } from '../payment-parts.tsx'
import { errorMessage, useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import type { Permission } from '../permissions.ts'
import { useSession } from '../useSession.ts'

const isMissing = (error: unknown) => alertsAvailability(error) === 'missing'
const nothing = () => Promise.resolve(undefined)

function OverviewPage() {
  const { can } = useSession()
  const canMachines = can('MACHINE_READ'), canStock = canMachines && can('INVENTORY_READ'), canAlerts = can('ALERT_READ')
  const poll = (allowed: boolean) => ({ pollMs: allowed ? OVERVIEW_POLL_MS : undefined })
  // A block the account may not read never calls its API (the backend would answer 403 anyway).
  const scan = useApi(signal => canMachines ? loadMachineScan(signal) : nothing(), `overview-scan|${canMachines}`, poll(canMachines))
  const maintenance = useApi(signal => canMachines ? loadMaintenance(signal) : nothing(), `overview-maintenance|${canMachines}`, poll(canMachines))
  const stock = useApi(signal => canStock ? loadLowStock(signal) : nothing(), `overview-stock|${canStock}`, poll(canStock))
  // A backend without BE 3.6 answers 404: that block says so and stops asking.
  const critical = useApi(signal => canAlerts ? loadCritical(signal) : nothing(), `overview-critical|${canAlerts}`, { ...poll(canAlerts), stopOn: isMissing })
  const reloadAll = () => { scan.reload(); maintenance.reload(); stock.reload(); critical.reload() }
  const busy = [scan, maintenance, stock, critical].some(state => state.loading || state.refreshing)

  // OFFLINE is decided at the time the list was received, on the server's clock (re-checked on every 30 s poll).
  const offline = scan.data ? offlineMachines(scan.data.page.content, scan.data.at) : undefined
  const stockReport = stock.data

  return <>
    <PageHead title="Tổng quan"
      subtitle="Máy cần xử lý ngay: mất kết nối, đang bảo trì, ngăn sắp hết hàng và cảnh báo nghiêm trọng. Bấm vào từng dòng để tới đúng chỗ xử lý. Tự làm mới mỗi 30 giây."
      actions={<Button type="button" variant="outline" onClick={reloadAll} disabled={busy} className="max-sm:h-11">
        <RefreshCw aria-hidden="true" className={cn(busy && 'motion-safe:animate-spin')} />Làm mới
      </Button>} />
    <div className="grid gap-4 md:grid-cols-2">
      <Block id="offline" title="Mất kết nối" unit="máy" icon={WifiOff} tone="danger" permission={canMachines ? undefined : 'MACHINE_READ'}
        hint="Máy đang bán hoặc đang bảo trì không gửi tín hiệu quá 180 giây. Mở tab Cảm biến & Sự kiện để xem tín hiệu cuối, Wi-Fi và lỗi."
        state={scan} count={offline?.length} empty={EMPTY_TEXT.offline}
        notes={scan.data?.incomplete ? [`Chỉ xét ${MACHINE_SCAN_SIZE} máy đầu tiên (theo tên); số máy còn lại sẽ được tính khi có API tổng quan của máy chủ.`] : []}
        rows={offline?.map(({ machine, connection }) => ({
          key: machine.id,
          link: <Link to={sensorsPath(machine.id)} className={LINK}>
            <span className="font-mono">{machine.code}</span> · {machine.name}
          </Link>,
          detail: <>{connectionDetail(connection, machine.lastSeenAt)}{machine.status === 'MAINTENANCE' ? ' · Đang bảo trì' : ''}</>,
        }))} />

      <Block id="maintenance" title="Đang bảo trì" unit="máy" icon={Wrench} tone="warning" permission={canMachines ? undefined : 'MACHINE_READ'}
        hint="Máy ở trạng thái Bảo trì không nhận đơn. Mở chi tiết máy để xem lý do và mở bán lại khi xong."
        state={maintenance} count={maintenance.data?.totalElements} empty={EMPTY_TEXT.maintenance} expandable={false}
        more={(maintenance.data?.totalElements ?? 0) > 0 ? { to: MAINTENANCE_LIST_PATH, label: `Xem tất cả ${maintenance.data?.totalElements} máy đang bảo trì` } : undefined}
        rows={maintenance.data?.content.map(machine => ({
          key: machine.id,
          link: <Link to={machineDetailPath(machine.id)} className={LINK}>
            <span className="font-mono">{machine.code}</span> · {machine.name}
          </Link>,
          detail: <>{machine.location ? `${machine.location} · ` : ''}Đổi trạng thái lúc {formatDateTime(machine.updatedAt)}</>,
        }))} />

      <Block id="low-stock" title="Sắp hết hàng" unit="ngăn" icon={PackageMinus} tone="warning" permission={canMachines ? (canStock ? undefined : 'INVENTORY_READ') : 'MACHINE_READ'}
        hint={`Ngăn đang hoạt động của máy đang bán còn từ ${LOW_STOCK_THRESHOLD} hộp sẵn bán trở xuống (hộp còn hạn, chưa giữ cho đơn). Mở sơ đồ tồn kho của ngăn để nạp hộp.`}
        state={stock} count={stockReport?.slots.length} empty={EMPTY_TEXT.lowStock}
        notes={stockReport ? [
          ...(stockReport.activeTotal > stockReport.checked + stockReport.failed ? [`Chỉ xét ${LOW_STOCK_MACHINE_LIMIT} máy đang bán đầu tiên (theo tên) trên ${stockReport.activeTotal} máy; các máy còn lại sẽ được tính khi có API tổng quan của máy chủ.`] : []),
          ...(stockReport.failed ? [`Không đọc được tồn kho của ${stockReport.failed} máy lần này; sẽ thử lại ở lần làm mới tiếp theo.`] : []),
          ...(stockReport.incomplete ? ['Có máy nhiều ngăn hoặc nhiều hộp hơn số đọc được; danh sách có thể chưa đủ.'] : []),
        ] : []}
        rows={stockReport?.slots.map(slot => ({
          key: slot.slotId,
          link: <Link to={lowStockPath(slot.machineId, slot.slotId)} className={LINK}>
            <span className="font-mono">{slot.machineCode}</span> · Ngăn {slot.slotCode}
          </Link>,
          detail: <>{lowStockText(slot)} · {slot.machineName}</>,
        }))} />

      <Block id="critical" title="Cảnh báo nghiêm trọng" unit="cảnh báo" icon={Siren} tone="danger" permission={canAlerts ? undefined : 'ALERT_READ'}
        hint="Cảnh báo mức Nghiêm trọng chưa có ai xác nhận. Mở cảnh báo để xem chi tiết, xác nhận và xử lý."
        state={critical} count={critical.data?.totalElements} empty={EMPTY_TEXT.critical} expandable={false}
        missing={critical.error && !critical.data && isMissing(critical.error) ? ALERTS_MISSING : undefined}
        more={(critical.data?.totalElements ?? 0) > 0 ? { to: CRITICAL_LIST_PATH, label: `Xem tất cả ${critical.data?.totalElements} cảnh báo nghiêm trọng đang mở` } : undefined}
        rows={critical.data?.content.map(alert => ({
          key: alert.id,
          link: <Link to={alertPath(alert.id)} className={LINK}>
            {alertTypeLabel(alert.type)}: {alert.title}
          </Link>,
          detail: <><StatusBadge domain="alertSeverity" value={alert.severity} describe={false} className="mr-1.5 align-middle" />
            <span className="font-mono">{alert.machineCode}</span>{alert.slotCode ? ` · Ngăn ${alert.slotCode}` : ''} · {formatDateTime(alert.triggeredAt)}</>,
        }))} />
    </div>
  </>
}

const TONE: Record<'danger' | 'warning', { icon: string; count: string }> = {
  danger: { icon: 'bg-status-danger text-status-danger-foreground', count: 'text-destructive' },
  warning: { icon: 'bg-status-warning text-status-warning-foreground', count: 'text-foreground' },
}

interface Row { key: string; link: ReactNode; detail: ReactNode }

/**
 * One block: title with the count, what counts and where a row leads, then (in order) no access, first load, failure,
 * missing feature, the positive empty state, or the rows. A failed refresh keeps the rows and says so.
 */
function Block({ id, title, unit, icon: Icon, tone, hint, permission, state, count, rows, empty, notes = [], more, missing, expandable = true }: {
  id: string; title: string; unit: string; icon: LucideIcon; tone: 'danger' | 'warning'; hint: string
  /** Set when the account lacks the permission this block needs: nothing is requested. */
  permission?: Permission
  state: ApiState<unknown>; count: number | undefined; rows: Row[] | undefined; empty: string
  notes?: string[]; more?: { to: string; label: string }; missing?: string
  /** Rows come from a full client-side list: show OVERVIEW_ROWS, then "Hiện tất cả" in place. */
  expandable?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const headingId = `overview-${id}`
  const status = state.error instanceof ApiError ? state.error.status : undefined
  const hasData = !permission && state.data !== undefined && count !== undefined
  const shown = hasData && rows ? (expandable ? visibleRows(rows, expanded) : rows) : []
  const attention = hasData && (count ?? 0) > 0

  let body: ReactNode
  if (permission) body = <p className="text-[13px] text-muted-foreground">Tài khoản của bạn không có quyền xem mục này. Liên hệ quản trị viên nếu công việc cần, rồi đăng nhập lại.</p>
  else if (!hasData && missing) body = <p role="status" className="text-[13px] text-muted-foreground">{missing}</p>
  else if (!hasData && status === 403) body = <p role="alert" className="text-[13px] text-muted-foreground">Máy chủ từ chối: tài khoản của bạn không có quyền xem mục này. Liên hệ quản trị viên để được cấp quyền, rồi đăng nhập lại.</p>
  else if (!hasData && status === 401) body = <p role="status" className="text-[13px] text-muted-foreground">Phiên đăng nhập đã hết hạn. Đang chuyển đến trang đăng nhập…</p>
  else if (!hasData && state.error) body = <div role="alert" className="grid justify-items-start gap-2 text-[13px] text-destructive">
    <p>Không tải được: {errorMessage(state.error)}</p>
    <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={state.reload}>Thử lại</Button>
  </div>
  else if (!hasData) body = <Loading label={`Đang tải mục ${title}…`} rows={3} />
  else if (!attention) body = <p className="flex items-start gap-2 text-[13px] text-status-success-foreground">
    <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span className="text-foreground">{empty}</span>
  </p>
  else body = <ul className="grid divide-y" aria-label={`${title}: danh sách cần xử lý`}>
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
      <p className="shrink-0 text-right" data-count={hasData ? count : ''}>
        <span className={cn('block text-2xl leading-none font-semibold tabular-nums', attention ? TONE[tone].count : 'text-muted-foreground')}>{hasData ? count : '—'}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </p>
    </header>
    {body}
    {hasData && state.error && <p role="status" className="text-xs text-destructive">
      Chưa làm mới được ({errorMessage(state.error)}). Đang hiện dữ liệu lúc {state.updatedAt ? formatDateTime(new Date(state.updatedAt).toISOString()) : '—'}.
    </p>}
    {hasData && notes.map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
    {attention && (expandable && rows && rows.length > OVERVIEW_ROWS || more) && <div className="mt-auto flex flex-wrap gap-2 pt-1">
      {expandable && rows && rows.length > OVERVIEW_ROWS && <Button type="button" variant="link" className="h-auto p-0 max-sm:min-h-11" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>{expanded ? 'Thu gọn' : `Hiện tất cả ${rows.length} ${unit}`}</Button>}
      {more && <Link to={more.to} className={cn(LINK, 'text-[13px]')}>{more.label}</Link>}
    </div>}
  </section>
}

export default OverviewPage
