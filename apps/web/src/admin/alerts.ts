// Rules of screen O2 "Cảnh báo" and the alert bell (FE 6.3) that do not need React, unit-tested in tests/alerts.test.mjs.
// API: GET/POST /alerts of api-contract/api.yaml (backend #58, docs/alerts.md); names follow the backend enums AlertType,
// AlertSeverity and AlertStatus. The list has no sort parameter (CRITICAL, WARNING, INFO, then newest first) and without
// `status` returns only the alerts not yet RESOLVED; `status` selects exactly one status. A backend without the path
// (404) still reads as "no data yet" and stops the bell (alertsAvailability).
import { ApiError } from '../api/client.ts'
import type { Alert, AlertListQuery, CreateWorkOrderFromAlertBody, ResolveAlertBody } from '../api/resources.ts'
import { dateRangeToInstants, formatDateTime, localDateTimeToInstant } from '../lib/format.ts'
import { oneOf, uuidParam } from '../lib/table-query.ts'

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const
export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const
/** Same order as the Java enum AlertType. */
export const ALERT_TYPES = ['HIGH_TEMPERATURE', 'LOW_TEMPERATURE', 'HIGH_HUMIDITY', 'MACHINE_OFFLINE', 'PRODUCT_EXPIRED', 'PRODUCT_EXPIRING', 'DISPENSE_FAILED', 'LOW_STOCK', 'HARDWARE_FAULT'] as const
export type AlertType = typeof ALERT_TYPES[number]

/** What happened, in the operator's words (the title comes from the backend as is). */
export const ALERT_TYPE_LABELS: Readonly<Record<AlertType, string>> = {
  HIGH_TEMPERATURE: 'Nhiệt độ cao',
  LOW_TEMPERATURE: 'Nhiệt độ thấp',
  HIGH_HUMIDITY: 'Độ ẩm cao',
  MACHINE_OFFLINE: 'Máy mất kết nối',
  PRODUCT_EXPIRED: 'Hộp hết hạn',
  PRODUCT_EXPIRING: 'Hộp sắp hết hạn',
  DISPENSE_FAILED: 'Nhả hàng thất bại',
  LOW_STOCK: 'Ngăn sắp hết hàng',
  HARDWARE_FAULT: 'Lỗi phần cứng',
}
/** Next step on site for each type (detail screen). */
export const ALERT_TYPE_HINTS: Readonly<Record<AlertType, string>> = {
  HIGH_TEMPERATURE: 'Kiểm tra cửa máy và hệ thống làm lạnh. Hộp nằm ngoài ngưỡng nhiệt lâu có thể phải rút khỏi ngăn.',
  LOW_TEMPERATURE: 'Kiểm tra cài đặt làm lạnh của máy; trái cây có thể bị đông lạnh.',
  HIGH_HUMIDITY: 'Kiểm tra gioăng cửa và khay nước ngưng của máy.',
  MACHINE_OFFLINE: 'Kiểm tra nguồn điện và mạng của máy. Máy mất kết nối không nhận được lệnh nhả hàng.',
  PRODUCT_EXPIRED: 'Rút hộp hết hạn khỏi ngăn trên màn Tồn kho; hộp hết hạn ở đáy ngăn chặn cả ngăn.',
  PRODUCT_EXPIRING: 'Ưu tiên bán hoặc lên kế hoạch rút hộp trước khi hết hạn.',
  DISPENSE_FAILED: 'Kiểm tra ngăn tại máy (mã lỗi bên dưới cho biết lý do), rồi đối soát đơn và hoàn tiền cho khách nếu cần.',
  LOW_STOCK: 'Nạp thêm hộp vào ngăn trên màn Tồn kho.',
  HARDWARE_FAULT: 'Xem mã lỗi bên dưới và kiểm tra máy tại chỗ (cửa, cảm biến, dây nối). Máy thường đã chuyển sang bảo trì; chỉ bật bán lại khi đã xử lý xong.',
}
export function alertTypeLabel(type: string | undefined): string {
  return type && Object.hasOwn(ALERT_TYPE_LABELS, type) ? ALERT_TYPE_LABELS[type as AlertType] : (type || 'Cảnh báo')
}
export function alertTypeHint(type: string | undefined): string {
  return type && Object.hasOwn(ALERT_TYPE_HINTS, type) ? ALERT_TYPE_HINTS[type as AlertType] : 'Kiểm tra máy và xử lý theo nội dung cảnh báo.'
}

