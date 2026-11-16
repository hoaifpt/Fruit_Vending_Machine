// Rules of the order detail screen (T1, FE 6.1) that do not need React: the order timeline, the bowls held for the order
// with one-click links to their slot on the inventory map and to their own history, how far dispensing got, and what
// still needs a person. Unit-tested (tests/order-detail.test.mjs).
//
// Sources: api-contract/api.yaml (GET /orders/{id}: OrderDetailResponse; allocations carry inventoryItemId, slotCode and
// their status but no slotId). The backend has no read endpoint for the dispense commands of an order, so dispensing is
// read from the order status and the allocations (docs/order-management.md, api-contract/mqtt-contract.md §4.1): a
// dispensed bowl's allocation is DISPENSED; a bowl that failed unsafely (ABORTED, TIMEOUT) keeps its allocation RESERVED
// and the bowl DISPENSE_FAILED (it blocks its slot); a safe failure (REJECTED) returns the bowl: allocation RELEASED.
// The commands themselves are in the machine's event history (tab "Cảm biến & Sự kiện" of the machine).
import type { OrderDetail, Slot } from '../api/resources.ts'
import { formatDateTime } from '../lib/format.ts'
import { uuidParam } from '../lib/table-query.ts'

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
 * Whether the order reached the dispensing stage (the backend created one dispense command per bowl with the move to
 * PAID): decided by the status only. A CANCELLED / PAYMENT_FAILED order never gets a command, even with a paidAt.
 */
export function wasPaid(order: Pick<OrderDetail, 'status'>): boolean {
  return PAID_STATUSES.includes(order.status ?? '')
}

/** Why an order never reached dispensing, by status. */
export function noCommandText(order: Pick<OrderDetail, 'status'>): string {
  if (order.status === 'PENDING_PAYMENT') return 'Chưa nhả hàng: lệnh nhả hàng chỉ được tạo khi đơn đã thanh toán thành công.'
  return 'Đơn này không nhả hàng: đơn đã kết thúc trước bước nhả hàng.'
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
  /** Slot of the bowl, looked up by code among the machine's slots ('' when unknown). */
  slotId: string
  /** One click to the slot on the inventory map (the whole machine when the slot id is unknown). */
  slotPath: string
  /** One click to the bowl's history; '' when the bowl id is missing. */
  boxPath: string
}

/** Every bowl held for the order, in line order, with its links. */
export function allocationRows(order: OrderDetail, slotIds: Readonly<Record<string, string>> = {}): AllocationRow[] {
  return (order.items ?? []).flatMap(line => (line.allocations ?? []).map(allocation => {
    const slotId = allocation.slotCode ? slotIds[allocation.slotCode] ?? '' : ''
    return {
      allocation, productName: line.productName, slotId,
      slotPath: inventoryMapPath(order.machineId, slotId), boxPath: boxHistoryPath(allocation.inventoryItemId),
    }
  }))
}

// ---- dispensing, from the allocations

/**
 * How far dispensing got: `dispensed` bowls handed out (DISPENSED), `held` still RESERVED (waiting for the machine on a
 * live order; on a finished order a bowl that failed and blocks its slot), `released` given back to the slot.
 */
export interface DispenseTally { total: number; dispensed: number; held: number; released: number }
export function dispenseTally(order: Pick<OrderDetail, 'items'>): DispenseTally {
  const tally = { total: 0, dispensed: 0, held: 0, released: 0 }
  for (const allocation of (order.items ?? []).flatMap(line => line.allocations ?? [])) {
    tally.total += 1
    if (allocation.status === 'DISPENSED') tally.dispensed += 1
    else if (allocation.status === 'RELEASED') tally.released += 1
    else tally.held += 1
  }
  return tally
}
/** Bowls of a finished order that were not handed out and still block their slot (allocation RESERVED). */
export function failedBowls(order: Pick<OrderDetail, 'status' | 'items'>): number {
  return isLiveOrder(order) ? 0 : dispenseTally(order).held
}
/** Machine history tab, where each dispense command of the order shows as events (no per-order command API). */
export function machineEventsPath(machineId: string | undefined): string {
  const id = uuidParam(machineId ?? '')
  return id ? `/admin/machines/${id}?tab=sensors` : ''
}

// ---- timeline

/** done: happened; current: in progress now; failed: ended badly; stopped: ended without going further; upcoming: not yet. */
export type StepState = 'done' | 'current' | 'failed' | 'stopped' | 'upcoming'
export interface TimelineStep { key: string; label: string; state: StepState; at?: string; detail: string }
export const STEP_STATE_TEXT: Record<StepState, string> = {
  done: 'Đã xong', current: 'Đang diễn ra', failed: 'Thất bại', stopped: 'Đã dừng', upcoming: 'Chưa tới',
}

