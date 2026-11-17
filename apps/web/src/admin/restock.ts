// Rules of screen O4 "Thực hiện phiếu nạp hàng" (FE 7.2) that do not need React, unit-tested in tests/restock.test.mjs.
// API: api-contract/api.yaml, backend #68 (docs/restock.md): GET /work-orders/{id}/restock (lines with their loads,
// linked maintenance commands, bowls removed by reason), POST .../restock-lines/{lineId}/loads (RESTOCK_EXECUTE, work
// order IN_PROGRESS), old bowls taken out by maintenance commands carrying workOrderId (REMOVE_ITEM / EMPTY_COLUMN, refill
// gate closed), refill gates opened and closed per column (OPEN_REFILL / CLOSE_REFILL), then POST /complete with a
// result note and a reason for every line loaded ≠ planned (all gates closed). The step shown is always derived from server
// data (work order, lines, slots' refillGateOpen, the machine's running command), so a reload resumes at the right step.
// Quantities follow the load rules of FE 4.3 (inventory-load.ts). Nothing is ever deleted.
import { ApiError } from '../api/client.ts'
import type {
  CompleteWorkOrderBody, InventorySummary, LineVariance, LinkedMaintenanceCommand, MaintenanceOperation, RestockLine, RestockLineInput, Slot, SlotSuggestion,
  UpdateRestockLineBody, WorkOrder,
} from '../api/resources.ts'
import { ValidationError, errorCode } from './form-error.ts'
import type { LoadRoom } from './inventory-load.ts'
import { LOAD_MAX_PER_REQUEST, QUANTITY_INVALID, fitConflictText, loadMax, parseBoxCount, quantityProblem } from './inventory-load.ts'
import type { FitConflict } from './inventory-load.ts'
import { REASON_LABELS } from './maintenance-commands.ts'
import { TICKETS_PATH, TICKET_LIMITS, hasRestockLines } from './tickets.ts'

const count = new Intl.NumberFormat('vi-VN')
const n = (value: number) => count.format(value)
/** Plain-language count of bowls: "3 hộp". */
export const bowls = (value: number) => `${n(value)} hộp`

// ---- steps

export const RESTOCK_STEPS = ['start', 'remove', 'load', 'close', 'reconcile'] as const
export type RestockStepKey = typeof RESTOCK_STEPS[number]
/** `done`: the work order is DONE or CANCELLED, only the summary is shown. */
export type RestockStep = RestockStepKey | 'done'

export const STEP_LABELS: Readonly<Record<RestockStepKey, string>> = {
  start: 'Bắt đầu', remove: 'Rút hộp cũ', load: 'Nạp theo dòng', close: 'Đóng cổng nạp', reconcile: 'Đối chiếu',
}
/** Steps the person may move between freely while the work order is IN_PROGRESS. */
export const WORK_STEPS: readonly RestockStepKey[] = ['remove', 'load', 'close', 'reconcile']

export function restockPath(ticketId: string): string {
  return `${TICKETS_PATH}/${encodeURIComponent(ticketId)}/restock`
}
export { hasRestockLines }

export interface StepInput {
  status: WorkOrder['status']
  lines: readonly Pick<RestockLine, 'plannedQuantity' | 'loadedQuantity'>[]
  /** Columns of the lines whose refill gate is open (slot.refillGateOpen). */
  gatesOpen: number
  /** The machine's unfinished maintenance command, if any (only its operation matters). */
  running?: { operation?: MaintenanceOperation | string }
}

const loadedOf = (line: Pick<RestockLine, 'loadedQuantity'>) => line.loadedQuantity ?? 0
const plannedOf = (line: Pick<RestockLine, 'plannedQuantity'>) => line.plannedQuantity ?? 0

/**
 * Step to resume at, from server data only:
 * DONE / CANCELLED → done; not IN_PROGRESS → start;
 * a running REMOVE_ITEM / EMPTY_COLUMN → remove, OPEN_REFILL → load, CLOSE_REFILL → close;
 * a gate of the lines open → load, or close once every line is loaded in full;
 * all gates closed: something loaded → reconcile, nothing loaded yet → remove (old bowls come out first).
 */
export function restockStep(input: StepInput): RestockStep {
  if (input.status === 'DONE' || input.status === 'CANCELLED') return 'done'
  if (input.status !== 'IN_PROGRESS') return 'start'
  const operation = input.running?.operation
  if (operation === 'REMOVE_ITEM' || operation === 'EMPTY_COLUMN') return 'remove'
  if (operation === 'OPEN_REFILL') return 'load'
  if (operation === 'CLOSE_REFILL') return 'close'
  const full = input.lines.length > 0 && input.lines.every(line => loadedOf(line) >= plannedOf(line))
  if (input.gatesOpen > 0) return full ? 'close' : 'load'
  return input.lines.some(line => loadedOf(line) > 0) ? 'reconcile' : 'remove'
}

