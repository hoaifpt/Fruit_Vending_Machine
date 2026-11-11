// Rules of the load and remove Sheets (I3, issue FE 4.3) that do not need React: how many boxes may be loaded now
// (free places of the slot, boxes the batch can still take, 1..1000 per request), checks shown as the staff types,
// the request bodies (contract fields only) and Vietnamese wording of backend errors under the right field. Unit-tested.
// Contract: api-contract/api.yaml (loadInventory, removeInventory, getSlotInventorySummary); rules:
// docs/inventory-management.md and backend InventoryService (409 messages: "Product must be ACTIVE", "Batch is expired",
// "Machine must be ACTIVE or MAINTENANCE for loading", "Slot must be ACTIVE for loading", "Slot capacity exceeded",
// "Batch declared quantity exceeded"; GlobalExceptionHandler: "Request conflicts with existing data").
import { ApiError } from '../api/client.ts'
import { batchesApi } from '../api/resources.ts'
import type { Batch, Machine, Slot } from '../api/resources.ts'
import type { components } from '../api/schema'
import { formatDateTime } from '../lib/format.ts'
import { ValidationError } from './form-error.ts'
import { describeRemoveError } from './inventory-map.ts'

type S = components['schemas']
export type LoadBody = S['LoadInventoryRequest']
export type RemoveBody = S['RemoveInventoryRequest']

/** LoadInventoryRequest.quantity maximum (a bounded bulk request, independent of the slot). */
export const LOAD_MAX_PER_REQUEST = 1000
/** RemoveInventoryRequest.reason maximum, after trimming. */
export const REASON_MAX = 500

const count = new Intl.NumberFormat('vi-VN')
const n = (value: number) => count.format(value)

// ---- batches to choose from

/** Loadable batches offered at most, and pages of 100 read at most to find them (expired batches come first). */
export const BATCH_OPTIONS_MAX = 100
export const BATCH_PAGES_MAX = 10

/**
 * Batches that can still be loaded (not expired at `now`), earliest expiry first (first expired, first out). GET
 * /product-batches has no expiry filter, so pages sorted by expiresAt,asc are read, skipping expired ones, until
 * BATCH_OPTIONS_MAX are found or the list ends (at most BATCH_PAGES_MAX pages). `truncated`: some may not be offered.
 */
export async function loadLoadableBatches(now: number, signal?: AbortSignal): Promise<{ batches: Batch[]; truncated: boolean }> {
  const batches: Batch[] = []
  for (let page = 0; page < BATCH_PAGES_MAX; page += 1) {
    const result = await batchesApi.list({ page, size: 100, sort: 'expiresAt,asc' }, signal)
    batches.push(...result.content.filter(batch => Date.parse(batch.expiresAt ?? '') > now))
    const last = page + 1 >= result.totalPages || !result.content.length
    if (batches.length >= BATCH_OPTIONS_MAX) return { batches: batches.slice(0, BATCH_OPTIONS_MAX), truncated: !last || batches.length > BATCH_OPTIONS_MAX }
    if (last) return { batches, truncated: false }
  }
  return { batches, truncated: true }
}

// ---- what fits

export interface LoadRoom {
  slotCode?: string
  /** Free places of the slot (summary remainingCapacity); undefined while unknown. */
  free?: number
  capacity?: number
  batchCode?: string
  /** Declared quantity of the batch and boxes already loaded from it (every status counts); undefined while unknown. */
  declared?: number
  loaded?: number
}

/** Boxes the batch can still take, or undefined while either figure is unknown. */
export function batchRemaining(room: LoadRoom): number | undefined {
  return room.declared === undefined || room.loaded === undefined ? undefined : Math.max(room.declared - room.loaded, 0)
}

/** Most boxes one load may carry now, and what limits it. */
export function loadMax(room: LoadRoom): { max: number; by: 'slot' | 'batch' | 'request' } {
  const remaining = batchRemaining(room)
  let max = LOAD_MAX_PER_REQUEST, by: 'slot' | 'batch' | 'request' = 'request'
  if (room.free !== undefined && room.free < max) { max = Math.max(room.free, 0); by = 'slot' }
  if (remaining !== undefined && remaining < max) { max = remaining; by = 'batch' }
  return { max, by }
}

