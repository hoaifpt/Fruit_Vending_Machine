// Rules of the order detail screen (T1, FE 6.1) that do not need React: the order timeline, the bowls held for the order
// with one-click links to their slot on the inventory map and to their own history, the dispense commands and what
// each one means, and what still needs a person. Unit-tested (tests/order-detail.test.mjs).
//
// Sources: api-contract/api.yaml (GET /orders/{id}: OrderDetailResponse, allocations carry inventoryItemId and slotCode
// but no slotId), api-contract/drafts/dispense-commands.yaml (GET /orders/{orderId}/dispense-commands, DRAFT waiting for
// backend issue 3.3), docs/order-management.md and docs/mqtt-dispense.md (one command per paid bowl, re-sent every 5 s
// with the same commandId, TIMEOUT after 60 s, a late DISPENSE_COMPLETED still turns the command and the order to
// success), backend DispenseService (FAILED/TIMEOUT leave the bowl DISPENSE_FAILED and the allocation RESERVED).
import { ApiError } from '../api/client.ts'
import type { DispenseCommand, OrderDetail, Slot } from '../api/resources.ts'
import { formatDateTime } from '../lib/format.ts'
import { uuidParam } from '../lib/table-query.ts'

/** DISPENSE_TIMEOUT of the backend: an unfinished command becomes TIMEOUT this long after it was created. */
export const DISPENSE_TIMEOUT_MS = 60_000
/** DISPENSE_RESEND_AFTER of the backend: an unanswered PENDING/SENT command is re-sent with the same code. */
export const DISPENSE_RESEND_MS = 5_000
/** Order statuses that still change by themselves (payment, dispensing): the screen refreshes while in one of them. */
export const LIVE_ORDER_STATUSES: readonly string[] = ['PENDING_PAYMENT', 'PAID', 'DISPENSING']
/** Statuses that mean the customer paid (the backend created dispense commands with the move to PAID). */
const PAID_STATUSES: readonly string[] = ['PAID', 'DISPENSING', 'COMPLETED', 'DISPENSE_FAILED', 'REFUNDED']
/** Refresh period of a live order. */
export const LIVE_POLL_MS = 5_000

type Allocation = NonNullable<NonNullable<OrderDetail['items']>[number]['allocations']>[number]

export function isLiveOrder(order: Pick<OrderDetail, 'status'>): boolean {
  return LIVE_ORDER_STATUSES.includes(order.status ?? '')
}

/**
 * Whether the order reached the dispensing stage, so it has (or will have) dispense commands: decided by the status
 * only. A CANCELLED / PAYMENT_FAILED order never gets a command, even with a paidAt (a late payment), so the commands
 * API is not asked for it.
 */
export function wasPaid(order: Pick<OrderDetail, 'status'>): boolean {
  return PAID_STATUSES.includes(order.status ?? '')
}

/** Why an order has no dispense command, by status (shown instead of the commands table). */
export function noCommandText(order: Pick<OrderDetail, 'status'>): string {
  if (order.status === 'PENDING_PAYMENT') return 'Chưa có lệnh nhả hàng: lệnh chỉ được tạo khi đơn đã thanh toán thành công.'
  return 'Đơn này không có lệnh nhả hàng: đơn đã kết thúc trước bước nhả hàng.'
}

/** Last 8 characters of an id, as shown elsewhere on the inventory screens ("…a1b2c3d4"). */
export function shortId(id: string | undefined): string {
  return id ? `…${id.slice(-8)}` : '—'
}

// ---- links (formats read by readMapQuery in inventory-map.ts and readHistoryFilters in inventory-history.ts)

/** Inventory map of the machine, narrowed to one slot when its id is known. Non-UUID ids are left out. */
export function inventoryMapPath(machineId: string | undefined, slotId?: string): string {
  const machine = uuidParam(machineId ?? '')
  if (!machine) return '/admin/inventory'
  const slot = uuidParam(slotId ?? '')
  return `/admin/inventory?machineId=${machine}${slot ? `&slotId=${slot}` : ''}`
}

