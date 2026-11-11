// Rules of the inventory history screen (I4) that do not need React: filters read from and written to the URL (only
// the parameters GET /inventory/transactions accepts, ids checked before they can become a 400), and the wording of
// each history row (event, reference, reason, who did it). Unit-tested.
// Contract: api-contract/api.yaml (listInventoryTransactions: page, size, inventoryItemId, machineId, slotId,
// referenceId, type; no sort, the order is createdAt,desc). Rules: docs/inventory-management.md (LOAD rows of one load
// share referenceId = operationId), backend InventoryService.remove (each REMOVE gets its own random referenceId, an
// operation id shared with no other row, so it is shown but not offered as a filter), docs/order-management.md
// (RESERVE / RETURN reference the order), backend DispenseService (SALE and the ADJUSTMENT RESERVED → DISPENSE_FAILED
// reference the order).
import { ApiError } from '../api/client.ts'
import { slotsApi } from '../api/resources.ts'
import type { InventoryTransaction } from '../api/resources.ts'
import { oneOf, uuidParam } from '../lib/table-query.ts'

export const TRANSACTION_TYPES = ['LOAD', 'RESERVE', 'SALE', 'EXPIRE', 'REMOVE', 'RETURN', 'ADJUSTMENT'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/** URL keys of the filters, in the order they are written back (stable, shareable links). */
export const HISTORY_FILTER_KEYS = ['machineId', 'slotId', 'type', 'inventoryItemId', 'referenceId'] as const
export type HistoryFilterKey = (typeof HISTORY_FILTER_KEYS)[number]

export interface HistoryFilters {
  machineId: string
  slotId: string
  type: TransactionType | ''
  inventoryItemId: string
  referenceId: string
  page: number
}
export const NO_FILTERS: HistoryFilters = { machineId: '', slotId: '', type: '', inventoryItemId: '', referenceId: '', page: 0 }

export const FILTER_LABELS: Record<HistoryFilterKey | 'page', string> = {
  machineId: 'Máy', slotId: 'Ngăn', type: 'Loại giao dịch', inventoryItemId: 'Mã hộp', referenceId: 'Phiếu nạp / đơn hàng', page: 'Trang',
}

/** A value of the URL that cannot be sent (not a UUID, unknown type, slot without machine…), with why. */
export interface IgnoredParam { key: HistoryFilterKey | 'page'; value: string; reason: string }

const UUID_REASON = 'không phải mã đầy đủ dạng UUID'

/**
 * Filters of the page from the URL. A value the API would refuse with a 400 is left out and listed in `ignored`, so the
 * screen can say so instead of showing a raw error: non-UUID ids, an unknown type, a negative or non-integer page and
 * a slot without its machine (the slot picker belongs to a machine, as on the inventory map).
 */
export function readHistoryFilters(params: URLSearchParams): { filters: HistoryFilters; ignored: IgnoredParam[] } {
  const ignored: IgnoredParam[] = []
  const id = (key: 'machineId' | 'slotId' | 'inventoryItemId' | 'referenceId') => {
    const raw = (params.get(key) ?? '').trim()
    const value = uuidParam(raw).toLowerCase()
    if (raw && !value) ignored.push({ key, value: raw, reason: UUID_REASON })
    return value
  }
  const machineId = id('machineId')
  let slotId = id('slotId')
  if (slotId && !machineId) {
    ignored.push({ key: 'slotId', value: slotId, reason: 'chỉ lọc theo ngăn khi đã chọn máy' })
    slotId = ''
  }
  const rawType = params.get('type') ?? ''
  const type = oneOf(rawType, TRANSACTION_TYPES) as TransactionType | ''
  if (rawType && !type) ignored.push({ key: 'type', value: rawType, reason: 'không phải loại giao dịch đã biết' })
  const rawPage = params.get('page') ?? ''
  const pageNumber = Number(rawPage)
  const page = rawPage && Number.isSafeInteger(pageNumber) && pageNumber >= 0 ? pageNumber : 0
  if (rawPage && !(Number.isSafeInteger(pageNumber) && pageNumber >= 0)) ignored.push({ key: 'page', value: rawPage, reason: 'số trang không hợp lệ' })
  return { filters: { machineId, slotId, type, inventoryItemId: id('inventoryItemId'), referenceId: id('referenceId'), page }, ignored }
}

/** Query of GET /inventory/transactions: page, size and the filters in effect; nothing the contract does not list. */
export function historyQuery(filters: HistoryFilters, size: number) {
  return {
    page: filters.page, size,
    machineId: filters.machineId || undefined,
    slotId: (filters.machineId && filters.slotId) || undefined,
    type: filters.type || undefined,
    inventoryItemId: filters.inventoryItemId || undefined,
    referenceId: filters.referenceId || undefined,
  }
}

/** Cache key of the list request: changes exactly when the query sent changes. */
export function historyKey(filters: HistoryFilters): string {
  const query = historyQuery(filters, 0)
  return HISTORY_FILTER_KEYS.map(key => query[key] ?? '').concat(String(filters.page)).join('|')
}

/** Query string of these filters (`?…`, or '' with none): fixed key order, empty values and page 0 left out. */
export function historySearch(filters: HistoryFilters): string {
  const params = new URLSearchParams()
  for (const key of HISTORY_FILTER_KEYS) if (filters[key]) params.set(key, filters[key])
  if (filters.page > 0) params.set('page', String(filters.page))
  const text = params.toString()
  return text ? `?${text}` : ''
}

export type HistoryPatch = Partial<HistoryFilters>

/**
 * Filters after a change. Another machine (or none) clears the slot, which belongs to the old machine; any filter
 * change returns to the first page unless the patch sets the page itself; a slot never stays without its machine.
 */
export function nextFilters(current: HistoryFilters, patch: HistoryPatch): HistoryFilters {
  const next: HistoryFilters = { ...current, ...patch }
  if ('machineId' in patch && patch.machineId !== current.machineId && !('slotId' in patch)) next.slotId = ''
  if (!next.machineId) next.slotId = ''
  if (!('page' in patch)) next.page = 0
  return next
}

/** URL of the history screen for a change of filters (see nextFilters). */
export function historyHref(current: HistoryFilters, patch: HistoryPatch, pathname = '/admin/inventory/history'): string {
  return pathname + historySearch(nextFilters(current, patch))
}

/** Filters in effect (page is not a filter). */
export function activeHistoryFilterCount(filters: HistoryFilters): number {
  return HISTORY_FILTER_KEYS.filter(key => filters[key]).length
}

/** URL after dropping the values that could not be used (ignored params and anything else unknown), same page. */
export function cleanHistoryHref(filters: HistoryFilters, pathname = '/admin/inventory/history'): string {
  return pathname + historySearch(filters)
}

// ---- id typed or pasted in a filter field

export const ID_INPUT_TEXT = 'Mã phải là mã đầy đủ 36 ký tự dạng xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. Bấm vào mã trong bảng để lọc nhanh thay vì gõ tay.'

/** A box or reference id typed by a person: spaces, braces and upper case are tolerated; '' clears the filter. */
export function parseIdInput(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const text = raw.trim().replace(/^\{(.*)\}$/, '$1').trim()
  if (!text) return { ok: true, value: '' }
  const value = uuidParam(text).toLowerCase()
  return value ? { ok: true, value } : { ok: false, error: ID_INPUT_TEXT }
}

// ---- row wording

/** Short form of an id for display (the end of the UUID, which differs between records); the full id goes in a title. */
export function shortId(id: string | null | undefined): string {
  return id ? `…${id.slice(-8)}` : '—'
}

export type ReferenceKind = 'load' | 'order' | 'remove' | 'other'

/**
 * What the referenceId of a row points at: the load operation (phiếu nạp), the order, the removal operation (one row
 * only, so filtering by it shows nothing more than the row itself), or something not known here.
 */
export function referenceKind(row: Pick<InventoryTransaction, 'type' | 'referenceId' | 'statusBefore' | 'statusAfter'>): ReferenceKind | undefined {
  if (!row.referenceId) return undefined
  if (row.type === 'LOAD') return 'load'
  if (row.type === 'REMOVE') return 'remove'
  if (row.type === 'RESERVE' || row.type === 'SALE' || row.type === 'RETURN') return 'order'
  // The dispense failure correction references the order; any other adjustment may reference something else.
  if (row.type === 'ADJUSTMENT' && (row.statusBefore === 'RESERVED' || row.statusAfter === 'DISPENSE_FAILED')) return 'order'
  return 'other'
}

export const REFERENCE_LABELS: Record<ReferenceKind, string> = { load: 'Phiếu nạp', order: 'Đơn hàng', remove: 'Mã thao tác rút', other: 'Tham chiếu' }
/** Whether a quick "filter by this reference" link makes sense: not for a removal, whose id belongs to that row alone. */
export function referenceFilterable(kind: ReferenceKind | undefined): boolean {
  return kind === 'load' || kind === 'order' || kind === 'other'
}

/** Backend reason codes (OrderReservationService, DispenseService, mock) in Vietnamese; free text typed by staff is kept. */
const REASONS: Record<string, string> = {
  ORDER_RESERVED: 'Giữ cho đơn hàng',
  ORDER_CANCELLED: 'Đơn bị hủy',
  RESERVATION_EXPIRED: 'Hết thời gian giữ chỗ',
  ORDER_COMPLETED: 'Đơn đã hoàn tất',
  DISPENSE_TIMEOUT: 'Máy không phản hồi khi nhả hàng (quá thời gian chờ)',
  TIMEOUT: 'Máy không phản hồi khi nhả hàng (quá thời gian chờ)',
  DISPENSE_ABORTED: 'Máy báo nhả hàng thất bại',
  FAILED: 'Máy báo nhả hàng thất bại',
}
export function reasonText(reason: string | null | undefined): string {
  const text = (reason ?? '').trim()
  if (!text) return ''
  return REASONS[text] ?? text
}

/** One sentence saying what happened to the box, from the type and the status change. */
export function eventText(row: Pick<InventoryTransaction, 'type' | 'statusBefore' | 'statusAfter'>): string {
  switch (row.type) {
    case 'LOAD': return 'Hộp được nạp vào ngăn.'
    case 'RESERVE': return 'Hộp đáy được giữ cho một đơn đang chờ thanh toán.'
    case 'SALE': return 'Máy đã nhả hộp cho khách.'
    case 'RETURN': return 'Đơn không hoàn tất nên hộp được trả lại ngăn để bán tiếp.'
    case 'EXPIRE': return 'Hộp quá hạn dùng, không bán được nữa.'
    case 'REMOVE': return 'Hộp được rút khỏi ngăn.'
    case 'ADJUSTMENT':
      return row.statusAfter === 'DISPENSE_FAILED' ? 'Máy không nhả được hộp; hộp chặn ngăn cho tới khi được xử lý.' : 'Trạng thái hộp được điều chỉnh.'
    default: return ''
  }
}

/** Events the system records on its own (kiosk order, payment, machine), without a person. */
const SYSTEM_TYPES: readonly string[] = ['RESERVE', 'SALE', 'RETURN', 'ADJUSTMENT', 'EXPIRE']

/**
 * Who did it: "Bạn" for the signed-in account, the name when the user list is readable (ADMIN), otherwise the short
 * account id; "Hệ thống" for order/payment/machine events without a person; '' when unknown (legacy rows).
 */
export function performerText(row: Pick<InventoryTransaction, 'type' | 'performedBy'>, names: Readonly<Record<string, string>>, selfId?: string): string {
  if (!row.performedBy) return SYSTEM_TYPES.includes(row.type ?? '') ? 'Hệ thống' : ''
  if (selfId && row.performedBy === selfId) return 'Bạn'
  return names[row.performedBy] ?? `Tài khoản ${shortId(row.performedBy)}`
}

// ---- lookups (names for the ids the history returns)

/** Slot codes of the machines shown, `slotId → code`; a machine whose slots fail to load is skipped (its rows keep the short id). */
export async function loadSlotCodes(machineIds: readonly string[], signal?: AbortSignal): Promise<Record<string, string>> {
  const unique = [...new Set(machineIds.filter(Boolean))]
  const results = await Promise.allSettled(unique.map(machineId => slotsApi.list(machineId, { page: 0, size: 100, sort: 'slotCode,asc' }, signal)))
  const codes: Record<string, string> = {}
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const slot of result.value.content) if (slot.id && slot.slotCode) codes[slot.id] = slot.slotCode
  }
  return codes
}

