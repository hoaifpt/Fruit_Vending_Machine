// Pure purchase-flow rules (issue #40 §6–7). The backend decides payment state; the kiosk only maps
// GET /kiosk/orders/{id} to a screen and never marks an order paid itself.
import type { KioskOrder } from './api.ts'

export const POLL_MS = 2_500
export const MAX_POLL_BACKOFF_MS = 10_000
export const CATALOG_REFRESH_MS = 45_000
export const PAID_RETURN_MS = 12_000
export const ENDED_RETURN_MS = 10_000
/** A failed dispense stays up long enough for the customer to write down or photograph the order code. */
export const DISPENSE_FAILED_RETURN_MS = 60_000
/** Past this, a PAID/DISPENSING order gets an explanation instead of an unchanging spinner. */
export const DISPENSE_SLOW_MS = 45_000
/** Past this without COMPLETED/DISPENSE_FAILED the kiosk stops waiting and shows the order code (like a failed dispense). */
export const DISPENSE_STUCK_MS = 150_000
/** Retry interval while the machine is offline, paused or out of stock. */
export const SERVICE_RETRY_MS = 15_000
/** Countdown turns to a warning colour in the last minute. */
export const COUNTDOWN_WARN_SECONDS = 60

export type OrderView =
  | { kind: 'create-payment' }
  | { kind: 'waiting-qr' }
  | { kind: 'qr'; qrCode: string; amount: number | undefined; deadline: number | undefined }
  | { kind: 'qr-expired'; canRenew: boolean }
  /** `sending`: paid, the backend is sending the command (PAID); `dispensing`: the machine is releasing the box. */
  | { kind: 'dispensing'; phase: 'sending' | 'dispensing' }
  | { kind: 'paid' }
  | { kind: 'dispense-failed' }
  | { kind: 'cancelled' }
  | { kind: 'ended' }

// After payment the backend sends the dispense command to the machine (MQTT) and reports the outcome on the order.
const time = (value: string | undefined) => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined }

/** Screen for a polled order. `serverNow` is the client clock corrected by the server offset. */
export function viewForOrder(order: KioskOrder, serverNow: number): OrderView {
  const status = order.status
  if (status === 'PAID') return { kind: 'dispensing', phase: 'sending' }
  if (status === 'DISPENSING') return { kind: 'dispensing', phase: 'dispensing' }
  if (status === 'COMPLETED') return { kind: 'paid' }
  if (status === 'DISPENSE_FAILED') return { kind: 'dispense-failed' }
  // The reservation sweep also ends an unpaid order as CANCELLED: past its hold deadline it reads as expired.
  if (status === 'CANCELLED') { const deadline = time(order.expiresAt); return deadline !== undefined && deadline <= serverNow ? { kind: 'ended' } : { kind: 'cancelled' } }
  if (status !== 'PENDING_PAYMENT') return { kind: 'ended' }
  const payment = order.currentPayment
  const orderDeadline = time(order.expiresAt)
  if (!payment) return { kind: 'create-payment' }
  if (payment.status === 'PENDING') {
    if (!payment.qrCode) return { kind: 'waiting-qr' }
    return { kind: 'qr', qrCode: payment.qrCode, amount: payment.amount ?? order.totalAmount, deadline: earliest(time(payment.expiresAt), orderDeadline) }
  }
  // FAILED / EXPIRED attempt (or SUCCESS not yet reflected on the order): a new QR only while the reservation lives.
  if (payment.status === 'SUCCESS') return { kind: 'waiting-qr' }
  return { kind: 'qr-expired', canRenew: orderDeadline === undefined || orderDeadline > serverNow }
}

function earliest(a: number | undefined, b: number | undefined) {
  return a === undefined ? b : b === undefined ? a : Math.min(a, b)
}

