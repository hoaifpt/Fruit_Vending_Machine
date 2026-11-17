// Rules of screen O5 "Lịch bảo trì" (FE 7.3) that do not need React, unit-tested in tests/maintenance-schedules.test.mjs.
// API: /maintenance-plans of api-contract/api.yaml (backend #70, docs/maintenance-plans.md). A plan repeats a maintenance
// job at one machine every N days; the server keeps `nextDueDate` (a Vietnam calendar day), creates the MAINTENANCE work
// order `leadDays` before it (source SCHEDULE) and moves it after the work order is done (completion day + N) or cancelled
// (scheduled day + N). MAINTENANCE_PLAN_READ reads, MAINTENANCE_PLAN_MANAGE (ADMIN) changes; PATCH sends the `version`
// last read (stale → 409 STALE_VERSION). Plans are never deleted: they are deactivated and activated again.
// The calendar helpers below are shared with the revenue screens (business days in Vietnam).
import { ApiError } from '../api/client.ts'
import type { CreateMaintenancePlanBody, MaintenancePlan, MaintenancePlanListQuery, UpdateMaintenancePlanBody, WorkOrderPriority } from '../api/resources.ts'
import { oneOf, uuidParam } from '../lib/table-query.ts'
import { errorCode } from './form-error.ts'

const DAY_MS = 86_400_000
/** Asia/Ho_Chi_Minh is UTC+7 all year (no DST). */
const VIETNAM_OFFSET_MS = 7 * 3_600_000

export const PLAN_LIMITS = { title: 200, instructions: 2000, minInterval: 1, maxInterval: 365, maxLead: 30 } as const
/** A due date this many days away or closer is "sắp đến hạn". */
export const DUE_SOON_DAYS = 3
export const DEFAULT_DUE_TIME = '17:00'

// ---- calendar days in Vietnam (`YYYY-MM-DD`)