// ---- list filters (URL)

/**
 * Filters kept on the URL. `status` empty is the backend default: every alert not closed yet (OPEN and ACKNOWLEDGED).
 * The API has no "every status" value, so closed alerts are listed on their own with status=RESOLVED.
 */
export const ALERT_FILTER_KEYS = ['status', 'severity', 'type', 'machineId', 'from', 'to'] as const
/** Label of the empty status option: what the list shows without a status. */
export const ALERT_DEFAULT_STATUS_LABEL = 'Chưa đóng (đang mở và đã tiếp nhận)'

export interface AlertFilters {
  status: typeof ALERT_STATUSES[number] | ''; severity: typeof ALERT_SEVERITIES[number] | ''; type: AlertType | ''
  machineId: string; from: string; to: string; page: number
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dateParam = (value: string | null) => (value && DATE.test(value) ? value : '')

/** Filters from the URL; values the contract would reject with a 400 (unknown enum, non-UUID machine) are dropped. */
export function readAlertFilters(params: URLSearchParams): AlertFilters {
  const page = Number(params.get('page') ?? '')
  return {
    status: oneOf(params.get('status'), ALERT_STATUSES) as AlertFilters['status'],
    severity: oneOf(params.get('severity'), ALERT_SEVERITIES) as AlertFilters['severity'],
    type: oneOf(params.get('type'), ALERT_TYPES) as AlertFilters['type'],
    machineId: uuidParam((params.get('machineId') ?? '').trim()),
    from: dateParam(params.get('from')), to: dateParam(params.get('to')),
    page: Number.isSafeInteger(page) && page > 0 ? page : 0,
  }
}

/** "Đến ngày" before "Từ ngày": the backend would answer 400 (to must be after from), so the end date is not sent. */
export function alertRangeInvalid(filters: Pick<AlertFilters, 'from' | 'to'>): boolean {
  return !!filters.from && !!filters.to && filters.to < filters.from
}

/** Query of GET /alerts: only parameters of the contract (never `sort`), absent when not in effect. */
export function alertListQuery(filters: AlertFilters, size: number): AlertListQuery {
  const range = dateRangeToInstants(filters.from, alertRangeInvalid(filters) ? '' : filters.to)
  return {
    page: filters.page, size,
    status: filters.status || undefined, severity: filters.severity || undefined, type: filters.type || undefined,
    machineId: filters.machineId || undefined, from: range.from, to: range.to,
  }
}

// ---- links

export const ALERTS_PATH = '/admin/alerts'
export const OPEN_ALERTS_PATH = '/admin/alerts?status=OPEN'
export function alertPath(alertId: string | undefined): string {
  return alertId ? `/admin/alerts/${encodeURIComponent(alertId)}` : ALERTS_PATH
}
export function machinePath(machineId: string | undefined): string {
  const id = uuidParam(machineId ?? '')
  return id ? `/admin/machines/${id}` : ''
}
/** Work order handling the alert (workOrderId of the response); the work order screens live at /admin/tickets/{id}. */
export function workOrderPath(workOrderId: string | null | undefined): string {
  const id = uuidParam(workOrderId ?? '')
  return id ? `/admin/tickets/${id}` : ''
}

// ---- availability

/**
 * `missing`: the backend has no alerts path (404 on the path, or 405/501), so there is nothing to show and no reason to
 * ask again. On the detail screen a 404 may also be an unknown id; the screen says both. `forbidden`/`unauthorized`
 * stop the bell too. Anything else is an ordinary failure, retried by the next poll.
 */
export type AlertsAvailability = 'missing' | 'forbidden' | 'unauthorized' | 'error'
export function alertsAvailability(error: unknown): AlertsAvailability {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 404 || status === 405 || status === 501) return 'missing'
  if (status === 403) return 'forbidden'
  if (status === 401) return 'unauthorized'
  return 'error'
}
/**
 * GET /alerts/{id} answered 404: the id is unknown, or the whole endpoint is not there. The client drops the server
 * message of a 404, so the detail screen asks the list once (`listProbe` is that answer's error, or undefined when it
 * worked): a 404 there too means the feature is missing; anything else reads as "not found".
 */
