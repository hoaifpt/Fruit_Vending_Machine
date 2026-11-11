// Rules of screen O2 "Cảnh báo" and the alert bell (FE 6.3) that do not need React, unit-tested in tests/alerts.test.mjs.
// API: draft contract api-contract/drafts/alerts.yaml, waiting for backend issue 3.6 (names follow the entity Alert and
// the enums AlertType, AlertSeverity, AlertStatus). Until 3.6 ships, the real backend answers 404 on /alerts: the screen
// says there is no data yet and the bell hides itself without polling again (alertsAvailability).
import { ApiError } from '../api/client.ts'
import type { Alert, AlertListQuery, ResolveAlertBody } from '../api/resources.ts'
import { dateRangeToInstants, formatDateTime } from '../lib/format.ts'
import { formatSort, oneOf, parseSort, uuidParam } from '../lib/table-query.ts'
import type { SortRule, SortState } from '../lib/table-query.ts'

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const
export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const
/** Same order as the Java enum AlertType. */
export const ALERT_TYPES = ['HIGH_TEMPERATURE', 'LOW_TEMPERATURE', 'HIGH_HUMIDITY', 'MACHINE_OFFLINE', 'PRODUCT_EXPIRED', 'PRODUCT_EXPIRING', 'DISPENSE_FAILED', 'LOW_STOCK'] as const
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
}
/** Next step on site for each type (detail screen). */
export const ALERT_TYPE_HINTS: Readonly<Record<AlertType, string>> = {
  HIGH_TEMPERATURE: 'Kiểm tra cửa máy và hệ thống làm lạnh. Hộp nằm ngoài ngưỡng nhiệt lâu có thể phải rút khỏi ngăn.',
  LOW_TEMPERATURE: 'Kiểm tra cài đặt làm lạnh của máy; trái cây có thể bị đông lạnh.',
  HIGH_HUMIDITY: 'Kiểm tra gioăng cửa và khay nước ngưng của máy.',
  MACHINE_OFFLINE: 'Kiểm tra nguồn điện và mạng của máy. Máy mất kết nối không bán được hàng.',
  PRODUCT_EXPIRED: 'Rút hộp hết hạn khỏi ngăn trên màn Tồn kho; hộp hết hạn ở đáy ngăn chặn cả ngăn.',
  PRODUCT_EXPIRING: 'Ưu tiên bán hoặc lên kế hoạch rút hộp trước khi hết hạn.',
  DISPENSE_FAILED: 'Kiểm tra ngăn tại máy, xem đơn liên quan và đối soát hoàn tiền cho khách nếu cần.',
  LOW_STOCK: 'Nạp thêm hộp vào ngăn trên màn Tồn kho.',
}
export function alertTypeLabel(type: string | undefined): string {
  return type && Object.hasOwn(ALERT_TYPE_LABELS, type) ? ALERT_TYPE_LABELS[type as AlertType] : (type || 'Cảnh báo')
}
export function alertTypeHint(type: string | undefined): string {
  return type && Object.hasOwn(ALERT_TYPE_HINTS, type) ? ALERT_TYPE_HINTS[type as AlertType] : 'Kiểm tra máy và xử lý theo nội dung cảnh báo.'
}

// ---- list filters (URL)

/** The only sort `GET /alerts` approves. */
export const ALERT_SORT_RULE: SortRule = { fields: ['triggeredAt'], fallback: 'triggeredAt,desc' }
export const ALERT_FILTER_KEYS = ['status', 'severity', 'type', 'machineId', 'from', 'to'] as const

export interface AlertFilters {
  status: typeof ALERT_STATUSES[number] | ''; severity: typeof ALERT_SEVERITIES[number] | ''; type: AlertType | ''
  machineId: string; from: string; to: string; sort: SortState; page: number
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
    sort: parseSort(params.get('sort'), ALERT_SORT_RULE),
    page: Number.isSafeInteger(page) && page > 0 ? page : 0,
  }
}