/** Whether `value` is a real calendar date `YYYY-MM-DD` (no 31/02). */
export function isDateString(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
}
/** The Vietnam calendar day of an instant (ms since epoch). */
export function vietnamDate(ms: number): string {
  return new Date(ms + VIETNAM_OFFSET_MS).toISOString().slice(0, 10)
}
/** The Vietnam calendar day of an ISO instant, or undefined. */
export function vietnamDateOf(instant: string | null | undefined): string | undefined {
  const ms = Date.parse(instant ?? '')
  return Number.isFinite(ms) ? vietnamDate(ms) : undefined
}
/** `date` plus `days` calendar days (crosses months, years and 29/02 correctly). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}
/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}
/** Start (00:00 Asia/Ho_Chi_Minh) of a Vietnam calendar day, as a UTC instant. */
export function dueInstant(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - VIETNAM_OFFSET_MS).toISOString()
}
/** `dd/MM/yyyy` of a calendar day (no time zone shift: it already is a Vietnam day). */
export function formatDay(date: string | null | undefined): string {
  return isDateString(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '—'
}

// ---- due state of a row

export type DueState = 'paused' | 'none' | 'overdue' | 'working' | 'today' | 'soon' | 'later'
export interface DueInfo { state: DueState; date?: string; days?: number }

/**
 * Where a plan stands as of `now`, from the server's nextDueDate and `overdue` (past due with no unfinished work order):
 * paused, overdue, past due but its work order is open ("working"), due today, soon (≤ DUE_SOON_DAYS days) or later.
 */
export function dueInfo(plan: Pick<MaintenancePlan, 'active' | 'nextDueDate' | 'overdue'>, now = Date.now()): DueInfo {
  if (!plan.active) return { state: 'paused' }
  const date = isDateString(plan.nextDueDate) ? plan.nextDueDate : undefined
  if (!date) return { state: 'none' }
  const days = daysBetween(vietnamDate(now), date)
  if (plan.overdue) return { state: 'overdue', date, days }
  if (days < 0) return { state: 'working', date, days }
  if (days === 0) return { state: 'today', date, days }
  return { state: days <= DUE_SOON_DAYS ? 'soon' : 'later', date, days }
}
/** Words for a due state (never colour alone). */
export function dueLabel(info: DueInfo): string {
  switch (info.state) {
    case 'paused': return 'Đã tắt'
    case 'none': return 'Chưa có ngày đến hạn'
    case 'overdue': return info.days !== undefined && info.days < 0 ? `Quá hạn ${-info.days} ngày, chưa có phiếu` : 'Quá hạn'
    case 'working': return `Quá hạn ${-(info.days ?? 0)} ngày · phiếu đang mở`
    case 'today': return 'Đến hạn hôm nay'
    case 'soon': return `Sắp đến hạn · còn ${info.days} ngày`
    case 'later': return `Còn ${info.days} ngày`
  }
}
export const intervalText = (days: number | undefined) => `Mỗi ${days ?? '—'} ngày`
export const leadText = (days: number | undefined) => (days ? `tạo phiếu trước ${days} ngày` : 'tạo phiếu đúng ngày đến hạn')

// ---- list filters (URL)

/** GET /maintenance-plans filters; the order is fixed by the server (next due date first). */
export const SCHEDULE_FILTER_KEYS = ['machineId', 'active'] as const
export const SCHEDULE_ACTIVE_OPTIONS = [{ value: 'true', label: 'Đang bật' }, { value: 'false', label: 'Đã tắt' }]

export interface ScheduleFilters { machineId: string; active: '' | 'true' | 'false'; page: number }

/** Filters from the URL; values the contract would reject with a 400 (non-UUID id, non-boolean) are dropped. */
export function readScheduleFilters(params: URLSearchParams): ScheduleFilters {
  const page = Number(params.get('page') ?? '')
  return {
    machineId: uuidParam((params.get('machineId') ?? '').trim()),
    active: oneOf(params.get('active'), ['true', 'false']) as ScheduleFilters['active'],
    page: Number.isSafeInteger(page) && page > 0 ? page : 0,
  }
}
/** Query of GET /maintenance-plans: only parameters of the contract (no sort), absent when not in effect. */
export function scheduleListQuery(filters: ScheduleFilters, size: number): MaintenancePlanListQuery {
  return { page: filters.page, size, machineId: filters.machineId || undefined, active: filters.active ? filters.active === 'true' : undefined }
}

export const SCHEDULES_PATH = '/admin/maintenance-schedules'

// ---- availability

/** `missing`: the backend has no maintenance plans (404 on the path, or 405/501). */
export type SchedulesAvailability = 'missing' | 'forbidden' | 'unauthorized' | 'error'
export function schedulesAvailability(error: unknown): SchedulesAvailability {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 404 || status === 405 || status === 501) return 'missing'
  if (status === 403) return 'forbidden'
  if (status === 401) return 'unauthorized'
  return 'error'
}
export const SCHEDULES_MISSING = 'Chưa có dữ liệu lịch bảo trì: máy chủ chưa cung cấp chức năng lịch bảo trì. Tạm thời hãy tạo phiếu bảo trì thủ công ở mục Phiếu công việc.'

// ---- form

export interface ScheduleValues {
  machineId: string; title: string; instructions: string
  /** Text of the number inputs, validated to integers. */
  intervalDays: string; leadDays: string
  /** `HH:mm`, local time in Vietnam. */
  dueTime: string
  priority: WorkOrderPriority | ''
  defaultAssigneeId: string
  /** `<input type="date">`: firstDueDate when creating (empty = today + interval), nextDueDate when editing. */
  dueDate: string
  [key: string]: string
}
export function newScheduleValues(): ScheduleValues {
  return { machineId: '', title: '', instructions: '', intervalDays: '', leadDays: '1', dueTime: DEFAULT_DUE_TIME, priority: 'NORMAL', defaultAssigneeId: '', dueDate: '' }
}
export function scheduleValues(plan: MaintenancePlan): ScheduleValues {
  return {
    machineId: plan.machineId ?? '', title: plan.title ?? '', instructions: plan.instructions ?? '', intervalDays: String(plan.intervalDays ?? ''),
    leadDays: String(plan.leadDays ?? 0), dueTime: plan.dueTime?.slice(0, 5) ?? DEFAULT_DUE_TIME, priority: plan.priority ?? 'NORMAL',
    defaultAssigneeId: plan.defaultAssignee?.id ?? '', dueDate: plan.nextDueDate ?? '',
  }
}

