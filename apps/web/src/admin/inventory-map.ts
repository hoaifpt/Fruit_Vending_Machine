// Rules of the inventory map (I2) that do not need React: which boxes are physically in each slot and in what order,
// which one is the slot head (the bottom box, sold/dispensed next), and whether that head blocks the slot. Unit-tested.
// Contract: api-contract/api.yaml (getMachine, listMachineSlots, listInventory, getSlotInventorySummary: headStatus,
// headExpired); rules: docs/inventory-management.md, docs/mqtt-dispense.md, docs/order-management.md.
//
// - A slot is a column of boxes: the head is the physically present box with the earliest loadedAt (tie-break id), the
//   only one the machine can push out. Boxes behind it wait, even when they are fine.
// - Physically present = AVAILABLE, RESERVED, EXPIRED, DISPENSE_FAILED (they take capacity); SOLD/REMOVED do not.
// - Only an AVAILABLE, unexpired head sells, and only while the machine and the slot are ACTIVE (and the product, known
//   only through the summary's sellableCount). A RESERVED head is held for an order in progress. An expired head
//   (status EXPIRED or batch expired) or a DISPENSE_FAILED head blocks the slot until staff take it out.
// - The remove API accepts AVAILABLE/EXPIRED only (REMOVABLE_STATUSES, the single switch): a DISPENSE_FAILED box needs
//   the reconciliation flow the backend has not built yet (409 today), so its button is shown locked with the reason.
//   Adding the status to REMOVABLE_STATUSES once the backend allows it turns the button on.
import { ApiError } from '../api/client.ts'
import { inventoryApi, machinesApi, slotsApi } from '../api/resources.ts'
import type { InventoryItem, InventorySummary, Machine, Slot } from '../api/resources.ts'
import { formatDateTime } from '../lib/format.ts'
import { statusMeta } from '../lib/status.ts'
import { oneOf, uuidParam } from '../lib/table-query.ts'

export const PRESENT_STATUSES = ['AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED'] as const
export type PresentStatus = (typeof PRESENT_STATUSES)[number]
/** Statuses POST /inventory/{id}/remove accepts: the single switch for "can this box be taken out on the web". */
export const REMOVABLE_STATUSES: readonly string[] = ['AVAILABLE', 'EXPIRED']
export function canRemove(item: InventoryItem): boolean {
  return REMOVABLE_STATUSES.includes(item.status ?? '')
}
/** Box cells drawn per column; a taller column shows how many more boxes / free places there are. */
export const MAX_VISIBLE_CELLS = 12
/** Slot summaries requested at the same time. */
export const SUMMARY_CONCURRENCY = 6
/** API maximum page size. */
const PAGE = 100
/** Pages read per status before giving up (10 000 boxes per status in one machine is far beyond any real column). */
const MAX_PAGES = 100

// ---- URL

export const INVENTORY_VIEWS = ['map', 'list'] as const
export type InventoryView = (typeof INVENTORY_VIEWS)[number]
export interface MapQuery { view: InventoryView; machineId: string; slotId: string }

/** `?view=` (map by default), `machineId` and `slotId` from the URL; non-UUID ids are dropped so they never become a 400. */
export function readMapQuery(params: URLSearchParams): MapQuery {
  return {
    view: (oneOf(params.get('view'), INVENTORY_VIEWS) || 'map') as InventoryView,
    machineId: uuidParam(params.get('machineId')),
    slotId: uuidParam(params.get('machineId')) ? uuidParam(params.get('slotId')) : '',
  }
}

// ---- order and head

const INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/i

/**
 * Sortable form of an ISO-8601 instant: whole seconds since epoch (any offset) and the fraction as 9 digits, so
 * `…:00.5Z`, `…:00.500000Z` and `…:00.000500001Z` compare as the instants they are (Date.parse keeps only milliseconds).
 * Unparsable or missing values sort last.
 */
