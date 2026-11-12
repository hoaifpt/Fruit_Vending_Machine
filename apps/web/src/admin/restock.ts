// Rules of screen O4 "Thực hiện phiếu nạp hàng" (FE 7.2) that do not need React, unit-tested in tests/restock.test.mjs.
// Contract: api-contract/drafts/work-tickets.yaml (restock lines, POST .../restock-lines/{lineId}/load and /remove,
// POST /complete with the reconciliation, waiting for BE 4.4) and drafts/machine-maintenance.yaml (OPEN_REFILL /
// CLOSE_REFILL, BE 4.2). The step shown is always derived from server data (the ticket, its lines, the machine's
// maintenance command history and the bowls of the lines' slots), so a reload resumes at the right step.
// Quantities follow the load rules of FE 4.3 (inventory-load.ts): free places of the slot, bowls left in the batch,
// 1..1000 per request. Nothing is ever deleted: a bowl taken out becomes REMOVED with its history row.
import { ApiError } from '../api/client.ts'
import type { InventoryItem, MaintenanceCommand, RestockLine, WorkTicket } from '../api/resources.ts'
import { formatDateTime } from '../lib/format.ts'
import { ValidationError } from './form-error.ts'
import type { LoadRoom } from './inventory-load.ts'
import { LOAD_MAX_PER_REQUEST, QUANTITY_INVALID, describeLoadError, describeRemoveFailure, loadMax, parseBoxCount, quantityProblem, reasonProblem } from './inventory-load.ts'
import { compareDispenseOrder, isExpiredBox, isPresent } from './inventory-map.ts'
import { runningCommand } from './maintenance-commands.ts'
import { TICKETS_PATH, hasRestockLines } from './tickets.ts'

const count = new Intl.NumberFormat('vi-VN')
const n = (value: number) => count.format(value)

// ---- steps

export const RESTOCK_STEPS = ['open', 'remove', 'load', 'close', 'reconcile'] as const
export type RestockStepKey = typeof RESTOCK_STEPS[number]
/** `done`: the ticket is COMPLETED or CANCELLED, only the summary is shown. */
export type RestockStep = RestockStepKey | 'done'

export const STEP_LABELS: Readonly<Record<RestockStepKey, string>> = {
  open: 'Mở cửa nạp', remove: 'Rút hộp hỏng', load: 'Nạp theo dòng', close: 'Đóng cửa nạp', reconcile: 'Đối chiếu',
}
/** Steps done with the refill door open: the person may move between them freely. */
export const DOOR_OPEN_STEPS: readonly RestockStepKey[] = ['remove', 'load', 'close']

export function restockPath(ticketId: string): string {
  return `${TICKETS_PATH}/${encodeURIComponent(ticketId)}/restock`
}

/** RESTOCK ticket that has lines (rule kept in tickets.ts, which decides the next-step buttons too). */
export { hasRestockLines }

export type RefillSince = { state: 'none' } | { state: 'open'; at: string } | { state: 'closed'; at: string }

/**
 * Refill door as left by this ticket: the newest successful OPEN_REFILL / CLOSE_REFILL sent at or after `since` (the
 * ticket's start) in the newest-first history. `closed` only counts after an OPEN_REFILL of this ticket: a CLOSE alone
 * (door closed by someone else before the restock opened it) is `none`.
 */
export function refillSince(commands: readonly MaintenanceCommand[] | undefined, since: string | null | undefined): RefillSince {
  const start = Date.parse(since ?? '')
  if (!commands || Number.isNaN(start)) return { state: 'none' }
  const ours = commands.filter(command => command.status === 'SUCCESS' && (command.type === 'OPEN_REFILL' || command.type === 'CLOSE_REFILL') && Date.parse(command.createdAt) >= start)
  const last = ours[0]
  if (!last) return { state: 'none' }
  const at = last.completedAt ?? last.updatedAt
  if (last.type === 'OPEN_REFILL') return { state: 'open', at }
  return ours.some(command => command.type === 'OPEN_REFILL') ? { state: 'closed', at } : { state: 'none' }
}

export interface StepInput {
  status: WorkTicket['status']
  startedAt?: string | null
  lines: readonly RestockLine[]
  /** Newest-first maintenance commands of the machine (the first page is enough: the newest decides). */
  commands: readonly MaintenanceCommand[] | undefined
  /** Expired bowls still in the lines' slots; undefined while unknown. */
  expiredLeft: number | undefined
  /** The backend has no maintenance commands yet (BE 4.2 missing): the door is opened and closed by hand at the machine. */
  doorByHand?: boolean
}

