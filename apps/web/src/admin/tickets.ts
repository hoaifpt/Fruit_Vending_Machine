// Rules of screen O3 "Phiếu công việc" (FE 7.1) that do not need React, unit-tested in tests/tickets.test.mjs.
// API: draft contract api-contract/drafts/work-tickets.yaml, waiting for backend issue 4.3. Lifecycle OPEN → ASSIGNED →
// IN_PROGRESS → COMPLETED, CANCELLED before COMPLETED; statuses are the `ticket` domain of src/lib/status.ts. A ticket is
// never deleted. Opening, assigning and cancelling need TICKET_WRITE; starting and completing are for the assignee only.
// Who sees which ticket is decided by the server (a caller without TICKET_WRITE only receives its own); the web never
// filters on its own and only uses the viewer's id to decide which buttons to show.
// FE 8.3: INCIDENT tickets ("Sự cố") are opened by the server from a customer report (drafts/incident-reports.yaml,
// BE 5.2), never from the "Tạo phiếu" form; they carry the report summary (incidentReport) and follow the same lifecycle.
import { ApiError } from '../api/client.ts'
import type { Alert, CancelWorkTicketBody, CompleteWorkTicketBody, CreateWorkTicketBody, WorkTicket, WorkTicketListQuery } from '../api/resources.ts'
import { formatDateTime, localDateTimeToInstant } from '../lib/format.ts'
import { formatSort, oneOf, parseSort, uuidParam } from '../lib/table-query.ts'
import type { SortRule, SortState } from '../lib/table-query.ts'
import { alertTypeHint, alertTypeLabel } from './alerts.ts'
import { INCIDENT_TYPES } from '../features/incident/incident.ts'

/** Same order as the `ticket` domain of STATUS_CATALOG (and the lifecycle). */
export const TICKET_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
export type TicketStatus = typeof TICKET_STATUSES[number]
export const TICKET_TYPES = ['RESTOCK', 'MAINTENANCE', 'INCIDENT'] as const
export type TicketType = typeof TICKET_TYPES[number]
/** Types an admin can open by hand (POST /work-tickets); INCIDENT only comes from a customer report. */
export const CREATABLE_TICKET_TYPES = ['RESTOCK', 'MAINTENANCE'] as const
export type CreatableTicketType = typeof CREATABLE_TICKET_TYPES[number]

export const TICKET_TYPE_LABELS: Readonly<Record<TicketType, string>> = { RESTOCK: 'Nạp hàng', MAINTENANCE: 'Bảo trì', INCIDENT: 'Sự cố' }
/** Options of the "Loại" filter of the list (every type). */
export const TICKET_TYPE_OPTIONS = TICKET_TYPES.map(type => ({ value: type, label: TICKET_TYPE_LABELS[type] }))
/** Options of the "Tạo phiếu" form (no INCIDENT). */
export const CREATABLE_TICKET_TYPE_OPTIONS = CREATABLE_TICKET_TYPES.map(type => ({ value: type, label: TICKET_TYPE_LABELS[type] }))
export function ticketTypeLabel(type: string | undefined): string {
  return type && Object.hasOwn(TICKET_TYPE_LABELS, type) ? TICKET_TYPE_LABELS[type as TicketType] : (type || 'Phiếu')
}

// ---- list filters (URL)

/** Sorts `GET /work-tickets` approves: newest first by default, or by due time. */
export const TICKET_SORT_RULE: SortRule = { fields: ['createdAt', 'dueAt'], fallback: 'createdAt,desc' }
export const TICKET_FILTER_KEYS = ['status', 'type', 'machineId', 'assigneeId'] as const

export interface TicketFilters {
  status: TicketStatus | ''; type: TicketType | ''; machineId: string; assigneeId: string; sort: SortState; page: number
}

/** Filters from the URL; values the contract would reject with a 400 (unknown enum, non-UUID id) are dropped. */
export function readTicketFilters(params: URLSearchParams): TicketFilters {
  const page = Number(params.get('page') ?? '')
  return {
    status: oneOf(params.get('status'), TICKET_STATUSES) as TicketFilters['status'],
    type: oneOf(params.get('type'), TICKET_TYPES) as TicketFilters['type'],
    machineId: uuidParam((params.get('machineId') ?? '').trim()),
    assigneeId: uuidParam((params.get('assigneeId') ?? '').trim()),
    sort: parseSort(params.get('sort'), TICKET_SORT_RULE),
    page: Number.isSafeInteger(page) && page > 0 ? page : 0,
  }
}

