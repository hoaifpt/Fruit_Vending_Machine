// Rules of the payment screens (T2 Thanh toán, T4 Nhật ký webhook, FE 6.2) that do not need React: URL filters cleaned to
// what the contract accepts, the "Cần xử lý" view, the kind of anomaly of a payment and the amount a webhook reported.
// Unit-tested (tests/payments.test.mjs).
//
// Where the three anomalies live (docs/payment-webhook.md, backend PaymentService.listPayments, PaymentAnomalyRecorder):
// - PAYMENT_LATE (money for a CANCELLED order) and PAYMENT_DUPLICATE (a second SUCCESS on one order) are not stored on the
//   payment; `GET /payments?requiresAttention=true` derives them on the server: SUCCESS payments whose order is CANCELLED
//   or that share their order with another SUCCESS payment (both are listed, the later one is the refund candidate).
// - PAYMENT_AMOUNT_MISMATCH leaves the payment unchanged and is only written to audit_logs, which has no API. The webhook
//   log keeps the body (with the amount) but its list has no amount filter and no link to the payment. So the web can
//   only show a mismatch per payment: its webhooks are found by `reference` (= the payment's paymentReference for MOCK
//   and payOS) and each body's amount is compared with the payment's, with the backend's rule
//   (PaymentConfirmationService): a SUCCESS event without an amount or with another amount, or a FAILED event with
//   another amount. A server-side list needs a backend change (proposal: requiresAttention also returns
//   PAYMENT_AMOUNT_MISMATCH and PAYMENT_TRANSACTION_CONFLICT; this screen then needs no change, see listAnomalies).
import type { OrderDetail, Payment, PaymentDetail } from '../api/resources.ts'
import { dateRangeToInstants } from '../lib/format.ts'
import { payloadValue } from './payload.ts'
import { oneOf, parseSort, formatSort, uuidParam } from '../lib/table-query.ts'
import type { SortRule, SortState } from '../lib/table-query.ts'