// ---- errors of the list

export type HistoryProblem =
  | { kind: 'forbidden' }
  | { kind: 'filters'; message: string }
  | { kind: 'notFound'; message: string }
  | { kind: 'other' }

export const FILTERS_REFUSED = 'Máy chủ không nhận bộ lọc hiện tại (có thể đường dẫn đã bị sửa tay). Xóa bộ lọc rồi chọn lại.'
export const FILTER_TARGET_GONE = 'Máy chủ không tìm thấy dữ liệu theo bộ lọc hiện tại. Xóa bộ lọc rồi chọn lại.'

/**
 * How the screen explains a failed list: 403 → the no-access block; 400 comes from the filters (malformed id or type),
 * so it offers to clear them; anything else (401, 5xx, network) is the generic error with retry. The backend does not
 * check that a filtered machine / slot / box exists (an unknown id just gives no rows), but the contract lists a 404,
 * so it is handled like a filter problem too.
 */
export function describeHistoryError(error: unknown): HistoryProblem {
  if (!(error instanceof ApiError)) return { kind: 'other' }
  if (error.status === 403) return { kind: 'forbidden' }
  if (error.status === 400) return { kind: 'filters', message: FILTERS_REFUSED }
  if (error.status === 404) return { kind: 'notFound', message: FILTER_TARGET_GONE }
  return { kind: 'other' }
}
