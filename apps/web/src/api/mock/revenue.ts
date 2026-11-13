// Mock of GET /reports/revenue (draft api-contract/drafts/revenue-reports.yaml, FE 9.1/9.2, waiting for BE 6.1).
// This plays the BACKEND: figures are computed from the mock's own orders (seed + kiosk orders of this session), with
// the draft's definitions: a sale counts at paidAt with the order snapshot amounts; a refund counts at its refund time.
// There is no refund timestamp in the data yet (question Q2 of the draft): a REFUNDED order is taken as refunded
// REFUND_DELAY_MS after it was paid.
import { MockHttpError, notFound } from './http.ts'
import type { MockOrder, MockOrderItem, MockStore } from './seed.ts'
import type { components } from '../drafts/revenue-reports'
import { addDays, daysBetween, dueInstant, isDateString, vietnamDate } from '../../admin/maintenance-schedules.ts'

type R = components['schemas']
type Figures = R['RevenueFigures']

const PAID: readonly MockOrder['status'][] = ['PAID', 'DISPENSING', 'COMPLETED', 'DISPENSE_FAILED', 'REFUNDED']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VIETNAM_OFFSET_MS = 7 * 3_600_000
export const REFUND_DELAY_MS = 30 * 60_000
export const MAX_RANGE_DAYS = 92

const zero = (): Figures => ({ orderCount: 0, quantity: 0, grossAmount: 0, discountAmount: 0, paidAmount: 0, refundCount: 0, refundAmount: 0, netAmount: 0 })

/** When the mock considers a REFUNDED order refunded (no refunded_at in the data yet). */
export function mockRefundedAt(order: Pick<MockOrder, 'status' | 'paidAt'>): number | null {
  if (order.status !== 'REFUNDED' || !order.paidAt) return null
  return Date.parse(order.paidAt) + REFUND_DELAY_MS
}

const lineGross = (line: MockOrderItem) => (line.originalUnitPrice ?? line.unitPrice ?? 0) * line.quantity
const lineDiscount = (line: MockOrderItem) => line.discountAmount ?? 0

function addSale(target: Figures, lines: readonly MockOrderItem[]) {
  target.orderCount += 1
  for (const line of lines) {
    target.quantity += line.quantity
    target.grossAmount += lineGross(line)
    target.discountAmount += lineDiscount(line)
    target.paidAmount += line.totalPrice
    target.netAmount += line.totalPrice
  }
}
function addRefund(target: Figures, lines: readonly MockOrderItem[]) {
  target.refundCount += 1
  for (const line of lines) {
    target.refundAmount += line.totalPrice
    target.netAmount -= line.totalPrice
  }
}

export function revenueReport(store: MockStore, query: URLSearchParams, now: number): R['RevenueReportResponse'] {
  const errors: Record<string, string> = {}
  const fromDate = query.get('fromDate') ?? '', toDate = query.get('toDate') ?? ''
  const groupBy = (query.get('groupBy') || 'DAY') as R['RevenueGroupBy']
  const productId = query.get('productId') || null
  if (!isDateString(fromDate)) errors.fromDate = 'Must be a date (yyyy-MM-dd).'
  if (!isDateString(toDate)) errors.toDate = 'Must be a date (yyyy-MM-dd).'
  if (!errors.fromDate && !errors.toDate) {
    if (toDate < fromDate) errors.toDate = 'toDate must not be before fromDate.'
    else if (daysBetween(fromDate, toDate) + 1 > MAX_RANGE_DAYS) errors.fromDate = `Range must not exceed ${MAX_RANGE_DAYS} days.`
  }
  if (groupBy !== 'DAY' && groupBy !== 'HOUR_OF_DAY') errors.groupBy = 'Must be DAY or HOUR_OF_DAY.'
  if (productId && !UUID.test(productId)) errors.productId = 'Must be a UUID.'
  if (Object.keys(errors).length) throw new MockHttpError(400, 'Validation Failed', errors)
  if (productId && !store.products.some(product => product.id === productId)) throw notFound('Product not found')

  const start = Date.parse(dueInstant(fromDate)), end = Date.parse(dueInstant(addDays(toDate, 1)))
  const keys = groupBy === 'DAY' ? Array.from({ length: daysBetween(fromDate, toDate) + 1 }, (_, index) => addDays(fromDate, index)) : Array.from({ length: 24 }, (_, hour) => String(hour))
  const buckets = new Map(keys.map(key => [key, zero()]))
  const keyOf = (ms: number) => groupBy === 'DAY' ? vietnamDate(ms) : String(new Date(ms + VIETNAM_OFFSET_MS).getUTCHours())
  const totals = zero()
  const products = new Map<string, R['ProductRevenue']>()
  const productRow = (line: MockOrderItem) => {
    let row = products.get(line.productId)
    if (!row) { row = { productId: line.productId, sku: line.sku ?? '', productName: line.productName ?? '', ...zero() }; products.set(line.productId, row) }
    return row
  }
  const within = (ms: number) => ms >= start && ms < end

  for (const order of store.orders) {
    if (!PAID.includes(order.status) || !order.paidAt) continue
    const lines = order.items.filter(line => !productId || line.productId === productId)
    if (!lines.length) continue
    const paidAt = Date.parse(order.paidAt)
    if (within(paidAt)) {
      addSale(totals, lines)
      addSale(buckets.get(keyOf(paidAt))!, lines)
      for (const line of lines) addSale(productRow(line), [line])
    }
    const refundedAt = mockRefundedAt(order)
    if (refundedAt !== null && within(refundedAt)) {
      addRefund(totals, lines)
      addRefund(buckets.get(keyOf(refundedAt))!, lines)
      for (const line of lines) addRefund(productRow(line), [line])
    }
  }
  // A product appearing in several lines of one order counted the order once per line above: count orders per product.
  for (const row of products.values()) {
    row.orderCount = store.orders.filter(order => PAID.includes(order.status) && order.paidAt && within(Date.parse(order.paidAt)) && order.items.some(line => line.productId === row.productId)).length
    row.refundCount = store.orders.filter(order => { const at = mockRefundedAt(order); return at !== null && within(at) && order.items.some(line => line.productId === row.productId) }).length
  }

  return {
    fromDate, toDate, productId, groupBy, timeZone: 'Asia/Ho_Chi_Minh', generatedAt: new Date(now).toISOString(), totals,
    buckets: keys.map(key => ({ ...buckets.get(key)!, date: groupBy === 'DAY' ? key : null, hour: groupBy === 'DAY' ? null : Number(key) })),
    byProduct: [...products.values()].sort((a, b) => b.netAmount - a.netAmount || a.sku.localeCompare(b.sku, 'en')),
  }
}
