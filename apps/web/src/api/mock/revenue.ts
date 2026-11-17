// Mock of the sales report API of backend #76 (api.yaml, docs/reports.md): summary, timeseries, peak-hours, products,
// machines and the CSV / PDF export. This plays the BACKEND, with its definitions (docs/reports.md §1):
// - a sale is a delivered order: completed_at in the range (COMPLETED, or REFUNDED after it was delivered); gross =
//   subtotal, discounts = discount_amount, net = total_amount;
// - deliveredRefunds: refunds (PRODUCT_QUALITY / OTHER) of delivered orders, at refunded_at; netRevenue = net − those;
// - moneyCollected: payments SUCCESS / REFUNDED at paid_at; moneyRefunded: every refund at refunded_at, by reason;
// - pendingRefunds: the current refund candidates (ignores range and filters); failedDispenses: orders paid in the
//   range that did not deliver (DISPENSE_FAILED, or refunded without delivery and not cancelled).
// Days and hours in Asia/Ho_Chi_Minh; product = the order's line (one line per order on the backend), machine = the order's.
import { MockHttpError, ok } from './http.ts'
import type { Reply } from './http.ts'
import type { HandlerContext, Route } from './handlers.ts'
import type { MockOrder, MockStore } from './seed.ts'
import { REASONS, refundCandidates } from './refunds.ts'
import type { components } from '../schema'
import { addDays, daysBetween, dueInstant, isDateString, vietnamDate } from '../../admin/maintenance-schedules.ts'

type S = components['schemas']
type Granularity = NonNullable<S['SalesSeries']['granularity']>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VIETNAM_OFFSET_MS = 7 * 3_600_000
export const MAX_RANGE_DAYS = 366
export const MAX_IDS = 20
export const ZONE = 'Asia/Ho_Chi_Minh'
const DELIVERED_REFUND_REASONS = ['PRODUCT_QUALITY', 'OTHER']
const iso = (ms: number) => new Date(ms).toISOString()

export interface SalesScope {
  from: string; to: string
  /** [start, end) instants of the range (00:00 Vietnam time of `from`, of the day after `to`). */
  start: number; end: number
  machineIds: string[]; productIds: string[]
}

/** The common parameters: 400 when missing, malformed, reversed, longer than 366 days, more than 20 ids or unknown ids. */
export function readScope(store: Pick<MockStore, 'machines' | 'products'>, query: URLSearchParams): SalesScope {
  const errors: Record<string, string> = {}
  const from = query.get('from') ?? '', to = query.get('to') ?? ''
  if (!from) errors.from = 'Required'
  else if (!isDateString(from)) errors.from = 'Must be a date (yyyy-MM-dd)'
  if (!to) errors.to = 'Required'
  else if (!isDateString(to)) errors.to = 'Must be a date (yyyy-MM-dd)'
  if (!errors.from && !errors.to) {
    if (to < from) errors.to = 'Must not be before from'
    else if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) errors.to = `The range must be at most ${MAX_RANGE_DAYS} days`
  }
  const ids = (name: 'machineId' | 'productId') => {
    const values = [...new Set(query.getAll(name).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean))]
    if (values.length > MAX_IDS) errors[name] = `At most ${MAX_IDS} values`
    else if (values.some(value => !UUID.test(value))) errors[name] = 'Must be a valid UUID'
    return values
  }
  const machineIds = ids('machineId'), productIds = ids('productId')
  if (Object.keys(errors).length) throw new MockHttpError(400, 'Invalid request parameter', errors)
  const unknownMachine = machineIds.find(id => !store.machines.some(machine => machine.id === id))
  if (unknownMachine) throw new MockHttpError(400, `Unknown machineId: ${unknownMachine}`)
  const unknownProduct = productIds.find(id => !store.products.some(product => product.id === id))
  if (unknownProduct) throw new MockHttpError(400, `Unknown productId: ${unknownProduct}`)
  return { from, to, start: Date.parse(dueInstant(from)), end: Date.parse(dueInstant(addDays(to, 1))), machineIds, productIds }
}