/**
 * What is shown: the person's choice among the work steps while the work order is IN_PROGRESS, otherwise the derived
 * step. "Đối chiếu" is never shown while a gate is open (completing would be refused with REFILL_GATE_OPEN).
 */
export function shownStep(derived: RestockStep, chosen: RestockStepKey | null, gatesOpen = 0): RestockStep {
  if (!chosen || derived === 'done' || derived === 'start' || !WORK_STEPS.includes(chosen)) return derived
  if (chosen === 'reconcile' && gatesOpen > 0) return derived
  return chosen
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

// ---- old bowls of a column (from its inventory summary)

export interface ColumnState {
  /** Bowls physically there. */
  present: number
  /** Expired (status or date) or failed to dispense: must come out before selling again. */
  toRemove: number
  /** Held for an order: the column cannot be emptied now. */
  reserved: number
  headBlocked: boolean
}
export function columnState(summary: Pick<InventorySummary, 'occupiedCount' | 'availableCount' | 'expiredCount' | 'reservedCount' | 'headStatus' | 'headExpired'> | undefined): ColumnState | undefined {
  if (!summary) return undefined
  const present = summary.occupiedCount ?? 0
  const reserved = summary.reservedCount ?? 0
  const failed = Math.max(0, present - (summary.availableCount ?? 0) - (summary.expiredCount ?? 0) - reserved)
  const headBlocked = summary.headStatus === 'EXPIRED' || summary.headStatus === 'DISPENSE_FAILED' || !!summary.headExpired
  return { present, toRemove: (summary.expiredCount ?? 0) + failed, reserved, headBlocked }
}
/** One sentence about the old bowls of a column for step 2. */
export function columnText(state: ColumnState | undefined): string {
  if (!state) return 'Đang đọc số hộp trong ngăn…'
  if (!state.present) return 'Ngăn đang trống, không có hộp cũ cần rút.'
  const parts = [`Đang có ${bowls(state.present)}`]
  parts.push(state.toRemove ? `${bowls(state.toRemove)} hết hạn hoặc nhả lỗi cần rút` : 'không có hộp hết hạn')
  if (state.headBlocked) parts.push('hộp ở đáy ngăn đang chặn bán')
  if (state.reserved) parts.push(`${bowls(state.reserved)} đang giữ cho đơn (chờ đơn xong mới rút được)`)
  return `${parts.join(', ')}.`
}

/** Bowls removed by the linked maintenance commands, in words: "Đã rút 3 hộp (Hộp hết hạn: 2, Hộp dập, hỏng: 1)". */
export function removedText(removedByReason: Record<string, number> | undefined): string {
  const entries = Object.entries(removedByReason ?? {}).filter(([, value]) => value > 0)
  if (!entries.length) return 'Chưa rút hộp nào trong phiếu này.'
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  return `Đã rút ${bowls(total)} trong phiếu này (${entries.map(([reason, value]) => `${REASON_LABELS[reason as keyof typeof REASON_LABELS] ?? reason}: ${n(value)}`).join(', ')}).`
}

/** A suggestion of GET /machines/{id}/restock-suggestions in words, for planning. */
export function suggestionText(slot: Pick<SlotSuggestion, 'slotCode' | 'currentProduct' | 'suggestedAction' | 'suggestedLoadQuantity' | 'expiredCount' | 'dispenseFailedCount' | 'expiringTodayCount'>): string {
  const what = `Ngăn ${slot.slotCode} · ${slot.currentProduct?.name ?? 'chưa rõ sản phẩm'}`
  const quantity = bowls(slot.suggestedLoadQuantity ?? 0)
  if (slot.suggestedAction === 'EMPTY_THEN_LOAD') {
    const old = (slot.expiredCount ?? 0) + (slot.dispenseFailedCount ?? 0) + (slot.expiringTodayCount ?? 0)
    return `${what}: xả ngăn${old ? ` (${bowls(old)} hết hạn, sắp hết hạn hoặc nhả lỗi)` : ''} rồi nạp ${quantity}`
  }
  if (slot.suggestedAction === 'LOAD') return `${what}: nạp thêm ${quantity}`
  return `${what}: không cần nạp`
}

// ---- loading per line

/** Bowls still to load for the plan (never negative). */
export const leftToLoad = (line: Pick<RestockLine, 'plannedQuantity' | 'loadedQuantity'>) => Math.max(plannedOf(line) - loadedOf(line), 0)

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

/**
 * Body of POST .../restock-lines/{lineId}/loads: { batchId, quantity } and acknowledgeExpiryInversion only when the
 * person confirmed loading a batch that expires before bowls already in the column.
 */
export function lineLoadBody(batchId: string, raw: string, room: LoadRoom = {}, acknowledge = false) {
  const errors: Record<string, string> = {}
  if (!batchId) errors.batchId = 'Chọn lô hàng để nạp.'
  const problem = quantityProblem(raw, room, true)
  if (problem) errors.quantity = problem
  const quantity = parseBoxCount(raw)
  if (quantity === undefined || quantity < 1 || quantity > LOAD_MAX_PER_REQUEST) errors.quantity ||= QUANTITY_INVALID
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return acknowledge ? { batchId, quantity: quantity!, acknowledgeExpiryInversion: true } : { batchId, quantity: quantity! }
}

// ---- reconciliation and completion

export interface ReconcileRow {
  lineId: string; slotCode: string; productName: string; planned: number; loaded: number; difference: number; text: string
  /** Reason already stored on the line (varianceReason), if any. */
  savedReason: string | null
}
export interface Reconciliation { rows: ReconcileRow[]; planned: number; loaded: number; difference: number; varianceLines: number }

/** "Khớp", "Thiếu 2 hộp" or "Thừa 1 hộp": the difference in words (not by colour only). */
export function differenceText(difference: number): string {
  if (difference === 0) return 'Khớp kế hoạch'
  return difference < 0 ? `Thiếu ${n(-difference)} hộp` : `Thừa ${n(difference)} hộp`
}

/** Plan against result per line and in total; a line whose loaded ≠ planned needs a reason (rule of POST /complete). */
export function reconcile(lines: readonly RestockLine[]): Reconciliation {
  const rows = lines.map(line => {
    const planned = plannedOf(line), loaded = loadedOf(line), difference = loaded - planned
    return { lineId: line.id ?? '', slotCode: line.slotCode ?? '', productName: line.productName ?? '', planned, loaded, difference, text: differenceText(difference), savedReason: line.varianceReason?.trim() || null }
  })
  const sum = (pick: (row: ReconcileRow) => number) => rows.reduce((total, row) => total + pick(row), 0)
  return { rows, planned: sum(row => row.planned), loaded: sum(row => row.loaded), difference: sum(row => row.difference), varianceLines: rows.filter(row => row.difference !== 0).length }
}

export const VARIANCE_REQUIRED = 'Dòng này nạp khác kế hoạch: ghi lý do (ví dụ “Lô mới chỉ còn 4 hộp”).'
export const RESULT_REQUIRED = 'Ghi kết quả nạp hàng (bắt buộc), ví dụ “Đã xả B, nạp đủ A”.'
export const varianceField = (lineId: string) => `variance-${lineId}`

/**
 * Body of POST /complete for a restock: resultNote (required) and lineVariances for every line loaded ≠ planned whose
 * reason was typed now; a differing line without a typed or stored reason is a field error. Typed reasons of matching
 * lines are not sent.
 */
export function restockCompleteBody(note: string, rows: readonly ReconcileRow[], reasons: Readonly<Record<string, string>>): { body?: CompleteWorkOrderBody; errors?: Record<string, string> } {
  const errors: Record<string, string> = {}
  const text = note.trim()
  if (!text) errors.resultNote = RESULT_REQUIRED
  else if (text.length > TICKET_LIMITS.note) errors.resultNote = `Tối đa ${TICKET_LIMITS.note} ký tự.`
  const lineVariances: LineVariance[] = []
  for (const row of rows) {
    if (row.difference === 0) continue
    const reason = (reasons[row.lineId] ?? '').trim()
    if (reason.length > 500) errors[varianceField(row.lineId)] = 'Tối đa 500 ký tự.'
    else if (reason) lineVariances.push({ lineId: row.lineId, reason })
    else if (!row.savedReason) errors[varianceField(row.lineId)] = VARIANCE_REQUIRED
  }
  if (Object.keys(errors).length) return { errors }
  return { body: lineVariances.length ? { resultNote: text, lineVariances } : { resultNote: text } }
}

// ---- errors

export const RESTOCK_STALE = 'Phiếu không còn ở trạng thái đang thực hiện (có thể đã hoàn tất hoặc bị hủy ở nơi khác). Trang đã tải lại; xem trạng thái mới nhất.'
export const RESTOCK_NOT_ASSIGNEE = 'Phiếu này không còn giao cho bạn (hoặc tài khoản thiếu quyền nạp hàng) nên bạn không thực hiện bước này được. Hãy hỏi quản trị viên.'

/**
 * A failed load of a line: field errors for the batch and the count (capacity, batch quantity with the FE 4.3 wording;
 * `refresh` when the figures must be read again), `inversion` when the batch expires before bowls already in the column
 * (the person may confirm and load anyway), `stale` when the work order is no longer IN_PROGRESS or no longer theirs.
 */
export function describeLineLoadError(error: unknown, quantity: number | undefined, room: LoadRoom): { error: unknown; refresh: boolean; stale?: boolean; inversion?: string; conflict?: FitConflict } {
  if (!(error instanceof ApiError)) return { error, refresh: false }
  const code = errorCode(error)
  const batch = room.batchCode ? `Lô ${room.batchCode}` : 'Lô đã chọn'
  if (error.status === 409) {
    if (code === 'SLOT_CAPACITY_EXCEEDED' || code === 'BATCH_QUANTITY_EXCEEDED') {
      const conflict: FitConflict = { kind: code === 'SLOT_CAPACITY_EXCEEDED' ? 'slot' : 'batch', quantity: quantity ?? 0 }
      return { error: new ValidationError({ quantity: fitConflictText(conflict, room, 'pending') }), refresh: true, conflict }
    }
    if (code === 'EXPIRY_INVERSION') return { error: error, refresh: false, inversion: `${batch} hết hạn sớm hơn các hộp đang có trong ngăn: hộp mới sẽ nằm trên và bán sau chúng, có thể hết hạn trong ngăn. Chọn lô khác, hoặc xác nhận vẫn nạp.` }
    if (code === 'BATCH_PRODUCT_MISMATCH') return { error: new ValidationError({ batchId: 'Lô đã chọn không phải sản phẩm của dòng này. Chọn lô đúng sản phẩm.' }), refresh: false }
    if (code === 'BATCH_EXPIRED') return { error: new ValidationError({ batchId: `${batch} đã hoặc sắp hết hạn (trong 5 phút) nên không nạp được. Chọn lô khác còn hạn.` }), refresh: true }
    if (code === 'SLOT_INACTIVE') return { error: new ApiError(409, `Ngăn ${room.slotCode ?? ''} đang ngừng hoạt động nên không nạp được. Nhờ quản trị viên bật ngăn rồi thử lại.`), refresh: true }
    if (code === 'WORK_ORDER_NOT_IN_PROGRESS' || code === 'INVALID_WORK_ORDER_TRANSITION') return { error: new ApiError(409, RESTOCK_STALE), refresh: true, stale: true }
    return { error: new ApiError(409, 'Máy chủ từ chối lần nạp này vì dữ liệu vừa thay đổi. Số liệu đã được tải lại; kiểm tra rồi nạp lại.'), refresh: true }
  }
  if (error.status === 404 || error.status === 403) return { error: new ApiError(error.status, RESTOCK_NOT_ASSIGNEE), refresh: false, stale: true }
  if (error.status === 400 && (error.fieldErrors.quantity || error.fieldErrors.batchId)) {
    return { error: new ValidationError({ ...(error.fieldErrors.quantity ? { quantity: QUANTITY_INVALID } : {}), ...(error.fieldErrors.batchId ? { batchId: 'Lô đã chọn không hợp lệ. Chọn lại lô.' } : {}) }), refresh: false }
  }
  return { error, refresh: false }
}

/** A failed completion: field errors on the result or the lines, known blockers explained, 409/404 reload the screen. */
export function describeCompleteError(error: unknown, rows: readonly ReconcileRow[]): { error: unknown; stale: boolean } {
  if (!(error instanceof ApiError)) return { error, stale: false }
  const code = errorCode(error)
  if (error.status === 400 && error.fieldErrors.resultNote) return { error: new ValidationError({ resultNote: RESULT_REQUIRED }), stale: false }
  if (code === 'RESTOCK_VARIANCE_REASON_REQUIRED') {
    return { error: new ValidationError(Object.fromEntries(rows.filter(row => row.difference !== 0 && !row.savedReason).map(row => [varianceField(row.lineId), VARIANCE_REQUIRED]))), stale: false }
  }
  if (code === 'REFILL_GATE_OPEN') return { error: new ApiError(409, 'Còn ngăn đang mở cổng nạp. Quay lại bước “Đóng cổng nạp” rồi hoàn tất.'), stale: true }
  if (code === 'MACHINE_COMMAND_IN_PROGRESS') return { error: new ApiError(409, 'Còn lệnh bảo trì chưa xong hoặc chờ đối soát. Chờ lệnh xong (hoặc đối soát ở thẻ Bảo trì của máy) rồi hoàn tất.'), stale: true }
  if (error.status === 409) return { error: new ApiError(409, RESTOCK_STALE), stale: true }
  if (error.status === 404 || error.status === 403) return { error: new ApiError(error.status, RESTOCK_NOT_ASSIGNEE), stale: true }
  return { error, stale: false }
}

// ---- refill gates and linked maintenance commands

/** Slots of the machine whose refill gate is open (POST /complete refuses with REFILL_GATE_OPEN while any is). */
export function openGates<T extends Pick<Slot, 'refillGateOpen'>>(slots: readonly T[] | undefined): T[] {
  return (slots ?? []).filter(slot => slot.refillGateOpen)
}
/** The newest maintenance command of this work order that needs attention: it failed, or waits for a reconciliation. */
export function linkedAttention<T extends Pick<LinkedMaintenanceCommand, 'status' | 'createdAt'>>(commands: readonly T[] | undefined): T | undefined {
  const newest = [...(commands ?? [])].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]
  return newest && (newest.status === 'FAILED' || newest.status === 'NEEDS_RECONCILIATION') ? newest : undefined
}

