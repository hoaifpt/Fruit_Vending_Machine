// Mock of the manual refunds of the real backend (#72, docs/refunds.md, api.yaml). There is no refund table on the
// backend: a payment REFUNDED carries the refund columns. The mock keeps them in store.refunds (one row per refunded
// payment, also read by the revenue mock of FM9). Recording moves the payment SUCCESS → REFUNDED, and the order to
// REFUNDED only when it is the order's paying payment and the order is DISPENSE_FAILED or COMPLETED; a late or duplicate
// payment never changes the order. Messages in English as the backend sends them, business 409s start with the code.
import { conflict, Form, MockHttpError, notFound, ok, fixedPage } from './http.ts'
import type { Reply } from './http.ts'
import type { HandlerContext, Route } from './handlers.ts'
import type { MockOrder, MockPayment, MockStore, MockUser } from './seed.ts'
import { candidateReportView, refundReportOf, resolveReportsOnRefund } from './customer-reports.ts'
import { closed, recordEvent } from './work-orders.ts'
import type { components } from '../schema'
import { addDays, isDateString } from '../../admin/maintenance-schedules.ts'

type S = components['schemas']
export type Reason = NonNullable<S['RefundPaymentRequest']['reason']>
type CandidateType = NonNullable<S['RefundCandidateResponse']['type']>
/** The refund columns of a REFUNDED payment (refunded_at, refunded_by, refund_reason, refund_transfer_ref, refund_note). */
export interface MockRefund {
  id: string; orderId: string; paymentId: string; amount: number; reason: Reason
  transferReference: string; note: string | null; refundedAt: string; refundedById: string; refundedByName: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const TRANSFER_REFERENCE = /^[A-Za-z0-9._/-]{4,64}$/
export const REASONS: readonly Reason[] = ['DISPENSE_FAILED', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'PRODUCT_QUALITY', 'OTHER']
const CANDIDATE_TYPES: readonly CandidateType[] = ['DISPENSE_FAILED', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'CUSTOMER_REPORT']
const UNFINISHED_ORDER: readonly MockOrder['status'][] = ['PENDING_PAYMENT', 'PAID', 'DISPENSING']
const iso = (ms: number) => new Date(ms).toISOString()
const decode = (value: string) => decodeURIComponent(value)
function route(method: string, template: string, policy: Route['policy'], handle: Route['handle']): Route {
  return { method, pattern: new RegExp(`^${template.replace(/:(\w+)/g, '(?<$1>[^/]+)')}/?$`), policy, handle }
}

/**
 * Seed: the payments already REFUNDED in the seed (orders REFUNDED after a failed dispense), recorded by the admin two
 * hours after the payment.
 */
export function seedRefunds(payments: readonly MockPayment[], admin: Pick<MockUser, 'id' | 'fullName'>): MockRefund[] {
  return payments.filter(payment => payment.status === 'REFUNDED').map((payment, index) => ({
    id: `95000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    orderId: payment.orderId, paymentId: payment.id, amount: payment.amount, reason: 'DISPENSE_FAILED',
    transferReference: `FT2631${String(index + 1).padStart(10, '0')}`,
    note: index === 0 ? 'Chuyển khoản Vietcombank cho khách theo số điện thoại trên phản ánh.' : null,
    refundedAt: new Date(Date.parse(payment.paidAt ?? payment.createdAt) + 2 * 3_600_000).toISOString(),
    refundedById: admin.id, refundedByName: admin.fullName ?? null,
  }))
}

// ---- views shared with handlers.ts (GET /orders/{id}, GET /payments/{id})

const actor = (refund: MockRefund): S['RefundActorResponse'] => ({ id: refund.refundedById, fullName: refund.refundedByName ?? '' })
export const refundOfPayment = (store: MockStore, paymentId: string) => store.refunds.find(refund => refund.paymentId === paymentId)

/** PaymentDetailResponse.refund: null for a payment that was not refunded. */
export function refundInfo(store: MockStore, paymentId: string): S['RefundInfoResponse'] | null {
  const refund = refundOfPayment(store, paymentId)
  return refund ? { refundedAt: refund.refundedAt, refundedBy: actor(refund), reason: refund.reason, transferReference: refund.transferReference, note: refund.note ?? undefined } : null
}
/** OrderDetailResponse.refunds (callers with REFUND_READ only) and refundedAt. */
export function orderRefunds(store: MockStore, orderId: string): S['OrderRefundResponse'][] {
  return store.refunds.filter(refund => refund.orderId === orderId).sort((a, b) => a.refundedAt.localeCompare(b.refundedAt)).map(refund => ({
    paymentId: refund.paymentId, amount: refund.amount, refundedAt: refund.refundedAt, refundedBy: actor(refund), reason: refund.reason,
    transferReference: refund.transferReference, note: refund.note ?? undefined,
  }))
}
export function orderRefundedAt(store: MockStore, order: Pick<MockOrder, 'id' | 'status'>): string | undefined {
  if (order.status !== 'REFUNDED') return undefined
  return store.refunds.filter(refund => refund.orderId === order.id).map(refund => refund.refundedAt).sort()[0]
}

// ---- rules

/** The paying payment: SUCCESS/REFUNDED with the earliest paidAt (tie: id). */
export function payingPaymentOf(store: MockStore, orderId: string): MockPayment | undefined {
  return store.payments.filter(payment => payment.orderId === orderId && (payment.status === 'SUCCESS' || payment.status === 'REFUNDED') && payment.paidAt)
    .sort((a, b) => a.paidAt!.localeCompare(b.paidAt!) || a.id.localeCompare(b.id))[0]
}

function reasonFits(reason: Reason, order: MockOrder, paying: boolean): boolean {
  switch (reason) {
    case 'DISPENSE_FAILED': return paying && order.status === 'DISPENSE_FAILED'
    case 'LATE_PAYMENT': return order.status === 'CANCELLED'
    case 'DUPLICATE_PAYMENT': return !paying && order.status !== 'CANCELLED'
    case 'PRODUCT_QUALITY': return paying && order.status === 'COMPLETED'
    case 'OTHER': return paying && (order.status === 'COMPLETED' || order.status === 'DISPENSE_FAILED')
  }
}

/** Payer bank account from the verified webhook (payOS counterAccount*); the mock derives a stable one, null for some. */
const PAYERS: S['PayerAccountResponse'][] = [
  { accountName: 'NGUYEN VAN AN', accountNumber: '0071000123456', bankId: '970436', bankName: 'Vietcombank' },
  { accountName: 'TRAN THI BINH', accountNumber: '19034567890123', bankId: '970407', bankName: 'Techcombank' },
]
export function payerOf(payment: MockPayment): S['PayerAccountResponse'] | null {
  const index = parseInt(payment.id.replace(/-/g, '').slice(-2), 16) % 3
  return index === 0 ? null : PAYERS[index - 1]
}

function candidateType(store: MockStore, payment: MockPayment, order: MockOrder): CandidateType | null {
  if (order.status === 'CANCELLED') return 'LATE_PAYMENT'
  if (payingPaymentOf(store, order.id)?.id !== payment.id) return 'DUPLICATE_PAYMENT'
  if (order.status === 'DISPENSE_FAILED') return 'DISPENSE_FAILED'
  return refundReportOf(store, order.id) ? 'CUSTOMER_REPORT' : null
}

// ---- query parameters

function dateRange(query: URLSearchParams, errors: Record<string, string>): { from: number | null; to: number | null; fromDate?: string; toDate?: string } {
  const read = (name: string) => {
    const value = query.get(name)
    if (!value) return undefined
    if (!isDateString(value)) { errors[name] = 'Must be a date (yyyy-MM-dd)'; return undefined }
    return value
  }
  const fromDate = read('from'), toDate = read('to')
  if (fromDate && toDate && toDate < fromDate) errors.to = 'Must not be before from'
  return {
    fromDate, toDate,
    from: fromDate ? Date.parse(`${fromDate}T00:00:00+07:00`) : null, to: toDate ? Date.parse(`${addDays(toDate, 1)}T00:00:00+07:00`) : null,
  }
}
function uuidQuery(query: URLSearchParams, name: string, errors: Record<string, string>) {
  const value = query.get(name)
  if (value && !UUID.test(value)) errors[name] = 'Must be a valid UUID'
  return value || null
}
function enumQuery<T extends string>(query: URLSearchParams, name: string, values: readonly T[], errors: Record<string, string>): T | null {
  const value = query.get(name)
  if (value && !values.includes(value as T)) errors[name] = `Must be one of: ${values.join(', ')}`
  return (value as T) || null
}
function failOn(errors: Record<string, string>) {
  if (Object.keys(errors).length) throw new MockHttpError(400, 'Invalid request parameter', errors)
}
const inRange = (at: string | undefined, range: { from: number | null; to: number | null }) => {
  const ms = Date.parse(at ?? '')
  return (range.from === null || ms >= range.from) && (range.to === null || ms < range.to)
}

// ---- handlers

function orderRef(order: MockOrder | undefined): S['RefundOrderResponse'] | undefined {
  return order ? { id: order.id, orderCode: order.orderCode, status: order.status, machineCode: order.machineCode } : undefined
}

/** PaymentDetailResponse with its refund block (GET /payments/{id} and the answer of POST …/refund). */
export function paymentDetail(store: MockStore, { qrCode, ...payment }: MockPayment) {
  const order = store.orders.find(candidate => candidate.id === payment.orderId)
  return { ...payment, orderCode: order?.orderCode, machineCode: order?.machineCode, qrCode, refund: refundInfo(store, payment.id) }
}

function record(ctx: HandlerContext): Reply {
  const { store, now } = ctx
  const form = new Form(ctx.body, ['reason', 'transferReference', 'note', 'workOrderId'])
  const body = ctx.body as Record<string, unknown>
  const reason = body.reason === undefined || body.reason === null ? (form.reject('reason', 'must not be null'), 'OTHER' as Reason) : form.oneOf('reason', REASONS)
  const transferReference = form.text('transferReference', 64)
  if (transferReference && !TRANSFER_REFERENCE.test(transferReference)) form.reject('transferReference', 'must match "^[A-Za-z0-9._/-]{4,64}$"')
  const note = form.optionalText('note', 500)
  if (!form.errors.reason && reason === 'OTHER' && !note) form.reject('note', 'is required for reason OTHER')
  const workOrderId = body.workOrderId
  if (workOrderId !== undefined && workOrderId !== null && (typeof workOrderId !== 'string' || !UUID.test(workOrderId))) form.reject('workOrderId', 'Must be a valid UUID')
  form.done()

  const id = decode(ctx.params.paymentId)
  if (!UUID.test(id)) throw new MockHttpError(400, 'Invalid request parameter', { paymentId: 'Must be a valid UUID' })
  const payment = store.payments.find(candidate => candidate.id === id)
  if (!payment) throw notFound('Payment not found')
  const order = store.orders.find(candidate => candidate.id === payment.orderId)!
  if (payment.status === 'REFUNDED') throw conflict('PAYMENT_ALREADY_REFUNDED: the payment is already refunded')
  if (payment.status !== 'SUCCESS') throw conflict(`PAYMENT_NOT_REFUNDABLE: a ${payment.status} payment cannot be refunded`)
  if (UNFINISHED_ORDER.includes(order.status)) throw conflict('DISPENSE_IN_PROGRESS: the order has no final result yet')
  const paying = payingPaymentOf(store, order.id)?.id === payment.id
  if (!reasonFits(reason, order, paying)) throw conflict(`REFUND_REASON_MISMATCH: ${reason} does not match an order ${order.status}${paying ? '' : ' (not the paying payment)'}`)
  if (store.refunds.some(refund => refund.transferReference.toLowerCase() === transferReference.toLowerCase())) {
    throw conflict('REFUND_TRANSFER_REF_USED: this transfer reference was already recorded for another refund')
  }
  const workOrder = typeof workOrderId === 'string' ? store.workOrders.find(candidate => candidate.id === workOrderId.toLowerCase()) : undefined
  if (typeof workOrderId === 'string' && (!workOrder || workOrder.type !== 'INCIDENT' || workOrder.status === 'CANCELLED')) {
    throw new MockHttpError(400, 'Validation Failed', { workOrderId: 'Must be an INCIDENT work order that is not cancelled' })
  }

  const at = iso(Math.max(now, Date.parse(payment.paidAt ?? '') || now))
  payment.status = 'REFUNDED'
  const user = ctx.user!
  store.refunds.push({
    id: crypto.randomUUID(), orderId: order.id, paymentId: payment.id, amount: payment.amount, reason, transferReference, note,
    refundedAt: at, refundedById: user.id, refundedByName: user.fullName ?? null,
  })
  if (paying && (order.status === 'DISPENSE_FAILED' || order.status === 'COMPLETED')) order.status = 'REFUNDED'
  resolveReportsOnRefund(store, order.id, user.id, now)
  if (workOrder) {
    recordEvent(store, workOrder, 'NOTE', user.id, now, { before: workOrder.status, note: `Refunded ${payment.amount} for order ${order.orderCode} (${reason}, ref ${transferReference})` })
    if (!closed(workOrder.status)) workOrder.updatedAt = iso(now)
  }
  return ok(paymentDetail(store, payment))
}

function refundRow(store: MockStore, refund: MockRefund): S['RefundResponse'] & { machineId?: string } {
  const payment = store.payments.find(candidate => candidate.id === refund.paymentId)
  const order = store.orders.find(candidate => candidate.id === refund.orderId)
  return {
    paymentId: refund.paymentId, amount: refund.amount, paidAt: payment?.paidAt, refundedAt: refund.refundedAt, refundedBy: actor(refund), reason: refund.reason,
    transferReference: refund.transferReference, note: refund.note ?? undefined, order: orderRef(order), machineId: order?.machineId,
  }
}

function listRefunds(ctx: HandlerContext): Reply {
  const { store, query } = ctx
  const errors: Record<string, string> = {}
  const reason = enumQuery(query, 'reason', REASONS, errors)
  const machineId = uuidQuery(query, 'machineId', errors)
  const refundedBy = uuidQuery(query, 'refundedBy', errors)
  const range = dateRange(query, errors)
  failOn(errors)
  const rows = store.refunds.filter(refund => (!reason || refund.reason === reason) && (!refundedBy || refund.refundedById === refundedBy) && inRange(refund.refundedAt, range))
    .map(refund => refundRow(store, refund)).filter(row => !machineId || row.machineId === machineId)
    .sort((a, b) => (b.refundedAt ?? '').localeCompare(a.refundedAt ?? '') || (b.paymentId ?? '').localeCompare(a.paymentId ?? ''))
    .map(({ machineId: _machineId, ...row }) => row)
  return ok(fixedPage(rows, query, { defaultSize: 20, maxSize: 100 }))
}

function listCandidates(ctx: HandlerContext): Reply {
  const { store, query } = ctx
  const errors: Record<string, string> = {}
  const type = enumQuery(query, 'type', CANDIDATE_TYPES, errors)
  const machineId = uuidQuery(query, 'machineId', errors)
  const range = dateRange(query, errors)
  failOn(errors)
  const rows: S['RefundCandidateResponse'][] = []
  for (const payment of store.payments) {
    if (payment.status !== 'SUCCESS') continue
    const order = store.orders.find(candidate => candidate.id === payment.orderId)
    if (!order || UNFINISHED_ORDER.includes(order.status) || (machineId && order.machineId !== machineId) || !inRange(payment.paidAt, range)) continue
    const own = candidateType(store, payment, order)
    if (!own) continue
    const report = refundReportOf(store, order.id)
    if (type && (type === 'CUSTOMER_REPORT' ? !report : own !== type)) continue
    const workOrder = report?.workOrderId ? store.workOrders.find(candidate => candidate.id === report.workOrderId) : undefined
    rows.push({
      paymentId: payment.id, type: own, amount: payment.amount, paidAt: payment.paidAt, order: orderRef(order), payer: payerOf(payment) ?? undefined,
      waitingSince: payment.paidAt, relatedWorkOrder: workOrder ? { id: workOrder.id, code: workOrder.code } : undefined,
      customerReport: report ? candidateReportView(report) : undefined,
    })
  }
  rows.sort((a, b) => (a.waitingSince ?? '').localeCompare(b.waitingSince ?? '') || (a.paymentId ?? '').localeCompare(b.paymentId ?? ''))
  return ok(fixedPage(rows, query, { defaultSize: 20, maxSize: 100 }))
}

function summary(ctx: HandlerContext): Reply {
  const { store, query } = ctx
  const errors: Record<string, string> = {}
  const machineId = uuidQuery(query, 'machineId', errors)
  const range = dateRange(query, errors)
  failOn(errors)
  const rows = store.refunds.filter(refund => inRange(refund.refundedAt, range)
    && (!machineId || store.orders.find(order => order.id === refund.orderId)?.machineId === machineId))
  const result: S['RefundSummaryResponse'] = {
    from: range.fromDate, to: range.toDate, machineId: machineId ?? undefined, count: rows.length, totalAmount: rows.reduce((sum, refund) => sum + refund.amount, 0),
    byReason: REASONS.map(reason => {
      const of = rows.filter(refund => refund.reason === reason)
      return { reason, count: of.length, totalAmount: of.reduce((sum, refund) => sum + refund.amount, 0) }
    }),
  }
  return ok(result)
}

export const refundRoutes: Route[] = [
  route('POST', '/payments/:paymentId/refund', { permission: 'PAYMENT_REFUND' }, record),
  route('GET', '/refunds', { permission: 'REFUND_READ' }, listRefunds),
  route('GET', '/refunds/candidates', { permission: 'REFUND_READ' }, listCandidates),
  route('GET', '/refunds/summary', { permission: 'REFUND_READ' }, summary),
]