/**
 * Query of GET /work-tickets: only parameters of the draft contract, absent when not in effect. Without TICKET_WRITE
 * the assignee filter is not sent: the server answers with the caller's own tickets whatever it says.
 */
export function ticketListQuery(filters: TicketFilters, size: number, canWrite: boolean): WorkTicketListQuery {
  return {
    page: filters.page, size, sort: formatSort(filters.sort),
    status: filters.status || undefined, type: filters.type || undefined, machineId: filters.machineId || undefined,
    assigneeId: canWrite ? filters.assigneeId || undefined : undefined,
  }
}
/** Filters shown (and counted) on the screen: the assignee filter only for those who see everyone's tickets. */
export function ticketFilterKeys(canWrite: boolean): readonly (typeof TICKET_FILTER_KEYS[number])[] {
  return canWrite ? TICKET_FILTER_KEYS : TICKET_FILTER_KEYS.filter(key => key !== 'assigneeId')
}

// ---- links

export const TICKETS_PATH = '/admin/tickets'
export function ticketPath(ticketId: string | undefined): string {
  return ticketId ? `/admin/tickets/${encodeURIComponent(ticketId)}` : TICKETS_PATH
}

// ---- availability of the draft endpoints

/** `missing`: the backend has not shipped BE 4.3 (404 on the path, or 405/501). */
export type TicketsAvailability = 'missing' | 'forbidden' | 'unauthorized' | 'error'
export function ticketsAvailability(error: unknown): TicketsAvailability {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 404 || status === 405 || status === 501) return 'missing'
  if (status === 403) return 'forbidden'
  if (status === 401) return 'unauthorized'
  return 'error'
}
export const TICKETS_MISSING = 'Chưa có dữ liệu phiếu công việc: máy chủ chưa cung cấp chức năng phiếu. Các màn khác vẫn dùng dữ liệu thật; việc tại máy tạm thời hãy giao trực tiếp.'
export const TICKET_NOT_FOUND = 'Không tìm thấy phiếu này: đường dẫn có thể đã sai, hoặc phiếu không giao cho bạn. Mở lại từ danh sách phiếu.'

// ---- who may do what next

export interface TicketViewer {
  /** Account id of the session (JWT `sub`). */
  userId: string | undefined
  /** Holds TICKET_WRITE: opens, assigns and cancels tickets, sees everyone's. */
  canWrite: boolean
}
export type TicketAction = 'assign' | 'start' | 'complete' | 'cancel'
/**
 * A next step offered for a ticket: one of the actions run through a dialog, or `restock`, the link to the step-by-step
 * restock screen (FE 7.2) that replaces Bắt đầu / Hoàn tất for a RESTOCK ticket with lines (it starts the ticket, opens
 * and closes the refill door and reconciles before completing; the plain dialogs would skip all of that).
 */
export type TicketNextAction = TicketAction | 'restock'

export function isMine(ticket: Pick<WorkTicket, 'assigneeId'>, viewer: TicketViewer): boolean {
  return !!viewer.userId && ticket.assigneeId === viewer.userId
}
export function isClosed(ticket: Pick<WorkTicket, 'status'>): boolean {
  return ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED'
}
/** RESTOCK ticket that has lines: the restock screen applies (others use the plain "Hoàn tất" of the detail page). */
export function hasRestockLines(ticket: Partial<Pick<WorkTicket, 'type' | 'restockLines'>>): boolean {
  return ticket.type === 'RESTOCK' && (ticket.restockLines?.length ?? 0) > 0
}

/**
 * The buttons a viewer gets for a ticket: only the valid next step(s) of the lifecycle for this role, progress first,
 * cancel last. OPEN/ASSIGNED → assign (admin); ASSIGNED → start and IN_PROGRESS → complete (assignee only, admins too
 * only when the ticket is theirs); anything not closed → cancel (admin). For a RESTOCK ticket with lines the assignee's
 * start / complete become one `restock` link to the restock screen. Never a delete.
 */
export function nextActions(ticket: Pick<WorkTicket, 'status' | 'assigneeId'> & Partial<Pick<WorkTicket, 'type' | 'restockLines'>>, viewer: TicketViewer): TicketNextAction[] {
  const actions: TicketNextAction[] = []
  const mine = isMine(ticket, viewer)
  const restock = hasRestockLines(ticket)
  if (viewer.canWrite && (ticket.status === 'OPEN' || ticket.status === 'ASSIGNED')) actions.push('assign')
  if (mine && (ticket.status === 'ASSIGNED' || ticket.status === 'IN_PROGRESS')) {
    actions.push(restock ? 'restock' : ticket.status === 'ASSIGNED' ? 'start' : 'complete')
  }
  if (viewer.canWrite && !isClosed(ticket)) actions.push('cancel')
  return actions
}

