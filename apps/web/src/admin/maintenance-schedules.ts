// Rules of screen O5 "Lịch bảo trì" (FE 7.3) that do not need React, unit-tested in tests/maintenance-schedules.test.mjs.
// API: draft contract api-contract/drafts/maintenance-schedules.yaml, waiting for backend issue 4.5. A schedule repeats a
// maintenance job at one machine every N days; the server computes nextDueAt and the web only previews it with the same
// rule (nextDueDate) before saving. Schedules are never deleted: they are paused and resumed. The mock layer uses the
// same date functions, so the preview and the "server" answer agree.
import { ApiError } from '../api/client.ts'
import type { CreateMaintenanceScheduleBody, MaintenanceSchedule, MaintenanceScheduleListQuery, UpdateMaintenanceScheduleBody } from '../api/resources.ts'
import { formatSort, oneOf, parseSort, uuidParam } from '../lib/table-query.ts'
import type { SortRule, SortState } from '../lib/table-query.ts'

const DAY_MS = 86_400_000
/** Asia/Ho_Chi_Minh is UTC+7 all year (no DST). */
const VIETNAM_OFFSET_MS = 7 * 3_600_000

export const SCHEDULE_LIMITS = { title: 200, note: 1000, minInterval: 1, maxInterval: 365 } as const
/** A due date this many days away or closer is "sắp đến hạn". */
export const DUE_SOON_DAYS = 3

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
/** Start (00:00 Asia/Ho_Chi_Minh) of a Vietnam calendar day, as a UTC instant: the shape of nextDueAt. */
export function dueInstant(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - VIETNAM_OFFSET_MS).toISOString()
}

/**
 * The due date rule of the draft: next = base + N days; while it is before today, add N again (a schedule never starts
 * out overdue). `base` is the day of the last completion, else startDate. Same rule as the server.
 */
export function nextDueDate(base: string, intervalDays: number, today: string): string {
  const first = addDays(base, intervalDays)
  const behind = daysBetween(first, today)
  return behind > 0 ? addDays(first, Math.ceil(behind / intervalDays) * intervalDays) : first
}
/** The day the cycle counts from: the last completion's Vietnam day, else startDate. */
export function scheduleBase(schedule: Pick<MaintenanceSchedule, 'startDate' | 'lastCompletedAt'>): string {
  return vietnamDateOf(schedule.lastCompletedAt) ?? schedule.startDate
}

// ---- due state of a row

export type DueState = 'paused' | 'none' | 'overdue' | 'today' | 'soon' | 'later'
export interface DueInfo { state: DueState; date?: string; days?: number }

/**
 * Where a schedule stands as of `now`, from the server's nextDueAt (and its `overdue` flag): paused, overdue, due today,
 * soon (≤ DUE_SOON_DAYS days) or later. Display only; the server decides what is due.
 */
export function dueInfo(schedule: Pick<MaintenanceSchedule, 'active' | 'nextDueAt' | 'overdue'>, now = Date.now()): DueInfo {
  if (!schedule.active) return { state: 'paused' }
  const date = vietnamDateOf(schedule.nextDueAt)
  if (!date) return { state: 'none' }
  const days = daysBetween(vietnamDate(now), date)
  if (schedule.overdue || days < 0) return { state: 'overdue', date, days }
  if (days === 0) return { state: 'today', date, days }
  return { state: days <= DUE_SOON_DAYS ? 'soon' : 'later', date, days }
}
/** Words for a due state (never colour alone). */
export function dueLabel(info: DueInfo): string {
  switch (info.state) {
    case 'paused': return 'Tạm dừng'
    case 'none': return 'Chưa có ngày đến hạn'
    case 'overdue': return info.days !== undefined && info.days < 0 ? `Quá hạn ${-info.days} ngày` : 'Quá hạn'
    case 'today': return 'Đến hạn hôm nay'
    case 'soon': return `Sắp đến hạn · còn ${info.days} ngày`
    case 'later': return `Còn ${info.days} ngày`
  }
}
export const intervalText = (days: number) => `Mỗi ${days} ngày`

