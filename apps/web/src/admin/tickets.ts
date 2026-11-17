// Rules of screen O3 "Phiếu công việc" (FE 7.1) that do not need React, unit-tested in tests/tickets.test.mjs.
// API: /work-orders of api-contract/api.yaml (backend #66, docs/work-orders.md). Lifecycle OPEN → ASSIGNED → IN_PROGRESS
// → DONE, CANCELLED from any unfinished status; statuses are the `ticket` domain of src/lib/status.ts. A work order is
// never deleted. WORK_ORDER_MANAGE creates, edits, assigns, unassigns and cancels; WORK_ORDER_EXECUTE starts, adds notes
// and completes: the assignee, or a manager (Admin) acting for them (BR-29). WORK_ORDER_READ_ALL lists everyone's work
// orders (GET /work-orders), everyone else lists their own (GET /work-orders/me). The server decides what is visible
// (someone else's work order is 404); the web only uses the viewer's id and permissions to decide which buttons to show.
// Edit, assign, unassign and cancel send the `version` last read: a stale one is 409 STALE_VERSION and the screen reloads.
import { ApiError } from '../api/client.ts'
import type {
  Alert, CancelWorkOrderBody, CompleteWorkOrderBody, CreateWorkOrderBody, MyWorkOrderQuery, UpdateWorkOrderBody, WorkOrder, WorkOrderEvent,
  WorkOrderListQuery, WorkOrderPriority, WorkOrderSource, WorkOrderStatus, WorkOrderType,
} from '../api/resources.ts'
import { formatDateTime, localDateTimeToInstant } from '../lib/format.ts'
import { statusMeta } from '../lib/status.ts'
import { oneOf, uuidParam } from '../lib/table-query.ts'
import { errorCode } from './form-error.ts'
import { alertTypeHint, alertTypeLabel } from './alerts.ts'
import { reportTypeLabel } from '../features/incident/incident.ts'

/** Same order as the `ticket` domain of STATUS_CATALOG (and the lifecycle). */
export const TICKET_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const satisfies readonly WorkOrderStatus[]
export type TicketStatus = WorkOrderStatus
export const TICKET_TYPES = ['RESTOCK', 'MAINTENANCE', 'INCIDENT'] as const satisfies readonly WorkOrderType[]
export type TicketType = WorkOrderType
/** Every type can be created by hand (source MANUAL); INCIDENT also comes from customer reports. */
export const CREATABLE_TICKET_TYPES = TICKET_TYPES
export type CreatableTicketType = TicketType

export const TICKET_TYPE_LABELS: Readonly<Record<TicketType, string>> = { RESTOCK: 'Nạp hàng', MAINTENANCE: 'Bảo trì', INCIDENT: 'Sự cố' }
/** Options of the "Loại" filter of the list. */
export const TICKET_TYPE_OPTIONS = TICKET_TYPES.map(type => ({ value: type, label: TICKET_TYPE_LABELS[type] }))
/** Options of the "Tạo phiếu" form. */
export const CREATABLE_TICKET_TYPE_OPTIONS = TICKET_TYPE_OPTIONS
export function ticketTypeLabel(type: string | undefined): string {
  return type && Object.hasOwn(TICKET_TYPE_LABELS, type) ? TICKET_TYPE_LABELS[type as TicketType] : (type || 'Phiếu')
}

/** Most urgent first, as the server sorts. */
export const TICKET_PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const satisfies readonly WorkOrderPriority[]
export const PRIORITY_LABELS: Readonly<Record<WorkOrderPriority, string>> = { URGENT: 'Khẩn cấp', HIGH: 'Cao', NORMAL: 'Bình thường', LOW: 'Thấp' }
export const PRIORITY_OPTIONS = TICKET_PRIORITIES.map(priority => ({ value: priority, label: PRIORITY_LABELS[priority] }))
export const priorityLabel = (priority: string | undefined) => PRIORITY_LABELS[priority as WorkOrderPriority] ?? (priority || 'Bình thường')