const integerIn = (raw: string, min: number, max: number): number | undefined => {
  const text = raw.trim()
  if (!/^\d{1,3}$/.test(text)) return undefined
  const value = Number(text)
  return value >= min && value <= max ? value : undefined
}
/** The interval as an integer 1..365, or undefined. */
export const parseInterval = (raw: string) => integerIn(raw, PLAN_LIMITS.minInterval, PLAN_LIMITS.maxInterval)
/** Days before the due date the work order is created: an integer 0..30, or undefined. */
export const parseLead = (raw: string) => integerIn(raw, 0, PLAN_LIMITS.maxLead)
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const PRIORITIES: readonly WorkOrderPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

/**
 * Client-side checks before POST / PATCH (the server checks again): machine (create), title, interval 1..365, lead 0..30
 * and below the interval, time HH:mm, a due day from today on (an unchanged one may already be past when editing).
 */
export function validateSchedule(values: ScheduleValues, now = Date.now(), current?: MaintenancePlan): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!current && !uuidParam(values.machineId)) errors.machineId = 'Chọn máy cần bảo trì.'
  const title = values.title.trim()
  if (!title) errors.title = 'Nhập tên công việc bảo trì, ví dụ “Vệ sinh khay nhả hàng”.'
  else if (title.length > PLAN_LIMITS.title) errors.title = `Tối đa ${PLAN_LIMITS.title} ký tự.`
  if (values.instructions.trim().length > PLAN_LIMITS.instructions) errors.instructions = `Tối đa ${PLAN_LIMITS.instructions} ký tự.`
  const interval = parseInterval(values.intervalDays)
  if (interval === undefined) errors.intervalDays = `Nhập số ngày nguyên từ ${PLAN_LIMITS.minInterval} đến ${PLAN_LIMITS.maxInterval}.`
  const lead = parseLead(values.leadDays)
  if (lead === undefined) errors.leadDays = `Nhập số ngày nguyên từ 0 đến ${PLAN_LIMITS.maxLead}.`
  else if (interval !== undefined && lead >= interval) errors.leadDays = 'Số ngày tạo phiếu trước phải nhỏ hơn chu kỳ.'
  if (!TIME.test(values.dueTime)) errors.dueTime = 'Chọn giờ hạn dạng HH:mm.'
  if (values.priority && !PRIORITIES.includes(values.priority)) errors.priority = 'Chọn mức ưu tiên.'
  if (values.defaultAssigneeId && !uuidParam(values.defaultAssigneeId)) errors.defaultAssigneeId = 'Chọn lại nhân viên nhận việc.'
  const unchanged = !!current && values.dueDate === current.nextDueDate
  if (current && !values.dueDate) errors.dueDate = 'Chọn ngày đến hạn kế tiếp.'
  else if (values.dueDate && !unchanged) {
    if (!isDateString(values.dueDate)) errors.dueDate = 'Ngày không hợp lệ.'
    else if (values.dueDate < vietnamDate(now)) errors.dueDate = 'Chọn từ hôm nay trở đi.'
  }
  return errors
}

/** Body of POST /maintenance-plans: required fields, optional ones only when filled in. */
export function createScheduleBody(values: ScheduleValues): CreateMaintenancePlanBody {
  const body: CreateMaintenancePlanBody = { machineId: values.machineId, title: values.title.trim(), intervalDays: parseInterval(values.intervalDays) ?? 0 }
  const instructions = values.instructions.trim()
  if (instructions) body.instructions = instructions
  const lead = parseLead(values.leadDays)
  if (lead !== undefined) body.leadDays = lead
  if (TIME.test(values.dueTime)) body.dueTime = values.dueTime
  if (values.priority) body.priority = values.priority
  if (uuidParam(values.defaultAssigneeId)) body.defaultAssigneeId = values.defaultAssigneeId
  if (isDateString(values.dueDate)) body.firstDueDate = values.dueDate
  return body
}

/**
 * Body of PATCH /maintenance-plans/{id}: the version and only what changed (the machine never does). Cleared instructions
 * are sent as "", a removed default assignee as clearDefaultAssignee: true. `undefined` when nothing changed.
 */