export function instantKey(value: string | null | undefined): [number, string] {
  const match = value ? INSTANT.exec(value.trim()) : null
  const seconds = match ? Date.parse(`${match[1]}${match[3] ?? 'Z'}`) : Number.NaN
  if (!match || Number.isNaN(seconds)) return [Number.POSITIVE_INFINITY, '']
  return [seconds, (match[2] ?? '').padEnd(9, '0').slice(0, 9)]
}

/** Dispense order: earliest loadedAt first, then id (the backend's tie-break, plain code-unit order). */
export function compareDispenseOrder(a: InventoryItem, b: InventoryItem): number {
  const [secondsA, fractionA] = instantKey(a.loadedAt), [secondsB, fractionB] = instantKey(b.loadedAt)
  if (secondsA !== secondsB) return secondsA < secondsB ? -1 : 1
  if (fractionA !== fractionB) return fractionA < fractionB ? -1 : 1
  const idA = a.id ?? '', idB = b.id ?? ''
  return idA < idB ? -1 : idA > idB ? 1 : 0
}

export function isPresent(item: InventoryItem): boolean {
  return (PRESENT_STATUSES as readonly string[]).includes(item.status ?? '')
}

/** Expired for selling: stored EXPIRED, or the batch expiry has passed (`expired`, computed by the server at request time). */
export function isExpiredBox(item: InventoryItem): boolean {
  return item.status === 'EXPIRED' || item.expired === true
}

export type BlockReason = 'expired' | 'dispenseFailed'
export type HeadState =
  | { kind: 'empty' }
  | { kind: 'ready' }
  | { kind: 'reserved' }
  | { kind: 'blocked'; reason: BlockReason; removable: boolean }

/** What the head means for the slot. RESERVED wins over expired: a held box cannot be removed (409) until its order ends. */
export function headState(head: InventoryItem | undefined): HeadState {
  if (!head) return { kind: 'empty' }
  if (head.status === 'RESERVED') return { kind: 'reserved' }
  if (head.status === 'DISPENSE_FAILED') return { kind: 'blocked', reason: 'dispenseFailed', removable: canRemove(head) }
  if (isExpiredBox(head)) return { kind: 'blocked', reason: 'expired', removable: canRemove(head) }
  return { kind: 'ready' }
}

// ---- columns

export type SummaryResult = { ok: true; summary: InventorySummary } | { ok: false; error: unknown }
type MachineStatus = Machine['status']

export interface SlotColumn {
  slot: Slot
  /** Boxes in the slot, head first (index 0 = bottom). */
  boxes: InventoryItem[]
  head?: InventoryItem
  state: HeadState
  occupied: number
  /** Free places (never negative, also for legacy over-capacity slots). */
  free: number
  /** Boxes drawn, head first; `hiddenBoxes` more sit above them. */
  visibleBoxes: InventoryItem[]
  hiddenBoxes: number
  /** Free places drawn above the boxes; `hiddenFree` more are not drawn. */
  emptyCells: number
  hiddenFree: number
  summary?: InventorySummary
  summaryFailed: boolean
  /** The summary (one DB snapshot) disagrees with the box list (another request): something changed in between. */
  outOfSync: boolean
  /** Machine status the column was built with (undefined: not known, treated as ACTIVE). */
  machineStatus?: MachineStatus
  /** The kiosk can sell this slot's head now: head ready, machine and slot ACTIVE, and the server counts it sellable. */
  selling: boolean
}

export interface ColumnOptions { maxCells?: number; machineStatus?: MachineStatus }

/**
 * One column per slot, in the order given (slot code). Boxes are the present items of that slot, in dispense order.
 * At most `maxCells` cells are drawn per column: boxes first (one cell turns into "+N hộp" when they do not fit), then
 * free places.
 */
