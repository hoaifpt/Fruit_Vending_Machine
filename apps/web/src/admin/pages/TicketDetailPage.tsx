// O3 Chi tiết phiếu công việc (FE 7.1): what to do and where (machine, linked alerts, plan: one click each), who is on it,
// what happens next, and the append-only history (GET /work-orders/{id}/events) with notes, result or cancel reason.
// The header only offers the valid next steps for this account and status, plus "Sửa phiếu" (WORK_ORDER_MANAGE) and
// "Thêm ghi chú" (assignee or manager) while unfinished. API: GET /work-orders/{id} of api.yaml (backend #66); someone
// else's work order without WORK_ORDER_READ_ALL is a 404, shown as "not found". An INCIDENT work order lists the
// customer reports attached to it (linkedReports: code, type, verdict, status; never the reporter's contact).
import { workOrdersApi } from '../../api/resources.ts'
import type { WorkOrder } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { formatDate, formatDateTime } from '../../lib/format.ts'
import { alertPath, alertTypeLabel, machinePath } from '../alerts.ts'
import { Badge, ErrorState, Link, Loading, PageHead, useDialog } from '../kit.tsx'
import { HEADING, HINT, LINK, PANEL } from '../payment-parts.tsx'
import { DueText, PriorityText, TicketActionButtons, TicketActionDialog, TicketHistory } from '../ticket-parts.tsx'
import type { TicketActionState } from '../ticket-parts.tsx'
import { restockPath } from '../restock.ts'
import { SCHEDULES_PATH } from '../maintenance-schedules.ts'
import {
  TICKETS_PATH, actionLabel, assigneeText, creatorText, incidentTypeLabel, isClosed, isOverdue, isRestock, mayExecute,
  nextActions, nextStepText, sourceLabel, ticketTypeLabel,
} from '../tickets.ts'
import type { TicketViewer } from '../tickets.ts'
import { useApi } from '../useApi.ts'
import { TicketUnavailable, loadTicket } from '../work-order-load.ts'
import { useSession } from '../useSession.ts'
import { useTicketViewer } from '../useTicketViewer.ts'

const BACK = { to: TICKETS_PATH, label: 'Danh sách phiếu công việc' }