const filtersEcho = (scope: SalesScope): S['FiltersEcho'] => ({ from: scope.from, to: scope.to, machineIds: scope.machineIds, productIds: scope.productIds, zone: ZONE })
const productOf = (order: Pick<MockOrder, 'items'>) => order.items[0]?.productId
const matches = (order: MockOrder, scope: SalesScope) =>
  (!scope.machineIds.length || scope.machineIds.includes(order.machineId)) && (!scope.productIds.length || scope.productIds.includes(productOf(order) ?? ''))
const within = (at: string | null | undefined, scope: Pick<SalesScope, 'start' | 'end'>) => {
  const ms = Date.parse(at ?? '')
  return Number.isFinite(ms) && ms >= scope.start && ms < scope.end
}
/** Delivered: the machine reported the dispense done (completed_at), whatever happened after (a later refund). */
export const delivered = (order: Pick<MockOrder, 'status' | 'completedAt'>) => !!order.completedAt && (order.status === 'COMPLETED' || order.status === 'REFUNDED')
const gross = (order: MockOrder) => order.subtotal ?? order.totalAmount + (order.discountAmount ?? 0)
const discount = (order: MockOrder) => order.discountAmount ?? Math.max(0, gross(order) - order.totalAmount)

/** A sale (delivered order in the range) and a delivered-order refund in the range, the two facts every figure adds up. */
interface Sale { order: MockOrder; at: number }
interface DeliveredRefund { order: MockOrder; amount: number; at: number }
function facts(store: MockStore, scope: SalesScope): { sales: Sale[]; refunds: DeliveredRefund[] } {
  const sales = store.orders.filter(order => delivered(order) && matches(order, scope) && within(order.completedAt, scope))
    .map(order => ({ order, at: Date.parse(order.completedAt!) }))
  const refunds: DeliveredRefund[] = []
  for (const refund of store.refunds) {
    if (!DELIVERED_REFUND_REASONS.includes(refund.reason) || !within(refund.refundedAt, scope)) continue
    const order = store.orders.find(candidate => candidate.id === refund.orderId)
    if (order && delivered(order) && matches(order, scope)) refunds.push({ order, amount: refund.amount, at: Date.parse(refund.refundedAt) })
  }
  return { sales, refunds }
}

interface Totals { ordersSold: number; grossSales: number; discounts: number; netSales: number; deliveredRefunds: number; netRevenue: number }
const zero = (): Totals => ({ ordersSold: 0, grossSales: 0, discounts: 0, netSales: 0, deliveredRefunds: 0, netRevenue: 0 })
function addSale(target: Totals, order: MockOrder) {
  target.ordersSold += 1
  target.grossSales += gross(order)
  target.discounts += discount(order)
  target.netSales += order.totalAmount
  target.netRevenue += order.totalAmount
}
function addRefund(target: Totals, amount: number) {
  target.deliveredRefunds += amount
  target.netRevenue -= amount
}
function totalsOf(sales: readonly Sale[], refunds: readonly DeliveredRefund[]): Totals {
  const totals = zero()
  for (const { order } of sales) addSale(totals, order)
  for (const { amount } of refunds) addRefund(totals, amount)
  return totals
}

// ---- endpoints

export function salesSummary(store: MockStore, scope: SalesScope, now: number): S['SalesSummary'] {
  const { sales, refunds } = facts(store, scope)
  const totals = totalsOf(sales, refunds)
  const orderOf = (id: string) => store.orders.find(order => order.id === id)
  const moneyCollected = store.payments.filter(payment => (payment.status === 'SUCCESS' || payment.status === 'REFUNDED') && within(payment.paidAt, scope)
    && (() => { const order = orderOf(payment.orderId); return !!order && matches(order, scope) })()).reduce((sum, payment) => sum + payment.amount, 0)
  const refunded = store.refunds.filter(refund => within(refund.refundedAt, scope) && (() => { const order = orderOf(refund.orderId); return !!order && matches(order, scope) })())
  const byReason = Object.fromEntries(REASONS.map(reason => [reason, refunded.filter(refund => refund.reason === reason).reduce((sum, refund) => sum + refund.amount, 0)]))
  const candidates = refundCandidates(store)
  const failedDispenses = store.orders.filter(order => matches(order, scope) && within(order.paidAt, scope)
    && (order.status === 'DISPENSE_FAILED' || (order.status === 'REFUNDED' && !order.completedAt && !order.cancelledAt))).length
  return {
    filters: filtersEcho(scope), ...totals,
    averageOrderValue: totals.ordersSold ? Math.floor(totals.netSales / totals.ordersSold) : 0,
    moneyCollected,
    moneyRefunded: { total: refunded.reduce((sum, refund) => sum + refund.amount, 0), byReason },
    pendingRefunds: { count: candidates.length, amount: candidates.reduce((sum, row) => sum + row.payment.amount, 0) },
    failedDispenses, generatedAt: iso(now),
  }
}

