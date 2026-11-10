// Rules of the Machines list (C2) that do not need React: URL filters and sort limited to what GET /machines accepts,
// why a machine is or is not selling (administrative status, kept apart from connectivity), the registration form
// (thresholds, request body limited to the contract fields) and Vietnamese wording of backend errors. Unit-tested.
// Contract: api-contract/api.yaml (listMachines, createMachine); rules: docs/machine-management.md, docs/order-management.md.
import { ApiError } from '../api/client.ts'
import { ValidationError } from './form-error.ts'
import type { components } from '../api/schema'
import { formatDateTime } from '../lib/format.ts'
import { formatSort, oneOf, parseSort } from '../lib/table-query.ts'
import type { SortRule, SortState } from '../lib/table-query.ts'

type S = components['schemas']
export type MachineStatus = S['MachineResponse']['status']
export type CreateMachineBody = S['CreateMachineRequest']
type MachineLike = Pick<S['MachineResponse'], 'status' | 'lastSeenAt' | 'createdAt' | 'updatedAt'>

export const MACHINE_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'] as const
export const MACHINE_FILTER_KEYS = ['status', 'search'] as const
/** `sort` of GET /machines: one approved field, default createdAt,desc. */
export const MACHINE_SORT: SortRule = { fields: ['id', 'code', 'name', 'location', 'status', 'createdAt', 'updatedAt'], fallback: 'createdAt,desc' }

/** Limits of CreateMachineRequest and of the `search` parameter. */
export const LIMITS = { code: 64, name: 200, location: 500, search: 200 } as const

export interface MachineFilters { status: string; search: string; sort: SortState; page: number }

/** Reads the list state from the URL; unknown values are dropped so hand-edited URLs never reach the API as a 400. */
export function readMachineFilters(params: URLSearchParams): MachineFilters {
  const rawPage = Number(params.get('page') ?? 0)
  return {
    status: oneOf(params.get('status'), MACHINE_STATUSES),
    search: (params.get('search') ?? '').trim().slice(0, LIMITS.search),
    sort: parseSort(params.get('sort'), MACHINE_SORT),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0,
  }
}

/** Query of GET /machines: only page, size, status, search and sort (the contract's parameters). */
export function machineListQuery(filters: MachineFilters, size: number) {
  return {
    page: filters.page, size,
    status: (filters.status || undefined) as MachineStatus | undefined,
    search: filters.search || undefined,
    sort: formatSort(filters.sort),
  }
}

export type SaleReason = 'selling' | 'new' | 'inactive' | 'maintenance'
export interface SaleState {
  selling: boolean
  reason: SaleReason
  /** Short line under the status badge: whether the kiosk may sell, and why not. */
  summary: string
  /** What to do next, worded for the person reading (ADMIN can act, STAFF asks an admin). */
  next: string
}

/**
 * Whether the kiosk of this machine takes orders, from the administrative status only: the catalog is empty and
 * `acceptingOrders=false` whenever the machine is not ACTIVE (docs/order-management.md). A machine never changed since
 * registration (INACTIVE, updatedAt = createdAt) is told apart as "new, not switched on yet". Connectivity
 * (`lastSeenAt`) is deliberately not part of this: see `lastContact`.
 */
export function saleState(machine: MachineLike, canManage: boolean): SaleState {
  if (machine.status === 'ACTIVE') return { selling: true, reason: 'selling', summary: 'Đang mở bán (kiosk nhận đơn khi có hàng).', next: '' }
  if (machine.status === 'MAINTENANCE') {
    return { selling: false, reason: 'maintenance', summary: 'Ngừng bán: đang bảo trì.',
      next: canManage ? 'Kiểm tra máy xong thì chuyển về Hoạt động trong chi tiết máy.' : 'Báo quản trị viên khi máy đã sửa xong.' }
  }
  const fresh = !machine.lastSeenAt && machine.updatedAt === machine.createdAt
  return fresh
    ? { selling: false, reason: 'new', summary: 'Ngừng bán: mới đăng ký, chưa bật bán.',
      next: canManage ? 'Mở chi tiết máy để thêm ngăn, cấp khóa kiosk rồi chuyển sang Hoạt động.' : 'Quản trị viên sẽ thiết lập và bật máy.' }
    : { selling: false, reason: 'inactive', summary: 'Ngừng bán: quản trị viên đang để máy tắt.',
      next: canManage ? 'Bật Hoạt động trong chi tiết máy khi máy sẵn sàng.' : 'Báo quản trị viên nếu máy cần bán lại.' }
}