export function actionLabel(action: TicketNextAction, ticket: Pick<WorkTicket, 'status'>): string {
  if (action === 'assign') return ticket.status === 'OPEN' ? 'Phân công' : 'Đổi người phụ trách'
  return { start: 'Bắt đầu', complete: 'Hoàn tất', cancel: 'Hủy phiếu', restock: 'Thực hiện nạp hàng' }[action]
}

const person = (name: string | null | undefined, id: string | null | undefined) =>
  name?.trim() || (id ? `Tài khoản …${id.slice(-8)}` : 'Không rõ người thực hiện')
export function assigneeText(ticket: Pick<WorkTicket, 'assigneeId' | 'assigneeName'>, viewer?: TicketViewer): string {
  if (!ticket.assigneeId) return 'Chưa phân công'
  const name = person(ticket.assigneeName, ticket.assigneeId)
  return viewer && isMine(ticket, viewer) ? `${name} (bạn)` : name
}

/** One sentence: what happens next and who does it, from the viewer's point of view. */
export function nextStepText(ticket: WorkTicket, viewer: TicketViewer): string {
  const mine = isMine(ticket, viewer)
  const who = person(ticket.assigneeName, ticket.assigneeId)
  if (ticket.type === 'INCIDENT') {
    if (ticket.status === 'OPEN' && viewer.canWrite) return 'Đọc báo cáo của khách bên dưới, rồi chọn nhân viên kiểm tra máy.'
    if (ticket.status === 'IN_PROGRESS' && mine) return 'Kiểm tra máy theo báo cáo của khách, xong thì bấm “Hoàn tất” và ghi lại đã thấy gì, đã làm gì. Hoàn tất phiếu không hoàn tiền cho khách.'
  }
  if (mine && hasRestockLines(ticket)) {
    if (ticket.status === 'ASSIGNED') return 'Khi tới máy, mở “Thực hiện nạp hàng” và làm theo từng bước: bắt đầu phiếu, mở cửa nạp, rút hộp hỏng, nạp theo dòng, đóng cửa nạp, đối chiếu.'
    if (ticket.status === 'IN_PROGRESS') return 'Tiếp tục ở “Thực hiện nạp hàng”: phiếu chỉ hoàn tất được sau khi đóng cửa nạp và đối chiếu số hộp.'
  }
  switch (ticket.status) {
    case 'OPEN': return viewer.canWrite ? 'Chọn nhân viên phụ trách để giao phiếu.' : 'Phiếu chưa có người phụ trách; quản trị viên sẽ phân công.'
    case 'ASSIGNED': return mine ? 'Khi tới máy, bấm “Bắt đầu” để báo bạn đang làm phiếu này.' : `Chờ ${who} bắt đầu tại máy.`
    case 'IN_PROGRESS': return mine ? 'Làm xong việc tại máy thì bấm “Hoàn tất” và ghi lại đã làm gì.' : `${who} đang thực hiện tại máy.`
    case 'COMPLETED': return 'Phiếu đã hoàn tất, không còn bước nào.'
    case 'CANCELLED': return 'Phiếu đã hủy, không còn bước nào.'
    default: return 'Trạng thái phiếu chưa có mô tả. Hãy báo quản trị viên kiểm tra.'
  }
}

/** Active ticket whose due time has passed (display hint only). */
export function isOverdue(ticket: Pick<WorkTicket, 'status' | 'dueAt'>, now = Date.now()): boolean {
  if (!ticket.dueAt || isClosed(ticket)) return false
  const due = Date.parse(ticket.dueAt)
  return Number.isFinite(due) && due < now
}

// ---- history of a ticket

export interface TicketStep { key: 'created' | 'assigned' | 'started' | 'completed' | 'cancelled'; label: string; at: string; by: string; note?: string }