/**
 * Step to resume at, from server data only:
 * ASSIGNED (not started) or no OPEN_REFILL succeeded since the start → open (also while OPEN_REFILL runs);
 * CLOSE_REFILL running → close; door closed after this ticket opened it → reconcile;
 * door open: nothing loaded yet and expired bowls left (or not known yet) → remove; every line loaded in full → close;
 * otherwise → load. COMPLETED / CANCELLED → done.
 */
export function restockStep(input: StepInput): RestockStep {
  if (input.status === 'COMPLETED' || input.status === 'CANCELLED') return 'done'
  if (input.status !== 'IN_PROGRESS') return 'open'
  const running = runningCommand(input.commands)
  if (running?.type === 'OPEN_REFILL') return 'open'
  if (running?.type === 'CLOSE_REFILL') return 'close'
  const refill: RefillSince = input.doorByHand ? { state: 'open', at: input.startedAt ?? '' } : refillSince(input.commands, input.startedAt)
  if (refill.state === 'none') return 'open'
  if (refill.state === 'closed') return 'reconcile'
  const loaded = input.lines.some(line => line.loadedQuantity > 0)
  if (!loaded && (input.expiredLeft === undefined || input.expiredLeft > 0)) return 'remove'
  if (input.lines.length && input.lines.every(line => line.loadedQuantity >= line.plannedQuantity)) return 'close'
  return 'load'
}

/**
 * Whether the step can be decided from the machine's maintenance command history. Only an IN_PROGRESS ticket needs it
 * (before, the step is always "open"; after, "done"). `failed`: the history could not be read (401, 403, 500, network;
 * a 404 means the backend has no maintenance commands, handled by hand as `missing`), so the screen shows the error
 * with a retry instead of guessing a step (it would claim the door was never opened).
 */
export function commandHistoryState(input: { status: WorkTicket['status']; loaded: boolean; error: unknown; missing: boolean }): 'ready' | 'loading' | 'failed' {
  if (input.status !== 'IN_PROGRESS' || input.loaded || input.missing) return 'ready'
  return input.error ? 'failed' : 'loading'
}

/**
 * What is shown: the person's choice among the door-open steps while the door is open, otherwise the derived step.
 * With the door handled by hand (no maintenance commands on the server) the reconciliation is reached by choice too.
 */
export function shownStep(derived: RestockStep, chosen: RestockStepKey | null, doorByHand = false): RestockStep {
  if (!chosen || derived === 'done' || !DOOR_OPEN_STEPS.includes(derived as RestockStepKey)) return derived
  return DOOR_OPEN_STEPS.includes(chosen) || (doorByHand && chosen === 'reconcile') ? chosen : derived
}

/** Position for the progress bar: 1-based, and how many steps are behind. `done` counts as after the last step. */
export function stepProgress(step: RestockStep): { index: number; total: number; label: string } {
  const total = RESTOCK_STEPS.length
  if (step === 'done') return { index: total, total, label: 'Đã xong' }
  return { index: RESTOCK_STEPS.indexOf(step) + 1, total, label: STEP_LABELS[step] }
}

/** State of each step in the progress bar relative to the shown one. */
export function stepState(step: RestockStepKey, shown: RestockStep): 'done' | 'current' | 'todo' {
  if (shown === 'done') return 'done'
  const at = RESTOCK_STEPS.indexOf(shown), index = RESTOCK_STEPS.indexOf(step)
  return index < at ? 'done' : index === at ? 'current' : 'todo'
}

// ---- bowls to take out

export interface RemovalPlan {
  /** Expired bowls (stored EXPIRED, or past their expiry): must come out before selling again. */
  expired: InventoryItem[]
  /** Sellable bowls the person may take out if damaged. */
  others: InventoryItem[]
  /** Bowls held for an order or after a failed dispense: not removable here. */
  locked: number
}