export const TICKET_SOURCES = ['MANUAL', 'ALERT', 'SCHEDULE', 'CUSTOMER_REPORT'] as const satisfies readonly WorkOrderSource[]
export const SOURCE_LABELS: Readonly<Record<WorkOrderSource, string>> = {
  MANUAL: 'Tạo thủ công', ALERT: 'Từ cảnh báo', SCHEDULE: 'Theo lịch bảo trì', CUSTOMER_REPORT: 'Từ phản ánh của khách',
}
export const SOURCE_OPTIONS = TICKET_SOURCES.map(source => ({ value: source, label: SOURCE_LABELS[source] }))
export const sourceLabel = (source: string | undefined) => SOURCE_LABELS[source as WorkOrderSource] ?? (source || '—')

// ---- list filters (URL)

/** Every filter of GET /work-orders. GET /work-orders/me only takes status and overdue. */
export const TICKET_FILTER_KEYS = ['status', 'type', 'source', 'priority', 'machineId', 'assigneeId', 'overdue'] as const
export const MY_TICKET_FILTER_KEYS = ['status', 'overdue'] as const
export type TicketFilterKey = typeof TICKET_FILTER_KEYS[number]

/**
 * The status filter in the URL. Absent ('') is the default "Chưa xong": GET sends status=OPEN&status=ASSIGNED&status=IN_PROGRESS,
 * because the server sorts by priority, due time, then oldest first without looking at the status, so old finished work
 * orders would otherwise push a work order just assigned to a later page. `status=ALL` sends no status (every status).
 */
export const TICKET_STATUS_ALL = 'ALL'
export const UNFINISHED_TICKET_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] as const satisfies readonly WorkOrderStatus[]
export const TICKET_STATUS_DEFAULT_LABEL = 'Chưa xong'
/** Options of the status select besides the default "Chưa xong" (value ''): "Tất cả", then each status in lifecycle order. */
export const TICKET_STATUS_FILTER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: TICKET_STATUS_ALL, label: 'Tất cả' },
  ...TICKET_STATUSES.map(value => ({ value, label: statusMeta('ticket', value).label })),
]

export interface TicketFilters {
  status: TicketStatus | typeof TICKET_STATUS_ALL | ''; type: TicketType | ''; source: WorkOrderSource | ''; priority: WorkOrderPriority | ''
  machineId: string; assigneeId: string; overdue: '' | 'true'; page: number
}

/** Filters from the URL; values the contract would reject with a 400 (unknown enum, non-UUID id) are dropped. */
export function readTicketFilters(params: URLSearchParams): TicketFilters {
  const page = Number(params.get('page') ?? '')
  return {
    status: oneOf(params.get('status'), [TICKET_STATUS_ALL, ...TICKET_STATUSES]) as TicketFilters['status'],
    type: oneOf(params.get('type'), TICKET_TYPES) as TicketFilters['type'],
    source: oneOf(params.get('source'), TICKET_SOURCES) as TicketFilters['source'],
    priority: oneOf(params.get('priority'), TICKET_PRIORITIES) as TicketFilters['priority'],
    machineId: uuidParam((params.get('machineId') ?? '').trim()),
    assigneeId: uuidParam((params.get('assigneeId') ?? '').trim()),
    overdue: params.get('overdue') === 'true' ? 'true' : '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 0,
  }
}

/** `status` of the GET query: the unfinished statuses by default, none for "Tất cả", else the one chosen. */
export function ticketStatusQuery(status: TicketFilters['status']): WorkOrderStatus[] | undefined {
  if (status === TICKET_STATUS_ALL) return undefined
  return status ? [status] : [...UNFINISHED_TICKET_STATUSES]
}

