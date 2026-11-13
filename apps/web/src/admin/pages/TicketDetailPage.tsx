// O3 Chi tiết phiếu công việc (FE 7.1): what to do and where (machine, alert: one click each), who is on it, what happens
// next, and who did each step with the note or cancel reason. The header only offers the valid next step for this
// account and status. API: GET /work-tickets/{id} of the draft contract api-contract/drafts/work-tickets.yaml
// (waiting for BE 4.3). A staff account asking for someone else's ticket gets 404 from the server, shown as "not found".
// FE 8.3: an INCIDENT ticket also shows the customer's report (code, type, order, description, photo; the phone number
// only reaches admins, the server leaves it null for staff). Customer text is rendered as text, never as HTML.
import { ApiError } from '../../api/client.ts'
import { ticketsApi } from '../../api/resources.ts'
import type { WorkTicket } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { alertPath, machinePath } from '../alerts.ts'
import { Badge, ErrorState, Link, Loading, PageHead, useDialog } from '../kit.tsx'
import { HEADING, HINT, LINK, PANEL } from '../payment-parts.tsx'
import { DueText, TicketActionButtons, TicketActionDialog, TicketHistory } from '../ticket-parts.tsx'
import type { TicketActionState } from '../ticket-parts.tsx'
import { hasRestockLines, restockPath } from '../restock.ts'
import { refundPathFor } from '../refunds.ts'
import {
  TICKETS_MISSING, TICKETS_PATH, TICKET_NOT_FOUND, assigneeText, incidentTypeLabel, isClosed, isMine, isOverdue, nextActions, nextStepText, safePhotoUrl,
  ticketTypeLabel, ticketsAvailability,
} from '../tickets.ts'
import type { TicketIncident } from '../tickets.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'
import { useTicketViewer } from '../useTicketViewer.ts'

const BACK = { to: TICKETS_PATH, label: 'Danh sách phiếu công việc' }

/** The ticket could not be shown: unknown (or not theirs) id, or no tickets endpoint at all. */
class TicketUnavailable extends Error {
  readonly kind: 'missing' | 'not-found'
  constructor(kind: 'missing' | 'not-found') { super(kind === 'missing' ? TICKETS_MISSING : TICKET_NOT_FOUND); this.kind = kind }
}

/** GET /work-tickets/{id}; on 404 one GET /work-tickets?size=1 tells an unknown id from a backend without BE 4.3. */
async function loadTicket(ticketId: string, signal: AbortSignal) {
  try { return await ticketsApi.get(ticketId, signal) } catch (error) {
    const code = error instanceof ApiError ? error.status : undefined
    if (code === 405 || code === 501) throw new TicketUnavailable('missing')
    if (code === 400) throw new TicketUnavailable('not-found')
    if (code !== 404) throw error
    let probe: unknown
    try { await ticketsApi.list({ page: 0, size: 1 }, signal) } catch (listError) { probe = listError }
    throw new TicketUnavailable(probe !== undefined && ticketsAvailability(probe) === 'missing' ? 'missing' : 'not-found')
  }
}

function TicketDetailPage({ ticketId }: { ticketId: string }) {
  const viewer = useTicketViewer()
  const { can } = useSession()
  const canMachines = can('MACHINE_READ'), canAlerts = can('ALERT_READ')
  const state = useApi(signal => loadTicket(ticketId, signal), ticketId)
  const action = useDialog<TicketActionState>()
  const ticket = state.data

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
  return <>
    <PageHead title={ticket.title} back={BACK} subtitle={`${ticketTypeLabel(ticket.type)} · máy ${ticket.machineCode}`}
      actions={nextActions(ticket, viewer).length ? <TicketActionButtons ticket={ticket} viewer={viewer} open={action.open} where="detail" /> : undefined} />
    <div className="grid gap-x-5 lg:grid-cols-2">
      <section className={PANEL} aria-labelledby="ticket-info">
        <h2 id="ticket-info" className={HEADING}>Thông tin phiếu</h2>
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px] [&_dt]:text-muted-foreground">
          <dt>Trạng thái</dt><dd><Badge domain="ticket" explain value={ticket.status} /></dd>
          <dt>Loại</dt><dd>{ticketTypeLabel(ticket.type)}</dd>
          <dt>Người phụ trách</dt><dd>{assigneeText(ticket, viewer)}</dd>
          <dt>Máy</dt><dd>{canMachines && machine
            ? <Link to={machine} className={LINK}><span className="font-mono">{ticket.machineCode}</span>{ticket.machineName ? ` · ${ticket.machineName}` : ''}</Link>
            : <><span className="font-mono">{ticket.machineCode}</span>{ticket.machineName ? ` · ${ticket.machineName}` : ''}</>}</dd>
          <dt>Hạn</dt><dd><DueText ticket={ticket} overdue={isOverdue(ticket, state.updatedAt ?? 0)} /></dd>
          {ticket.alertId && <><dt>Cảnh báo</dt><dd>{canAlerts
            ? <Link to={alertPath(ticket.alertId)} className={LINK}>Mở cảnh báo gốc</Link>
            : 'Phiếu mở từ một cảnh báo'}</dd></>}
          <dt>Mô tả</dt><dd className="whitespace-pre-wrap break-words">{ticket.description || '—'}</dd>
          <dt>Cập nhật lúc</dt><dd>{formatDateTime(ticket.updatedAt)}</dd>
        </dl>
      </section>
      <section className={PANEL} aria-labelledby="ticket-progress">
        <h2 id="ticket-progress" className={HEADING}>Tiến trình</h2>
        <p className={HINT}><strong className="font-medium text-foreground">Bước tiếp theo: </strong>{nextStepText(ticket, viewer)}</p>
        {hasRestockLines(ticket) && <RestockEntry ticket={ticket} mine={isMine(ticket, viewer)} />}
        <TicketHistory ticket={ticket} />
      </section>
      {ticket.type === 'INCIDENT' && <IncidentReportPanel report={ticket.incidentReport ?? null} canOrders={can('ORDER_READ')} canRefund={can('REFUND_RECORD')} />}
    </div>
    <TicketActionDialog state={action.value} close={action.close} changed={state.reload} screen="detail" />
  </>
}