export function buildColumns(slots: readonly Slot[], items: readonly InventoryItem[], summaries: Readonly<Record<string, SummaryResult>> = {}, options: ColumnOptions = {}): SlotColumn[] {
  const { maxCells = MAX_VISIBLE_CELLS, machineStatus } = options
  const bySlot = new Map<string, InventoryItem[]>()
  for (const item of items) {
    if (!item.slotId || !isPresent(item)) continue
    const list = bySlot.get(item.slotId) ?? []
    list.push(item)
    bySlot.set(item.slotId, list)
  }
  return slots.map(slot => {
    const boxes = (bySlot.get(slot.id) ?? []).sort(compareDispenseOrder)
    const head = boxes[0]
    const occupied = boxes.length
    const free = Math.max(0, slot.capacity - occupied)
    const overflow = occupied > maxCells
    const visibleBoxes = boxes.slice(0, overflow ? maxCells - 1 : occupied)
    const room = Math.max(0, maxCells - visibleBoxes.length - (overflow ? 1 : 0))
    const emptyCells = Math.min(free, room)
    const result = summaries[slot.id]
    const summary = result?.ok ? result.summary : undefined
    const outOfSync = !!summary && (Number(summary.occupiedCount ?? occupied) !== occupied || (summary.headStatus ?? null) !== ((head?.status as string | undefined) ?? null))
    const state = headState(head)
    const selling = state.kind === 'ready' && slot.status === 'ACTIVE' && (machineStatus ?? 'ACTIVE') === 'ACTIVE' && (!summary || Number(summary.sellableCount ?? 0) > 0)
    return {
      slot, boxes, head, state, occupied, free, visibleBoxes, hiddenBoxes: occupied - visibleBoxes.length,
      emptyCells, hiddenFree: free - emptyCells, summary, summaryFailed: !!result && !result.ok, outOfSync, machineStatus, selling,
    }
  })
}

export interface MapOverview { slots: number; selling: number; idle: number; reserved: number; blocked: number; empty: number; inactive: number }

/**
 * Counts for the line above the map. A slot that is not ACTIVE counts as inactive whatever its head; a ready head that
 * cannot sell (machine not ACTIVE, nothing sellable for the server) counts as idle, never as selling.
 */
export function mapOverview(columns: readonly SlotColumn[]): MapOverview {
  const overview: MapOverview = { slots: columns.length, selling: 0, idle: 0, reserved: 0, blocked: 0, empty: 0, inactive: 0 }
  for (const column of columns) {
    if (column.slot.status !== 'ACTIVE') overview.inactive += 1
    else if (column.state.kind === 'ready') overview[column.selling ? 'selling' : 'idle'] += 1
    else overview[column.state.kind] += 1
  }
  return overview
}

/** "3 ngăn · 2 đang bán · …"; "sẵn sàng nhưng chưa bán" and "ngừng/lỗi" only when not zero. */
export function overviewText(overview: MapOverview): string {
  const parts = [`${overview.slots} ngăn`, `${overview.selling} đang bán`]
  if (overview.idle) parts.push(`${overview.idle} sẵn sàng nhưng chưa bán`)
  parts.push(`${overview.blocked} đang chặn`, `${overview.reserved} đang giữ`, `${overview.empty} trống`)
  if (overview.inactive) parts.push(`${overview.inactive} ngừng/lỗi`)
  return parts.join(' · ')
}

// ---- wording

export const BLOCKED_LABEL = 'Đang chặn ngăn'