/** Box count typed by a person: digits only (spaces ignored), else undefined. */
export function parseBoxCount(raw: string): number | undefined {
  const text = raw.replace(/\s/g, '')
  if (!/^\d+$/.test(text)) return undefined
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : undefined
}

export const QUANTITY_REQUIRED = 'Vui lòng nhập số hộp đã xếp vào ngăn.'
export const QUANTITY_INVALID = 'Số hộp phải là số nguyên từ 1 trở lên.'
export const QUANTITY_TOO_MANY = `Mỗi lần nạp tối đa ${n(LOAD_MAX_PER_REQUEST)} hộp; chia thành nhiều lần nạp.`

const slotName = (room: LoadRoom) => room.slotCode ? `Ngăn ${room.slotCode}` : 'Ngăn đã chọn'
const batchName = (room: LoadRoom) => room.batchCode ? `Lô ${room.batchCode}` : 'Lô đã chọn'

/**
 * Problem of the box count, checked on every keystroke against what is known: '' when fine (or still empty while
 * typing; `required` makes empty an error, on submit). Says how many still fit and what to do instead.
 */
export function quantityProblem(raw: string, room: LoadRoom, required = false): string {
  if (!raw.trim()) return required ? QUANTITY_REQUIRED : ''
  const value = parseBoxCount(raw)
  if (value === undefined || value < 1) return QUANTITY_INVALID
  if (value > LOAD_MAX_PER_REQUEST) return QUANTITY_TOO_MANY
  if (room.free !== undefined && value > room.free) return room.free <= 0
    ? `${slotName(room)} đã đầy, không còn chỗ trống. Chọn ngăn khác hoặc rút bớt hộp trước.`
    : `${slotName(room)} chỉ còn trống ${n(room.free)} chỗ. Nhập tối đa ${n(room.free)} hộp hoặc chọn ngăn khác.`
  const remaining = batchRemaining(room)
  if (remaining !== undefined && value > remaining) return remaining <= 0
    ? `${batchName(room)} đã nạp đủ ${n(room.declared ?? 0)} hộp khai báo. Chọn lô khác.`
    : `${batchName(room)} chỉ còn nạp được ${n(remaining)} hộp (đã nạp ${n(room.loaded ?? 0)}/${n(room.declared ?? 0)}). Nhập tối đa ${n(remaining)} hộp hoặc chọn lô khác.`
  return ''
}

export interface LoadSelection {
  machine?: Machine
  slot?: Slot
  batch?: Batch
  room: LoadRoom
  now: number
}

export type LoadField = 'machineId' | 'slotId' | 'batchId' | 'quantity'
export type LoadValues = Record<LoadField, string>
export const NEW_LOAD: LoadValues = { machineId: '', slotId: '', batchId: '', quantity: '' }

/** Why the chosen machine, slot or batch cannot be loaded now, shown as soon as it is chosen (before the count). */
export function selectionProblems({ machine, slot, batch, room, now }: LoadSelection): Partial<Record<LoadField, string>> {
  const problems: Partial<Record<LoadField, string>> = {}
  if (machine?.status === 'INACTIVE') problems.machineId = 'Máy đang ngừng hoạt động nên không nạp được. Chọn máy khác hoặc nhờ quản trị viên chuyển máy sang Hoạt động hoặc Bảo trì.'
  if (slot && slot.status !== 'ACTIVE') problems.slotId = `Ngăn ${slot.slotCode} đang ${slot.status === 'ERROR' ? 'báo lỗi' : 'ngừng hoạt động'} nên không nạp được. Chọn ngăn khác hoặc nhờ quản trị viên bật lại ngăn.`
  else if (slot && room.free !== undefined && room.free <= 0) problems.slotId = `Ngăn ${slot.slotCode} đã đầy (${n(room.capacity ?? slot.capacity)}/${n(room.capacity ?? slot.capacity)} hộp). Chọn ngăn khác hoặc rút bớt hộp hết hạn trước.`
  if (batch) {
    const expires = Date.parse(batch.expiresAt ?? '')
    const remaining = batchRemaining(room)
    if (!Number.isNaN(expires) && expires <= now) problems.batchId = `Lô ${batch.batchCode} đã hết hạn (${formatDateTime(batch.expiresAt)}) nên không nạp được. Chọn lô khác còn hạn.`
    else if (remaining !== undefined && remaining <= 0) problems.batchId = `Lô ${batch.batchCode} đã nạp đủ ${n(room.declared ?? 0)} hộp khai báo. Chọn lô khác hoặc tạo lô mới.`
  }
  return problems
}