/** Query of GET /work-orders (WORK_ORDER_READ_ALL): only parameters of the contract, absent when not in effect. No sort: the order is fixed. */
export function ticketListQuery(filters: TicketFilters, size: number): WorkOrderListQuery {
  return {
    page: filters.page, size,
    status: ticketStatusQuery(filters.status), type: filters.type || undefined, source: filters.source || undefined,
    priority: filters.priority || undefined, machineId: filters.machineId || undefined, assigneeId: filters.assigneeId || undefined,
    overdue: filters.overdue ? true : undefined,
  }
}
/** Query of GET /work-orders/me: status and overdue only (other filters do not exist there). */
export function myTicketQuery(filters: TicketFilters, size: number): MyWorkOrderQuery {
  return { page: filters.page, size, status: ticketStatusQuery(filters.status), overdue: filters.overdue ? true : undefined }
}
/** Filters shown (and counted) on the screen: everything for READ_ALL, status and overdue for "my" work orders. */
export function ticketFilterKeys(readAll: boolean): readonly TicketFilterKey[] {
  return readAll ? TICKET_FILTER_KEYS : MY_TICKET_FILTER_KEYS
}

// ---- links

export const TICKETS_PATH = '/admin/tickets'
export function ticketPath(ticketId: string | undefined): string {
  return ticketId ? `/admin/tickets/${encodeURIComponent(ticketId)}` : TICKETS_PATH
}

// ---- availability

/** `missing`: the backend answers 404/405/501 on the list (an older backend without work orders). */
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
  /** WORK_ORDER_READ_ALL: lists everyone's work orders. */
  canReadAll: boolean
  /** WORK_ORDER_MANAGE: creates, edits, assigns, unassigns, cancels; may also execute for the assignee (Admin). */
  canWrite: boolean
  /** WORK_ORDER_EXECUTE: starts, adds notes, completes. */
  canExecute: boolean
}
export type TicketAction = 'assign' | 'unassign' | 'start' | 'complete' | 'cancel' | 'edit' | 'note'
/**
 * A next step offered for a work order: one of the actions run through a dialog, or `restock`, the link to the
 * step-by-step restock screen (FE 7.2) that replaces Bắt đầu / Hoàn tất for a RESTOCK work order (it starts it, takes the
 * old bowls out, loads per line, closes the refill gates and completes with the variance reasons).
 */
export type TicketNextAction = 'assign' | 'unassign' | 'start' | 'complete' | 'cancel' | 'restock'

type Who = Pick<WorkOrder, 'assignee'>
export function isMine(ticket: Who, viewer: Pick<TicketViewer, 'userId'>): boolean {
  return !!viewer.userId && ticket.assignee?.id === viewer.userId
}
export function isClosed(ticket: Pick<WorkOrder, 'status'>): boolean {
  return ticket.status === 'DONE' || ticket.status === 'CANCELLED'
}
/** The viewer may start / note / complete: holds WORK_ORDER_EXECUTE and is the assignee, or a manager acting for them. */
export function mayExecute(ticket: Who, viewer: TicketViewer): boolean {
  return viewer.canExecute && (isMine(ticket, viewer) || viewer.canWrite)
}
/** RESTOCK work order: carried out on the restock screen (lines, loads, refill gates, variances). */
export function isRestock(ticket: Partial<Pick<WorkOrder, 'type'>>): boolean {
  return ticket.type === 'RESTOCK'
}
/** Kept for the restock screen: a RESTOCK work order with at least one planned line. */
export function hasRestockLines(ticket: Partial<Pick<WorkOrder, 'type' | 'restockSummary'>>): boolean {
  return isRestock(ticket) && (ticket.restockSummary?.lines ?? 0) > 0
}

/**
 * The buttons a viewer gets: only the valid next step(s) of the lifecycle for these permissions, assignment first, then
 * progress, cancel last. OPEN/ASSIGNED/IN_PROGRESS → assign (manager; reassignment keeps IN_PROGRESS); ASSIGNED →
 * unassign (manager); ASSIGNED → start and IN_PROGRESS → complete (assignee, or a manager acting for them); anything
 * unfinished → cancel (manager). For RESTOCK the start / complete become one `restock` link. Never a delete.
 */