// ---- list filters (URL)

/** Sorts `GET /maintenance-schedules` approves: soonest due first by default (paused last), or creation time. */
export const SCHEDULE_SORT_RULE: SortRule = { fields: ['nextDueAt', 'createdAt'], fallback: 'nextDueAt,asc' }
export const SCHEDULE_FILTER_KEYS = ['machineId', 'active'] as const
export const SCHEDULE_ACTIVE_OPTIONS = [{ value: 'true', label: 'Đang chạy' }, { value: 'false', label: 'Tạm dừng' }]

export interface ScheduleFilters { machineId: string; active: '' | 'true' | 'false'; sort: SortState; page: number }

/** Filters from the URL; values the contract would reject with a 400 (non-UUID id, non-boolean) are dropped. */
export function readScheduleFilters(params: URLSearchParams): ScheduleFilters {
  const page = Number(params.get('page') ?? '')
  return {
    machineId: uuidParam((params.get('machineId') ?? '').trim()),
    active: oneOf(params.get('active'), ['true', 'false']) as ScheduleFilters['active'],
    sort: parseSort(params.get('sort'), SCHEDULE_SORT_RULE),
    page: Number.isSafeInteger(page) && page > 0 ? page : 0,
  }
}
/** Query of GET /maintenance-schedules: only parameters of the draft contract, absent when not in effect. */
export function scheduleListQuery(filters: ScheduleFilters, size: number): MaintenanceScheduleListQuery {
  return {
    page: filters.page, size, sort: formatSort(filters.sort),
    machineId: filters.machineId || undefined, active: filters.active ? filters.active === 'true' : undefined,
  }
}

export const SCHEDULES_PATH = '/admin/maintenance-schedules'

// ---- availability of the draft endpoints

/** `missing`: the backend has not shipped BE 4.5 (404 on the path, or 405/501). */
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
  machineId: string; title: string
  /** Text of the number input, validated to an integer 1..365. */
  intervalDays: string
  /** `<input type="date">`, a Vietnam calendar day. */
  startDate: string
  assigneeId: string; note: string
  [key: string]: string
}
export function newScheduleValues(now = Date.now()): ScheduleValues {
  return { machineId: '', title: '', intervalDays: '', startDate: vietnamDate(now), assigneeId: '', note: '' }
}
export function scheduleValues(schedule: MaintenanceSchedule): ScheduleValues {
  return {
    machineId: schedule.machineId, title: schedule.title, intervalDays: String(schedule.intervalDays), startDate: schedule.startDate,
    assigneeId: schedule.assigneeId ?? '', note: schedule.note ?? '',
  }
}

/** The interval as an integer 1..365, or undefined. */
export function parseInterval(raw: string): number | undefined {
  const text = raw.trim()
  if (!/^\d{1,3}$/.test(text)) return undefined
  const value = Number(text)
  return value >= SCHEDULE_LIMITS.minInterval && value <= SCHEDULE_LIMITS.maxInterval ? value : undefined
}

/** Client-side checks before POST / PATCH (the server checks again). */
export function validateSchedule(values: ScheduleValues): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!uuidParam(values.machineId)) errors.machineId = 'Chọn máy cần bảo trì.'
  const title = values.title.trim()
  if (!title) errors.title = 'Nhập tên công việc bảo trì, ví dụ “Vệ sinh khay nhả hàng”.'
  else if (title.length > SCHEDULE_LIMITS.title) errors.title = `Tối đa ${SCHEDULE_LIMITS.title} ký tự.`
  if (parseInterval(values.intervalDays) === undefined) errors.intervalDays = `Nhập số ngày nguyên từ ${SCHEDULE_LIMITS.minInterval} đến ${SCHEDULE_LIMITS.maxInterval}.`
  if (!isDateString(values.startDate)) errors.startDate = 'Chọn ngày tính chu kỳ.'
  if (values.note.trim().length > SCHEDULE_LIMITS.note) errors.note = `Tối đa ${SCHEDULE_LIMITS.note} ký tự.`
  if (values.assigneeId && !uuidParam(values.assigneeId)) errors.assigneeId = 'Chọn lại nhân viên phụ trách.'
  return errors
}