/** Every check made before sending: required choices, what the selection allows and the count. */
export function validateLoad(values: LoadValues, selection: LoadSelection): Record<string, string> {
  const errors: Record<string, string> = { ...selectionProblems(selection) }
  if (!values.machineId) errors.machineId = 'Vui lòng chọn máy.'
  if (!values.slotId) errors.slotId = values.machineId ? 'Vui lòng chọn ngăn.' : 'Chọn máy trước, rồi chọn ngăn.'
  if (!values.batchId) errors.batchId = 'Vui lòng chọn lô hàng.'
  const quantity = quantityProblem(values.quantity, selection.room, true)
  if (quantity) errors.quantity = quantity
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message))
}

/** POST /inventory/load body: exactly batchId, slotId and quantity (a JSON integer). */
export function loadBody(values: LoadValues): LoadBody {
  const quantity = parseBoxCount(values.quantity)
  if (!values.batchId || !values.slotId || quantity === undefined || quantity < 1 || quantity > LOAD_MAX_PER_REQUEST) {
    throw new ValidationError(Object.fromEntries(Object.entries({
      batchId: values.batchId ? '' : 'Vui lòng chọn lô hàng.',
      slotId: values.slotId ? '' : 'Vui lòng chọn ngăn.',
      quantity: quantityProblem(values.quantity, {}, true),
    }).filter(([, message]) => message)))
  }
  return { batchId: values.batchId, slotId: values.slotId, quantity }
}

/** The always-visible lines above the count: free places, what the batch can still take, and the maximum now. */
export function roomLines(room: LoadRoom): { slot: string; batch: string; max: string } {
  const remaining = batchRemaining(room)
  const { max, by } = loadMax(room)
  const slot = room.free === undefined ? '' : `${slotName(room)}: còn trống ${n(room.free)}${room.capacity !== undefined ? `/${n(room.capacity)}` : ''} chỗ`
  const batch = remaining === undefined ? '' : `${batchName(room)}: còn nạp được ${n(remaining)} hộp (đã nạp ${n(room.loaded ?? 0)}/${n(room.declared ?? 0)})`
  const why = by === 'slot' ? 'theo chỗ trống của ngăn' : by === 'batch' ? 'theo số còn lại của lô' : 'mỗi lần nạp'
  return { slot, batch, max: room.free === undefined && remaining === undefined ? '' : `Nạp được tối đa ${n(max)} hộp lần này (${why}).` }
}

/** Hint of the count field: the accepted range, or why nothing more can be loaded (never "from 1 to 0"). */
export function quantityHint(room: LoadRoom): string {
  const known = room.free !== undefined || batchRemaining(room) !== undefined
  if (!known) return 'Số nguyên, ví dụ 5.'
  const { max, by } = loadMax(room)
  if (max > 0) return `Số nguyên từ 1 đến ${n(max)}.`
  return by === 'slot'
    ? `Không nạp thêm được: ${slotName(room).toLowerCase()} đã đầy. Chọn ngăn khác hoặc rút bớt hộp trước.`
    : `Không nạp thêm được: ${batchName(room).toLowerCase()} đã nạp đủ số khai báo. Chọn lô khác.`
}

// ---- load errors

/** A 409 "does not fit" (slot or batch) waiting for, or explained by, the figures read again. */
export interface FitConflict { kind: 'slot' | 'batch'; quantity: number }
/** State of the figures read again after the refusal. */
export type Reload = 'pending' | 'ok' | 'failed'

/**
 * Text of a 409 "does not fit": says the figures were read again only once they were, and asks to lower the count only
 * when the new figures really are too small (otherwise something changed and a retry may work).
 */