export type DetailFailure = 'missing' | 'not-found'
export function detailFailure(listProbe: unknown): DetailFailure {
  return listProbe !== undefined && alertsAvailability(listProbe) === 'missing' ? 'missing' : 'not-found'
}
export const ALERT_NOT_FOUND = 'Không tìm thấy cảnh báo này: đường dẫn có thể đã sai hoặc cảnh báo không còn tồn tại. Mở lại từ danh sách cảnh báo hoặc từ chuông thông báo.'
export const ALERTS_MISSING = 'Chưa có dữ liệu cảnh báo: máy chủ chưa cung cấp chức năng cảnh báo. Các màn khác vẫn dùng dữ liệu thật; trạng thái máy xem ở màn Máy bán hàng.'

// ---- actions

export type AlertAction = 'acknowledge' | 'resolve'
/** Only OPEN is offered (acknowledging an ACKNOWLEDGED alert again is accepted by the backend but changes nothing). */
export function canAcknowledge(alert: Pick<Alert, 'status'>): boolean { return alert.status === 'OPEN' }
export function canResolve(alert: Pick<Alert, 'status'>): boolean { return alert.status === 'OPEN' || alert.status === 'ACKNOWLEDGED' }

export const RESOLUTION_NOTE_MAX = 500
/** Body of POST /alerts/{id}/resolve: the note only when there is one (blank is the same as none). */
export function resolveBody(note: string): ResolveAlertBody {
  const text = note.trim()
  return text ? { note: text } : {}
}

/** Where the action was taken: the list (status column) or the detail screen ("Xử lý" section). */
export type AlertScreen = 'list' | 'detail'
const CONFLICT_TEXT: Record<AlertScreen, Record<AlertAction, string>> = {
  list: {
    acknowledge: 'Cảnh báo này vừa được đóng (bởi người khác hoặc hệ thống) nên không xác nhận được nữa. Danh sách đã được tải lại; xem người xử lý ở cột Trạng thái.',
    resolve: 'Cảnh báo này đã được đóng trước đó nên không đóng lại được. Danh sách đã được tải lại; xem người đã đóng ở cột Trạng thái.',
  },
  detail: {
    acknowledge: 'Cảnh báo này vừa được đóng (bởi người khác hoặc hệ thống) nên không xác nhận được nữa. Trang đã được tải lại; xem người xử lý ở mục Xử lý.',
    resolve: 'Cảnh báo này đã được đóng trước đó nên không đóng lại được. Trang đã được tải lại; xem người đã đóng ở mục Xử lý.',
  },
}
/**
 * The error a dialog shows for a failed action: a 409 (alert already RESOLVED) is explained in Vietnamese with what to
 * do next, other errors keep their message (ApiError already turns 400 and 5xx into readable text).
 */
export function alertActionError(error: unknown, action: AlertAction, screen: AlertScreen = 'list'): unknown {
  if (error instanceof ApiError && error.status === 409) return new ApiError(409, CONFLICT_TEXT[screen][action], error.fieldErrors)
  return error
}
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

// ---- who handled it

export interface HandlingStep { key: 'triggered' | 'acknowledged' | 'resolved'; label: string; at: string; by?: string; note?: string }

/** acknowledgedBy / resolvedBy: the user's email, or "system" when the condition cleared by itself. */
export function actorText(actor: string | null | undefined): string {
  const value = actor?.trim()
  if (!value) return 'Không rõ người thực hiện'
  return value.toLowerCase() === 'system' ? 'Hệ thống (tự đóng khi sự cố hết)' : value
}
/** "Condition cleared" of a system resolution, in Vietnamese; any other note is shown as written. */
export function resolutionNoteText(note: string | null | undefined): string | undefined {
  const text = note?.trim()
  if (!text) return undefined
  return text === 'Condition cleared' ? 'Điều kiện gây cảnh báo đã hết.' : text
}

