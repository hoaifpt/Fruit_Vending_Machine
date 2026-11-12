// O3 Chi tiết phiếu công việc (FE 7.1): what to do and where (machine, alert: one click each), who is on it, what happens
// next, and who did each step with the note or cancel reason. The header only offers the valid next step for this
// account and status. API: GET /work-tickets/{id} of the draft contract api-contract/drafts/work-tickets.yaml
// (waiting for BE 4.3). A staff account asking for someone else's ticket gets 404 from the server, shown as "not found".
import { ApiError } from '../../api/client.ts'
import { ticketsApi } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { alertPath, machinePath } from '../alerts.ts'
import { Badge, ErrorState, Link, Loading, PageHead, useDialog } from '../kit.tsx'
import { HEADING, HINT, LINK, PANEL } from '../payment-parts.tsx'
import { DueText, TicketActionButtons, TicketActionDialog, TicketHistory } from '../ticket-parts.tsx'
import type { TicketActionState } from '../ticket-parts.tsx'
import { TICKETS_MISSING, TICKETS_PATH, TICKET_NOT_FOUND, assigneeText, isOverdue, nextActions, nextStepText, ticketTypeLabel, ticketsAvailability } from '../tickets.ts'
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
        <TicketHistory ticket={ticket} />
      </section>
    </div>
    <TicketActionDialog state={action.value} close={action.close} changed={state.reload} screen="detail" />
  </>
}

export default TicketDetailPage
