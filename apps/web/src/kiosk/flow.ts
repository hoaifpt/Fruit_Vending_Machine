// Pure purchase-flow rules (issue #40 §6–7). The backend decides payment state; the kiosk only maps
// GET /kiosk/orders/{id} to a screen and never marks an order paid itself.
import type { KioskOrder } from './api.ts'

export const POLL_MS = 2_500
export const MAX_POLL_BACKOFF_MS = 10_000
export const CATALOG_REFRESH_MS = 45_000
export const PAID_RETURN_MS = 12_000
export const ENDED_RETURN_MS = 8_000

export type OrderView =
  | { kind: 'create-payment' }
  | { kind: 'waiting-qr' }
  | { kind: 'qr'; qrCode: string; amount: number | undefined; deadline: number | undefined }
  | { kind: 'qr-expired'; canRenew: boolean }
  | { kind: 'paid' }
  | { kind: 'cancelled' }
  | { kind: 'ended' }

const PAID_STATES = new Set(['PAID', 'DISPENSING', 'COMPLETED'])
const time = (value: string | undefined) => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined }

/** Screen for a polled order. `serverNow` is the client clock corrected by the server offset. */
export function viewForOrder(order: KioskOrder, serverNow: number): OrderView {
  const status = order.status
  if (status && PAID_STATES.has(status)) return { kind: 'paid' }
  if (status === 'CANCELLED') return { kind: 'cancelled' }
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

/** Reads a positive whole number of seconds from configuration, falling back to `fallback`. */
export function configuredSeconds(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}