/** History of one bowl, or '' when the id is not a UUID (the history screen would ignore it). */
export function boxHistoryPath(inventoryItemId: string | undefined): string {
  const id = uuidParam(inventoryItemId ?? '')
  return id ? `/admin/inventory/history?inventoryItemId=${id}` : ''
}

export function paymentPath(paymentId: string | undefined): string {
  return paymentId ? `/admin/payments/${encodeURIComponent(paymentId)}` : ''
}

/** slotCode → slotId of one machine's slots (the order's allocations only carry the code). */
export function slotIdsByCode(slots: readonly Slot[] | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  for (const slot of slots ?? []) if (slot.slotCode && slot.id) map[slot.slotCode] = slot.id
  return map
}

// ---- bowls

export interface AllocationRow {
  allocation: Allocation
  productName?: string
  /** Dispense command of this bowl, when the commands are known. */
  command?: DispenseCommand
  /** Slot of the bowl: from its command when there is one, else looked up by code among the machine's slots. */
  slotId: string
  /** One click to the slot on the inventory map (the whole machine when the slot id is unknown). */
  slotPath: string
  /** One click to the bowl's history; '' when the bowl id is missing. */
  boxPath: string
}

/** Every bowl held for the order, in line order, with its links and its command. */
export function allocationRows(order: OrderDetail, commands: readonly DispenseCommand[] = [], slotIds: Readonly<Record<string, string>> = {}): AllocationRow[] {
  return (order.items ?? []).flatMap(line => (line.allocations ?? []).map(allocation => {
    const command = commands.find(candidate => candidate.inventoryItemId === allocation.inventoryItemId)
    const slotId = uuidParam(command?.slotId ?? '') || (allocation.slotCode ? slotIds[allocation.slotCode] ?? '' : '')
    return {
      allocation, productName: line.productName, command, slotId,
      slotPath: inventoryMapPath(order.machineId, slotId), boxPath: boxHistoryPath(allocation.inventoryItemId),
    }
  }))
}

// ---- dispense commands

/**
 * How the screen treats a failed GET of the commands: `missing` when the backend does not have the endpoint yet (404,
 * 405, 501: the order itself loaded, so a 404 here is the path, not the order), `forbidden` for 403, else `error`.
 */
export type DispenseAvailability = 'missing' | 'forbidden' | 'error'
export function dispenseAvailability(error: unknown): DispenseAvailability {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 404 || status === 405 || status === 501) return 'missing'
  if (status === 403) return 'forbidden'
  return 'error'
}
export const DISPENSE_MISSING = 'Chưa có dữ liệu lệnh nhả hàng: máy chủ chưa cung cấp thông tin này. Trạng thái đơn, hộp và thanh toán ở trên vẫn là dữ liệu thật.'

const millis = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN)

/** A success the machine reported after the 60 s timeout (the command had already turned TIMEOUT or FAILED). */
export function isLateResult(command: Pick<DispenseCommand, 'status' | 'createdAt' | 'completedAt'>): boolean {
  if (command.status !== 'SUCCESS') return false
  const took = millis(command.completedAt) - millis(command.createdAt)
  return Number.isFinite(took) && took > DISPENSE_TIMEOUT_MS
}

/** Still waiting for the machine but past the timeout: the next backend sweep turns it TIMEOUT. */
export function isOverdue(command: Pick<DispenseCommand, 'status' | 'createdAt'>, nowMs: number): boolean {
  if (!['PENDING', 'SENT', 'ACKNOWLEDGED'].includes(command.status)) return false
  const created = millis(command.createdAt)
  return Number.isFinite(created) && nowMs - created > DISPENSE_TIMEOUT_MS
}

/**
 * When a command ended. FAILED/TIMEOUT before the command was ever sent have no completedAt (DispenseService sets it
 * only after a send): the last update time is shown instead, flagged `approximate`.
 */
export function commandEndedAt(command: Pick<DispenseCommand, 'status' | 'completedAt' | 'updatedAt'>): { at?: string; approximate: boolean } {
  if (command.completedAt) return { at: command.completedAt, approximate: false }
  if ((command.status === 'FAILED' || command.status === 'TIMEOUT') && command.updatedAt) return { at: command.updatedAt, approximate: true }
  return { at: undefined, approximate: false }
}