export function nextActions(ticket: Pick<WorkOrder, 'status' | 'assignee'> & Partial<Pick<WorkOrder, 'type'>>, viewer: TicketViewer): TicketNextAction[] {
  const actions: TicketNextAction[] = []
  const status = ticket.status
  const executes = mayExecute(ticket, viewer) && !!ticket.assignee
  if (executes && (status === 'ASSIGNED' || status === 'IN_PROGRESS')) {
    actions.push(isRestock(ticket) ? 'restock' : status === 'ASSIGNED' ? 'start' : 'complete')
  }
  if (viewer.canWrite && (status === 'OPEN' || status === 'ASSIGNED' || status === 'IN_PROGRESS')) actions.push('assign')
  if (viewer.canWrite && status === 'ASSIGNED') actions.push('unassign')
  if (viewer.canWrite && !isClosed({ status })) actions.push('cancel')
  return actions
}

export function actionLabel(action: TicketNextAction | TicketAction, ticket: Pick<WorkOrder, 'status'>): string {
  if (action === 'assign') return ticket.status === 'OPEN' ? 'Phân công' : 'Đổi người phụ trách'
  return {
    unassign: 'Bỏ phân công', start: 'Bắt đầu', complete: 'Hoàn tất', cancel: 'Hủy phiếu', restock: 'Thực hiện nạp hàng',
    edit: 'Sửa phiếu', note: 'Thêm ghi chú',
  }[action]
}

const person = (user: WorkOrder['assignee'] | null | undefined, fallback = 'Không rõ người thực hiện') =>
  user?.fullName?.trim() || (user?.id ? `Tài khoản …${user.id.slice(-8)}` : fallback)
export function assigneeText(ticket: Who, viewer?: Pick<TicketViewer, 'userId'>): string {
  if (!ticket.assignee?.id) return 'Chưa phân công'
  const name = person(ticket.assignee)
  return viewer && isMine(ticket, viewer) ? `${name} (bạn)` : name
}
/** Who created it: a person, or the system (alert, schedule, customer report). */
export function creatorText(ticket: Pick<WorkOrder, 'createdBy' | 'source'>): string {
  return ticket.createdBy?.id ? person(ticket.createdBy) : `Hệ thống (${sourceLabel(ticket.source).toLowerCase()})`
}

/** One sentence: what happens next and who does it, from the viewer's point of view. */
export function nextStepText(ticket: WorkOrder, viewer: TicketViewer): string {
  const mine = isMine(ticket, viewer)
  const executes = mayExecute(ticket, viewer)
  const who = person(ticket.assignee)
  if (isRestock(ticket) && executes && !isClosed(ticket) && ticket.assignee) {
    if (ticket.status === 'ASSIGNED') return `Khi tới máy, mở “Thực hiện nạp hàng” và làm theo từng bước: bắt đầu phiếu, rút hộp cũ, nạp theo dòng, đóng cổng nạp, đối chiếu.${mine ? '' : ` Bạn đang làm thay ${who}.`}`
    if (ticket.status === 'IN_PROGRESS') return 'Tiếp tục ở “Thực hiện nạp hàng”: phiếu chỉ hoàn tất được khi mọi cổng nạp đã đóng và dòng lệch kế hoạch có lý do.'
  }
  if (ticket.type === 'INCIDENT' && ticket.status === 'IN_PROGRESS' && executes) {
    return 'Kiểm tra máy theo phản ánh của khách, xong thì bấm “Hoàn tất” và ghi kết quả. Hoàn tất phiếu không hoàn tiền cho khách.'
  }
  switch (ticket.status) {
    case 'OPEN': return viewer.canWrite ? 'Chọn nhân viên phụ trách để giao phiếu.' : 'Phiếu chưa có người phụ trách; quản trị viên sẽ phân công.'
    case 'ASSIGNED': return executes ? `Khi tới máy, bấm “Bắt đầu”${ticket.type === 'INCIDENT' ? '' : ': máy chuyển sang Bảo trì và ngừng bán'}.${mine ? '' : ` Bạn đang làm thay ${who}.`}` : `Chờ ${who} bắt đầu tại máy.`
    case 'IN_PROGRESS': return executes ? 'Làm xong việc tại máy thì bấm “Hoàn tất” và ghi kết quả (bắt buộc).' : `${who} đang thực hiện tại máy.`
    case 'DONE': return 'Phiếu đã hoàn tất, không còn bước nào. Máy vẫn ở Bảo trì cho tới khi quản trị viên bật lại.'
    case 'CANCELLED': return 'Phiếu đã hủy, không còn bước nào.'
    default: return 'Trạng thái phiếu chưa có mô tả. Hãy báo quản trị viên kiểm tra.'
  }
}