/** Steps of an alert in order: raised, acknowledged (who, when), closed (who, when, note). Absent steps are left out. */
export function handlingSteps(alert: Alert): HandlingStep[] {
  const steps: HandlingStep[] = [{ key: 'triggered', label: 'Phát sinh', at: formatDateTime(alert.triggeredAt) }]
  if (alert.acknowledgedAt) steps.push({ key: 'acknowledged', label: 'Xác nhận', at: formatDateTime(alert.acknowledgedAt), by: actorText(alert.acknowledgedBy) })
  if (alert.status === 'RESOLVED' || alert.resolvedAt) {
    steps.push({ key: 'resolved', label: 'Đóng', at: formatDateTime(alert.resolvedAt), by: actorText(alert.resolvedBy), note: resolutionNoteText(alert.resolutionNote) })
  }
  return steps
}
/** One line per handling step after "raised", for the list: "Xác nhận: staff@freshvend.test, 09/11/2026 13:05". */
export function handledByLines(alert: Alert): string[] {
  return handlingSteps(alert).filter(step => step.key !== 'triggered').map(step => `${step.label}: ${step.by}, ${step.at}`)
}

// ---- "Mở phiếu": POST /alerts/{alertId}/work-orders (WORK_ORDER_MANAGE)

/**
 * On: "Mở phiếu" opens the work-order form of the alert for accounts with WORK_ORDER_MANAGE. Set to false to show the
 * button disabled with TICKET_PENDING_TEXT instead.
 */
export const TICKETS_AVAILABLE: boolean = true
export const TICKET_PENDING_TEXT = 'Chưa mở được phiếu công việc: chức năng phiếu sẽ có trong đợt cập nhật Phiếu công việc (FM7). Tạm thời hãy xác nhận cảnh báo và báo trực tiếp cho người phụ trách.'
/** Shown instead of the button to accounts that may not open tickets (staff). */
export const TICKET_ADMIN_ONLY_TEXT = 'Phiếu công việc do quản trị viên mở. Nếu cần người tới máy xử lý, hãy báo quản trị viên.'

export const WORK_ORDER_TYPES = ['RESTOCK', 'MAINTENANCE', 'INCIDENT'] as const
export const WORK_ORDER_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
export type WorkOrderType = typeof WORK_ORDER_TYPES[number]
export type WorkOrderPriority = typeof WORK_ORDER_PRIORITIES[number]
export const WORK_ORDER_TYPE_LABELS: Readonly<Record<WorkOrderType, string>> = { RESTOCK: 'Nạp hàng', MAINTENANCE: 'Bảo trì', INCIDENT: 'Sự cố' }
export const WORK_ORDER_PRIORITY_LABELS: Readonly<Record<WorkOrderPriority, string>> = { LOW: 'Thấp', NORMAL: 'Bình thường', HIGH: 'Cao', URGENT: 'Khẩn cấp' }
export const WORK_ORDER_LIMITS = { title: 200, description: 1000 } as const

/** What the backend fills in when a field is left out: type from the alert type, priority from its severity. */
export function workOrderDefaults(alert: Pick<Alert, 'type' | 'severity'>): { type: WorkOrderType; priority: WorkOrderPriority } {
  const restock = alert.type === 'LOW_STOCK' || alert.type === 'PRODUCT_EXPIRED' || alert.type === 'PRODUCT_EXPIRING'
  const priority: WorkOrderPriority = alert.severity === 'CRITICAL' ? 'URGENT' : alert.severity === 'WARNING' ? 'HIGH' : 'NORMAL'
  return { type: restock ? 'RESTOCK' : 'MAINTENANCE', priority }
}

export type AlertWorkOrderValues = { type: string; title: string; description: string; priority: string; assigneeId: string; dueAt: string }
export const NEW_ALERT_WORK_ORDER: AlertWorkOrderValues = { type: '', title: '', description: '', priority: '', assigneeId: '', dueAt: '' }

/** Field errors of the form (empty when it can be sent). Every field is optional. */
export function validateAlertWorkOrder(values: AlertWorkOrderValues, now = Date.now()): Record<string, string> {
  const errors: Record<string, string> = {}
  if (values.title.trim().length > WORK_ORDER_LIMITS.title) errors.title = `Tối đa ${WORK_ORDER_LIMITS.title} ký tự.`
  if (values.description.trim().length > WORK_ORDER_LIMITS.description) errors.description = `Tối đa ${WORK_ORDER_LIMITS.description} ký tự.`
  if (values.dueAt) {
    const due = localDateTimeToInstant(values.dueAt)
    if (!due) errors.dueAt = 'Thời hạn không hợp lệ.'
    else if (Date.parse(due) <= now) errors.dueAt = 'Thời hạn phải ở tương lai.'
  }
  if (values.assigneeId && !uuidParam(values.assigneeId)) errors.assigneeId = 'Chọn lại nhân viên phụ trách.'
  return errors
}

