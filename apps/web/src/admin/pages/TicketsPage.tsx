// O3 Phiếu công việc (FE 7.1): restock, maintenance and incident jobs at a machine, server-side filters on the URL, in the
// server's order (URGENT first, then due time, then oldest). WORK_ORDER_READ_ALL reads GET /work-orders with every filter;
// everyone else reads GET /work-orders/me (status and overdue only). Managers (WORK_ORDER_MANAGE) create, assign and
// cancel; the assignee (or a manager acting for them) starts and completes. Each row only offers the valid next step.
// No delete. API: /work-orders of api-contract/api.yaml (backend #66).
import { ClipboardPlus } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { workOrdersApi } from '../../api/resources.ts'
import type { WorkOrder } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch } from '../../lib/table-query.ts'
import { machinePath } from '../alerts.ts'
import { Badge, DataTable, Link, PAGE_SIZE, PageHead, Pagination, SelectFilter, enumOptions, useDialog } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useMachineOptions, useStaffOptions } from '../options.ts'
import { LINK } from '../payment-parts.tsx'
import { CreateTicketSheet, DueText, PriorityText, TicketActionButtons, TicketActionDialog } from '../ticket-parts.tsx'
import type { TicketActionState } from '../ticket-parts.tsx'
import {
  PRIORITY_OPTIONS, SOURCE_OPTIONS, TICKETS_MISSING, TICKET_STATUSES, TICKET_TYPE_OPTIONS, assigneeText, isClosed, isOverdue, myTicketQuery, nextActions,
  readTicketFilters, ticketFilterKeys, ticketListQuery, ticketOrigin, ticketPath, ticketTypeLabel, ticketsAvailability,
} from '../tickets.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'
import { useTicketViewer } from '../useTicketViewer.ts'

const isMissing = (error: unknown) => ticketsAvailability(error) === 'missing'
const OVERDUE_OPTIONS = [{ value: 'true', label: 'Chỉ phiếu quá hạn' }]