// ---- planning lines (RESTOCK_PLAN, only while nothing was loaded against a line)

export const PLAN_LINE_MAX = 1000
export interface LineValues { slotId: string; productId: string; plannedQuantity: string; [key: string]: string }
export const NEW_LINE: LineValues = { slotId: '', productId: '', plannedQuantity: '' }

/** Client checks of a planned line: slot, product, 1..capacity (the server checks again). */
export function validateLine(values: LineValues, capacity?: number): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!values.slotId) errors.slotId = 'Chọn ngăn.'
  if (!values.productId) errors.productId = 'Chọn sản phẩm.'
  const quantity = parseBoxCount(values.plannedQuantity)
  const max = Math.min(capacity ?? PLAN_LINE_MAX, PLAN_LINE_MAX)
  if (quantity === undefined || quantity < 1) errors.plannedQuantity = QUANTITY_INVALID
  else if (quantity > max) errors.plannedQuantity = `Tối đa ${bowls(max)} (sức chứa của ngăn).`
  return errors
}
/** Body of POST .../restock-lines. */
export function lineInputBody(values: LineValues): RestockLineInput {
  return { slotId: values.slotId, productId: values.productId, plannedQuantity: parseBoxCount(values.plannedQuantity) ?? 0 }
}
/** Body of PATCH .../restock-lines/{lineId}: only what changed; undefined when nothing did. */
export function updateLineBody(line: Pick<RestockLine, 'plannedQuantity' | 'productId'>, values: Pick<LineValues, 'plannedQuantity' | 'productId'>): UpdateRestockLineBody | undefined {
  const body: UpdateRestockLineBody = {}
  const quantity = parseBoxCount(values.plannedQuantity)
  if (quantity !== undefined && quantity !== line.plannedQuantity) body.plannedQuantity = quantity
  if (values.productId && values.productId !== line.productId) body.productId = values.productId
  return Object.keys(body).length ? body : undefined
}