/** Vietnam day of an instant; Monday of its ISO week; first of its month. */
const dayOf = (ms: number) => vietnamDate(ms)
function periodStart(date: string, granularity: Granularity): string {
  if (granularity === 'DAY') return date
  if (granularity === 'MONTH') return `${date.slice(0, 8)}01`
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday 0
  return addDays(date, -weekday)
}
function periodEnd(start: string, granularity: Granularity): string {
  if (granularity === 'DAY') return start
  if (granularity === 'WEEK') return addDays(start, 6)
  return addDays(`${addDays(`${start.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1)
}

export function salesSeries(store: MockStore, scope: SalesScope, granularity: Granularity, now: number): S['SalesSeries'] {
  const { sales, refunds } = facts(store, scope)
  const buckets: (S['SalesBucket'] & Totals & { key: string })[] = []
  for (let key = periodStart(scope.from, granularity); key <= scope.to; key = addDays(periodEnd(key, granularity), 1)) {
    const end = periodEnd(key, granularity)
    buckets.push({ key, start: key < scope.from ? scope.from : key, end: end > scope.to ? scope.to : end, ...zero() })
  }
  const bucketOf = (ms: number) => buckets.find(bucket => bucket.key === periodStart(dayOf(ms), granularity))
  for (const { order, at } of sales) { const bucket = bucketOf(at); if (bucket) addSale(bucket, order) }
  for (const { amount, at } of refunds) { const bucket = bucketOf(at); if (bucket) addRefund(bucket, amount) }
  return { filters: filtersEcho(scope), granularity, buckets: buckets.map(({ key: _key, ...bucket }) => bucket), generatedAt: iso(now) }
}

export function peakHours(store: MockStore, scope: SalesScope, now: number): S['PeakHours'] {
  const { sales } = facts(store, scope)
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, ordersSold: 0, netSales: 0 }))
  const weekdayHours = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const { order, at } of sales) {
    const local = new Date(at + VIETNAM_OFFSET_MS)
    const hour = local.getUTCHours(), weekday = (local.getUTCDay() + 6) % 7
    hours[hour].ordersSold += 1
    hours[hour].netSales += order.totalAmount
    weekdayHours[weekday][hour] += 1
  }
  return { filters: filtersEcho(scope), hours, weekdayHours, generatedAt: iso(now) }
}

export function productSales(store: MockStore, scope: SalesScope, sortBy: 'QUANTITY' | 'NET_SALES', limit: number, now: number): S['ProductReport'] {
  const { sales, refunds } = facts(store, scope)
  const rows = new Map<string, S['ProductSales'] & { quantity: number; netSales: number; grossSales: number; discounts: number; deliveredRefunds: number }>()
  const row = (order: MockOrder) => {
    const id = productOf(order) ?? ''
    let entry = rows.get(id)
    if (!entry) {
      const product = store.products.find(candidate => candidate.id === id)
      entry = { productId: id, sku: product?.sku ?? order.items[0]?.sku, name: product?.name ?? order.items[0]?.productName, status: product?.status, quantity: 0, grossSales: 0, discounts: 0, netSales: 0, deliveredRefunds: 0, sharePercent: 0 }
      rows.set(id, entry)
    }
    return entry
  }
  for (const { order } of sales) {
    const entry = row(order)
    entry.quantity += order.items.reduce((sum, line) => sum + line.quantity, 0)
    entry.grossSales += gross(order)
    entry.discounts += discount(order)
    entry.netSales += order.totalAmount
  }
  for (const { order, amount } of refunds) row(order).deliveredRefunds += amount
  const total = [...rows.values()].reduce((sum, entry) => sum + entry.netSales, 0)
  for (const entry of rows.values()) entry.sharePercent = total ? Math.round((entry.netSales / total) * 1000) / 10 : 0
  const products = [...rows.values()].sort((a, b) => (sortBy === 'QUANTITY' ? b.quantity - a.quantity : b.netSales - a.netSales)
    || (a.name ?? '').localeCompare(b.name ?? '', 'vi') || (a.productId ?? '').localeCompare(b.productId ?? '')).slice(0, limit)
  return { filters: filtersEcho(scope), sortBy, limit, products, generatedAt: iso(now) }
}

