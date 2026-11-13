// Mock of GET /reports/revenue (draft api-contract/drafts/revenue-reports.yaml, FE 9.1/9.2, waiting for BE 6.1).
// This plays the BACKEND: figures are computed from the mock's own orders (seed + kiosk orders of this session), with
// the draft's definitions: a sale counts at paidAt with the order snapshot amounts; a refund counts at its refund time,
// read from the refunds the mock records (FE 8.1, draft refunds.yaml: refundedAt, amount). Only refunds of revenue are
// counted (reason DISPENSE_FAILED, on a paid order): a late payment (PAYMENT_LATE, cancelled order) or a duplicate
// payment (PAYMENT_DUPLICATE) never entered the revenue, so giving it back does not leave it either.
import { MockHttpError, notFound } from './http.ts'
import type { MockOrder, MockOrderItem, MockStore } from './seed.ts'
import type { MockRefund } from './refunds.ts'
import type { components } from '../drafts/revenue-reports'
import { addDays, daysBetween, dueInstant, isDateString, vietnamDate } from '../../admin/maintenance-schedules.ts'

type R = components['schemas']
type Figures = R['RevenueFigures']

const PAID: readonly MockOrder['status'][] = ['PAID', 'DISPENSING', 'COMPLETED', 'DISPENSE_FAILED', 'REFUNDED']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VIETNAM_OFFSET_MS = 7 * 3_600_000
export const MAX_RANGE_DAYS = 92

const zero = (): Figures => ({ orderCount: 0, quantity: 0, grossAmount: 0, discountAmount: 0, paidAmount: 0, refundCount: 0, refundAmount: 0, netAmount: 0 })

/** A recorded refund that gives back revenue: the refund of a dispense failure, on an order that was paid. */
export function refundsRevenue(refund: Pick<MockRefund, 'reason'>, order: Pick<MockOrder, 'status' | 'paidAt'> | undefined): boolean {
  return refund.reason === 'DISPENSE_FAILED' && !!order?.paidAt && PAID.includes(order.status)
}

/** Splits a refunded amount over the order's lines in proportion to each line's paid total (whole đồng, rest on the last). */
export function refundShares(lines: readonly Pick<MockOrderItem, 'totalPrice'>[], amount: number): number[] {
  const paid = lines.reduce((sum, line) => sum + line.totalPrice, 0)
  if (paid === amount || !lines.length) return lines.map(line => line.totalPrice)
  const shares = lines.map(line => paid > 0 ? Math.floor(amount * line.totalPrice / paid) : 0)
  shares[shares.length - 1] += amount - shares.reduce((sum, share) => sum + share, 0)
  return shares
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
function addRefund(target: Figures, amount: number) {
  target.refundCount += 1
  target.refundAmount += amount
  target.netAmount -= amount
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
  }
  // Refunds at their refundedAt, for the amount recorded, split over the order's lines in proportion to what each line
  // was paid (whole đồng, rest on the last line), so with a product filter and per product what was given back for
  // that product is counted, and the product rows still add up to the totals.
  const refundedProducts = new Map<string, Set<string>>()
  for (const refund of store.refunds) {
    const order = store.orders.find(candidate => candidate.id === refund.orderId)
    if (!order || !refundsRevenue(refund, order)) continue
    const refundedAt = Date.parse(refund.refundedAt)
    if (!within(refundedAt)) continue
    const shares = refundShares(order.items, refund.amount)
    const lines = order.items.map((line, index) => ({ line, share: shares[index] })).filter(({ line }) => !productId || line.productId === productId)
    if (!lines.length) continue
    const amount = lines.reduce((sum, { share }) => sum + share, 0)
    addRefund(totals, amount)
    addRefund(buckets.get(keyOf(refundedAt))!, amount)
    for (const { line, share } of lines) {
      const row = productRow(line)
      const seen = refundedProducts.get(line.productId) ?? new Set<string>()
      refundedProducts.set(line.productId, seen)
      // One refund counts once per product even when the product is on several lines of the order.
      if (seen.has(refund.id)) { row.refundAmount += share; row.netAmount -= share } else { seen.add(refund.id); addRefund(row, share) }
    }
  }
  // A product appearing in several lines of one order counted the order once per line above: count orders per product.
  for (const row of products.values()) {
    row.orderCount = store.orders.filter(order => PAID.includes(order.status) && order.paidAt && within(Date.parse(order.paidAt)) && order.items.some(line => line.productId === row.productId)).length
  }

  return {
    fromDate, toDate, productId, groupBy, timeZone: 'Asia/Ho_Chi_Minh', generatedAt: new Date(now).toISOString(), totals,
    buckets: keys.map(key => ({ ...buckets.get(key)!, date: groupBy === 'DAY' ? key : null, hour: groupBy === 'DAY' ? null : Number(key) })),
    byProduct: [...products.values()].sort((a, b) => b.netAmount - a.netAmount || a.sku.localeCompare(b.sku, 'en')),
  }
}