/** Whole seconds left until `deadline` on the server clock; 0 once passed. */
export function secondsLeft(deadline: number | undefined, serverNow: number): number | undefined {
  return deadline === undefined ? undefined : Math.max(0, Math.ceil((deadline - serverNow) / 1000))
}

/** Server-minus-client offset measured from the envelope timestamp at receipt time. */
export function clockOffset(serverTime: number | undefined, clientNow: number): number {
  return serverTime === undefined ? 0 : serverTime - clientNow
}

/** Poll every 2.5 s; after network failures back off exponentially up to 10 s. */
export function pollDelay(consecutiveFailures: number): number {
  return consecutiveFailures <= 0 ? POLL_MS : Math.min(MAX_POLL_BACKOFF_MS, POLL_MS * 2 ** consecutiveFailures)
}

export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Money message for an order that ended without a box. The backend only records money through a SUCCESS payment
 * attempt, so anything else means nothing was charged; a SUCCESS on a cancelled/expired order is a late payment that
 * staff must refund.
 */
export function chargeOutcome(order: Pick<KioskOrder, 'currentPayment'>): 'not-charged' | 'paid-late' {
  return order.currentPayment?.status === 'SUCCESS' ? 'paid-late' : 'not-charged'
}

export type MachineState = 'unconfigured' | 'offline' | 'maintenance' | 'inactive' | 'paused' | 'sold-out'

/** Why the kiosk cannot sell right now, from GET /kiosk/me and GET /kiosk/catalog. */
export function machineStateOf(machineStatus: string | undefined, acceptingOrders: boolean | undefined, productCount: number): MachineState | null {
  // The catalog is the live answer; the machine status (from /kiosk/me) only explains a refusal.
  if (acceptingOrders === false) return machineStatus === 'MAINTENANCE' ? 'maintenance' : machineStatus === 'INACTIVE' ? 'inactive' : 'paused'
  return productCount === 0 ? 'sold-out' : null
}

/** Customer-facing explanation and next step for every state in which the kiosk cannot sell. */
export const MACHINE_STATE_COPY: Record<MachineState, { title: string; text: string; next: string }> = {
  unconfigured: {
    title: 'Máy chưa được cấu hình',
    text: 'Máy chưa được kết nối với hệ thống bán hàng nên chưa thể bán.',
    next: 'Vui lòng liên hệ nhân viên vận hành. Nhân viên: cấp khóa kiosk trong trang quản trị (Máy bán hàng → Khóa kiosk).',
  },
  offline: {
    title: 'Máy đang mất kết nối',
    text: 'Máy chưa liên lạc được với hệ thống nên tạm thời chưa nhận đơn. Bạn chưa bị trừ tiền.',
    next: 'Máy tự kết nối lại sau mỗi 15 giây. Vui lòng quay lại sau ít phút.',
  },
  maintenance: {
    title: 'Máy đang bảo trì',
    text: 'Nhân viên đang kiểm tra hoặc nạp hàng cho máy nên máy tạm ngừng bán.',
    next: 'Máy sẽ mở bán lại ngay khi bảo trì xong. Vui lòng quay lại sau.',
  },
  inactive: {
    title: 'Máy tạm ngừng phục vụ',
    text: 'Máy đã được tạm ngừng hoạt động.',
    next: 'Vui lòng dùng máy khác hoặc liên hệ nhân viên vận hành.',
  },
  paused: {
    title: 'Máy tạm ngừng nhận đơn',
    text: 'Máy tạm thời chưa nhận đơn mới.',
    next: 'Máy tự kiểm tra lại sau mỗi 15 giây. Vui lòng quay lại sau ít phút.',
  },
  'sold-out': {
    title: 'Máy đã hết hàng',
    text: 'Hiện không còn hộp trái cây nào bán được trong máy.',
    next: 'Nhân viên sẽ sớm nạp thêm. Danh sách tự cập nhật khi có hàng.',
  },
}

/** Reads a positive whole number of seconds from configuration, falling back to `fallback`. */
export function configuredSeconds(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}