/** Present bowls of one slot split for step 2, each list in dispense order (head first). */
export function removalPlan(items: readonly InventoryItem[], now: number): RemovalPlan {
  const present = items.filter(isPresent).sort(compareDispenseOrder)
  const expiredNow = (item: InventoryItem) => isExpiredBox(item) || Date.parse(item.expiresAt ?? '') <= now
  const removable = (item: InventoryItem) => item.status === 'AVAILABLE' || item.status === 'EXPIRED'
  return {
    expired: present.filter(item => removable(item) && expiredNow(item)),
    others: present.filter(item => removable(item) && !expiredNow(item)),
    locked: present.filter(item => !removable(item)).length,
  }
}

export const REMOVE_REASONS = { expired: 'Hộp hết hạn', damaged: 'Hộp dập, hỏng' } as const

/** Body of POST .../restock-lines/{lineId}/remove: exactly { inventoryItemId, reason }, reason trimmed (1..500). */
export function lineRemoveBody(inventoryItemId: string, reason: string) {
  const problem = reasonProblem(reason)
  if (problem) throw new ValidationError({ reason: problem })
  if (!inventoryItemId) throw new ValidationError({ inventoryItemId: 'Chọn hộp cần rút.' })
  return { inventoryItemId, reason: reason.trim() }
}

// ---- loading per line

/** Bowls still to load for the plan (never negative). */
export const leftToLoad = (line: Pick<RestockLine, 'plannedQuantity' | 'loadedQuantity'>) => Math.max(line.plannedQuantity - line.loadedQuantity, 0)

/**
 * Count pre-filled for a line: what is left of the plan, capped by what fits now (slot free places, batch left,
 * 1000 per request; see loadMax). '' when nothing is left or nothing fits.
 */
export function defaultQuantity(line: Pick<RestockLine, 'plannedQuantity' | 'loadedQuantity'>, room: LoadRoom): string {
  const value = Math.min(leftToLoad(line), loadMax(room).max)
  return value > 0 ? String(value) : ''
}

/** Problem of a line's count as typed (same wording and limits as the load sheet of FE 4.3); '' when fine. */
export function lineQuantityProblem(raw: string, room: LoadRoom, required = false): string {
  return quantityProblem(raw, room, required)
}

/** Body of POST .../restock-lines/{lineId}/load: exactly { batchId, quantity } (an integer 1..1000). */
export function lineLoadBody(batchId: string, raw: string, room: LoadRoom = {}) {
  const errors: Record<string, string> = {}
  if (!batchId) errors.batchId = 'Chọn lô hàng để nạp.'
  const problem = quantityProblem(raw, room, true)
  if (problem) errors.quantity = problem
  const quantity = parseBoxCount(raw)
  if (quantity === undefined || quantity < 1 || quantity > LOAD_MAX_PER_REQUEST) errors.quantity ||= QUANTITY_INVALID
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return { batchId, quantity: quantity! }
}

// ---- reconciliation

export interface ReconcileRow { lineId: string; slotCode: string; productName: string; planned: number; loaded: number; removed: number; difference: number; text: string }
export interface Reconciliation { rows: ReconcileRow[]; planned: number; loaded: number; removed: number; difference: number; noteRequired: boolean }

/** "Khớp", "Thiếu 2 hộp" or "Thừa 1 hộp": the difference in words (not by colour only). */
export function differenceText(difference: number): string {
  if (difference === 0) return 'Khớp kế hoạch'
  return difference < 0 ? `Thiếu ${n(-difference)} hộp` : `Thừa ${n(difference)} hộp`
}

/** Plan against result per line and in total; a note is required when any line differs (rule of POST /complete). */
export function reconcile(lines: readonly RestockLine[]): Reconciliation {
  const rows = lines.map(line => {
    const difference = line.loadedQuantity - line.plannedQuantity
    return { lineId: line.id, slotCode: line.slotCode, productName: line.productName, planned: line.plannedQuantity, loaded: line.loadedQuantity, removed: line.removedQuantity, difference, text: differenceText(difference) }
  })
  const sum = (pick: (row: ReconcileRow) => number) => rows.reduce((total, row) => total + pick(row), 0)
  return { rows, planned: sum(row => row.planned), loaded: sum(row => row.loaded), removed: sum(row => row.removed), difference: sum(row => row.difference), noteRequired: rows.some(row => row.difference !== 0) }
}

export const NOTE_MAX = 500
export const NOTE_REQUIRED = 'Số hộp đã nạp khác kế hoạch: ghi lý do (ví dụ “Lô chỉ còn 2 hộp”, “Ngăn A2 có hộp dập”) để quản trị viên đối chiếu.'