/** Steps in order with who and when; absent steps are left out. "Phân công" is the latest (re)assignment. */
export function ticketSteps(ticket: WorkTicket): TicketStep[] {
  const steps: TicketStep[] = [{ key: 'created', label: 'Tạo phiếu', at: formatDateTime(ticket.createdAt), by: person(ticket.createdByName, ticket.createdById) }]
  if (ticket.assignedAt) steps.push({ key: 'assigned', label: 'Phân công', at: formatDateTime(ticket.assignedAt), by: person(ticket.assignedByName, ticket.assignedById), note: ticket.assigneeId ? `Giao cho ${person(ticket.assigneeName, ticket.assigneeId)}` : undefined })
  if (ticket.startedAt) steps.push({ key: 'started', label: 'Bắt đầu', at: formatDateTime(ticket.startedAt), by: person(ticket.startedByName, ticket.startedById) })
  if (ticket.status === 'COMPLETED' || ticket.completedAt) steps.push({ key: 'completed', label: 'Hoàn tất', at: formatDateTime(ticket.completedAt), by: person(ticket.completedByName, ticket.completedById), note: ticket.completionNote?.trim() || undefined })
  if (ticket.status === 'CANCELLED' || ticket.cancelledAt) steps.push({ key: 'cancelled', label: 'Hủy', at: formatDateTime(ticket.cancelledAt), by: person(ticket.cancelledByName, ticket.cancelledById), note: ticket.cancelReason?.trim() ? `Lý do: ${ticket.cancelReason.trim()}` : undefined })
  return steps
}

// ---- INCIDENT tickets (FE 8.3)

export type TicketIncident = NonNullable<WorkTicket['incidentReport']>
/** Vietnamese label of a customer report type (same labels as the public form, SRS 3.6.4). */
export function incidentTypeLabel(type: string | undefined | null): string {
  return INCIDENT_TYPES.find(option => option.value === type)?.label ?? (type || 'Sự cố khác')
}
/** Small line under a ticket title in the list: where the ticket came from. */
export function ticketOrigin(ticket: Pick<WorkTicket, 'type' | 'alertId'> & Partial<Pick<WorkTicket, 'incidentReport'>>): string {
  if (ticket.type === 'INCIDENT') return ticket.incidentReport?.reportCode ? `từ báo cáo ${ticket.incidentReport.reportCode}` : 'từ báo cáo của khách'
  return ticket.alertId ? 'từ cảnh báo' : ''
}
/**
 * A photo link the page may render: only an absolute https URL (signed by the server), or http on localhost for
 * development; anything else (javascript:, data:, relative) is dropped.
 */
export function safePhotoUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return url.toString()
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.toString()
  } catch { /* not a URL */ }
  return null
}

// ---- forms

export const TICKET_LIMITS = { title: 200, description: 1000, note: 500, reason: 500 } as const

export interface TicketValues {
  type: TicketType | ''; machineId: string; title: string; description: string
  /** `<input type="datetime-local">`, Vietnam time; optional. */
  dueAt: string
  alertId: string; assigneeId: string
  [key: string]: string
}
export const NEW_TICKET: TicketValues = { type: '', machineId: '', title: '', description: '', dueAt: '', alertId: '', assigneeId: '' }

/** Client-side checks before POST /work-tickets (the server checks again). */
export function validateTicket(values: TicketValues, now = Date.now()): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!values.type) errors.type = 'Chọn loại phiếu.'
  else if (!(CREATABLE_TICKET_TYPES as readonly string[]).includes(values.type)) errors.type = 'Phiếu sự cố chỉ được tạo tự động từ báo cáo của khách. Chọn Nạp hàng hoặc Bảo trì.'
  if (!uuidParam(values.machineId)) errors.machineId = 'Chọn máy cần làm việc.'
  const title = values.title.trim()
  if (!title) errors.title = 'Nhập tiêu đề ngắn cho công việc.'
  else if (title.length > TICKET_LIMITS.title) errors.title = `Tối đa ${TICKET_LIMITS.title} ký tự.`
  if (values.description.trim().length > TICKET_LIMITS.description) errors.description = `Tối đa ${TICKET_LIMITS.description} ký tự.`
  if (values.dueAt) {
    const due = localDateTimeToInstant(values.dueAt)
    if (!due) errors.dueAt = 'Thời hạn không hợp lệ.'
    else if (Date.parse(due) <= now) errors.dueAt = 'Thời hạn phải ở tương lai.'
  }
  if (values.assigneeId && !uuidParam(values.assigneeId)) errors.assigneeId = 'Chọn lại nhân viên phụ trách.'
  return errors
}