export function fitConflictText({ kind, quantity }: FitConflict, room: LoadRoom, reload: Reload): string {
  const sent = `${n(quantity)} hộp`
  const slot = kind === 'slot'
  const name = slot ? slotName(room) : batchName(room)
  const left = slot ? room.free : batchRemaining(room)
  const what = slot ? 'số chỗ trống' : 'số hộp lô còn nạp được'
  const lead = slot ? `${name} không còn đủ chỗ cho ${sent}: có thể vừa có người nạp thêm.` : `${name} không còn đủ hộp khai báo cho ${sent}: có thể vừa có người nạp từ lô này.`
  if (reload === 'pending') return `${lead} Đang tải lại ${what}…`
  if (reload === 'failed' || left === undefined) return `${lead} Chưa tải lại được ${what}; đóng biểu mẫu, bấm Tải lại trên sơ đồ rồi thử lại.`
  if (left >= quantity) return `${name} vừa có thay đổi trong lúc nạp; ${what} vừa tải lại vẫn đủ cho ${sent}. Bấm Nạp hộp để thử lại.`
  if (left <= 0) return slot ? `${name} đã đầy (vừa tải lại), không còn chỗ cho ${sent}. Chọn ngăn khác hoặc rút bớt hộp trước.` : `${name} đã nạp đủ số khai báo (vừa tải lại). Chọn lô khác.`
  return slot
    ? `${name} chỉ còn trống ${n(left)} chỗ (vừa tải lại), không đủ cho ${sent}. Giảm xuống ${n(left)} hộp hoặc chọn ngăn khác.`
    : `${name} chỉ còn nạp được ${n(left)} hộp (vừa tải lại), không đủ cho ${sent}. Giảm xuống ${n(left)} hộp hoặc chọn lô khác.`
}

export const LOAD_TEXT = {
  productInactive: 'Sản phẩm của lô này đang ngừng bán nên không nạp được. Chọn lô của sản phẩm đang bán, hoặc nhờ quản trị viên mở bán lại.',
  batchGone: 'Không tìm thấy lô này nữa. Đóng biểu mẫu, tải lại trang rồi chọn lại lô.',
  slotGone: 'Không tìm thấy ngăn này nữa (máy hoặc ngăn có thể vừa thay đổi). Chọn lại máy và ngăn.',
  productGone: 'Không tìm thấy sản phẩm của lô này. Chọn lô khác hoặc tải lại trang.',
  notFound: 'Máy chủ không tìm thấy dữ liệu cần để nạp hộp. Tải lại trang rồi thử lại.',
  raced: 'Có thao tác khác trên ngăn hoặc lô này cùng lúc. Số liệu đã được tải lại; kiểm tra rồi bấm Nạp hộp lần nữa.',
  conflict: 'Máy chủ từ chối nạp hộp vì dữ liệu vừa thay đổi. Số liệu đã được tải lại; kiểm tra rồi thử lại.',
  badRequest: 'Máy chủ từ chối dữ liệu nạp hộp. Tải lại trang rồi thử lại.',
} as const

/**
 * Vietnamese for a failed POST /inventory/load, under the field it concerns. `quantity` is what was sent, `room` what
 * the form knew when sending. `refresh`: the free places / batch figures shown are stale and must be read again;
 * `conflict`: a "does not fit" whose text follows the figures read again (fitConflictText).
 * Matches the backend's English messages and the mock's Vietnamese ones. 401/403/5xx/network are returned unchanged.
 */