/** Body of POST /maintenance-schedules: required fields, optional ones only when filled in. */
export function createScheduleBody(values: ScheduleValues): CreateMaintenanceScheduleBody {
  const body: CreateMaintenanceScheduleBody = {
    machineId: values.machineId, title: values.title.trim(), intervalDays: parseInterval(values.intervalDays) ?? 0, startDate: values.startDate,
  }
  if (uuidParam(values.assigneeId)) body.assigneeId = values.assigneeId
  const note = values.note.trim()
  if (note) body.note = note
  return body
}

/**
 * Body of PATCH /maintenance-schedules/{id}: only the fields that changed (the machine never does). A removed assignee
 * or cleared note is sent as null, as the draft asks. Empty object when nothing changed.
 */
export function updateScheduleBody(schedule: MaintenanceSchedule, values: ScheduleValues): UpdateMaintenanceScheduleBody {
  const body: UpdateMaintenanceScheduleBody = {}
  const title = values.title.trim()
  if (title !== schedule.title) body.title = title
  const interval = parseInterval(values.intervalDays)
  if (interval !== undefined && interval !== schedule.intervalDays) body.intervalDays = interval
  if (values.startDate !== schedule.startDate) body.startDate = values.startDate
  const assignee = uuidParam(values.assigneeId) || null
  if (assignee !== (schedule.assigneeId ?? null)) body.assigneeId = assignee
  const note = values.note.trim() || null
  if (note !== (schedule.note?.trim() || null)) body.note = note
  return body
}

/**
 * "Đến hạn kế tiếp" while typing: the same rule as the server, from the form's interval and start date (or the last
 * completion when editing a schedule that has one). Undefined until both are valid.
 */
export function previewNextDue(values: Pick<ScheduleValues, 'intervalDays' | 'startDate'>, now = Date.now(), lastCompletedAt?: string | null): DueInfo | undefined {
  const interval = parseInterval(values.intervalDays)
  if (interval === undefined || !isDateString(values.startDate)) return undefined
  const today = vietnamDate(now)
  const date = nextDueDate(vietnamDateOf(lastCompletedAt) ?? values.startDate, interval, today)
  const days = daysBetween(today, date)
  return { state: days === 0 ? 'today' : days <= DUE_SOON_DAYS ? 'soon' : 'later', date, days }
}

// ---- errors

export type ScheduleAction = 'create' | 'update' | 'deactivate' | 'activate'

/**
 * Vietnamese explanation of a 409 with the next step; other errors (and a missing endpoint, explained by the caller)
 * keep their own message.
 */
export function scheduleActionError(error: unknown, action: ScheduleAction): unknown {
  if (schedulesAvailability(error) === 'missing' && error instanceof ApiError) return new ApiError(error.status, SCHEDULES_MISSING)
  if (!(error instanceof ApiError) || error.status !== 409) return error
  const text: Record<ScheduleAction, string> = {
    create: 'Máy này đã có một lịch đang chạy cùng tên. Đặt tên khác, hoặc sửa lịch đang có thay vì tạo mới.',
    update: 'Máy này đã có một lịch đang chạy khác cùng tên. Đặt tên khác cho lịch này.',
    deactivate: 'Lịch này đã được tạm dừng trước đó (có thể bởi người khác). Danh sách đã được tải lại; xem trạng thái mới nhất.',
    activate: 'Không bật lại được: lịch đã chạy rồi, hoặc máy đã có lịch đang chạy cùng tên. Danh sách đã được tải lại; xem trạng thái mới nhất.',
  }
  return new ApiError(409, text[action], error.fieldErrors)
}
/** Errors after which retrying the same confirmation cannot help: close it and reload. */
export function isStaleSchedule(error: unknown, action: ScheduleAction): boolean {
  return error instanceof ApiError && error.status === 409 && (action === 'deactivate' || action === 'activate')
}