/** Commands that ended badly (the bowl is DISPENSE_FAILED and blocks its slot), whatever the order status says. */
export function failedCommands<T extends Pick<DispenseCommand, 'status'>>(commands: readonly T[] | undefined): T[] {
  return (commands ?? []).filter(command => command.status === 'FAILED' || command.status === 'TIMEOUT')
}

/** One sentence under a command: what happens next on its own, or what a person has to do. */
export function commandNote(command: Pick<DispenseCommand, 'status' | 'createdAt' | 'completedAt'>, nowMs: number): string {
  if (isOverdue(command, nowMs)) return 'Đã quá 60 giây mà máy chưa báo kết quả; lệnh sẽ chuyển "Quá thời gian" ở lần quét kế tiếp.'
  switch (command.status) {
    case 'PENDING': return 'Chưa gửi được xuống máy (máy mất kết nối hoặc kênh lệnh đang tắt). Hệ thống thử lại mỗi 5 giây.'
    case 'SENT': return 'Đang chờ máy xác nhận. Hệ thống gửi lại cùng mã lệnh mỗi 5 giây; máy không nhả hai lần.'
    case 'ACKNOWLEDGED': return 'Máy đang nhả hộp, chờ máy báo kết quả.'
    case 'SUCCESS': {
      if (!isLateResult(command)) return 'Máy đã nhả hộp.'
      const seconds = Math.round((millis(command.completedAt) - millis(command.createdAt)) / 1000)
      return `Kết quả đến muộn: máy báo nhả xong sau ${seconds} giây (quá 60 giây), lệnh và đơn đã chuyển sang thành công.`
    }
    case 'FAILED': return 'Máy báo không nhả được; hộp chặn ngăn cho tới khi nhân viên kiểm tra. Nếu máy báo nhả xong muộn, lệnh tự chuyển thành công.'
    case 'TIMEOUT': return 'Máy không báo kết quả trong 60 giây. Nếu máy báo nhả xong muộn, lệnh và đơn tự chuyển thành công.'
    default: return ''
  }
}

export interface DispenseTally { total: number; success: number; failed: number; open: number }
export function dispenseTally(commands: readonly Pick<DispenseCommand, 'status'>[]): DispenseTally {
  const tally = { total: commands.length, success: 0, failed: 0, open: 0 }
  for (const command of commands) {
    if (command.status === 'SUCCESS') tally.success += 1
    else if (command.status === 'FAILED' || command.status === 'TIMEOUT') tally.failed += 1
    else tally.open += 1
  }
  return tally
}

// ---- timeline

/** done: happened; current: in progress now; failed: ended badly; stopped: ended without going further; upcoming: not yet. */
export type StepState = 'done' | 'current' | 'failed' | 'stopped' | 'upcoming'
export interface TimelineStep { key: string; label: string; state: StepState; at?: string; detail: string }
export const STEP_STATE_TEXT: Record<StepState, string> = {
  done: 'Đã xong', current: 'Đang diễn ra', failed: 'Thất bại', stopped: 'Đã dừng', upcoming: 'Chưa tới',
}

/** Latest of the given instants (ISO strings), or undefined. */
function latest(values: (string | null | undefined)[]): string | undefined {
  let best: string | undefined, bestMs = Number.NEGATIVE_INFINITY
  for (const value of values) {
    const ms = millis(value)
    if (Number.isFinite(ms) && ms > bestMs) { best = value ?? undefined; bestMs = ms }
  }
  return best
}