/** FE 8.3: the customer report behind an INCIDENT ticket. */
function IncidentReportPanel({ report, canOrders, canRefund }: { report: TicketIncident | null; canOrders: boolean; canRefund: boolean }) {
  if (!report) return <section className={`${PANEL} lg:col-span-2`} aria-labelledby="ticket-incident">
    <h2 id="ticket-incident" className={HEADING}>Báo cáo của khách</h2>
    <p className={HINT}>Không đọc được báo cáo gốc của phiếu này. Tải lại trang; nếu vẫn vậy, báo bộ phận kỹ thuật kèm đường dẫn phiếu.</p>
  </section>
  const photo = safePhotoUrl(report.photoUrl)
  const paidNotReceived = report.type === 'PAID_NOT_RECEIVED'
  return <section className={`${PANEL} lg:col-span-2`} aria-labelledby="ticket-incident">
    <h2 id="ticket-incident" className={HEADING}>Báo cáo của khách</h2>
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px] [&_dt]:text-muted-foreground">
      <dt>Mã báo cáo</dt><dd className="font-mono">{report.reportCode}</dd>
      <dt>Loại sự cố</dt><dd>{incidentTypeLabel(report.type)}</dd>
      <dt>Gửi lúc</dt><dd>{formatDateTime(report.createdAt)}</dd>
      <dt>Mã đơn</dt><dd>{report.orderCode
        ? <span className="grid gap-1">
          {canOrders && report.orderId
            ? <Link to={`/admin/orders/${report.orderId}`} className={LINK} label={`Mở đơn ${report.orderCode}`}><span className="font-mono">{report.orderCode}</span></Link>
            : <span className="font-mono">{report.orderCode}</span>}
          {canRefund && report.orderFlagged && report.orderId && <span className="text-[13px] text-muted-foreground">Đơn đã được đưa vào “Cần hoàn tiền” để kiểm tra. <Link to={refundPathFor(report.orderId)} className={LINK}>Mở hoàn tiền của đơn</Link></span>}
        </span>
        : paidNotReceived ? 'Khách chưa ghi mã đơn' : 'Không có'}</dd>
      <dt>Mô tả</dt><dd className="whitespace-pre-wrap break-words">{report.description?.trim() || 'Khách không ghi mô tả.'}</dd>
      {report.contactPhone && <><dt>Số điện thoại</dt><dd><a href={`tel:${report.contactPhone}`} className={LINK}>{report.contactPhone}</a>
        <span className="block text-xs text-muted-foreground">Chỉ quản trị viên thấy số này; chỉ dùng để gọi lại về sự cố.</span></dd></>}
      <dt>Ảnh</dt><dd>{photo
        ? <a href={photo} target="_blank" rel="noopener noreferrer" className="inline-block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <img src={photo} alt={`Ảnh khách gửi kèm báo cáo ${report.reportCode} (mở ảnh lớn trong thẻ mới)`} className="max-h-60 max-w-full rounded-md border object-contain" />
        </a>
        : report.hasPhoto ? 'Khách có gửi ảnh nhưng chưa xem được ở đây: máy chủ chưa cấp đường dẫn xem ảnh. Tải lại trang sau ít phút.' : 'Không có ảnh'}</dd>
    </dl>
    {paidNotReceived && <p className={`${HINT} mt-3!`}>Hoàn tất phiếu không tự hoàn tiền và không đổi trạng thái đơn. Kiểm tra máy trước; quản trị viên ghi nhận hoàn tiền ở màn Hoàn tiền khi đơn đã ở trạng thái nhả hàng thất bại.</p>}
  </section>
}

/** FE 7.2: a RESTOCK ticket with lines is carried out step by step on its own screen (made for a phone). */
function RestockEntry({ ticket, mine }: { ticket: WorkTicket; mine: boolean }) {
  const lines = ticket.restockLines ?? []
  const planned = lines.reduce((total, line) => total + line.plannedQuantity, 0)
  const closed = isClosed(ticket)
  const label = closed ? 'Xem đối chiếu nạp hàng' : mine ? 'Thực hiện nạp hàng từng bước' : 'Xem tiến độ nạp hàng'
  return <div className="mb-4 grid gap-2 rounded-lg border bg-muted/40 px-3.5 py-3 text-[13px]">
    <p>Phiếu nạp {lines.length} ngăn ({lines.map(line => line.slotCode).join(', ')}), tổng {planned} hộp theo kế hoạch.{mine && !closed ? ' Màn nạp hàng dẫn bạn qua từng bước: mở cửa nạp, rút hộp hỏng, nạp theo dòng, đóng cửa nạp, đối chiếu.' : ''}</p>
    <p><Button asChild variant={mine && !closed ? 'default' : 'outline'} className="h-11 max-sm:w-full"><Link to={restockPath(ticket.id)}>{label}</Link></Button></p>
  </div>
}

export default TicketDetailPage