/** One line under the slot code: can this slot sell now, and if not why. Never "Đang bán" unless it really sells. */
export function columnSaleText(column: SlotColumn): string {
  if (column.slot.status === 'INACTIVE') return 'Không bán: ngăn đang ngừng hoạt động.'
  if (column.slot.status === 'ERROR') return 'Không bán: ngăn đang báo lỗi.'
  const { state } = column
  if (state.kind === 'empty') return 'Ngăn trống, cần nạp hộp.'
  if (state.kind === 'reserved') return 'Hộp đáy đang được giữ cho một đơn; ngăn bán tiếp khi đơn xong hoặc hết giờ giữ.'
  if (state.kind === 'blocked') return state.reason === 'expired'
    ? 'Không bán: hộp đáy đã hết hạn nên chặn cả ngăn.'
    : 'Không bán: hộp đáy nhả hàng thất bại nên chặn cả ngăn.'
  if (column.selling) return 'Đang bán: hộp đáy được bán tiếp theo.'
  if (column.machineStatus && column.machineStatus !== 'ACTIVE') return `Không bán: máy đang ${statusMeta('machine', column.machineStatus).label.toLowerCase()}; hộp đáy còn hạn, bán lại khi máy hoạt động.`
  return 'Không bán: hộp đáy còn hạn nhưng máy chủ chưa tính là bán được (sản phẩm có thể đang ngừng bán).'
}

/** Marker on the head box. */
export function headLabel(column: SlotColumn): string {
  if (column.state.kind === 'blocked') return BLOCKED_LABEL
  if (column.state.kind === 'reserved') return 'Hộp đáy · đang giữ'
  return column.selling ? 'Hộp đáy · bán tiếp theo' : 'Hộp đáy · chưa bán'
}

/** Why the head blocks the slot; what the boxes behind it wait for depends on whether it can be taken out here. */
export function blockedText(state: HeadState, behind: number): string {
  if (state.kind !== 'blocked') return ''
  const rest = behind <= 0 ? ''
    : state.removable ? ` ${behind} hộp phía trên chỉ bán được sau khi rút hộp này.` : ` ${behind} hộp phía trên phải chờ hộp này được xử lý xong.`
  if (state.reason === 'expired') return `Hộp đã hết hạn, máy không bán hộp nào của ngăn.${rest}`
  return `Máy không nhả được hộp này.${rest}`
}

/** Why "Rút hộp" is locked for a blocking head the API refuses to remove (today: DISPENSE_FAILED). */
export const REMOVE_LOCKED = 'Hộp nhả hàng thất bại cần đối soát; hệ thống chưa cho rút trực tiếp.'
/** Next step for that head; an administrator is not told to call an administrator. */
export function lockedNextStep(isAdmin: boolean): string {
  return isAdmin
    ? 'Kiểm tra ngăn tại máy và xem đơn liên quan để xử lý hoàn tiền; nút rút hộp sẽ mở khi có quy trình đối soát.'
    : 'Kiểm tra ngăn tại máy, xem đơn liên quan và báo quản trị viên.'
}

/** Short status word of a box, or '' for a plain sellable box (its look and the head marker already say enough). */
export function boxStatusText(item: InventoryItem): string {
  if (item.status === 'RESERVED') return 'Đang giữ'
  if (item.status === 'DISPENSE_FAILED') return 'Nhả lỗi'
  if (isExpiredBox(item)) return 'Hết hạn'
  return ''
}

/** Everything a screen reader needs about one box, in one sentence. */
export function boxDescription(item: InventoryItem, position: number, column: SlotColumn): string {
  const where = position === 1 ? (column.selling ? ' (đáy, bán tiếp theo)' : ' (đáy)') : ''
  const parts = [`Vị trí ${position}${where}`, item.productName ?? 'Không rõ sản phẩm', `lô ${item.batchCode ?? '—'}`, `hạn dùng ${formatDateTime(item.expiresAt)}`]
  const status = boxStatusText(item)
  if (status) parts.push(status.toLowerCase())
  if (position === 1 && column.state.kind === 'blocked') parts.push(BLOCKED_LABEL.toLowerCase())
  return parts.join(', ')
}

/** Accessible name of a column: code, fill and sale state. */
export function columnLabel(column: SlotColumn): string {
  return `Ngăn ${column.slot.slotCode}: ${column.occupied}/${column.slot.capacity} hộp. ${columnSaleText(column)}`
}