/** Overdue as the server says (unfinished and past its due time). */
export function isOverdue(ticket: Pick<WorkOrder, 'overdue' | 'status'>): boolean {
  return !!ticket.overdue && !isClosed(ticket)
}

// ---- history of a work order (GET /work-orders/{id}/events)

const EVENT_LABELS: Readonly<Record<NonNullable<WorkOrderEvent['type']>, string>> = {
  CREATED: 'Tạo phiếu', ASSIGNED: 'Phân công', UNASSIGNED: 'Bỏ phân công', STARTED: 'Bắt đầu', COMPLETED: 'Hoàn tất',
  CANCELLED: 'Hủy phiếu', UPDATED: 'Sửa phiếu', NOTE: 'Ghi chú', OVERDUE: 'Quá hạn',
}
export interface TicketStep { key: string; label: string; at: string; by: string; note?: string }

/** One row per history event, oldest first, with who (or the system) and the note. */
export function ticketSteps(events: readonly WorkOrderEvent[]): TicketStep[] {
  return events.map((event, index) => ({
    key: event.id ?? String(index),
    label: EVENT_LABELS[event.type as keyof typeof EVENT_LABELS] ?? event.type ?? 'Sự kiện',
    at: formatDateTime(event.createdAt),
    by: event.actor?.id ? person(event.actor) : 'Hệ thống',
    note: event.note?.trim() || undefined,
  }))
}

// ---- customer reports of an INCIDENT work order (FE 8.3, linkedReports)

/** Vietnamese label of a customer report type (same labels as the public form). */
export function incidentTypeLabel(type: string | undefined | null): string {
  return reportTypeLabel(type)
}
/** Small line under a title in the list: where the work order came from. */
export function ticketOrigin(ticket: Pick<WorkOrder, 'source' | 'code'>): string {
  return ticket.source && ticket.source !== 'MANUAL' ? sourceLabel(ticket.source).toLowerCase() : ''
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

export const TICKET_LIMITS = { title: 200, description: 2000, note: 2000, reason: 500 } as const

export interface TicketValues {
  type: TicketType | ''; machineId: string; title: string; description: string; priority: WorkOrderPriority | ''
  /** `<input type="datetime-local">`, Vietnam time; optional. */
  dueAt: string
  assigneeId: string
  [key: string]: string
}
export const NEW_TICKET: TicketValues = { type: '', machineId: '', title: '', description: '', priority: 'NORMAL', dueAt: '', assigneeId: '' }

function checkDue(values: Pick<TicketValues, 'dueAt'>, now: number, errors: Record<string, string>) {
  if (!values.dueAt) return
  const due = localDateTimeToInstant(values.dueAt)
  if (!due) errors.dueAt = 'Thời hạn không hợp lệ.'
  else if (Date.parse(due) <= now) errors.dueAt = 'Thời hạn phải ở tương lai.'
}

/** Client-side checks before POST /work-orders (the server checks again). A RESTOCK from suggestions needs no title. */
export function validateTicket(values: TicketValues, now = Date.now(), fromSuggestions = false): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!values.type) errors.type = 'Chọn loại phiếu.'
  if (!uuidParam(values.machineId)) errors.machineId = 'Chọn máy cần làm việc.'
  const title = values.title.trim()
  if (!title && !fromSuggestions) errors.title = 'Nhập tiêu đề ngắn cho công việc.'
  else if (title.length > TICKET_LIMITS.title) errors.title = `Tối đa ${TICKET_LIMITS.title} ký tự.`
  if (values.description.trim().length > TICKET_LIMITS.description) errors.description = `Tối đa ${TICKET_LIMITS.description} ký tự.`
  checkDue(values, now, errors)
  if (values.assigneeId && !uuidParam(values.assigneeId)) errors.assigneeId = 'Chọn lại nhân viên phụ trách.'
  return errors
}

