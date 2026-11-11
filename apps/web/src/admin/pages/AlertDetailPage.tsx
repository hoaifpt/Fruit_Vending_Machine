// O2 Chi tiết cảnh báo (FE 6.3): what happened, where (machine, slot, order: one click each), what to do next, and who
// acknowledged and closed it, with the note. Acknowledge / close from here too; "Mở phiếu" waits for FM7.
// API: GET /alerts/{id} of the draft contract api-contract/drafts/alerts.yaml (waiting for BE 3.6).
import { ApiError } from '../../api/client.ts'
import { alertsApi } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { AcknowledgeDialog, HandledBy, OpenTicketButton, ResolveSheet } from '../alert-parts.tsx'
import type { DetailFailure } from '../alerts.ts'
import { ALERTS_MISSING, ALERTS_PATH, ALERT_NOT_FOUND, alertTypeHint, detailFailure, alertTypeLabel, canAcknowledge, canResolve, machinePath } from '../alerts.ts'
import { Badge, ErrorState, Link, Loading, PageHead, useDialog } from '../kit.tsx'
import { inventoryMapPath, shortId } from '../order-detail.ts'
import { HEADING, HINT, LINK, PANEL } from '../payment-parts.tsx'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

const BACK = { to: ALERTS_PATH, label: 'Danh sách cảnh báo' }

/** The alert could not be shown: unknown id, or no alerts endpoint at all (see detailFailure). */
class AlertUnavailable extends Error {
  readonly kind: DetailFailure
  constructor(kind: DetailFailure) { super(kind === 'missing' ? ALERTS_MISSING : ALERT_NOT_FOUND); this.kind = kind }
}

/** GET /alerts/{id}; on 404 one GET /alerts?size=1 tells an unknown id from a backend without BE 3.6. */
async function loadAlert(alertId: string, signal: AbortSignal) {
  try { return await alertsApi.get(alertId, signal) } catch (error) {
    const code = error instanceof ApiError ? error.status : undefined
    if (code === 405 || code === 501) throw new AlertUnavailable('missing')
    if (code === 400) throw new AlertUnavailable('not-found')
    if (code !== 404) throw error
    let probe: unknown
    try { await alertsApi.list({ page: 0, size: 1 }, signal) } catch (listError) { probe = listError }
    throw new AlertUnavailable(detailFailure(probe))
  }
}

function AlertDetailPage({ alertId }: { alertId: string }) {
  const { can } = useSession()
  const canWrite = can('ALERT_WRITE'), canMachines = can('MACHINE_READ'), canInventory = can('INVENTORY_READ'), canOrders = can('ORDER_READ')
  const state = useApi(signal => loadAlert(alertId, signal), alertId)
  const action = useDialog<'acknowledge' | 'resolve'>()
  const alert = state.data

  if (state.error && !alert) {
    if (state.error instanceof AlertUnavailable) return <>
      <PageHead title={state.error.kind === 'missing' ? 'Chưa có dữ liệu cảnh báo' : 'Không tìm thấy cảnh báo'} back={BACK} />
      <div role="alert" className="px-4 py-10 text-center text-muted-foreground">
        <p>{state.error.message}</p>
        <p className="mt-3!"><Button asChild variant="outline" size="sm"><Link to={BACK.to}>Về danh sách cảnh báo</Link></Button></p>
      </div>
    </>
    return <><PageHead title="Cảnh báo" back={BACK} /><ErrorState error={state.error} retry={state.reload} /></>
  }
  if (!alert) return <><PageHead title="Cảnh báo" back={BACK} /><Loading label="Đang tải cảnh báo…" rows={6} /></>

  const machine = machinePath(alert.machineId)
  return <>
    <PageHead title={`${alertTypeLabel(alert.type)} · máy ${alert.machineCode}`} back={BACK} subtitle={`Tiêu đề từ máy: ${alert.title}`}
      actions={canWrite && canResolve(alert) ? <>
        {canAcknowledge(alert) && <Button type="button" variant="outline" onClick={() => action.open('acknowledge')}>Xác nhận</Button>}
        <Button type="button" onClick={() => action.open('resolve')}>Đóng cảnh báo</Button>
      </> : undefined} />
    <div className="grid gap-x-5 lg:grid-cols-2">
      <section className={PANEL} aria-labelledby="alert-info">
        <h2 id="alert-info" className={HEADING}>Thông tin cảnh báo</h2>
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px] [&_dt]:text-muted-foreground">
          <dt>Mức độ</dt><dd><Badge domain="alertSeverity" explain value={alert.severity} /></dd>
          <dt>Trạng thái</dt><dd><Badge domain="alert" explain value={alert.status} /></dd>
          <dt>Loại</dt><dd>{alertTypeLabel(alert.type)}</dd>
          <dt>Nội dung từ máy</dt><dd className="whitespace-pre-wrap break-words">{alert.message || '—'}</dd>
          <dt>Phát sinh lúc</dt><dd>{formatDateTime(alert.triggeredAt)}</dd>
          <dt>Máy</dt><dd>{canMachines && machine
            ? <Link to={machine} className={LINK}><span className="font-mono">{alert.machineCode}</span>{alert.machineName ? ` · ${alert.machineName}` : ''}</Link>
            : <><span className="font-mono">{alert.machineCode}</span>{alert.machineName ? ` · ${alert.machineName}` : ''}</>}</dd>
          {alert.slotCode && <><dt>Ngăn</dt><dd>{canInventory
            ? <Link to={inventoryMapPath(alert.machineId, alert.slotId ?? undefined)} className={LINK} label={`Ngăn ${alert.slotCode}, mở trên sơ đồ tồn kho`}>Ngăn {alert.slotCode}</Link>
            : <>Ngăn {alert.slotCode}</>}</dd></>}
          {alert.orderId && <><dt>Đơn hàng</dt><dd>{canOrders
            ? <Link to={`/admin/orders/${encodeURIComponent(alert.orderId)}`} className={LINK} label={`Đơn ${alert.orderCode ?? shortId(alert.orderId)}, mở đơn hàng`}>{alert.orderCode ?? shortId(alert.orderId)}</Link>
            : alert.orderCode ?? shortId(alert.orderId)}</dd></>}
        </dl>
      </section>
      <section className={PANEL} aria-labelledby="alert-handling">
        <h2 id="alert-handling" className={HEADING}>Xử lý</h2>
        {alert.status !== 'RESOLVED' && <p className={HINT}><strong className="font-medium text-foreground">Việc cần làm: </strong>{alertTypeHint(alert.type)}</p>}
        <HandledBy alert={alert} withNote className="mb-4 text-[14px]!" />
        {!canWrite && alert.status !== 'RESOLVED' && <p className={HINT}>Tài khoản của bạn chỉ xem được cảnh báo, không xác nhận hay đóng được. Hãy báo quản trị viên.</p>}
        {alert.status !== 'RESOLVED' && <OpenTicketButton />}
      </section>
    </div>
    {action.value === 'acknowledge' && <AcknowledgeDialog alert={alert} close={action.close} changed={state.reload} screen="detail" />}
    {action.value === 'resolve' && <ResolveSheet alert={alert} close={action.close} changed={state.reload} screen="detail" />}
  </>
}

export default AlertDetailPage