/** Body of POST /work-tickets: required fields, and each optional field only when it is filled in. */
export function createTicketBody(values: TicketValues): CreateWorkTicketBody {
  const body: CreateWorkTicketBody = { type: values.type as CreatableTicketType, machineId: values.machineId, title: values.title.trim() }
  const description = values.description.trim()
  if (description) body.description = description
  const dueAt = values.dueAt ? localDateTimeToInstant(values.dueAt) : undefined
  if (dueAt) body.dueAt = dueAt
  if (uuidParam(values.alertId)) body.alertId = values.alertId
  if (uuidParam(values.assigneeId)) body.assigneeId = values.assigneeId
  return body
}

/** Body of POST /complete: the note only when there is one (blank is the same as none). */
export function completeBody(note: string): CompleteWorkTicketBody {
  const text = note.trim()
  return text ? { note: text } : {}
}
/** Body of POST /cancel, or the field error when the reason is missing or too long. */
export function cancelBody(reason: string): { body?: CancelWorkTicketBody; error?: string } {
  const text = reason.trim()
  if (!text) return { error: 'Nhập lý do hủy để mọi người biết vì sao phiếu không làm nữa.' }
  if (text.length > TICKET_LIMITS.reason) return { error: `Tối đa ${TICKET_LIMITS.reason} ký tự.` }
  return { body: { reason: text } }
}

/** "Mở phiếu" from an alert: same machine, the alert id, a restock for stock alerts and maintenance otherwise. */
export function ticketFromAlert(alert: Pick<Alert, 'id' | 'type' | 'machineId' | 'machineCode' | 'slotCode'>): TicketValues {
  const restock = alert.type === 'LOW_STOCK' || alert.type === 'PRODUCT_EXPIRED' || alert.type === 'PRODUCT_EXPIRING'
  const where = `máy ${alert.machineCode}${alert.slotCode ? `, ngăn ${alert.slotCode}` : ''}`
  return {
    ...NEW_TICKET, type: restock ? 'RESTOCK' : 'MAINTENANCE', machineId: alert.machineId, alertId: alert.id,
    title: `${alertTypeLabel(alert.type)} · ${where}`.slice(0, TICKET_LIMITS.title), description: alertTypeHint(alert.type),
  }
}

// ---- errors of an action

export type TicketScreen = 'list' | 'detail'
const RELOADED: Record<TicketScreen, string> = { list: 'Danh sách đã được tải lại', detail: 'Trang đã được tải lại' }
const CONFLICT_TEXT: Record<TicketAction, string> = {
  assign: 'Phiếu này đã được bắt đầu, hoàn tất hoặc hủy nên không phân công lại được nữa.',
  start: 'Phiếu này không còn ở trạng thái chờ bắt đầu (có thể đã được đổi người, bắt đầu hoặc hủy).',
  complete: 'Phiếu này không còn ở trạng thái đang thực hiện (có thể đã hoàn tất hoặc bị hủy).',
  cancel: 'Phiếu này đã hoàn tất hoặc đã hủy trước đó nên không hủy được nữa.',
}
const NOT_ASSIGNEE = 'Phiếu này không còn giao cho bạn nên bạn không thực hiện bước này được. Hãy hỏi quản trị viên.'
const RESTOCK_NOTE_REQUIRED = 'Số hộp đã nạp khác kế hoạch của phiếu: ghi lý do để quản trị viên đối chiếu (hoặc làm theo màn “Thực hiện nạp hàng”).'

/**
 * The error a dialog shows for a failed action: a 409 (state changed meanwhile) and, for start/complete, a 403 (the
 * ticket was given to someone else) are explained in Vietnamese with what to do next; other errors keep their message.
 */
export function ticketActionError(error: unknown, action: TicketAction, screen: TicketScreen = 'list'): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) return new ApiError(409, `${CONFLICT_TEXT[action]} ${RELOADED[screen]}; xem trạng thái mới nhất.`, error.fieldErrors)
  if (error.status === 403 && (action === 'start' || action === 'complete')) return new ApiError(403, NOT_ASSIGNEE, error.fieldErrors)
  // FE 7.2: a RESTOCK ticket whose loaded bowls differ from its plan needs a note (rule of POST /complete).
  if (error.status === 400 && action === 'complete' && /differs from planned/i.test(error.fieldErrors.note ?? '')) {
    return new ApiError(400, error.message, { ...error.fieldErrors, note: RESTOCK_NOTE_REQUIRED })
  }
  return error
}
/** Errors after which retrying the same dialog cannot help: close it and reload the screen. */
export function isStale(error: unknown, action: TicketAction): boolean {
  return error instanceof ApiError && (error.status === 409 || (error.status === 403 && (action === 'start' || action === 'complete')))
}