function TicketDetailPage({ ticketId }: { ticketId: string }) {
  const viewer = useTicketViewer()
  const { can } = useSession()
  const canMachines = can('MACHINE_READ'), canAlerts = can('ALERT_READ'), canPlans = can('MAINTENANCE_PLAN_READ')
  const state = useApi(signal => loadTicket(ticketId, signal), ticketId)
  const ticket = state.data
  const events = useApi(signal => ticket ? workOrdersApi.events(ticketId, signal) : Promise.resolve(undefined), `${ticketId}|events|${ticket?.version ?? ''}|${ticket?.updatedAt ?? ''}`)
  const action = useDialog<TicketActionState>()

  if (state.error && !ticket) {
    if (state.error instanceof TicketUnavailable) return <>
      <PageHead title={state.error.kind === 'missing' ? 'Chưa có dữ liệu phiếu công việc' : 'Không tìm thấy phiếu'} back={BACK} />
      <div role="alert" className="px-4 py-10 text-center text-muted-foreground">
        <p>{state.error.message}</p>
        <p className="mt-3!"><Button asChild variant="outline" size="sm"><Link to={BACK.to}>Về danh sách phiếu</Link></Button></p>
      </div>
    </>
    return <><PageHead title="Phiếu công việc" back={BACK} /><ErrorState error={state.error} retry={state.reload} /></>
  }
  if (!ticket) return <><PageHead title="Phiếu công việc" back={BACK} /><Loading label="Đang tải phiếu…" rows={6} /></>

  const machine = machinePath(ticket.machineId)
  const changed = () => { state.reload(); events.reload() }
  const open = !isClosed(ticket)
  const extra = <>
    {viewer.canWrite && open && <Button type="button" variant="outline" className="max-sm:h-11" data-focus-key={`ticket-edit-${ticket.id}`} onClick={() => action.open({ action: 'edit', ticket })}>{actionLabel('edit', ticket)}</Button>}
    {mayExecute(ticket, viewer) && open && <Button type="button" variant="outline" className="max-sm:h-11" data-focus-key={`ticket-note-${ticket.id}`} onClick={() => action.open({ action: 'note', ticket })}>{actionLabel('note', ticket)}</Button>}
  </>
  const hasActions = nextActions(ticket, viewer).length > 0 || (open && (viewer.canWrite || mayExecute(ticket, viewer)))
  return <>
    <PageHead title={ticket.title ?? 'Phiếu công việc'} back={BACK} subtitle={`${ticket.code ?? ''} · ${ticketTypeLabel(ticket.type)} · máy ${ticket.machineCode}`}
      actions={hasActions ? <span className="flex flex-wrap gap-1.5"><TicketActionButtons ticket={ticket} viewer={viewer} open={action.open} where="detail" />{extra}</span> : undefined} />
    <div className="grid gap-x-5 lg:grid-cols-2">
      <section className={PANEL} aria-labelledby="ticket-info">
        <h2 id="ticket-info" className={HEADING}>Thông tin phiếu</h2>
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px] [&_dt]:text-muted-foreground">
          <dt>Mã phiếu</dt><dd className="font-mono">{ticket.code ?? '—'}</dd>
          <dt>Trạng thái</dt><dd><Badge domain="ticket" explain value={ticket.status} /></dd>
          <dt>Loại</dt><dd>{ticketTypeLabel(ticket.type)}</dd>
          <dt>Ưu tiên</dt><dd><PriorityText priority={ticket.priority} /></dd>
          <dt>Nguồn</dt><dd>{sourceLabel(ticket.source)}</dd>
          <dt>Người phụ trách</dt><dd>{assigneeText(ticket, viewer)}</dd>
          <dt>Máy</dt><dd>{canMachines && machine
            ? <Link to={machine} className={LINK}><span className="font-mono">{ticket.machineCode}</span>{ticket.machineName ? ` · ${ticket.machineName}` : ''}</Link>
            : <><span className="font-mono">{ticket.machineCode}</span>{ticket.machineName ? ` · ${ticket.machineName}` : ''}</>}</dd>
          <dt>Hạn</dt><dd><DueText ticket={ticket} overdue={isOverdue(ticket)} /></dd>
          {ticket.maintenancePlan?.id && <><dt>Lịch bảo trì</dt><dd>{canPlans
            ? <Link to={SCHEDULES_PATH} className={LINK}>{ticket.maintenancePlan.title}</Link>
            : ticket.maintenancePlan.title}{ticket.scheduledFor ? ` · lần ${formatDate(ticket.scheduledFor)}` : ''}</dd></>}
          <dt>Tạo bởi</dt><dd>{creatorText(ticket)} · {formatDateTime(ticket.createdAt)}</dd>
          <dt>Mô tả</dt><dd className="whitespace-pre-wrap break-words">{ticket.description || '—'}</dd>
          {ticket.status === 'DONE' && <><dt>Kết quả</dt><dd className="whitespace-pre-wrap break-words">{ticket.resultNote || '—'}<span className="block text-xs text-muted-foreground">{ticket.completedBy?.fullName ?? ''} · {formatDateTime(ticket.completedAt)}</span></dd></>}
          {ticket.status === 'CANCELLED' && <><dt>Lý do hủy</dt><dd className="whitespace-pre-wrap break-words">{ticket.cancelReason || '—'}<span className="block text-xs text-muted-foreground">{ticket.cancelledBy?.fullName ?? ''} · {formatDateTime(ticket.cancelledAt)}</span></dd></>}
          <dt>Cập nhật lúc</dt><dd>{formatDateTime(ticket.updatedAt)}</dd>
        </dl>
      </section>
      <section className={PANEL} aria-labelledby="ticket-progress">
        <h2 id="ticket-progress" className={HEADING}>Tiến trình</h2>
        <p className={HINT}><strong className="font-medium text-foreground">Bước tiếp theo: </strong>{nextStepText(ticket, viewer)}</p>
        {isRestock(ticket) && <RestockEntry ticket={ticket} viewer={viewer} />}
        {events.error && !events.data ? <ErrorState error={events.error} retry={events.reload} />
          : !events.data ? <Loading label="Đang tải lịch sử phiếu…" rows={3} />
          : <TicketHistory events={events.data} />}
      </section>
      {(ticket.linkedAlerts?.length ?? 0) > 0 && <section className={PANEL} aria-labelledby="ticket-alerts">
        <h2 id="ticket-alerts" className={HEADING}>Cảnh báo gắn với phiếu</h2>
        <ul className="grid gap-2 text-[14px]">
          {ticket.linkedAlerts!.map(alert => <li key={alert.id} className="flex flex-wrap items-center gap-2">
            <Badge domain="alert" value={alert.status} />
            {canAlerts && alert.id ? <Link to={alertPath(alert.id)} className={LINK}>{alert.title || alertTypeLabel(alert.type)}</Link> : <span>{alert.title || alertTypeLabel(alert.type)}</span>}
          </li>)}
        </ul>
        {open && <p className={`${HINT} mt-3!`}>Hoàn tất phiếu sẽ đóng các cảnh báo còn mở ở đây (có thể bỏ chọn khi hoàn tất).</p>}
      </section>}
      {(ticket.linkedReports?.length ?? 0) > 0 && <section className={PANEL} aria-labelledby="ticket-reports">
        <h2 id="ticket-reports" className={HEADING}>Phản ánh của khách</h2>
        <ul className="grid gap-2 text-[14px]">
          {ticket.linkedReports!.map(report => <li key={report.id ?? report.code}>
            <span className="font-mono">{report.code}</span> · {incidentTypeLabel(report.type)}{report.status ? ` · ${report.status}` : ''}{report.verdict ? ` · ${report.verdict}` : ''}
          </li>)}
        </ul>
        <p className={`${HINT} mt-3!`}>Hoàn tất phiếu không tự hoàn tiền và không đổi trạng thái đơn; hoàn tiền ghi ở màn Hoàn tiền.</p>
      </section>}
    </div>
    <TicketActionDialog state={action.value} close={action.close} changed={changed} screen="detail" />
  </>
}