export function describeLoadError(error: unknown, quantity: number | undefined, room: LoadRoom): { error: unknown; refresh: boolean; conflict?: FitConflict } {
  if (!(error instanceof ApiError)) return { error, refresh: false }
  const message = error.message
  if (error.status === 409) {
    const fit: FitConflict['kind'] | undefined = /capacity|sức chứa/i.test(message) ? 'slot' : /declared quantity|số lượng của lô|khai báo/i.test(message) ? 'batch' : undefined
    if (fit) {
      const conflict = { kind: fit, quantity: quantity ?? 0 }
      // The figures are read again by the caller: the text says so until they arrive (see fitConflictText).
      return { error: new ValidationError({ quantity: fitConflictText(conflict, room, 'pending') }), refresh: true, conflict }
    }
    if (/batch is expired|hết hạn/i.test(message)) return { error: new ValidationError({ batchId: `${batchName(room)} vừa hết hạn nên không nạp được. Chọn lô khác còn hạn.` }), refresh: true }
    if (/product must be active|ngừng bán/i.test(message)) return { error: new ValidationError({ batchId: LOAD_TEXT.productInactive }), refresh: false }
    if (/machine must be|máy đang ngừng/i.test(message)) return { error: new ValidationError({ machineId: 'Máy vừa chuyển sang Ngừng hoạt động nên không nạp được. Chọn máy khác hoặc nhờ quản trị viên chuyển máy sang Hoạt động hoặc Bảo trì.' }), refresh: true }
    if (/slot must be|ngăn đang không hoạt động/i.test(message)) return { error: new ValidationError({ slotId: `${slotName(room)} vừa ngừng hoạt động hoặc báo lỗi nên không nạp được. Chọn ngăn khác.` }), refresh: true }
    if (/conflicts with existing data/i.test(message)) return { error: new ApiError(409, LOAD_TEXT.raced), refresh: true }
    return { error: new ApiError(409, LOAD_TEXT.conflict), refresh: true }
  }
  if (error.status === 404) {
    if (/batch|lô/i.test(message)) return { error: new ValidationError({ batchId: LOAD_TEXT.batchGone }), refresh: false }
    if (/slot|ngăn|machine|máy/i.test(message)) return { error: new ValidationError({ slotId: LOAD_TEXT.slotGone }), refresh: true }
    if (/product|sản phẩm/i.test(message)) return { error: new ValidationError({ batchId: LOAD_TEXT.productGone }), refresh: false }
    return { error: new ApiError(404, LOAD_TEXT.notFound), refresh: false }
  }
  if (error.status === 400) {
    const entries = Object.entries(error.fieldErrors)
    const known = ['batchId', 'slotId', 'quantity']
    if (entries.length && entries.every(([field]) => known.includes(field))) {
      return { error: new ValidationError(Object.fromEntries(entries.map(([field, text]) => [field, translateLoadField(field, text)]))), refresh: false }
    }
    return { error: new ApiError(400, LOAD_TEXT.badRequest), refresh: false }
  }
  return { error, refresh: false }
}

function translateLoadField(field: string, message: string): string {
  if (/must not be (blank|null|empty)|is required/i.test(message)) return field === 'quantity' ? QUANTITY_REQUIRED : field === 'batchId' ? 'Vui lòng chọn lô hàng.' : 'Vui lòng chọn ngăn.'
  if (field === 'quantity' && /less than or equal|max|1000/i.test(message)) return QUANTITY_TOO_MANY
  if (field === 'quantity' && /greater than|min|positive|integer|number/i.test(message)) return QUANTITY_INVALID
  if (/uuid|format|invalid/i.test(message)) return field === 'batchId' ? 'Lô đã chọn không hợp lệ. Chọn lại lô.' : field === 'slotId' ? 'Ngăn đã chọn không hợp lệ. Chọn lại ngăn.' : QUANTITY_INVALID
  return message
}

// ---- remove

/** Common reasons, one tap each; the text sent is still the free `reason` field. */
export const QUICK_REASONS = ['Hộp hết hạn', 'Hộp dập, hỏng', 'Hộp đổ, rò rỉ', 'Kiểm tra máy, lấy ra'] as const

export const REASON_REQUIRED = 'Vui lòng nhập lý do rút hộp.'
export const REASON_TOO_LONG = `Lý do tối đa ${REASON_MAX} ký tự.`

/** '' when the reason is acceptable: not blank, at most 500 characters once trimmed (as the backend strips it). */
export function reasonProblem(raw: string): string {
  const text = raw.trim()
  if (!text) return REASON_REQUIRED
  return text.length > REASON_MAX ? REASON_TOO_LONG : ''
}

/** POST /inventory/{id}/remove body: exactly { reason }, trimmed. */
export function removeBody(raw: string): RemoveBody {
  const problem = reasonProblem(raw)
  if (problem) throw new ValidationError({ reason: problem })
  return { reason: raw.trim() }
}

/**
 * A failed removal: 409/404 mean the box changed (see describeRemoveError, `stale`: reload); a 400 about the reason
 * goes under the reason field; anything else unchanged.
 */
export function describeRemoveFailure(error: unknown): { error: unknown; stale: boolean } {
  if (error instanceof ApiError && error.status === 400) {
    const reason = error.fieldErrors.reason
    if (reason) return { error: new ValidationError({ reason: /size|500|max/i.test(reason) ? REASON_TOO_LONG : /blank|null|empty|required/i.test(reason) ? REASON_REQUIRED : reason }), stale: false }
    return { error: new ApiError(400, 'Máy chủ từ chối lý do rút hộp. Kiểm tra lý do (1–500 ký tự) rồi thử lại.'), stale: false }
  }
  return describeRemoveError(error)
}
