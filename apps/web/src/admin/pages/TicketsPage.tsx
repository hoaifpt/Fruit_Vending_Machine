// O3 Phiếu công việc (FE 7.1): restock, maintenance and (FE 8.3) incident jobs at a machine, newest first, server-side filters on the URL.
// Admins (TICKET_WRITE) see every ticket, open, assign and cancel; staff only receive the tickets given to them (the
// server filters) and start / complete them. Each row only offers the valid next step. No delete.
// API: draft contract api-contract/drafts/work-tickets.yaml (waiting for BE 4.3); on a backend without it (404) the
// screen says there is no data yet.
import { ClipboardPlus } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { ticketsApi } from '../../api/resources.ts'
import type { WorkTicket } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import { machinePath } from '../alerts.ts'
import { Badge, DataTable, Link, PAGE_SIZE, PageHead, Pagination, SelectFilter, enumOptions, useDialog } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useMachineOptions, useStaffOptions } from '../options.ts'
import { LINK } from '../payment-parts.tsx'
import { CreateTicketSheet, DueText, TicketActionButtons, TicketActionDialog } from '../ticket-parts.tsx'
import type { TicketActionState } from '../ticket-parts.tsx'
import {
  TICKETS_MISSING, TICKET_SORT_RULE, TICKET_STATUSES, TICKET_TYPE_OPTIONS, assigneeText, isClosed, isOverdue, nextActions, readTicketFilters, ticketFilterKeys,
  ticketListQuery, ticketOrigin, ticketPath, ticketTypeLabel, ticketsAvailability,
} from '../tickets.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'
import { useTicketViewer } from '../useTicketViewer.ts'

const isMissing = (error: unknown) => ticketsAvailability(error) === 'missing'