/** Body of POST /work-orders: required fields, and each optional field only when it is filled in. */
export function createTicketBody(values: TicketValues): CreateWorkOrderBody {
  const body: CreateWorkOrderBody = { type: values.type as TicketType, machineId: values.machineId, title: values.title.trim() }
  const description = values.description.trim()
  if (description) body.description = description
  if (values.priority) body.priority = values.priority
  const dueAt = values.dueAt ? localDateTimeToInstant(values.dueAt) : undefined
  if (dueAt) body.dueAt = dueAt
  if (uuidParam(values.assigneeId)) body.assigneeId = values.assigneeId
  return body
}

/** Body of POST /machines/{id}/restock-work-orders: fromSuggestions and the optional fields that are filled in. */
export function restockFromSuggestionsBody(values: TicketValues) {
  const body: { fromSuggestions: true; title?: string; priority?: WorkOrderPriority; assigneeId?: string; dueAt?: string } = { fromSuggestions: true }
  const title = values.title.trim()
  if (title) body.title = title
  if (values.priority) body.priority = values.priority
  if (uuidParam(values.assigneeId)) body.assigneeId = values.assigneeId
  const dueAt = values.dueAt ? localDateTimeToInstant(values.dueAt) : undefined
  if (dueAt) body.dueAt = dueAt
  return body
}

/** `datetime-local` value (Vietnam time) of an instant, for editing a due time. */
export function localInputOf(instant: string | null | undefined): string {
  const ms = Date.parse(instant ?? '')
  return Number.isFinite(ms) ? new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16) : ''
}
export interface EditValues { title: string; description: string; priority: WorkOrderPriority | ''; dueAt: string; [key: string]: string }
export function editValues(ticket: WorkOrder): EditValues {
  return { title: ticket.title ?? '', description: ticket.description ?? '', priority: ticket.priority ?? 'NORMAL', dueAt: localInputOf(ticket.dueAt) }
}
/**
 * Body of PATCH /work-orders/{id}: the version and only the changed fields (description "" clears it); `undefined` when
 * nothing changed. Field errors are thrown by the caller from validateEdit.
 */
export function updateTicketBody(ticket: WorkOrder, values: EditValues): UpdateWorkOrderBody | undefined {
  const body: UpdateWorkOrderBody = { version: ticket.version ?? 0 }
  const title = values.title.trim()
  if (title && title !== ticket.title) body.title = title
  const description = values.description.trim()
  if (description !== (ticket.description ?? '').trim()) body.description = description
  if (values.priority && values.priority !== ticket.priority) body.priority = values.priority
  const due = values.dueAt ? localDateTimeToInstant(values.dueAt) : undefined
  if (due && due !== ticket.dueAt && localInputOf(due) !== localInputOf(ticket.dueAt)) body.dueAt = due
  return Object.keys(body).length > 1 ? body : undefined
}
export function validateEdit(values: EditValues, now = Date.now(), current?: string | null): Record<string, string> {
  const errors: Record<string, string> = {}
  const title = values.title.trim()
  if (!title) errors.title = 'Tiêu đề không được để trống.'
  else if (title.length > TICKET_LIMITS.title) errors.title = `Tối đa ${TICKET_LIMITS.title} ký tự.`
  if (values.description.trim().length > TICKET_LIMITS.description) errors.description = `Tối đa ${TICKET_LIMITS.description} ký tự.`
  // An unchanged due time may already be in the past; only a new one must be in the future.
  if (values.dueAt && values.dueAt !== localInputOf(current)) checkDue(values, now, errors)
  return errors
}