const PLAN_CONFLICTS: Readonly<Record<string, string>> = {
  LINE_ALREADY_LOADED: 'Dòng này đã có hộp được nạp nên không sửa hay bỏ được nữa. Ghi chênh lệch ở bước Đối chiếu.',
  DUPLICATE_LINE: 'Ngăn này đã có dòng cho sản phẩm đó. Sửa số hộp của dòng đang có thay vì thêm dòng mới.',
  SLOT_INACTIVE: 'Ngăn đang ngừng hoạt động nên không lập kế hoạch nạp được. Bật ngăn trước.',
  PRODUCT_INACTIVE: 'Sản phẩm đang ngừng bán nên không nạp được. Chọn sản phẩm khác.',
  INVALID_WORK_ORDER_TRANSITION: 'Phiếu đã hoàn tất hoặc đã hủy nên không đổi kế hoạch được nữa.',
}
/** A failed planning call in words; `stale` when the screen must reload. */
export function describePlanError(error: unknown): { error: unknown; stale: boolean } {
  if (!(error instanceof ApiError)) return { error, stale: false }
  const code = errorCode(error)
  if (error.status === 409) return { error: new ApiError(409, (code && PLAN_CONFLICTS[code]) || 'Kế hoạch vừa thay đổi ở nơi khác. Trang đã tải lại; kiểm tra rồi thử lại.'), stale: true }
  if (error.status === 404) return { error: new ApiError(404, 'Không tìm thấy dòng hoặc phiếu này nữa. Trang đã tải lại.'), stale: true }
  return { error, stale: false }
}