function TicketsPage() {
  const { params, update } = useQueryParams()
  const filters = readTicketFilters(params)
  const viewer = useTicketViewer()
  const { can } = useSession()
  const canMachines = can('MACHINE_READ')
  const machines = useMachineOptions()
  const staff = useStaffOptions(viewer.canWrite && can('USER_READ'))
  const query = ticketListQuery(filters, PAGE_SIZE, viewer.canWrite)
  const state = useApi(signal => ticketsApi.list(query, signal), `${JSON.stringify(query)}`, { stopOn: isMissing })
  const missing = !state.data && !!state.error && isMissing(state.error)
  const action = useDialog<TicketActionState>()
  const create = useDialog()
  const rows = state.data?.content
  const forbidden = state.error instanceof ApiError && state.error.status === 403 && !rows
  const keys = ticketFilterKeys(viewer.canWrite)
  const filterCount = activeFilterCount(keys.map(key => filters[key]))
  // "Quá hạn" as of the last load (refreshed with the list).
  const now = state.updatedAt ?? 0

  const columns: Column<WorkTicket>[] = [
    { head: 'Phiếu', cell: ticket => <span className="grid max-w-[46ch] gap-0.5">
      <Link to={ticketPath(ticket.id)} className={LINK}>{ticket.title}</Link>
      <span className="text-xs text-muted-foreground">{ticketTypeLabel(ticket.type)}{ticketOrigin(ticket) ? ` · ${ticketOrigin(ticket)}` : ''}</span>
    </span> },
    { head: 'Máy', nowrap: true, cell: ticket => canMachines && machinePath(ticket.machineId)
      ? <Link to={machinePath(ticket.machineId)} className={`${LINK} font-mono text-[13px]`} label={`Máy ${ticket.machineCode}, mở chi tiết máy`}>{ticket.machineCode}</Link>
      : <span className="font-mono text-[13px]">{ticket.machineCode}</span> },
    ...(viewer.canWrite ? [{ head: 'Người phụ trách', cell: (ticket: WorkTicket) => <span className={ticket.assigneeId ? '' : 'text-muted-foreground'}>{assigneeText(ticket, viewer)}</span> }] : []),
    { head: 'Trạng thái', cell: ticket => <Badge domain="ticket" value={ticket.status} /> },
    { head: 'Hạn', sortKey: 'dueAt', firstDirection: 'asc', cell: ticket => <DueText ticket={ticket} overdue={isOverdue(ticket, now)} /> },
    { head: 'Tạo lúc', sortKey: 'createdAt', firstDirection: 'desc', nowrap: true, cell: ticket => formatDateTime(ticket.createdAt) },
    { head: 'Bước tiếp theo', cell: ticket => nextActions(ticket, viewer).length
      ? <TicketActionButtons ticket={ticket} viewer={viewer} open={action.open} where="list" />
      : <span className="text-xs text-muted-foreground">{isClosed(ticket) ? 'Không còn bước nào' : 'Chờ người phụ trách'}</span> },
  ]

  const subtitle = viewer.canWrite
    ? 'Việc nạp hàng, bảo trì và xử lý sự cố tại máy. Tạo phiếu, giao cho nhân viên, theo dõi đến khi hoàn tất; mỗi bước ghi người và thời điểm. Phiếu sự cố được tạo tự động khi khách gửi báo cáo. Phiếu không xóa được, chỉ hủy kèm lý do.'
    : 'Phiếu được giao cho bạn: việc nạp hàng, bảo trì và xử lý sự cố tại máy. Bấm “Bắt đầu” khi tới máy và “Hoàn tất” khi xong; mỗi bước ghi tên bạn và thời điểm.'
  const head = <PageHead title="Phiếu công việc" subtitle={subtitle}
    actions={viewer.canWrite && !forbidden && !missing ? <Button type="button" data-focus-key="tickets-create" onClick={() => create.open()}><ClipboardPlus aria-hidden="true" />Tạo phiếu</Button> : undefined} />

  if (missing) return <>
    {head}
    <p role="status" className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-muted-foreground">{TICKETS_MISSING}</p>
  </>

  const empty = filterCount
    ? <>Không có phiếu khớp bộ lọc. <Button type="button" variant="link" className="h-auto p-0" onClick={() => update(clearFiltersPatch(keys))}>Xóa bộ lọc</Button></>
    : viewer.canWrite
      ? 'Chưa có phiếu công việc nào. Bấm “Tạo phiếu” để giao việc nạp hàng hoặc bảo trì cho nhân viên, hoặc mở phiếu từ một cảnh báo.'
      : 'Bạn chưa được giao phiếu nào. Khi quản trị viên giao việc, phiếu sẽ hiện ở đây.'

  return <>
    {head}
    {!viewer.canWrite && !forbidden && <p className="mb-3! text-[13px] text-muted-foreground" role="note">Danh sách chỉ gồm phiếu được giao cho bạn.</p>}
    {!forbidden && <FilterBar activeCount={filterCount} onClear={() => update(clearFiltersPatch(keys))}>
      <SelectFilter label="Trạng thái" value={filters.status} onChange={value => update({ status: value || undefined, page: undefined })} options={enumOptions('ticket', TICKET_STATUSES)} />
      <SelectFilter label="Loại" value={filters.type} onChange={value => update({ type: value || undefined, page: undefined })} options={TICKET_TYPE_OPTIONS} />
      <SelectFilter label="Máy" value={filters.machineId} onChange={value => update({ machineId: value || undefined, page: undefined })} options={machines} />
      {viewer.canWrite && <SelectFilter label="Người phụ trách" value={filters.assigneeId} onChange={value => update({ assigneeId: value || undefined, page: undefined })} options={staff.options} />}
    </FilterBar>}
    <DataTable state={state} rows={rows} rowKey={ticket => ticket.id} caption="Danh sách phiếu công việc" empty={empty}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, TICKET_SORT_RULE), page: undefined })} columns={columns} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: next ? String(next) : undefined })} />}
    <TicketActionDialog state={action.value} close={action.close} changed={state.reload} screen="list" />
    {create.value && <CreateTicketSheet close={create.close} created={() => state.reload()} />}
  </>
}

export default TicketsPage