export const PAYMENT_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED'] as const
export type PaymentStatus = typeof PAYMENT_STATUSES[number]
/** The only sorts `GET /payments` approves. */
export const PAYMENT_SORT_RULE: SortRule = { fields: ['createdAt', 'amount', 'paidAt'], fallback: 'createdAt,desc' }
/** The only sorts `GET /payment-webhook-logs` approves. */
export const WEBHOOK_SORT_RULE: SortRule = { fields: ['receivedAt', 'provider'], fallback: 'receivedAt,desc' }
/** URL key of the "Cần xử lý" view, same name as the contract query. */
export const ATTENTION_PARAM = 'requiresAttention'
export const PAYMENT_FILTER_KEYS = ['status', 'provider', 'orderId', 'machineId', 'from', 'to'] as const
export const WEBHOOK_FILTER_KEYS = ['provider', 'verified', 'reference', 'from', 'to'] as const

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dateParam = (value: string | null) => (value && DATE.test(value) ? value : '')
const pageOf = (params: URLSearchParams) => {
  const value = Number(params.get('page') ?? '')
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

export interface PaymentFilters {
  status: PaymentStatus | ''; provider: string; orderId: string; machineId: string; from: string; to: string
  attention: boolean; sort: SortState; page: number
}

/** Payment list filters from the URL; values the contract would reject with a 400 (non-UUID ids, unknown status) are dropped. */
export function readPaymentFilters(params: URLSearchParams): PaymentFilters {
  return {
    status: oneOf(params.get('status'), PAYMENT_STATUSES) as PaymentStatus | '',
    provider: (params.get('provider') ?? '').trim(),
    orderId: uuidParam((params.get('orderId') ?? '').trim()),
    machineId: uuidParam((params.get('machineId') ?? '').trim()),
    from: dateParam(params.get('from')), to: dateParam(params.get('to')),
    attention: params.get(ATTENTION_PARAM) === 'true',
    sort: parseSort(params.get('sort'), PAYMENT_SORT_RULE),
    page: pageOf(params),
  }
}

/** Query of GET /payments: only parameters listed in the contract, absent when not in effect. */
export function paymentListQuery(filters: PaymentFilters, size: number) {
  const range = dateRangeToInstants(filters.from, filters.to)
  return {
    page: filters.page, size, sort: formatSort(filters.sort),
    status: filters.status || undefined, provider: filters.provider || undefined,
    orderId: filters.orderId || undefined, machineId: filters.machineId || undefined,
    createdFrom: range.from, createdTo: range.to,
    requiresAttention: filters.attention ? true : undefined,
  }
}

export interface WebhookFilters { provider: string; verified: 'true' | 'false' | ''; reference: string; from: string; to: string; sort: SortState; page: number }

export function readWebhookFilters(params: URLSearchParams): WebhookFilters {
  return {
    provider: (params.get('provider') ?? '').trim(),
    verified: oneOf(params.get('verified'), ['true', 'false']) as 'true' | 'false' | '',
    reference: (params.get('reference') ?? '').trim(),
    from: dateParam(params.get('from')), to: dateParam(params.get('to')),
    sort: parseSort(params.get('sort'), WEBHOOK_SORT_RULE),
    page: pageOf(params),
  }
}

/** Query of GET /payment-webhook-logs: only parameters listed in the contract. */
export function webhookListQuery(filters: WebhookFilters, size: number) {
  const range = dateRangeToInstants(filters.from, filters.to)
  return {
    page: filters.page, size, sort: formatSort(filters.sort),
    provider: filters.provider || undefined,
    verified: filters.verified ? filters.verified === 'true' : undefined,
    reference: filters.reference || undefined,
    receivedFrom: range.from, receivedTo: range.to,
  }
}

// ---- links

export function webhookLogPath(logId: string | undefined): string {
  return logId ? `/admin/webhook-logs/${encodeURIComponent(logId)}` : ''
}
/** Webhook log list narrowed to one provider reference (every call the provider made about one payment). */
export function webhookLogsByReferencePath(reference: string | undefined): string {
  return reference ? `/admin/webhook-logs?reference=${encodeURIComponent(reference)}` : '/admin/webhook-logs'
}
/** Every payment attempt of one order. Non-UUID ids are left out (the API would answer 400). */
export function orderPaymentsPath(orderId: string | undefined): string {
  const id = uuidParam(orderId ?? '')
  return id ? `/admin/payments?orderId=${id}` : '/admin/payments'
}
export const ATTENTION_PATH = `/admin/payments?${ATTENTION_PARAM}=true`

// ---- "Cần xử lý" on the list

export type ListAnomaly = 'duplicate' | 'review'
export interface ListAnomalyInfo { kind: ListAnomaly; refundCandidate: boolean }

const byPaidThenCreated = (a: Pick<Payment, 'paidAt' | 'createdAt'>, b: Pick<Payment, 'paidAt' | 'createdAt'>) =>
  (b.paidAt ?? '').localeCompare(a.paidAt ?? '') || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')

/**
 * Kind of anomaly of each row of the "Cần xử lý" list, from the rows alone (PaymentResponse has no order status nor
 * anomaly type). SUCCESS rows of the same order on this page: a duplicate payment; the one paid last (then created last)
 * is the refund candidate, as the backend documents. Any other row is "to review": today a late payment or a duplicate
 * whose twin is on another page; if the backend extends requiresAttention (amount mismatch, transaction conflict) those
 * rows land here too, still correct. The detail page reads the order and the webhooks and says which.
 */
export function listAnomalies(rows: readonly Pick<Payment, 'id' | 'orderId' | 'status' | 'paidAt' | 'createdAt'>[]): Map<string, ListAnomalyInfo> {
  const successByOrder = new Map<string, typeof rows[number][]>()
  for (const row of rows) {
    if (row.status !== 'SUCCESS' || !row.orderId) continue
    successByOrder.set(row.orderId, [...(successByOrder.get(row.orderId) ?? []), row])
  }
  const result = new Map<string, ListAnomalyInfo>()
  for (const row of rows) {
    const group = row.status === 'SUCCESS' && row.orderId ? successByOrder.get(row.orderId) ?? [] : []
    if (group.length > 1) result.set(row.id ?? '', { kind: 'duplicate', refundCandidate: [...group].sort(byPaidThenCreated)[0] === row })
    else result.set(row.id ?? '', { kind: 'review', refundCandidate: false })
  }
  return result
}

export const LIST_ANOMALY_TEXT: Record<ListAnomaly, string> = {
  duplicate: 'Trùng khoản',
  review: 'Cần đối soát',
}

// ---- one payment

export type PaymentAnomaly = 'late' | 'duplicate' | 'mismatch'
export interface PaymentFinding { kind: PaymentAnomaly; text: string; refundCandidate?: boolean }


/**
 * What is abnormal about one payment, given its order (GET /orders/{id}) and the amounts its webhooks reported.
 * Late: SUCCESS on an order that will not be served. Duplicate: another SUCCESS on the same order (the later one is the
 * refund candidate). Mismatch: a verified webhook reported another amount than the payment (the payment was not changed).
 */
export function paymentFindings(
  payment: Pick<PaymentDetail, 'id' | 'status' | 'amount' | 'paidAt' | 'createdAt'>,
  order: Pick<OrderDetail, 'status' | 'payments'> | undefined,
  /** Webhooks of this payment whose amount check is a mismatch (see webhookAmountCheck, isMismatch). */
  mismatchCount = 0,
): PaymentFinding[] {
  const result: PaymentFinding[] = []
  if (payment.status === 'SUCCESS' && order) {
    // PAYMENT_LATE: the backend's rule is a SUCCESS on a CANCELLED order (PaymentConfirmationService).
    if (order.status === 'CANCELLED') {
      result.push({ kind: 'late', refundCandidate: true, text: 'Thanh toán đến muộn: tiền về khi đơn đã hủy, khách không nhận hộp. Đối soát với nhà cung cấp, hoàn tiền thủ công (chuyển khoản) rồi ghi nhận ở màn Hoàn tiền.' })
    }
    const successes = (order.payments ?? []).filter(other => other.status === 'SUCCESS')
    if (successes.length > 1 && successes.some(other => other.id === payment.id)) {
      const latest = [...successes].sort(byPaidThenCreated)[0]
      const candidate = latest.id === payment.id
      result.push({ kind: 'duplicate', refundCandidate: candidate, text: candidate
        ? `Thanh toán trùng: đơn có ${successes.length} khoản thành công, khoản này đến sau nên là khoản cần hoàn. Đối soát rồi hoàn tiền thủ công.`
        : `Thanh toán trùng: đơn có ${successes.length} khoản thành công. Khoản này đến trước và được tính cho đơn; khoản đến sau là khoản cần hoàn.` })
    }
  }
  if (mismatchCount > 0) {
    result.push({ kind: 'mismatch', text: `Lệch số tiền: nhà cung cấp báo ${mismatchCount === 1 ? 'một lần' : `${mismatchCount} lần`} với số tiền khác (hoặc không có số tiền) so với thanh toán, nên hệ thống không ghi nhận. Đối soát với nhà cung cấp; nếu khách đã bị trừ tiền thì hoàn tiền thủ công.` })
  }
  return result
}

/** Exact VND comparison at 2 decimals (the backend compares BigDecimal values). */
export function sameAmount(a: number | undefined, b: number | undefined): boolean {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.round(a * 100) === Math.round(b * 100)
}

/**
 * Amount a provider reported in a stored webhook body: MOCK puts it at the top (`amount`), payOS under `data.amount`.
 * Takes rawPayload as the API sends it (a JSON object on the real backend, a string in the generated schema; see
 * payload.ts). Only the JSON body is read (rawBody exists only when the body was not JSON). Undefined when absent.
 */
export function payloadAmount(rawPayload: unknown): number | undefined {
  const body = payloadValue(rawPayload)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  const read = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : undefined)
  const top = read(record.amount)
  if (top !== undefined) return top
  const data = record.data
  return data && typeof data === 'object' ? read((data as Record<string, unknown>).amount) : undefined
}