/** Body of POST /alerts/{alertId}/work-orders: only the fields filled in (the backend fills the rest from the alert). */
export function alertWorkOrderBody(values: AlertWorkOrderValues): CreateWorkOrderFromAlertBody {
  const body: CreateWorkOrderFromAlertBody = {}
  if ((WORK_ORDER_TYPES as readonly string[]).includes(values.type)) body.type = values.type as WorkOrderType
  if ((WORK_ORDER_PRIORITIES as readonly string[]).includes(values.priority)) body.priority = values.priority as WorkOrderPriority
  const title = values.title.trim(), description = values.description.trim()
  if (title) body.title = title
  if (description) body.description = description
  const dueAt = values.dueAt ? localDateTimeToInstant(values.dueAt) : undefined
  if (dueAt) body.dueAt = dueAt
  if (uuidParam(values.assigneeId)) body.assigneeId = values.assigneeId
  return body
}

/**
 * A 409 of POST /alerts/{id}/work-orders in Vietnamese. The backend message starts with its code:
 * "ALERT_RESOLVED: the alert is already resolved" or "ALERT_ALREADY_HANDLED: the alert is handled by work order WO-… (uuid)".
 * Other errors are kept.
 */
export function workOrderError(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.status !== 409) return error
  if (/ALERT_ALREADY_HANDLED/.test(error.message) || !/resolved/i.test(error.message)) {
    const code = error.message.match(/work order (WO-[A-Z0-9-]+)/)?.[1]
    return new ApiError(409, `Cảnh báo này đã có phiếu công việc${code ? ` ${code}` : ''} chưa hoàn tất nên không mở thêm phiếu. Trang đã được tải lại; mở phiếu đó ở mục Xử lý.`, error.fieldErrors)
  }
  return new ApiError(409, 'Cảnh báo này đã được đóng nên không mở phiếu được nữa. Trang đã được tải lại.', error.fieldErrors)
}

// ---- bell

/** Poll every 30 s while the tab is visible. */
export const BELL_POLL_MS = 30_000
/** Open alerts listed in the bell, in the backend's order (CRITICAL first, then newest). */
export const BELL_SIZE = 5
export const BELL_QUERY: AlertListQuery = { status: 'OPEN', page: 0, size: BELL_SIZE }
/** Second, light request of each bell poll: how many CRITICAL alerts are open (its totalElements), for the bell's label. */
export const BELL_CRITICAL_QUERY: AlertListQuery = { status: 'OPEN', severity: 'CRITICAL', page: 0, size: 1 }

/** Alerts of this poll the bell has not seen before; none on the first load (nothing is "new" yet). */
export function freshAlerts(seen: ReadonlySet<string> | null, latest: readonly Alert[]): Alert[] {
  if (!seen) return []
  return latest.filter(alert => !!alert.id && !seen.has(alert.id))
}

/** Polite announcement for screen readers when new alerts arrive ('' when there is nothing new). */
export function bellAnnouncement(fresh: readonly Alert[], listFull: boolean): string {
  if (!fresh.length) return ''
  // The list is ordered by severity first: name the newest of the new ones.
  const first = [...fresh].sort((a, b) => (Date.parse(b.triggeredAt ?? '') || 0) - (Date.parse(a.triggeredAt ?? '') || 0))[0]
  const where = first.machineCode ? ` tại máy ${first.machineCode}` : ''
  const one = `${alertTypeLabel(first.type)}${where}`
  if (fresh.length === 1) return `Cảnh báo mới: ${one}.`
  return `${listFull && fresh.length >= BELL_SIZE ? 'Có ít nhất' : 'Có'} ${fresh.length} cảnh báo mới. Mới nhất: ${one}.`
}

export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count)
}
/** Accessible name of the bell button; it starts with the visible word and carries the visible count. */
export function bellLabel(count: number | undefined, critical = 0): string {
  if (count === undefined) return 'Cảnh báo'
  if (count <= 0) return 'Cảnh báo: không có cảnh báo đang mở'
  return critical > 0 ? `Cảnh báo: ${count} đang mở, ${critical} nghiêm trọng` : `Cảnh báo: ${count} đang mở`
}