export function updateScheduleBody(plan: MaintenancePlan, values: ScheduleValues): UpdateMaintenancePlanBody | undefined {
  const body: UpdateMaintenancePlanBody = { version: plan.version ?? 0 }
  const title = values.title.trim()
  if (title && title !== plan.title) body.title = title
  const instructions = values.instructions.trim()
  if (instructions !== (plan.instructions ?? '').trim()) body.instructions = instructions
  const interval = parseInterval(values.intervalDays)
  if (interval !== undefined && interval !== plan.intervalDays) body.intervalDays = interval
  const lead = parseLead(values.leadDays)
  if (lead !== undefined && lead !== plan.leadDays) body.leadDays = lead
  if (TIME.test(values.dueTime) && values.dueTime !== plan.dueTime?.slice(0, 5)) body.dueTime = values.dueTime
  if (values.priority && values.priority !== plan.priority) body.priority = values.priority
  const assignee = uuidParam(values.defaultAssigneeId)
  if (assignee && assignee !== plan.defaultAssignee?.id) body.defaultAssigneeId = assignee
  else if (!assignee && plan.defaultAssignee?.id) body.clearDefaultAssignee = true
  if (isDateString(values.dueDate) && values.dueDate !== plan.nextDueDate) body.nextDueDate = values.dueDate
  return Object.keys(body).length > 1 ? body : undefined
}

/**
 * "Đến hạn" while typing a new plan: the chosen first due day, else today + interval (the server's default), and the day
 * its work order is created (due − lead). Undefined until the interval is valid.
 */
export function previewFirstDue(values: Pick<ScheduleValues, 'intervalDays' | 'leadDays' | 'dueDate'>, now = Date.now()): { due: string; createdOn: string; days: number } | undefined {
  const interval = parseInterval(values.intervalDays)
  if (interval === undefined) return undefined
  const today = vietnamDate(now)
  const due = isDateString(values.dueDate) ? values.dueDate : addDays(today, interval)
  const lead = parseLead(values.leadDays) ?? 0
  const createdOn = addDays(due, -lead)
  return { due, createdOn: createdOn < today ? today : createdOn, days: daysBetween(today, due) }
}

// ---- errors

export type ScheduleAction = 'create' | 'update' | 'deactivate' | 'activate' | 'generate'
export const PLAN_STALE = 'Lịch này vừa được người khác sửa. Danh sách đã được tải lại; mở lại lịch để xem nội dung mới nhất rồi sửa lại.'
const CONFLICTS: Readonly<Record<string, string>> = {
  STALE_VERSION: PLAN_STALE,
  MACHINE_INACTIVE: 'Máy đang Ngừng hoạt động nên không đặt lịch hay tạo phiếu được. Bật máy (Hoạt động hoặc Bảo trì) rồi thử lại.',
  MAINTENANCE_PLAN_INACTIVE: 'Lịch đang tắt nên không tạo phiếu được. Bật lại lịch trước.',
  PLAN_HAS_OPEN_WORK_ORDER: 'Lịch đang có phiếu bảo trì chưa xong. Hoàn tất hoặc hủy phiếu đó trước khi tạo phiếu mới.',
  OCCURRENCE_ALREADY_GENERATED: 'Lần đến hạn này đã có phiếu (có thể đã xong hoặc đã hủy). Lần sau hệ thống sẽ tự tạo phiếu.',
}

/** Vietnamese explanation of a 409 with the next step; a missing endpoint is explained; other errors keep their message. */
export function scheduleActionError(error: unknown, action: ScheduleAction): unknown {
  if (schedulesAvailability(error) === 'missing' && error instanceof ApiError && action !== 'generate') return new ApiError(error.status, SCHEDULES_MISSING)
  if (!(error instanceof ApiError) || error.status !== 409) return error
  const code = errorCode(error)
  if (code && CONFLICTS[code]) return new ApiError(409, CONFLICTS[code], error.fieldErrors)
  return new ApiError(409, 'Lịch vừa thay đổi ở nơi khác. Danh sách đã được tải lại; xem trạng thái mới nhất rồi thử lại.', error.fieldErrors)
}
/** Errors after which retrying the same dialog cannot help: close it and reload. */
export function isStaleSchedule(error: unknown, action: ScheduleAction): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false
  const code = errorCode(error)
  return code === 'STALE_VERSION' || action === 'deactivate' || action === 'activate' || action === 'generate'
}
