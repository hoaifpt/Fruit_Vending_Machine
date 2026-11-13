// Mock of manual refunds (FE 8.1, draft api-contract/drafts/refunds.yaml, backend 5.1). Messages in English as the
// backend would send them. Recording moves the payment SUCCESS → REFUNDED and a DISPENSE_FAILED order (with no other
// SUCCESS payment left) to REFUNDED; a late or duplicate payment leaves the order as it is.
import { conflict, created, Form, MockHttpError, notFound, ok, paginate } from './http.ts'
import type { HandlerContext, Route } from './handlers.ts'
import type { MockOrder, MockPayment, MockStore, MockUser } from './seed.ts'
import type { components } from '../drafts/refunds'

type D = components['schemas']
type Reason = D['RefundResponse']['reason']
/** What the refunds table would keep (draft): order/payment details are read from their rows when answering. */
export interface MockRefund {
  id: string; orderId: string; paymentId: string; amount: number; reason: Reason
  transferRef: string; note: string | null; refundedAt: string; refundedById: string; refundedByName: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TRANSFER_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,63}$/
const REASONS: readonly Reason[] = ['DISPENSE_FAILED', 'PAYMENT_LATE', 'PAYMENT_DUPLICATE']

/**
 * Seed: one refund per payment already REFUNDED in the seed (orders REFUNDED after a failed dispense), recorded by the
 * admin two hours after the payment.
 */
export function seedRefunds(payments: readonly MockPayment[], admin: Pick<MockUser, 'id' | 'fullName'>): MockRefund[] {
  return payments.filter(payment => payment.status === 'REFUNDED').map((payment, index) => ({
    id: `95000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    orderId: payment.orderId, paymentId: payment.id, amount: payment.amount, reason: 'DISPENSE_FAILED',
    transferRef: `FT2631${String(index + 1).padStart(10, '0')}`,
    note: index === 0 ? 'Chuyển khoản Vietcombank cho khách theo số điện thoại trên phiếu báo sự cố.' : null,
    refundedAt: new Date(Date.parse(payment.paidAt ?? payment.createdAt) + 2 * 3_600_000).toISOString(),
    refundedById: admin.id, refundedByName: admin.fullName ?? null,
  }))
}

function refundView(store: MockStore, refund: MockRefund): D['RefundResponse'] {
  const order = store.orders.find(candidate => candidate.id === refund.orderId)
  const payment = store.payments.find(candidate => candidate.id === refund.paymentId)
  return {
    ...refund, orderCode: order?.orderCode ?? '', orderStatus: order?.status ?? 'REFUNDED', machineId: order?.machineId, machineCode: order?.machineCode,
    paymentProvider: payment?.provider, paymentStatus: payment?.status ?? 'REFUNDED',
  }
}

function findOrder(ctx: HandlerContext): MockOrder {
  const id = decodeURIComponent(ctx.params.orderId)
  if (!UUID.test(id)) throw new MockHttpError(400, 'Invalid order id', { orderId: 'Must be a valid UUID' })
  const order = ctx.store.orders.find(candidate => candidate.id === id)
  if (!order) throw notFound('Order not found')
  return order
}

function recordRefund(ctx: HandlerContext) {
  const form = new Form(ctx.body, ['transferRef', 'note', 'paymentId'])
  const body = ctx.body as Record<string, unknown>
  const transferRef = form.text('transferRef', 64)
  if (transferRef && !TRANSFER_REF.test(transferRef)) form.reject('transferRef', 'must match ^[A-Za-z0-9][A-Za-z0-9._/-]{2,63}$')
  const note = form.optionalText('note', 500)
  const paymentId = body.paymentId
  if (paymentId !== undefined && (typeof paymentId !== 'string' || !UUID.test(paymentId))) form.reject('paymentId', 'Must be a valid UUID')
  form.done()

  const { store } = ctx
  const order = findOrder(ctx)
  const ofOrder = store.payments.filter(payment => payment.orderId === order.id)
  const successes = ofOrder.filter(payment => payment.status === 'SUCCESS')
  let payment: MockPayment | undefined
  if (typeof paymentId === 'string') {
    payment = ofOrder.find(candidate => candidate.id.toLowerCase() === paymentId.toLowerCase())
    if (!payment) throw notFound('Payment not found for this order')
  } else {
    if (successes.length > 1) throw new MockHttpError(400, 'Validation Failed', { paymentId: 'Required when the order has more than one SUCCESS payment' })
    payment = successes[0] ?? ofOrder.find(candidate => candidate.status === 'REFUNDED')
    if (!payment) throw conflict('Order has no SUCCESS payment')
  }
  if (payment.status === 'REFUNDED') throw conflict('Payment is already REFUNDED')
  if (payment.status !== 'SUCCESS') throw conflict(`Payment is ${payment.status}, only SUCCESS can be refunded`)
  const reason: Reason | null = order.status === 'DISPENSE_FAILED' ? 'DISPENSE_FAILED' : order.status === 'CANCELLED' ? 'PAYMENT_LATE' : successes.length > 1 ? 'PAYMENT_DUPLICATE' : null
  if (!reason) throw conflict('Order is not a refund case')

  payment.status = 'REFUNDED'
  if (order.status === 'DISPENSE_FAILED' && !successes.some(other => other.id !== payment.id)) order.status = 'REFUNDED'
  const refund: MockRefund = {
    id: crypto.randomUUID(), orderId: order.id, paymentId: payment.id, amount: payment.amount, reason, transferRef, note,
    refundedAt: new Date(ctx.now).toISOString(), refundedById: ctx.user!.id, refundedByName: ctx.user!.fullName ?? null,
  }
  store.refunds.push(refund)
  return created(refundView(store, refund))
}

function listRefunds(ctx: HandlerContext) {
  const { store, query } = ctx
  for (const name of ['orderId', 'paymentId', 'machineId']) {
    const value = query.get(name)
    if (value && !UUID.test(value)) throw new MockHttpError(400, 'Invalid request parameter', { [name]: 'Must be a valid UUID' })
  }
  const reason = query.get('reason')
  if (reason && !REASONS.includes(reason as Reason)) throw new MockHttpError(400, 'Invalid request parameter', { reason: `Must be one of ${REASONS.join(', ')}` })
  const from = query.get('refundedFrom'), to = query.get('refundedTo')
  const rows = store.refunds.map(refund => refundView(store, refund)).filter(row =>
    (!query.get('orderId') || row.orderId === query.get('orderId')) && (!query.get('paymentId') || row.paymentId === query.get('paymentId'))
    && (!query.get('machineId') || row.machineId === query.get('machineId')) && (!reason || row.reason === reason)
    && (!from || Date.parse(row.refundedAt) >= Date.parse(from)) && (!to || Date.parse(row.refundedAt) < Date.parse(to)))
  return ok(paginate(rows, query, { sorts: { refundedAt: row => row.refundedAt, amount: row => row.amount }, defaultSort: 'refundedAt,desc' }))
}

export const refundRoutes: Route[] = [
  { method: 'POST', pattern: /^\/orders\/(?<orderId>[^/]+)\/refund\/?$/, policy: { draftPermission: 'REFUND_RECORD' }, handle: recordRefund },
  // PAYMENT_READ, ADMIN only like the payments it belongs to (the mock's 'admin' policy, as for GET /payments).
  { method: 'GET', pattern: /^\/refunds\/?$/, policy: 'admin', handle: listRefunds },
]