/** FE 7.2: a RESTOCK work order is carried out step by step on its own screen (made for a phone). */
function RestockEntry({ ticket, viewer }: { ticket: WorkOrder; viewer: TicketViewer }) {
  const summary = ticket.restockSummary
  const closed = isClosed(ticket)
  const executes = mayExecute(ticket, viewer) && !!ticket.assignee
  const label = closed ? 'Xem đối chiếu nạp hàng' : executes ? 'Thực hiện nạp hàng từng bước' : 'Xem tiến độ nạp hàng'
  return <div className="mb-4 grid gap-2 rounded-lg border bg-muted/40 px-3.5 py-3 text-[13px]">
    <p>{summary?.lines
      ? `Phiếu nạp ${summary.lines} dòng, kế hoạch ${summary.plannedTotal ?? 0} hộp, đã nạp ${summary.loadedTotal ?? 0} hộp${summary.varianceLines ? `, ${summary.varianceLines} dòng lệch kế hoạch` : ''}.`
      : 'Phiếu chưa có dòng nạp (ngăn, sản phẩm, số hộp): chưa bắt đầu được cho tới khi quản trị viên lập kế hoạch.'}
      {executes && !closed ? ' Màn nạp hàng dẫn bạn qua từng bước: bắt đầu, rút hộp cũ, nạp theo dòng, đóng cổng nạp, đối chiếu.' : ''}</p>
    <p><Button asChild variant={executes && !closed ? 'default' : 'outline'} className="h-11 max-sm:w-full"><Link to={restockPath(ticket.id!)}>{label}</Link></Button></p>
  </div>
}

export default TicketDetailPage