/** Query of GET /alerts: only parameters of the draft contract, absent when not in effect. */
export function alertListQuery(filters: AlertFilters, size: number): AlertListQuery {
  const range = dateRangeToInstants(filters.from, filters.to)
  return {
    page: filters.page, size, sort: formatSort(filters.sort),
    status: filters.status || undefined, severity: filters.severity || undefined, type: filters.type || undefined,
    machineId: filters.machineId || undefined, triggeredFrom: range.from, triggeredTo: range.to,
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

// ---- availability of the draft endpoints

/**
 * `missing`: the backend has not shipped BE 3.6 (404 on the path, or 405/501), so there is nothing to show and no reason
 * to ask again. On the detail screen a 404 may also be an unknown id; the screen says both. `forbidden`/`unauthorized`
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
 * GET /alerts/{id} answered 404: the id is unknown, or the whole endpoint is not there (backend before 3.6). The client
 * drops the server message of a 404, so the detail screen asks the list once (`listProbe` is that answer's error, or
 * undefined when it worked): a 404 there too means the feature is missing; anything else reads as "not found".
 */
export type DetailFailure = 'missing' | 'not-found'
export function detailFailure(listProbe: unknown): DetailFailure {
  return listProbe !== undefined && alertsAvailability(listProbe) === 'missing' ? 'missing' : 'not-found'
}
export const ALERT_NOT_FOUND = 'Không tìm thấy cảnh báo này: đường dẫn có thể đã sai hoặc cảnh báo không còn tồn tại. Mở lại từ danh sách cảnh báo hoặc từ chuông thông báo.'
export const ALERTS_MISSING = 'Chưa có dữ liệu cảnh báo: máy chủ chưa cung cấp chức năng cảnh báo. Các màn khác vẫn dùng dữ liệu thật; trạng thái máy xem ở màn Máy bán hàng.'

// ---- actions

export type AlertAction = 'acknowledge' | 'resolve'
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
    acknowledge: 'Cảnh báo này vừa được người khác xác nhận hoặc đóng nên không xác nhận được nữa. Danh sách đã được tải lại; xem người xử lý ở cột Trạng thái.',
    resolve: 'Cảnh báo này đã được đóng trước đó nên không đóng lại được. Danh sách đã được tải lại; xem người đã đóng ở cột Trạng thái.',
  },
  detail: {
    acknowledge: 'Cảnh báo này vừa được người khác xác nhận hoặc đóng nên không xác nhận được nữa. Trang đã được tải lại; xem người xử lý ở mục Xử lý.',
    resolve: 'Cảnh báo này đã được đóng trước đó nên không đóng lại được. Trang đã được tải lại; xem người đã đóng ở mục Xử lý.',
  },
}
/**
 * The error a dialog shows for a failed action: a 409 (state changed meanwhile) is explained in Vietnamese with what to
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

const person = (name: string | null | undefined, id: string | null | undefined) =>
  name?.trim() || (id ? `Tài khoản …${id.slice(-8)}` : 'Không rõ người thực hiện')

/** Steps of an alert in order: raised, acknowledged (who, when), closed (who, when, note). Absent steps are left out. */
export function handlingSteps(alert: Alert): HandlingStep[] {
  const steps: HandlingStep[] = [{ key: 'triggered', label: 'Phát sinh', at: formatDateTime(alert.triggeredAt) }]
  if (alert.acknowledgedAt) steps.push({ key: 'acknowledged', label: 'Xác nhận', at: formatDateTime(alert.acknowledgedAt), by: person(alert.acknowledgedByName, alert.acknowledgedById) })
  if (alert.status === 'RESOLVED' || alert.resolvedAt) {
    steps.push({ key: 'resolved', label: 'Đóng', at: formatDateTime(alert.resolvedAt), by: person(alert.resolvedByName, alert.resolvedById), note: alert.resolutionNote?.trim() || undefined })
  }
  return steps
}
/** One line per handling step after "raised", for the list: "Xác nhận: Nhân viên vận hành, 09/11/2026 13:05". */
export function handledByLines(alert: Alert): string[] {
  return handlingSteps(alert).filter(step => step.key !== 'triggered').map(step => `${step.label}: ${step.by}, ${step.at}`)
}

// ---- "Mở phiếu" (work tickets are FM7, backend 4.3)

/** Off until the work ticket screens (FE 7.1) and API (BE 4.3) exist; the button is shown disabled with the reason. */
export const TICKETS_AVAILABLE = false
export const TICKET_PENDING_TEXT = 'Chưa mở được phiếu công việc: chức năng phiếu sẽ có trong đợt cập nhật Phiếu công việc (FM7). Tạm thời hãy xác nhận cảnh báo và báo trực tiếp cho người phụ trách.'

// ---- bell

/** Poll every 30 s while the tab is visible. */
export const BELL_POLL_MS = 30_000
/** Newest open alerts listed in the bell. */
export const BELL_SIZE = 5
export const BELL_QUERY: AlertListQuery = { status: 'OPEN', page: 0, size: BELL_SIZE, sort: 'triggeredAt,desc' }
/**
 * Second, light request of each bell poll: how many CRITICAL alerts are open (its totalElements), so the bell turns red
 * even when the critical one is older than the five newest. The draft contract has no severity sort, hence a count.
 */
export const BELL_CRITICAL_QUERY: AlertListQuery = { status: 'OPEN', severity: 'CRITICAL', page: 0, size: 1, sort: 'triggeredAt,desc' }

/** Alerts of this poll the bell has not seen before; none on the first load (nothing is "new" yet). */
export function freshAlerts(seen: ReadonlySet<string> | null, latest: readonly Alert[]): Alert[] {
  if (!seen) return []
  return latest.filter(alert => !!alert.id && !seen.has(alert.id))
}

/** Polite announcement for screen readers when new alerts arrive ('' when there is nothing new). */
export function bellAnnouncement(fresh: readonly Alert[], listFull: boolean): string {
  if (!fresh.length) return ''
  const first = fresh[0]
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