function dispenseStep(order: OrderDetail): TimelineStep {
  const tally = dispenseTally(order)
  const counted = tally.total ? ` Máy đã nhả ${tally.dispensed}/${tally.total} hộp.` : ''
  switch (order.status) {
    case 'PAID':
      return { key: 'dispense', label: 'Chờ máy nhả hàng', state: 'current', at: order.paidAt,
        detail: 'Lệnh nhả hàng đã tạo cùng lúc thanh toán thành công, đang chờ gửi xuống máy. Hệ thống tự thử lại nếu máy chưa nhận.' }
    case 'DISPENSING':
      // The backend moves the order to DISPENSING as soon as a command is published, before the machine answers.
      return { key: 'dispense', label: 'Đang nhả hàng', state: 'current', detail: `Lệnh đã gửi xuống máy, đang chờ máy báo kết quả.${counted}` }
    case 'COMPLETED': {
      // Several bowls: one may have failed before another succeeded; the order still ends COMPLETED, but the failed bowl
      // keeps its allocation RESERVED, blocks its slot and was not served.
      if (tally.held) return { key: 'dispense', label: 'Nhả hàng có hộp lỗi', state: 'failed', at: order.completedAt,
        detail: `${tally.held} hộp nhả lỗi đang chặn ngăn và khách chưa nhận hộp đó, dù đơn ghi nhận hoàn tất.${counted}` }
      return { key: 'dispense', label: 'Đã nhả hàng', state: 'done', at: order.completedAt, detail: `Máy đã nhả hộp cho khách.${counted}` }
    }
    case 'DISPENSE_FAILED': {
      const blocked = tally.held ? ` ${tally.held} hộp bị đánh dấu nhả lỗi và chặn ngăn cho tới khi nhân viên kiểm tra.` : ''
      const returned = tally.released ? ` ${tally.released} hộp đã được trả lại ngăn để bán tiếp.` : ''
      return { key: 'dispense', label: 'Nhả hàng thất bại', state: 'failed', detail: `Máy không nhả được hộp (hoặc không báo kết quả trong 60 giây).${blocked}${returned}${counted}` }
    }
    default: {
      // REFUNDED (or a status the web does not know yet): only what the allocations say, if anything.
      if (!tally.total) return { key: 'dispense', label: 'Nhả hàng', state: 'stopped', detail: 'Không có thông tin nhả hàng của đơn này.' }
      if (tally.dispensed === tally.total) return { key: 'dispense', label: 'Đã nhả hàng', state: 'done', detail: `Máy đã nhả hộp cho khách.${counted}` }
      if (tally.held) return { key: 'dispense', label: 'Nhả hàng thất bại', state: 'failed', detail: `Máy không nhả được hộp.${counted}` }
      return { key: 'dispense', label: 'Nhả hàng', state: 'stopped', detail: `Hộp chưa nhả đã được trả lại ngăn.${counted}` }
    }
  }
}

/**
 * Steps of the order, oldest first: created → payment → dispensing → end. Built from the order's own instants, status
 * and allocations. An order that never got paid stops at the payment step; a live order shows the steps still to come
 * as "upcoming".
 */
export function orderTimeline(order: OrderDetail): TimelineStep[] {
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
      return [created, paid, dispenseStep(order), completion]
    case 'COMPLETED':
      return [created, paid, dispenseStep(order), { ...completion, state: 'done', at: order.completedAt,
        detail: failedBowls(order) ? 'Đơn hoàn tất vì máy đã nhả được hộp sau cùng; hộp nhả lỗi vẫn cần xử lý.' : 'Khách đã nhận hộp.' }]
    case 'DISPENSE_FAILED':
      return [created, paid, dispenseStep(order)]
    case 'REFUNDED':
      return [created, paid, dispenseStep(order), { key: 'refunded', label: 'Đã hoàn tiền', state: 'done', detail: 'Tiền của đơn đã được hoàn lại cho khách.' }]
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
export function orderAttention(order: OrderDetail): Attention[] {
  const result: Attention[] = []
  const successes = (order.payments ?? []).filter(payment => payment.status === 'SUCCESS')
  const failed = order.status === 'COMPLETED' ? failedBowls(order) : 0
  if (order.status === 'DISPENSE_FAILED') {
    result.push({ key: 'dispense-failed', paymentId: successes[0]?.id, text: 'Khách đã trả tiền nhưng máy chưa nhả được hộp. Kiểm tra ngăn tại máy (hộp nhả lỗi đang chặn ngăn), rồi hoàn tiền thủ công cho khách (chuyển khoản) và ghi nhận ở màn Hoàn tiền.' })
  } else if (failed) {
    result.push({ key: 'box-failed', paymentId: successes[0]?.id, text: `${failed} hộp của đơn nhả lỗi dù đơn đã hoàn tất: hộp đó chặn ngăn và khách chưa nhận. Kiểm tra ngăn tại máy, rồi hoàn tiền thủ công phần hộp lỗi.` })
  }
  if ((order.status === 'CANCELLED' || order.status === 'PAYMENT_FAILED') && successes.length) {
    result.push({ key: 'late-payment', text: 'Có thanh toán thành công trên đơn không còn được phục vụ: cần đối soát và hoàn tiền thủ công.', paymentId: successes[0].id })
  }
  if (successes.length > 1) {
    result.push({ key: 'duplicate-payment', text: `Đơn có ${successes.length} lần thanh toán thành công: khách có thể đã trả hai lần, cần đối soát.`, paymentId: successes[1].id })
  }
  return result
}