// ---- loading

export interface MachineMap {
  machine: Machine
  slots: Slot[]
  items: InventoryItem[]
  summaries: Record<string, SummaryResult>
  /** The slot list or a status had more than could be read; the map may miss some. */
  incomplete: boolean
  asOf: number
}

/** Like Promise.allSettled over `items`, with at most `limit` calls running at once; results keep the input order. */
export async function settleLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      try { results[index] = { status: 'fulfilled', value: await run(items[index]) } } catch (reason) { results[index] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return results
}

/**
 * Every present box of the machine: GET /inventory?machineId&status&sort=loadedAt,asc for each present status (SOLD
 * and REMOVED rows stay in the history forever and are not needed), all pages, run together.
 */
export async function loadPresentItems(machineId: string, signal?: AbortSignal): Promise<{ items: InventoryItem[]; incomplete: boolean }> {
  const perStatus = await Promise.all(PRESENT_STATUSES.map(async status => {
    const rows: InventoryItem[] = []
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await inventoryApi.list({ machineId, status, page, size: PAGE, sort: 'loadedAt,asc' }, signal)
      rows.push(...result.content)
      if (page + 1 >= result.totalPages || !result.content.length) return { rows, incomplete: false }
    }
    return { rows, incomplete: true }
  }))
  return { items: perStatus.flatMap(result => result.rows), incomplete: perStatus.some(result => result.incomplete) }
}

/**
 * The machine, its slots (first 100 by code), every present box and one summary per slot (at most
 * SUMMARY_CONCURRENCY at once). A failing summary only marks its column; a failing machine, slot list or box list fails
 * the whole map (shown as the page error).
 */
export async function loadMachineMap(machineId: string, signal?: AbortSignal): Promise<MachineMap> {
  const [machine, slotPage, present] = await Promise.all([
    machinesApi.get(machineId, signal),
    slotsApi.list(machineId, { page: 0, size: PAGE, sort: 'slotCode,asc' }, signal),
    loadPresentItems(machineId, signal),
  ])
  const results = await settleLimited(slotPage.content, SUMMARY_CONCURRENCY, slot => slotsApi.summary(machineId, slot.id, signal))
  const summaries = Object.fromEntries(slotPage.content.map((slot, index) => {
    const result = results[index]
    return [slot.id, result.status === 'fulfilled' ? { ok: true, summary: result.value } : { ok: false, error: result.reason }] as const
  })) as Record<string, SummaryResult>
  return {
    machine, slots: slotPage.content, items: present.items, summaries,
    incomplete: present.incomplete || slotPage.totalElements > slotPage.content.length, asOf: Date.now(),
  }
}

/** Columns of a loaded map, built with its machine status. */
export function mapColumns(map: MachineMap, maxCells = MAX_VISIBLE_CELLS): SlotColumn[] {
  return buildColumns(map.slots, map.items, map.summaries, { maxCells, machineStatus: map.machine.status })
}

// ---- remove errors

export const REMOVE_STALE = 'Hộp vừa đổi trạng thái (đang giữ cho đơn hoặc đã được rút). Sơ đồ đã tải lại.'
export const REMOVE_GONE = 'Không tìm thấy hộp này nữa (có thể đã được rút). Sơ đồ đã tải lại.'

/**
 * 409/404 of POST /inventory/{id}/remove mean the map is out of date: Vietnamese text (shown as a form-level message,
 * hence status 409) and `stale` so the caller reloads. Anything else is returned unchanged.
 */
export function describeRemoveError(error: unknown): { error: unknown; stale: boolean } {
  if (error instanceof ApiError && error.status === 409) return { error: new ApiError(409, REMOVE_STALE), stale: true }
  if (error instanceof ApiError && error.status === 404) return { error: new ApiError(409, REMOVE_GONE), stale: true }
  return { error, stale: false }
}