/**
 * Last time the machine talked to the server, shown apart from the administrative status. The API has no
 * online/offline value yet (heartbeat not built), so nothing is inferred from it and it never stops sales.
 */
export function lastContact(machine: Pick<MachineLike, 'lastSeenAt'>): string {
  return machine.lastSeenAt ? formatDateTime(machine.lastSeenAt) : 'Chưa từng kết nối'
}

// ---- registration form

export const THRESHOLDS = [
  { key: 'minTemperature', label: 'Nhiệt độ tối thiểu (°C)', min: -100, max: 100 },
  { key: 'maxTemperature', label: 'Nhiệt độ tối đa (°C)', min: -100, max: 100 },
  { key: 'minHumidity', label: 'Độ ẩm tối thiểu (%)', min: 0, max: 100 },
  { key: 'maxHumidity', label: 'Độ ẩm tối đa (%)', min: 0, max: 100 },
] as const
export type ThresholdKey = (typeof THRESHOLDS)[number]['key']

export type MachineValues = { code: string; name: string; location: string } & Record<ThresholdKey, string>
/** Starting values of the registration form: the usual cold-chain range for cut fruit, editable before saving. */
export const NEW_MACHINE: MachineValues = { code: '', name: '', location: '', minTemperature: '2', maxTemperature: '8', minHumidity: '40', maxHumidity: '80' }

export type ThresholdResult = { ok: true; value: number } | { ok: false; message: string }

/** A threshold typed by a person: `2`, `-2`, `2,5` or `2.5`, at most 2 decimals, within [min, max]. Never rounded. */
export function parseThreshold(raw: string, min: number, max: number): ThresholdResult {
  const text = raw.trim().replace(/^[−–]/, '-')
  if (!text) return { ok: false, message: 'Vui lòng nhập giá trị.' }
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(text)
  if (!match) return { ok: false, message: 'Chỉ nhập số, ví dụ 2 hoặc 2,5.' }
  if ((match[3] ?? '').length > 2) return { ok: false, message: 'Tối đa 2 chữ số thập phân.' }
  const value = Number(`${match[1]}${match[2]}.${match[3] || '0'}`)
  if (value < min || value > max) return { ok: false, message: `Phải từ ${min} đến ${max}.` }
  return { ok: true, value: Object.is(value, -0) ? 0 : value }
}

/** Checks the backend also makes, shown beside the fields without a round trip. */
export function validateMachine(values: MachineValues): Record<string, string> {
  const errors: Record<string, string> = {}
  const code = values.code.trim(), name = values.name.trim(), location = values.location.trim()
  if (!code) errors.code = 'Vui lòng nhập mã máy.'
  else if (code.length > LIMITS.code) errors.code = `Mã máy tối đa ${LIMITS.code} ký tự.`
  if (!name) errors.name = 'Vui lòng nhập tên máy.'
  else if (name.length > LIMITS.name) errors.name = `Tên máy tối đa ${LIMITS.name} ký tự.`
  if (!location) errors.location = 'Vui lòng nhập vị trí đặt máy.'
  else if (location.length > LIMITS.location) errors.location = `Vị trí tối đa ${LIMITS.location} ký tự.`
  const numbers: Partial<Record<ThresholdKey, number>> = {}
  for (const { key, min, max } of THRESHOLDS) {
    const result = parseThreshold(values[key], min, max)
    if (result.ok) numbers[key] = result.value; else errors[key] = result.message
  }
  if (numbers.minTemperature !== undefined && numbers.maxTemperature !== undefined && numbers.minTemperature >= numbers.maxTemperature) {
    errors.minTemperature = 'Phải nhỏ hơn nhiệt độ tối đa.'
  }
  if (numbers.minHumidity !== undefined && numbers.maxHumidity !== undefined && numbers.minHumidity >= numbers.maxHumidity) {
    errors.minHumidity = 'Phải nhỏ hơn độ ẩm tối đa.'
  }
  return errors
}