/** Body of POST /complete: the result note is mandatory. */
export function completeBody(note: string): { body?: CompleteWorkOrderBody; error?: string } {
  const text = note.trim()
  if (!text) return { error: 'Ghi kết quả: đã làm gì tại máy (bắt buộc).' }
  if (text.length > TICKET_LIMITS.note) return { error: `Tối đa ${TICKET_LIMITS.note} ký tự.` }
  return { body: { resultNote: text } }
}
/** Body of POST /cancel (reason and version), or the field error when the reason is missing or too long. */
export function cancelBody(reason: string, version: number | undefined): { body?: CancelWorkOrderBody; error?: string } {
  const text = reason.trim()
  if (!text) return { error: 'Nhập lý do hủy để mọi người biết vì sao phiếu không làm nữa.' }
  if (text.length > TICKET_LIMITS.reason) return { error: `Tối đa ${TICKET_LIMITS.reason} ký tự.` }
  return { body: { reason: text, version: version ?? 0 } }
}
/** Text of a note (POST /notes), or the error. */
export function noteText(note: string): { note?: string; error?: string } {
  const text = note.trim()
  if (!text) return { error: 'Nhập nội dung ghi chú.' }
  if (text.length > TICKET_LIMITS.note) return { error: `Tối đa ${TICKET_LIMITS.note} ký tự.` }
  return { note: text }
}

/** "Mở phiếu" from an alert: same machine, a restock for stock alerts and maintenance otherwise (POST /alerts/{id}/work-orders sets the rest). */
export function ticketFromAlert(alert: Pick<Alert, 'id' | 'type' | 'machineId' | 'machineCode' | 'slotCode'>): TicketValues {
  const restock = alert.type === 'LOW_STOCK' || alert.type === 'PRODUCT_EXPIRED' || alert.type === 'PRODUCT_EXPIRING'
  const where = `máy ${alert.machineCode}${alert.slotCode ? `, ngăn ${alert.slotCode}` : ''}`
  return {
    ...NEW_TICKET, type: restock ? 'RESTOCK' : 'MAINTENANCE', machineId: alert.machineId ?? '',
    title: `${alertTypeLabel(alert.type)} · ${where}`.slice(0, TICKET_LIMITS.title), description: alertTypeHint(alert.type),
  }
}

// ---- errors of an action

/** Code of a business 409 (`CODE: message`), or undefined. */
export { errorCode }