export function machineSales(store: MockStore, scope: SalesScope, now: number): S['MachineReport'] {
  const { sales, refunds } = facts(store, scope)
  const machines = store.machines.filter(machine => !scope.machineIds.length || scope.machineIds.includes(machine.id))
    .sort((a, b) => a.code.localeCompare(b.code, 'en'))
    .map(machine => {
      const totals = totalsOf(sales.filter(sale => sale.order.machineId === machine.id), refunds.filter(refund => refund.order.machineId === machine.id))
      return { machineId: machine.id, code: machine.code, name: machine.name, ordersSold: totals.ordersSold, netSales: totals.netSales, deliveredRefunds: totals.deliveredRefunds, netRevenue: totals.netRevenue }
    })
  return { filters: filtersEcho(scope), machines, generatedAt: iso(now) }
}

// ---- export

/** CSV cell as the backend writes it: text starting with = + - @ tab CR gets a leading ', quoted when needed (RFC 4180). */
function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number') return String(value)
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
export function salesCsv(store: MockStore, scope: SalesScope, now: number): string {
  const summary = salesSummary(store, scope, now)
  const days = salesSeries(store, scope, 'DAY', now)
  const peak = peakHours(store, scope, now)
  const products = productSales(store, scope, 'NET_SALES', Number.MAX_SAFE_INTEGER, now)
  const machines = machineSales(store, scope, now)
  const rows: (string | number | undefined)[][] = [
    ['[Filters]'], ['from', scope.from], ['to', scope.to], ['machineIds', scope.machineIds.join(' ')], ['productIds', scope.productIds.join(' ')], ['zone', ZONE], ['generatedAt', summary.generatedAt], [],
    ['[Summary]'], ['metric', 'value'],
    ...(['ordersSold', 'grossSales', 'discounts', 'netSales', 'deliveredRefunds', 'netRevenue', 'averageOrderValue', 'moneyCollected', 'failedDispenses'] as const).map(key => [key, summary[key]]),
    ['moneyRefunded', summary.moneyRefunded?.total], ...REASONS.map(reason => [`moneyRefunded.${reason}`, summary.moneyRefunded?.byReason?.[reason] ?? 0]),
    ['pendingRefunds.count', summary.pendingRefunds?.count], ['pendingRefunds.amount', summary.pendingRefunds?.amount], [],
    ['[Daily]'], ['date', 'ordersSold', 'grossSales', 'discounts', 'netSales', 'deliveredRefunds', 'netRevenue'],
    ...(days.buckets ?? []).map(bucket => [bucket.start, bucket.ordersSold, bucket.grossSales, bucket.discounts, bucket.netSales, bucket.deliveredRefunds, bucket.netRevenue]), [],
    ['[Products]'], ['sku', 'name', 'status', 'quantity', 'grossSales', 'discounts', 'netSales', 'deliveredRefunds', 'sharePercent'],
    ...(products.products ?? []).map(product => [product.sku, product.name, product.status, product.quantity, product.grossSales, product.discounts, product.netSales, product.deliveredRefunds, product.sharePercent]), [],
    ['[Peak hours]'], ['hour', 'ordersSold', 'netSales'], ...(peak.hours ?? []).map(hour => [hour.hour, hour.ordersSold, hour.netSales]), [],
    ['[Machines]'], ['code', 'name', 'ordersSold', 'netSales', 'deliveredRefunds', 'netRevenue'],
    ...(machines.machines ?? []).map(machine => [machine.code, machine.name, machine.ordersSold, machine.netSales, machine.deliveredRefunds, machine.netRevenue]),
  ]
  return `﻿${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
/** A one-page PDF carrying the summary figures as text (enough for a download test; the backend renders A4 with PDFBox). */
export function salesPdf(store: MockStore, scope: SalesScope, now: number): Uint8Array {
  const summary = salesSummary(store, scope, now)
  const lines = [`FreshVend sales ${scope.from} - ${scope.to}`, `ordersSold ${summary.ordersSold}`, `netSales ${summary.netSales}`, `netRevenue ${summary.netRevenue}`]
  const text = lines.map((line, index) => `BT /F1 11 Tf 50 ${780 - index * 18} Td (${line.replace(/[()\\]/g, '')}) Tj ET`).join('\n')
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}
function exportReport(ctx: HandlerContext): Reply {
  const format = ctx.query.get('format') ?? ''
  if (format !== 'CSV' && format !== 'PDF') throw new MockHttpError(400, 'Invalid request parameter', { format: 'Must be one of: CSV, PDF' })
  const scope = readScope(ctx.store, ctx.query)
  const name = `freshvend-sales_${scope.from}_${scope.to}.${format.toLowerCase()}`
  const body = format === 'CSV' ? new TextEncoder().encode(salesCsv(ctx.store, scope, ctx.now)) : salesPdf(ctx.store, scope, ctx.now)
  ctx.store.exportLog.push({ format, at: iso(ctx.now), userId: ctx.user?.id ?? '', from: scope.from, to: scope.to })
  return {
    status: 200, data: undefined,
    raw: { body, headers: { 'Content-Type': format === 'CSV' ? 'text/csv;charset=UTF-8' : 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } },
  }
}

// ---- routes

function enumParam<T extends string>(query: URLSearchParams, name: string, values: readonly T[], fallback: T): T {
  const value = query.get(name)
  if (value === null || value === '') return fallback
  if (!values.includes(value as T)) throw new MockHttpError(400, 'Invalid request parameter', { [name]: `Must be one of: ${values.join(', ')}` })
  return value as T
}
function limitParam(query: URLSearchParams): number {
  const raw = query.get('limit')
  if (raw === null || raw === '') return 10
  const value = Number(raw)
  if (!/^\d+$/.test(raw) || value < 1 || value > 100) throw new MockHttpError(400, 'Invalid request parameter', { limit: 'Must be between 1 and 100' })
  return value
}
const read = { permission: 'REPORT_SALES_READ' }
const route = (template: string, policy: Route['policy'], handle: Route['handle']): Route => ({ method: 'GET', pattern: new RegExp(`^${template}/?$`), policy, handle })

export const salesReportRoutes: Route[] = [
  route('/reports/sales/summary', read, ctx => ok(salesSummary(ctx.store, readScope(ctx.store, ctx.query), ctx.now))),
  route('/reports/sales/timeseries', read, ctx => {
    const granularity = enumParam(ctx.query, 'granularity', ['DAY', 'WEEK', 'MONTH'] as const, 'DAY')
    return ok(salesSeries(ctx.store, readScope(ctx.store, ctx.query), granularity, ctx.now))
  }),
  route('/reports/sales/peak-hours', read, ctx => ok(peakHours(ctx.store, readScope(ctx.store, ctx.query), ctx.now))),
  route('/reports/sales/products', read, ctx => {
    const sortBy = enumParam(ctx.query, 'sortBy', ['QUANTITY', 'NET_SALES'] as const, 'NET_SALES')
    const limit = limitParam(ctx.query)
    return ok(productSales(ctx.store, readScope(ctx.store, ctx.query), sortBy, limit, ctx.now))
  }),
  route('/reports/sales/machines', read, ctx => ok(machineSales(ctx.store, readScope(ctx.store, ctx.query), ctx.now))),
  route('/reports/sales/export', { permission: 'REPORT_EXPORT' }, exportReport),
]