function dispenseStep(order: OrderDetail, commands: readonly DispenseCommand[] | undefined): TimelineStep {
  const tally = commands ? dispenseTally(commands) : undefined
  const counted = tally && tally.total ? ` Máy đã nhả ${tally.success}/${tally.total} hộp.` : ''
  const ended = commands ? latest(commands.map(command => commandEndedAt(command).at)) : undefined
  switch (order.status) {
    case 'PAID': {
      const waiting = commands?.some(command => command.status === 'PENDING')
      return { key: 'dispense', label: 'Chờ máy nhả hàng', state: 'current', at: commands ? latest(commands.map(command => command.sentAt ?? command.createdAt)) : undefined,
        detail: waiting ? 'Lệnh chưa gửi được xuống máy; hệ thống tự thử lại trong 60 giây.' : 'Lệnh đã tạo cùng lúc thanh toán thành công, đang chờ máy nhận.' }
    }
    case 'DISPENSING': {
      // The backend moves the order to DISPENSING as soon as a command is published (markSent), before the machine answers:
      // "the machine received it" is only said once a command has acknowledgedAt.
      const acknowledged = commands?.some(command => !!command.acknowledgedAt)
      return { key: 'dispense', label: 'Đang nhả hàng', state: 'current', at: commands ? latest(commands.map(command => command.acknowledgedAt ?? command.sentAt)) : undefined,
        detail: `${acknowledged ? 'Máy đã nhận lệnh, đang chờ máy báo kết quả.' : 'Lệnh đã gửi xuống máy, đang chờ máy xác nhận.'}${counted}` }
    }
    case 'COMPLETED': {
      // Several bowls: one may have failed before another succeeded; the order still ends COMPLETED (backend
      // DispenseService.completed), but the failed bowl blocks its slot and was not served.
      if (tally?.failed) return { key: 'dispense', label: 'Nhả hàng có hộp lỗi', state: 'failed', at: ended ?? order.completedAt,
        detail: `${tally.failed} hộp nhả lỗi đang chặn ngăn và khách chưa nhận hộp đó, dù đơn ghi nhận hoàn tất.${counted}` }
      const late = commands?.some(isLateResult)
      return { key: 'dispense', label: 'Đã nhả hàng', state: 'done', at: ended ?? order.completedAt,
        detail: `${late ? 'Máy báo nhả xong sau thời hạn 60 giây (kết quả đến muộn), đơn vẫn được ghi nhận hoàn tất.' : 'Máy đã nhả hộp cho khách.'}${counted}` }
    }
    case 'DISPENSE_FAILED': {
      const timedOut = commands?.some(command => command.status === 'TIMEOUT')
      return { key: 'dispense', label: 'Nhả hàng thất bại', state: 'failed', at: ended ?? (commands ? latest(commands.map(command => command.updatedAt)) : undefined),
        detail: `${timedOut ? 'Máy không báo kết quả trong 60 giây.' : 'Máy không nhả được hộp.'} Hộp bị đánh dấu nhả lỗi và chặn ngăn cho tới khi nhân viên kiểm tra.${counted}` }
    }
    default: {
      // REFUNDED (or a status the web does not know yet): only what the commands say, if anything.
      if (!tally?.total) return { key: 'dispense', label: 'Nhả hàng', state: 'stopped', detail: 'Không có thông tin nhả hàng của đơn này.' }
      if (tally.failed) return { key: 'dispense', label: 'Nhả hàng thất bại', state: 'failed', at: ended, detail: `Máy không nhả được hộp.${counted}` }
      if (tally.success === tally.total) return { key: 'dispense', label: 'Đã nhả hàng', state: 'done', at: ended, detail: `Máy đã nhả hộp cho khách.${counted}` }
      return { key: 'dispense', label: 'Nhả hàng', state: 'stopped', detail: `Lệnh nhả hàng chưa kết thúc.${counted}` }
    }
  }
}

/**
 * Steps of the order, oldest first: created → payment → dispensing → end. Built from the order's own instants and
 * status; the dispense commands (when known) add their times and counts. An order that never got paid stops at the
 * payment step; a live order shows the steps still to come as "upcoming".
 */