export type TicketScreen = 'list' | 'detail'
export const STALE_TEXT = 'Phiếu vừa bị người khác thay đổi, đã tải lại'
const RELOADED: Record<TicketScreen, string> = { list: 'Danh sách đã được tải lại', detail: 'Trang đã được tải lại' }
const CONFLICT_TEXT: Record<TicketAction, string> = {
  assign: 'Phiếu này đã hoàn tất hoặc đã hủy nên không phân công lại được nữa.',
  unassign: 'Phiếu này không còn ở trạng thái Đã phân công (có thể đã được bắt đầu hoặc hủy).',
  start: 'Phiếu này không còn ở trạng thái chờ bắt đầu (có thể đã được đổi người, bắt đầu hoặc hủy).',
  complete: 'Phiếu này không còn ở trạng thái đang thực hiện (có thể đã hoàn tất hoặc bị hủy).',
  cancel: 'Phiếu này đã hoàn tất hoặc đã hủy trước đó nên không hủy được nữa.',
  edit: 'Phiếu này đã hoàn tất hoặc đã hủy nên không sửa được nữa.',
  note: 'Phiếu này đã hoàn tất hoặc đã hủy nên không ghi chú thêm được.',
}
/** 409 codes that explain why the step cannot run now; retrying later can help, so the dialog stays open. */
const BLOCKERS: Readonly<Record<string, string>> = {
  MACHINE_INACTIVE: 'Máy đang Ngừng hoạt động nên không bắt đầu được. Nhờ quản trị viên bật máy (Hoạt động hoặc Bảo trì) rồi thử lại.',
  MACHINE_HAS_ACTIVE_ORDERS: 'Máy còn đơn của khách đang chờ thanh toán hoặc đang nhả hàng. Chờ tối đa 5 phút rồi bấm lại “Bắt đầu”.',
  MACHINE_COMMAND_IN_PROGRESS: 'Máy đang chạy một lệnh (nhả hàng hoặc bảo trì). Chờ lệnh đó xong rồi thử lại.',
  RESTOCK_WITHOUT_LINES: 'Phiếu nạp hàng chưa có dòng nạp (ngăn, sản phẩm, số hộp) nên chưa bắt đầu được. Nhờ quản trị viên lập kế hoạch nạp.',
  REFILL_GATE_OPEN: 'Còn ngăn đang mở cổng nạp. Đóng hết cổng nạp ở màn Thực hiện nạp hàng rồi hoàn tất.',
  RESTOCK_VARIANCE_REASON_REQUIRED: 'Có dòng nạp khác kế hoạch mà chưa có lý do. Ghi lý do cho từng dòng lệch ở màn Thực hiện nạp hàng.',
}
const NOT_YOURS = 'Phiếu này không còn giao cho bạn nên bạn không thực hiện bước này được. Hãy hỏi quản trị viên.'

/**
 * The error a dialog shows for a failed action. STALE_VERSION and other state changes (409) are explained with "đã tải
 * lại"; known blockers (machine busy, gates open…) say what to do; a 404 on start/complete/note means the work order is
 * no longer the caller's. Other errors keep their message.
 */
export function ticketActionError(error: unknown, action: TicketAction, screen: TicketScreen = 'list'): unknown {
  if (!(error instanceof ApiError)) return error
  const code = errorCode(error)
  if (error.status === 409 && code && BLOCKERS[code]) return new ApiError(409, BLOCKERS[code], error.fieldErrors)
  if (error.status === 409 && code === 'STALE_VERSION') return new ApiError(409, `${STALE_TEXT}. Xem nội dung mới nhất rồi thao tác lại.`, error.fieldErrors)
  if (error.status === 409) return new ApiError(409, `${CONFLICT_TEXT[action]} ${RELOADED[screen]}; xem trạng thái mới nhất.`, error.fieldErrors)
  if ((error.status === 404 || error.status === 403) && (action === 'start' || action === 'complete' || action === 'note')) return new ApiError(error.status, NOT_YOURS, error.fieldErrors)
  if (error.status === 400 && action === 'assign' && Object.keys(error.fieldErrors).length === 0) {
    return new ApiError(400, 'Người được chọn không nhận phiếu được (tài khoản không hoạt động hoặc thiếu quyền thực hiện phiếu). Chọn người khác.', error.fieldErrors)
  }
  return error
}
/** Errors after which retrying the same dialog cannot help: close it and reload the screen. */
export function isStale(error: unknown, action: TicketAction): boolean {
  if (!(error instanceof ApiError)) return false
  const code = errorCode(error)
  if (error.status === 409) return !(code && BLOCKERS[code])
  return (error.status === 404 || error.status === 403) && (action === 'start' || action === 'complete' || action === 'note')
}