function TicketsPage() {
  const { params, update } = useQueryParams()
  const filters = readTicketFilters(params)
  const viewer = useTicketViewer()
  const { can } = useSession()
  const canMachines = can('MACHINE_READ')
  const readAll = viewer.canReadAll
  const machines = useMachineOptions()
  const staff = useStaffOptions(readAll && can('USER_READ'))
  const query = readAll ? ticketListQuery(filters, PAGE_SIZE) : myTicketQuery(filters, PAGE_SIZE)
  const state = useApi(signal => (readAll ? workOrdersApi.list(ticketListQuery(filters, PAGE_SIZE), signal) : workOrdersApi.mine(myTicketQuery(filters, PAGE_SIZE), signal)),
    `${readAll ? 'all' : 'me'}|${JSON.stringify(query)}`, { stopOn: isMissing })
  const missing = !state.data && !!state.error && isMissing(state.error)
  const action = useDialog<TicketActionState>()
  const create = useDialog()
  const rows = state.data?.content
  const forbidden = state.error instanceof ApiError && state.error.status === 403 && !rows
  const keys = ticketFilterKeys(readAll)
  const filterCount = activeFilterCount(keys.map(key => filters[key]))
  const set = (key: string) => (value: string) => update({ [key]: value || undefined, page: undefined })

  const columns: Column<WorkOrder>[] = [
    { head: 'Phiếu', cell: ticket => <span className="grid max-w-[46ch] gap-0.5">
      <Link to={ticketPath(ticket.id)} className={LINK}>{ticket.title}</Link>
      <span className="text-xs text-muted-foreground"><span className="font-mono">{ticket.code}</span> · {ticketTypeLabel(ticket.type)}{ticketOrigin(ticket) ? ` · ${ticketOrigin(ticket)}` : ''}</span>
    </span> },
    { head: 'Máy', nowrap: true, cell: ticket => canMachines && machinePath(ticket.machineId)
      ? <Link to={machinePath(ticket.machineId)} className={`${LINK} font-mono text-[13px]`} label={`Máy ${ticket.machineCode}, mở chi tiết máy`}>{ticket.machineCode}</Link>
      : <span className="font-mono text-[13px]">{ticket.machineCode}</span> },
    { head: 'Ưu tiên', cell: ticket => <PriorityText priority={ticket.priority} /> },
    ...(readAll ? [{ head: 'Người phụ trách', cell: (ticket: WorkOrder) => <span className={ticket.assignee?.id ? '' : 'text-muted-foreground'}>{assigneeText(ticket, viewer)}</span> }] : []),
    { head: 'Trạng thái', cell: ticket => <Badge domain="ticket" value={ticket.status} /> },
    { head: 'Hạn', cell: ticket => <DueText ticket={ticket} overdue={isOverdue(ticket)} /> },
    { head: 'Tạo lúc', nowrap: true, secondary: true, cell: ticket => formatDateTime(ticket.createdAt) },
    { head: 'Bước tiếp theo', cell: ticket => nextActions(ticket, viewer).length
      ? <TicketActionButtons ticket={ticket} viewer={viewer} open={action.open} where="list" />
      : <span className="text-xs text-muted-foreground">{isClosed(ticket) ? 'Không còn bước nào' : 'Chờ người phụ trách'}</span> },
  ]

  const subtitle = viewer.canWrite
    ? 'Việc nạp hàng, bảo trì và xử lý sự cố tại máy, khẩn cấp và sắp đến hạn trước. Tạo phiếu, giao cho nhân viên, theo dõi đến khi hoàn tất; mỗi bước ghi người và thời điểm. Phiếu cũng được tạo tự động từ cảnh báo, lịch bảo trì và phản ánh của khách. Phiếu không xóa được, chỉ hủy kèm lý do.'
    : 'Phiếu được giao cho bạn: việc nạp hàng, bảo trì và xử lý sự cố tại máy, khẩn cấp trước. Bấm “Bắt đầu” khi tới máy và “Hoàn tất” khi xong; mỗi bước ghi tên bạn và thời điểm.'
  const head = <PageHead title="Phiếu công việc" subtitle={subtitle}
    actions={viewer.canWrite && !forbidden && !missing ? <Button type="button" data-focus-key="tickets-create" onClick={() => create.open()}><ClipboardPlus aria-hidden="true" />Tạo phiếu</Button> : undefined} />

  if (missing) return <>
    {head}
    <p role="status" className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-muted-foreground">{TICKETS_MISSING}</p>
  </>

  const empty = filterCount
    ? <>Không có phiếu khớp bộ lọc. <Button type="button" variant="link" className="h-auto p-0" onClick={() => update(clearFiltersPatch(keys))}>Xóa bộ lọc</Button></>
    : viewer.canWrite
      ? 'Chưa có phiếu công việc nào. Bấm “Tạo phiếu” để giao việc nạp hàng, bảo trì hoặc xử lý sự cố cho nhân viên.'
      : 'Bạn chưa được giao phiếu nào. Khi quản trị viên giao việc, phiếu sẽ hiện ở đây.'

  return <>
    {head}
    {!readAll && !forbidden && <p className="mb-3! text-[13px] text-muted-foreground" role="note">Danh sách chỉ gồm phiếu được giao cho bạn.</p>}
    {!forbidden && <FilterBar activeCount={filterCount} onClear={() => update(clearFiltersPatch(keys))}>
      <SelectFilter label="Trạng thái" value={filters.status} onChange={set('status')} options={enumOptions('ticket', TICKET_STATUSES)} />
      {readAll && <SelectFilter label="Loại" value={filters.type} onChange={set('type')} options={TICKET_TYPE_OPTIONS} />}
      {readAll && <SelectFilter label="Ưu tiên" value={filters.priority} onChange={set('priority')} options={PRIORITY_OPTIONS} />}
      {readAll && <SelectFilter label="Nguồn" value={filters.source} onChange={set('source')} options={SOURCE_OPTIONS} />}
      {readAll && <SelectFilter label="Máy" value={filters.machineId} onChange={set('machineId')} options={machines} />}
      {readAll && <SelectFilter label="Người phụ trách" value={filters.assigneeId} onChange={set('assigneeId')} options={staff.options} />}
      <SelectFilter label="Hạn" value={filters.overdue} onChange={set('overdue')} options={OVERDUE_OPTIONS} empty="Mọi hạn" />
    </FilterBar>}
    <DataTable state={state} rows={rows} rowKey={ticket => ticket.id!} caption="Danh sách phiếu công việc" empty={empty} columns={columns} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: next ? String(next) : undefined })} />}
    <TicketActionDialog state={action.value} close={action.close} changed={state.reload} screen="list" />
    {create.value && <CreateTicketSheet close={create.close} created={() => state.reload()} />}
  </>
}

export default TicketsPage