/** Body of POST /complete for a restock: the note when there is one; required when the result differs from the plan. */
export function restockCompleteBody(note: string, noteRequired: boolean): { body?: { note?: string }; error?: string } {
  const text = note.trim()
  if (!text && noteRequired) return { error: NOTE_REQUIRED }
  if (text.length > NOTE_MAX) return { error: `Tối đa ${NOTE_MAX} ký tự.` }
  return { body: text ? { note: text } : {} }
}

/** Line after completion: how many LOW_STOCK alerts the server closed. */
export function resolvedText(count: number): string {
  return count > 0
    ? `Đã tự đóng ${n(count)} cảnh báo Ngăn sắp hết hàng của máy này.`
    : 'Không có cảnh báo Ngăn sắp hết hàng nào được tự đóng: chỉ ngăn đã nạp đủ kế hoạch mới được đóng. Cảnh báo còn lại xử lý ở màn Cảnh báo.'
}

/** One sentence about the refill door for step 1 and 4 (from the history). */
export function refillText(refill: RefillSince): string {
  if (refill.state === 'open') return `Cửa nạp đang mở (máy báo lúc ${formatDateTime(refill.at)}).`
  if (refill.state === 'closed') return `Cửa nạp đã đóng (máy báo lúc ${formatDateTime(refill.at)}).`
  return 'Cửa nạp chưa được mở cho phiếu này.'
}

// ---- errors

export const RESTOCK_STALE = 'Phiếu không còn ở trạng thái đang thực hiện (có thể đã hoàn tất hoặc bị hủy ở nơi khác). Trang đã tải lại; xem trạng thái mới nhất.'
export const RESTOCK_NOT_ASSIGNEE = 'Phiếu này không còn giao cho bạn (hoặc tài khoản thiếu quyền nạp/rút hộp) nên bạn không thực hiện bước này được. Hãy hỏi quản trị viên.'
const BATCH_MISMATCH = 'Lô đã chọn không phải sản phẩm của dòng này. Chọn lô đúng sản phẩm.'

/**
 * A failed load of a line: the FE 4.3 wording (describeLoadError: capacity, batch, expiry… under the field, with
 * `refresh` when the figures must be read again), plus the ticket's own refusals (not IN_PROGRESS, not the assignee,
 * batch of another product).
 */
export function describeLineLoadError(error: unknown, quantity: number | undefined, room: LoadRoom): ReturnType<typeof describeLoadError> & { stale?: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 409 && /not in_progress|IN_PROGRESS/i.test(error.message)) return { error: new ApiError(409, RESTOCK_STALE), refresh: true, stale: true }
    if (error.status === 409 && /does not match/i.test(error.message)) return { error: new ValidationError({ batchId: BATCH_MISMATCH }), refresh: false }
    if (error.status === 403) return { error: new ApiError(403, RESTOCK_NOT_ASSIGNEE), refresh: false, stale: true }
  }
  return describeLoadError(error, quantity, room)
}

/** A failed removal of a bowl: the FE 4.3 wording (describeRemoveFailure) plus the ticket's own refusals. */
export function describeLineRemoveError(error: unknown): { error: unknown; stale: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 409 && /not in_progress|IN_PROGRESS/i.test(error.message)) return { error: new ApiError(409, RESTOCK_STALE), stale: true }
    if (error.status === 403) return { error: new ApiError(403, RESTOCK_NOT_ASSIGNEE), stale: true }
    if (error.status === 400 && error.fieldErrors.inventoryItemId) return { error: new ApiError(409, 'Hộp này không còn ở ngăn của dòng nạp. Danh sách hộp đã được tải lại.'), stale: true }
  }
  return describeRemoveFailure(error)
}

/** A failed completion: 400 on the note goes under the note; 409/403 explained (the screen reloads). */
export function describeCompleteError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 400 && error.fieldErrors.note) return new ValidationError({ note: /blank|required|differs/i.test(error.fieldErrors.note) ? NOTE_REQUIRED : error.fieldErrors.note })
  if (error.status === 409) return new ApiError(409, RESTOCK_STALE)
  if (error.status === 403) return new ApiError(403, RESTOCK_NOT_ASSIGNEE)
  return error
}

/** Plain-language count of bowls: "3 hộp". */
export const bowls = (value: number) => `${n(value)} hộp`