export function orderTimeline(order: OrderDetail, commands?: readonly DispenseCommand[]): TimelineStep[] {
  const created: TimelineStep = { key: 'created', label: 'Tạo đơn', state: 'done', at: order.createdAt, detail: `Kiosk tạo đơn và giữ hộp tới ${formatDateTime(order.expiresAt)}.` }
  const paid: TimelineStep = { key: 'paid', label: 'Đã thanh toán', state: 'done', at: order.paidAt, detail: 'Hệ thống nhận được tiền và tạo lệnh nhả hàng cho từng hộp.' }
  const completion: TimelineStep = { key: 'completed', label: 'Hoàn tất', state: 'upcoming', detail: 'Khách nhận hộp.' }
  switch (order.status) {
    case 'PENDING_PAYMENT':
      return [created, { key: 'paid', label: 'Chờ thanh toán', state: 'current', detail: `Khách cần quét mã QR trước ${formatDateTime(order.expiresAt)}; quá hạn thì đơn tự hủy và hộp trở lại ngăn.` },
        { key: 'dispense', label: 'Nhả hàng', state: 'upcoming', detail: 'Bắt đầu ngay khi thanh toán thành công.' }, completion]
    case 'CANCELLED':
      return [created, ...(order.paidAt ? [paid] : []),
        { key: 'cancelled', label: 'Đã hủy', state: 'stopped', at: order.cancelledAt, detail: 'Đơn bị hủy hoặc hết hạn thanh toán; hộp đã trả lại ngăn để bán tiếp.' }]
    case 'PAYMENT_FAILED':
      return [created, { key: 'payment-failed', label: 'Thanh toán thất bại', state: 'failed', at: order.cancelledAt, detail: 'Thanh toán không thành công; đơn không được xử lý tiếp và hộp trở lại ngăn.' }]
    case 'PAID':
    case 'DISPENSING':
      return [created, paid, dispenseStep(order, commands), completion]
    case 'COMPLETED':
      return [created, paid, dispenseStep(order, commands), { ...completion, state: 'done', at: order.completedAt,
        detail: failedCommands(commands).length ? 'Đơn hoàn tất vì máy đã nhả được hộp sau cùng; hộp nhả lỗi vẫn cần xử lý.' : 'Khách đã nhận hộp.' }]
    case 'DISPENSE_FAILED':
      return [created, paid, dispenseStep(order, commands)]
    case 'REFUNDED':
      return [created, paid, dispenseStep(order, commands), { key: 'refunded', label: 'Đã hoàn tiền', state: 'done', detail: 'Tiền của đơn đã được hoàn lại cho khách.' }]
    default:
      return [created, { key: 'unknown', label: order.status ?? 'Không rõ trạng thái', state: 'current', detail: 'Hệ thống chưa có mô tả cho trạng thái này. Hãy báo quản trị viên kiểm tra.' }]
  }
}

// ---- what needs a person

export interface Attention { key: string; text: string; paymentId?: string }

/**
 * What staff must do about this order: a failed dispense (check the slot, refund by hand: the web has no refund), a
 * failed bowl inside an order whose status does not say so (several bowls, a later one succeeded: the order is
 * COMPLETED), money received on an order that will not be served (late payment on a cancelled order), or two
 * successful payments. Refund items link the successful payment.
 */
export function orderAttention(order: OrderDetail, commands?: readonly DispenseCommand[]): Attention[] {
  const result: Attention[] = []
  const successes = (order.payments ?? []).filter(payment => payment.status === 'SUCCESS')
  const failed = failedCommands(commands)
  if (order.status === 'DISPENSE_FAILED') {
    result.push({ key: 'dispense-failed', paymentId: successes[0]?.id, text: 'Khách đã trả tiền nhưng máy chưa nhả được hộp. Kiểm tra ngăn tại máy (hộp nhả lỗi đang chặn ngăn), rồi hoàn tiền thủ công cho khách (chuyển khoản) và ghi nhận ở màn Hoàn tiền.' })
  } else if (failed.length) {
    result.push({ key: 'box-failed', paymentId: successes[0]?.id, text: `${failed.length} hộp của đơn nhả lỗi (lệnh thất bại hoặc quá thời gian) dù đơn đang ở trạng thái khác: hộp đó chặn ngăn và khách chưa nhận. Kiểm tra ngăn tại máy, rồi hoàn tiền thủ công phần hộp lỗi.` })
  }
  if ((order.status === 'CANCELLED' || order.status === 'PAYMENT_FAILED') && successes.length) {
    result.push({ key: 'late-payment', text: 'Có thanh toán thành công trên đơn không còn được phục vụ: cần đối soát và hoàn tiền thủ công.', paymentId: successes[0].id })
  }
  if (successes.length > 1) {
    result.push({ key: 'duplicate-payment', text: `Đơn có ${successes.length} lần thanh toán thành công: khách có thể đã trả hai lần, cần đối soát.`, paymentId: successes[1].id })
  }
  return result
}