/**
 * POST /machines body: exactly the seven contract fields. Status is not sent (the server registers every machine
 * INACTIVE). The code is uppercased here as the backend does, so what the person sees matches what is saved.
 */
export function createMachineBody(values: MachineValues): CreateMachineBody {
  const errors = validateMachine(values)
  if (Object.keys(errors).length) throw new ValidationError(errors)
  const number = (key: ThresholdKey) => { const result = parseThreshold(values[key], -Infinity, Infinity); return result.ok ? result.value : NaN }
  return {
    code: values.code.trim().toUpperCase(), name: values.name.trim(), location: values.location.trim(),
    minTemperature: number('minTemperature'), maxTemperature: number('maxTemperature'),
    minHumidity: number('minHumidity'), maxHumidity: number('maxHumidity'),
  }
}

export const CODE_TAKEN = 'Mã máy này đã được dùng cho một máy khác (không phân biệt hoa thường). Hãy nhập mã khác.'
export const THRESHOLD_ORDER = 'Ngưỡng tối thiểu phải nhỏ hơn ngưỡng tối đa (cả nhiệt độ và độ ẩm).'
export const UNKNOWN_FIELD = 'Máy chủ từ chối dữ liệu gửi lên. Hãy tải lại trang rồi thử lại.'
const FORM_FIELDS = ['code', 'name', 'location', 'minTemperature', 'maxTemperature', 'minHumidity', 'maxHumidity'] as const

/** Bean-validation messages of the backend (English) in Vietnamese; an unknown message is kept as is. */
export function translateFieldError(message: string): string {
  if (/must not be (blank|null|empty)|is required/i.test(message)) return 'Không được để trống.'
  const size = /size must be between (\d+) and (\d+)/i.exec(message)
  if (size) return `Tối đa ${size[2]} ký tự.`
  const low = /greater than or equal to (-?\d+(?:\.\d+)?)/i.exec(message)
  if (low) return `Phải lớn hơn hoặc bằng ${low[1]}.`
  const high = /less than or equal to (-?\d+(?:\.\d+)?)/i.exec(message)
  if (high) return `Phải nhỏ hơn hoặc bằng ${high[1]}.`
  if (/out of bounds|fraction|decimal/i.test(message)) return 'Tối đa 2 chữ số thập phân.'
  return message
}

/**
 * Errors of POST /machines shown where they belong:
 * - 409: `code` is the only unique column of `machines` (V2 migration), so both the service check ("Machine code is
 *   already in use") and the constraint hit by two simultaneous registrations ("Request conflicts with existing
 *   data") mean a taken code: shown once, in Vietnamese, under the code field.
 * - 400 with field errors: under the matching fields in Vietnamese; a field the form does not have is named in the
 *   form-level message instead.
 * - 400 "Minimum … strictly below maximum …" (no field errors): a Vietnamese form-level message.
 * - 400 "Unknown request field" (no field errors; the request DTO rejects any extra field): a Vietnamese form-level
 *   message asking to reload, since the page is out of date with the server.
 * Anything else is returned unchanged.
 */
export function describeSaveError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) return new ValidationError({ code: CODE_TAKEN })
  if (error.status !== 400) return error
  const entries = Object.entries(error.fieldErrors)
  if (!entries.length) {
    if (/strictly below|minimum.*maximum/i.test(error.message)) return new ApiError(400, THRESHOLD_ORDER)
    if (/unknown request field/i.test(error.message)) return new ApiError(400, UNKNOWN_FIELD)
    return error
  }
  const unknown = entries.filter(([field]) => !(FORM_FIELDS as readonly string[]).includes(field))
  if (unknown.length) {
    const all = entries.map(([field, message]) => `${field}: ${translateFieldError(message)}`).join('; ')
    return new ApiError(400, `Máy chủ từ chối dữ liệu gửi lên (${all}). Hãy tải lại trang rồi thử lại.`)
  }
  return new ValidationError(Object.fromEntries(entries.map(([field, message]) => [field, translateFieldError(message)])))
}