/** Event types whose body the backend compares with the payment (others and rejected calls are never applied). */
export const CHECKED_EVENTS: readonly string[] = ['PAYMENT_SUCCESS', 'PAYMENT_FAILED']
export function isCheckedWebhook(log: { verified?: boolean; eventType?: string | null }): boolean {
  return !!log.verified && CHECKED_EVENTS.includes(log.eventType ?? '')
}

export type AmountCheck = 'match' | 'mismatch' | 'missing' | 'unknown' | 'not-checked'
/**
 * How one webhook's amount compares with the payment, with the backend's rule: a verified SUCCESS without an amount
 * (`missing`) or with another amount is a mismatch; a verified FAILED is a mismatch only when it carries another amount.
 * Rejected calls and other events were never applied: not checked. `unknown` is for a body the screen could not read.
 */
export function webhookAmountCheck(log: { verified?: boolean; eventType?: string | null }, amount: number | undefined, expected: number | undefined): AmountCheck {
  if (!isCheckedWebhook(log)) return 'not-checked'
  if (log.eventType === 'PAYMENT_SUCCESS') return amount === undefined ? 'missing' : sameAmount(amount, expected) ? 'match' : 'mismatch'
  if (amount === undefined) return 'not-checked'
  return sameAmount(amount, expected) ? 'match' : 'mismatch'
}
/** Checks the backend counts as PAYMENT_AMOUNT_MISMATCH. */
export function isMismatch(check: AmountCheck): boolean {
  return check === 'mismatch' || check === 'missing'
}
export const AMOUNT_CHECK_TEXT: Record<AmountCheck, string> = {
  match: 'Khớp',
  mismatch: 'Lệch số tiền',
  missing: 'Không có số tiền (tính là lệch)',
  unknown: 'Không đọc được số tiền',
  'not-checked': 'Không đối chiếu',
}

/** Payment amount against the order total: a single payment pays the whole order. */
export function amountVsOrder(amount: number | undefined, orderTotal: number | undefined): 'match' | 'mismatch' | 'unknown' {
  if (typeof amount !== 'number' || typeof orderTotal !== 'number') return 'unknown'
  return sameAmount(amount, orderTotal) ? 'match' : 'mismatch'
}

export const WEBHOOK_EVENT_TEXT: Record<string, string> = {
  PAYMENT_SUCCESS: 'Báo thanh toán thành công',
  PAYMENT_FAILED: 'Báo thanh toán thất bại',
  UNKNOWN: 'Không rõ',
}
export function webhookEventText(eventType: string | null | undefined): string {
  return eventType ? WEBHOOK_EVENT_TEXT[eventType] ?? eventType : '—'
}
