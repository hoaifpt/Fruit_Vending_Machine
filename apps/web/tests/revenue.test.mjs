// FE 9.1 Báo cáo doanh thu (R1) and FE 9.2 Tổng quan (O1 revenue block) on the sales report API of backend #76
// (api.yaml, docs/reports.md): URL filters, range rules, the query (contract parameters only), labels of figures and
// periods, peak hours, the server-rendered export (file name from Content-Disposition), and the mock playing the backend
// with its definitions (sales at completed_at, refunds at refunded_at, delivered refunds apart, totals add up).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient, fileNameFromDisposition } from '../src/api/client.ts'
import { authApi, dashboardApi, ordersApi, refundsApi, salesReportsApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { jsonResponse } from './helpers.mjs'
import { delivered, machineSales, peakHours, productSales, readScope, salesSeries, salesSummary } from '../src/api/mock/revenue.ts'
import { can } from '../src/admin/permissions.ts'
import { matchRoute, navFor } from '../src/admin/routes.ts'
import { addDays, vietnamDate } from '../src/admin/maintenance-schedules.ts'
import {
  EXPORT_HINT, FIGURES, MAX_RANGE_DAYS, PRODUCT_LIMIT, REVENUE_PATH, WEEKDAYS, bucketLabel, bucketShortLabel, busiestHours, chartScale, compactMoney,
  exportFileName, exportQuery, figureText, figureValue, hasActivity, heatLevel, hourLabel, hoursOfDay, labelEvery, loadSalesReport, loadWeekSummary,
  matrixMax, overviewWeek, presetOf, presetRange, readRevenueFilters, refundsByReason, reportRejected, revenueHref, revenueKey, salesQuery, scopeText,
  shareText, validateRange,
} from '../src/admin/revenue.ts'

const TODAY = '2026-11-13'
const P1 = '40000000-0000-0000-0000-000000000001'
const P2 = '40000000-0000-0000-0000-000000000002'
const M1 = '20000000-0000-0000-0000-000000000001'
const M2 = '20000000-0000-0000-0000-000000000002'
const DEFAULTS = { from: '2026-11-07', to: TODAY, machineId: '', productId: '', granularity: 'DAY', productSort: 'NET_SALES' }

// ---- filters and range

test('presets end today, in Vietnam calendar days', () => {
  assert.deepEqual(presetRange('today', TODAY), { from: TODAY, to: TODAY })
  assert.deepEqual(presetRange('7d', TODAY), { from: '2026-11-07', to: TODAY })
  assert.deepEqual(presetRange('30d', TODAY), { from: '2026-10-15', to: TODAY })
  assert.deepEqual(presetRange('month', TODAY), { from: '2026-11-01', to: TODAY })
  assert.equal(presetOf({ from: '2026-11-07', to: TODAY }, TODAY), '7d')
  assert.equal(presetOf({ from: '2026-11-08', to: TODAY }, TODAY), undefined)
  assert.deepEqual(overviewWeek(TODAY), presetRange('7d', TODAY), 'the overview reads the same 7 days as the preset')
})

test('URL filters: defaults to the last 7 days, invalid values are ignored and named', () => {
  assert.deepEqual(readRevenueFilters(new URLSearchParams(''), TODAY), { filters: DEFAULTS, ignored: [] })
  const full = readRevenueFilters(new URLSearchParams(`from=2026-11-01&to=2026-11-10&machineId=${M1}&productId=${P1}&granularity=week&productSort=quantity`), TODAY)
  assert.deepEqual(full.filters, { from: '2026-11-01', to: '2026-11-10', machineId: M1, productId: P1, granularity: 'WEEK', productSort: 'QUANTITY' })
  assert.equal(readRevenueFilters(new URLSearchParams('granularity=month'), TODAY).filters.granularity, 'MONTH')
  const bad = readRevenueFilters(new URLSearchParams('from=2026-02-30&to=x&machineId=1&productId=../1&granularity=hour&productSort=name'), TODAY)
  assert.deepEqual(bad.filters, DEFAULTS)
  assert.deepEqual(bad.ignored, ['from', 'to', 'machineId', 'productId', 'granularity', 'productSort'])
})

test(`range rules are checked before any request (at most ${MAX_RANGE_DAYS} days)`, () => {
  assert.equal(MAX_RANGE_DAYS, 366)
  assert.deepEqual(validateRange('2026-11-01', TODAY), {})
  assert.deepEqual(validateRange(TODAY, TODAY), {})
  assert.match(validateRange(TODAY, '2026-11-12').to, /bằng hoặc sau/)
  assert.deepEqual(validateRange('2025-11-13', TODAY), {}, '366 days counting both ends')
  assert.match(validateRange('2025-11-12', TODAY).from, /tối đa 366 ngày/)
  assert.ok(validateRange('', TODAY).from)
})

test('query and links send only the contract parameters; ids repeat as lists, empty filters are not sent', () => {
  assert.deepEqual(salesQuery(DEFAULTS), { from: '2026-11-07', to: TODAY })
  assert.deepEqual(salesQuery({ ...DEFAULTS, machineId: M1, productId: P1 }), { from: '2026-11-07', to: TODAY, machineId: [M1], productId: [P1] })
  assert.deepEqual(exportQuery({ ...DEFAULTS, machineId: M1 }, 'PDF'), { format: 'PDF', from: '2026-11-07', to: TODAY, machineId: [M1] })
  assert.equal(revenueHref({ from: TODAY, to: TODAY }), `${REVENUE_PATH}?from=${TODAY}&to=${TODAY}`)
  assert.equal(revenueHref({ ...DEFAULTS, machineId: M1, productId: P1, granularity: 'MONTH', productSort: 'QUANTITY' }),
    `${REVENUE_PATH}?from=2026-11-07&to=${TODAY}&machineId=${M1}&productId=${P1}&granularity=month&productSort=quantity`)
  // The link reads back as the same filters.
  const back = readRevenueFilters(new URL(revenueHref({ ...DEFAULTS, granularity: 'WEEK' }), 'https://x.invalid').searchParams, TODAY).filters
  assert.equal(revenueKey(back), revenueKey({ ...DEFAULTS, granularity: 'WEEK' }))
})

test('route R1: REPORT_SALES_READ, ADMIN only, in the Giao dịch group; export needs REPORT_EXPORT', () => {
  const route = matchRoute(REVENUE_PATH)
  assert.equal(route.page, 'revenue-report')
  assert.equal(route.permission, 'REPORT_SALES_READ')
  assert.deepEqual(route.roles, ['ADMIN'])
  assert.equal(can(['STAFF'], 'REPORT_SALES_READ'), false)
  assert.equal(can(['ADMIN'], 'REPORT_EXPORT'), true)
  assert.equal(can(['STAFF'], 'REPORT_EXPORT'), false)
  assert.equal(can({ roles: ['ADMIN'], permissions: ['REPORT_SALES_READ'] }, 'REPORT_EXPORT'), false, 'reading does not imply exporting')
  const item = navFor(['ADMIN']).find(entry => entry.to === REVENUE_PATH)
  assert.equal(item.group, 'Giao dịch')
  assert.equal(item.label, 'Báo cáo doanh thu')
  assert.equal(navFor(['STAFF']).some(entry => entry.to === REVENUE_PATH), false)
})

// ---- display

const summarySample = () => ({
  filters: { from: '2026-11-12', to: TODAY, machineIds: [], productIds: [], zone: 'Asia/Ho_Chi_Minh' },
  ordersSold: 3, grossSales: 105000, discounts: 17500, netSales: 87500, deliveredRefunds: 35000, netRevenue: 52500, averageOrderValue: 29166,
  moneyCollected: 122500, moneyRefunded: { total: 70000, byReason: { DISPENSE_FAILED: 35000, PRODUCT_QUALITY: 35000 } },
  pendingRefunds: { count: 1, amount: 35000 }, failedDispenses: 1, generatedAt: '2026-11-13T06:05:00Z',
})

test('figures: the server values, money as VND, counts plain; netRevenue first; refunds by every reason', () => {
  assert.equal(FIGURES[0].key, 'netRevenue')
  assert.deepEqual(FIGURES.map(figure => figure.key), ['netRevenue', 'netSales', 'grossSales', 'discounts', 'deliveredRefunds', 'ordersSold', 'averageOrderValue', 'moneyCollected', 'moneyRefunded', 'failedDispenses'])
  const summary = summarySample()
  assert.equal(figureValue(summary, 'moneyRefunded'), 70000)
  assert.equal(figureValue(summary, 'netRevenue'), 52500)
  assert.equal(figureValue({}, 'ordersSold'), 0)
  assert.match(figureText({ money: true }, 35000), /^35\.000\s₫$/)
  assert.match(figureText({ money: true }, -17500), /^-17\.500\s₫$/)
  assert.equal(figureText({ money: false }, 1234), '1.234')
  assert.deepEqual(refundsByReason(summary).map(row => [row.reason, row.amount]),
    [['DISPENSE_FAILED', 35000], ['LATE_PAYMENT', 0], ['DUPLICATE_PAYMENT', 0], ['PRODUCT_QUALITY', 35000], ['OTHER', 0]])
  assert.equal(refundsByReason(summary)[0].label, 'Nhả hàng thất bại')
  assert.equal(hasActivity(summary), true)
  assert.equal(hasActivity({ ordersSold: 0, deliveredRefunds: 0, moneyCollected: 0, moneyRefunded: { total: 0 }, failedDispenses: 0 }), false)
  assert.equal(hasActivity({ ordersSold: 0, moneyRefunded: { total: 35000 } }), true, 'a period with only a refund is not empty')
  assert.equal(shareText(36.5), '36,5%')
  assert.equal(shareText(0), '0,0%')
  assert.equal(scopeText({ from: TODAY, to: TODAY }, undefined, undefined), 'Ngày 13/11/2026 · Tất cả máy · Tất cả sản phẩm')
  assert.equal(scopeText({ from: '2026-11-07', to: TODAY }, 'DEV-01 · Máy 1', 'Táo'), 'Từ 07/11/2026 đến 13/11/2026 · Máy DEV-01 · Máy 1 · Sản phẩm Táo')
  assert.match(EXPORT_HINT, /máy chủ tạo/)
})

test('periods: day, ISO week (clipped by the range) and calendar month labels', () => {
  assert.equal(bucketLabel({ start: TODAY, end: TODAY }, 'DAY'), '13/11/2026')
  assert.equal(bucketLabel({ start: '2026-11-09', end: '2026-11-15' }, 'WEEK'), '09/11 – 15/11/2026')
  assert.equal(bucketLabel({ start: TODAY, end: TODAY }, 'WEEK'), '13/11/2026', 'a one-day clipped week reads as that day')
  assert.equal(bucketLabel({ start: '2026-11-01', end: '2026-11-30' }, 'MONTH'), 'Tháng 11/2026')
  assert.equal(bucketLabel({ start: '2026-02-01', end: '2026-02-28' }, 'MONTH'), 'Tháng 02/2026')
  assert.equal(bucketLabel({ start: '2026-11-01', end: TODAY }, 'MONTH'), 'Tháng 11/2026 (01/11 – 13/11)')
  assert.equal(bucketLabel({}, 'DAY'), '—')
  assert.equal(bucketShortLabel({ start: TODAY }, 'DAY'), '13/11')
  assert.equal(bucketShortLabel({ start: '2026-11-01' }, 'MONTH'), '11/2026')
})

test('peak hours: 24 hours in order, busiest first, Monday-first matrix with a heat scale', () => {
  const peak = { hours: [{ hour: 12, ordersSold: 5, netSales: 175000 }, { hour: 7, ordersSold: 5, netSales: 200000 }, { hour: 18, ordersSold: 2, netSales: 70000 }] }
  const hours = hoursOfDay(peak)
  assert.equal(hours.length, 24)
  assert.deepEqual(hours.map(row => row.hour), Array.from({ length: 24 }, (_, hour) => hour))
  assert.equal(hours[3].ordersSold, 0, 'an hour missing from the answer is 0')
  assert.deepEqual(busiestHours(peak).map(row => row.hour), [7, 12, 18], 'ties by sales')
  assert.deepEqual(busiestHours({ hours: [] }), [])
  assert.equal(hourLabel(9), '09:00–09:59')
  assert.deepEqual(WEEKDAYS.map(day => day.short), ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'])
  assert.equal(matrixMax([[0, 3], [8, 1]]), 8)
  assert.equal(matrixMax(undefined), 1)
  assert.deepEqual([0, 1, 2, 4, 6, 8].map(value => heatLevel(value, 8)), [0, 1, 1, 2, 3, 4])
})

test('chart scale: nice ticks from zero, negatives kept, all-zero safe', () => {
  assert.deepEqual(chartScale([0, 0]), { min: 0, max: 1, ticks: [0] })
  const scale = chartScale([35000, 70000, 17500])
  assert.deepEqual(scale.ticks, [0, 20000, 40000, 60000, 80000])
  const negative = chartScale([-35000, 52500])
  assert.ok(negative.min <= -35000 && negative.ticks.includes(0))
  assert.equal(labelEvery(7, 8), 1)
  assert.equal(labelEvery(24, 12), 2)
  assert.equal(compactMoney(0), '0')
  assert.equal(compactMoney(500000), '500 N')
  assert.equal(compactMoney(1200000), '1,2 Tr')
})

test('export: file name from Content-Disposition (RFC 5987 wins, no path), else the server pattern', () => {
  assert.equal(fileNameFromDisposition('attachment; filename="freshvend-sales_2026-11-07_2026-11-13.csv"'), 'freshvend-sales_2026-11-07_2026-11-13.csv')
  assert.equal(fileNameFromDisposition("attachment; filename=\"a.pdf\"; filename*=UTF-8''b%C3%A1o-c%C3%A1o.pdf"), 'báo-cáo.pdf')
  assert.equal(fileNameFromDisposition('attachment; filename=plain.csv'), 'plain.csv')
  assert.equal(fileNameFromDisposition('attachment; filename="../../etc/passwd"'), 'passwd')
  assert.equal(fileNameFromDisposition('attachment'), undefined)
  assert.equal(fileNameFromDisposition(null), undefined)
  assert.equal(exportFileName({ from: '2026-11-07', to: TODAY }, 'CSV'), 'freshvend-sales_2026-11-07_2026-11-13.csv')
  assert.equal(exportFileName({ from: '2026-11-07', to: TODAY }, 'PDF', 'x.pdf'), 'x.pdf')
  assert.equal(reportRejected(new ApiError(400, 'Unknown machineId: x')), true)
  assert.equal(reportRejected(new ApiError(403, 'no')), false)
})

// ---- the mock as the backend, on a hand-made store

const day = (date, time = '03:00:00') => `${addDays(date, 0)}T${time}Z` // 10:00 Vietnam time by default
const line = productId => ({ productId, sku: productId === P1 ? 'FRUIT-1' : 'FRUIT-2', productName: productId === P1 ? 'Táo' : 'Dưa hấu', quantity: 1, unitPrice: 35000, totalPrice: 35000 })
let serial = 0
function order(fields) {
  serial += 1
  return { id: `50000000-0000-0000-0000-${String(serial).padStart(12, '0')}`, machineId: M1, status: 'COMPLETED', subtotal: 35000, totalAmount: 35000, discountAmount: 0, items: [line(P1)], ...fields }
}
const refund = (orderId, amount, reason, refundedAt) => ({ id: `95${orderId.slice(2)}`, orderId, paymentId: 'x', amount, reason, transferReference: 'FT1', note: null, refundedAt, refundedById: 'a', refundedByName: null })
const handMade = (orders, refunds = [], payments = []) => ({
  products: [{ id: P1, sku: 'FRUIT-1', name: 'Táo', status: 'ACTIVE' }, { id: P2, sku: 'FRUIT-2', name: 'Dưa hấu', status: 'INACTIVE' }],
  machines: [{ id: M1, code: 'M-01', name: 'Máy 1' }, { id: M2, code: 'M-02', name: 'Máy 2' }],
  orders, refunds, payments, customerReports: [], workOrders: [],
})
const NOW = Date.parse('2026-11-13T06:00:00Z')
const scope = (store, params) => readScope(store, new URLSearchParams(params))

test('mock definitions: sale at completed_at (not paid_at); delivered refunds apart; DISPENSE_FAILED refund never revenue', () => {
  const paidYesterdayDoneToday = order({ paidAt: day('2026-11-12', '16:59:00'), completedAt: day(TODAY, '00:00:30') })
  const discounted = order({ subtotal: 35000, totalAmount: 17500, discountAmount: 17500, paidAt: day(TODAY), completedAt: day(TODAY) })
  const quality = order({ status: 'REFUNDED', paidAt: day('2026-11-10'), completedAt: day('2026-11-10'), items: [line(P2)] })
  const failed = order({ status: 'REFUNDED', paidAt: day(TODAY), completedAt: undefined, machineId: M2 })
  const stuck = order({ status: 'DISPENSE_FAILED', paidAt: day(TODAY), completedAt: undefined })
  const store = handMade([paidYesterdayDoneToday, discounted, quality, failed, stuck], [
    refund(quality.id, 35000, 'PRODUCT_QUALITY', day(TODAY)), // sold 3 days ago, refunded today
    refund(failed.id, 35000, 'DISPENSE_FAILED', day(TODAY)),
  ], [
    { id: 'p1', orderId: discounted.id, status: 'SUCCESS', amount: 17500, paidAt: day(TODAY) },
    { id: 'p2', orderId: failed.id, status: 'REFUNDED', amount: 35000, paidAt: day(TODAY) },
    { id: 'p3', orderId: paidYesterdayDoneToday.id, status: 'SUCCESS', amount: 35000, paidAt: day('2026-11-12', '16:59:00') },
  ])
  const today = salesSummary(store, scope(store, { from: TODAY, to: TODAY }), NOW)
  assert.equal(today.ordersSold, 2, 'the order paid yesterday and delivered after midnight is a sale of today; failed ones are not sales')
  assert.equal(today.grossSales, 70000)
  assert.equal(today.discounts, 17500)
  assert.equal(today.netSales, 52500)
  assert.equal(today.deliveredRefunds, 35000, 'the quality refund counts on the day it was refunded')
  assert.equal(today.netRevenue, 17500)
  assert.equal(today.averageOrderValue, 26250)
  assert.equal(today.moneyCollected, 52500, 'payments of today by paid_at (the one paid yesterday is not)')
  assert.equal(today.moneyRefunded.total, 70000)
  assert.equal(today.moneyRefunded.byReason.DISPENSE_FAILED, 35000)
  assert.deepEqual(Object.keys(today.moneyRefunded.byReason), ['DISPENSE_FAILED', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'PRODUCT_QUALITY', 'OTHER'])
  assert.equal(today.failedDispenses, 2)
  assert.deepEqual(today.filters, { from: TODAY, to: TODAY, machineIds: [], productIds: [], zone: 'Asia/Ho_Chi_Minh' })
  // The day of the sale keeps the sale; the refund is not there.
  const saleDay = salesSummary(store, scope(store, { from: '2026-11-10', to: '2026-11-10' }), NOW)
  assert.deepEqual([saleDay.ordersSold, saleDay.netSales, saleDay.deliveredRefunds], [1, 35000, 0])
  // Only a refund in the period: negative net revenue.
  const product2 = salesSummary(store, scope(store, { from: TODAY, to: TODAY, productId: P2 }), NOW)
  assert.deepEqual([product2.ordersSold, product2.netRevenue], [0, -35000])
  // Machine filter.
  assert.equal(salesSummary(store, scope(store, { from: TODAY, to: TODAY, machineId: M2 }), NOW).failedDispenses, 1)
  assert.equal(delivered({ status: 'REFUNDED', completedAt: day(TODAY) }), true)
  assert.equal(delivered({ status: 'REFUNDED', completedAt: undefined }), false)
})

test('mock: time series, products, machines and peak hours add up to the summary', () => {
  const orders = [
    order({ completedAt: day('2026-11-02') }), // Monday
    order({ completedAt: day('2026-11-08', '16:30:00') }), // Sunday 23:30 Vietnam time
    order({ completedAt: day('2026-11-08', '17:30:00'), items: [{ ...line(P2), quantity: 2, totalPrice: 50000 }], subtotal: 50000, totalAmount: 50000 }), // Monday 00:30
    order({ completedAt: day('2026-12-01'), machineId: M2 }),
  ]
  const store = handMade(orders, [refund(orders[0].id, 35000, 'OTHER', day('2026-11-20'))])
  const range = scope(store, { from: '2026-11-01', to: '2026-12-02' })
  const summary = salesSummary(store, range, NOW)
  const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0)
  for (const granularity of ['DAY', 'WEEK', 'MONTH']) {
    const buckets = salesSeries(store, range, granularity, NOW).buckets
    for (const key of ['ordersSold', 'grossSales', 'discounts', 'netSales', 'deliveredRefunds', 'netRevenue']) assert.equal(sum(buckets, key), summary[key], `${granularity} ${key}`)
    assert.equal(buckets[0].start, '2026-11-01')
    assert.equal(buckets.at(-1).end, '2026-12-02')
  }
  assert.equal(salesSeries(store, range, 'DAY', NOW).buckets.length, 32, 'zero-filled, one bucket per day')
  const weeks = salesSeries(store, range, 'WEEK', NOW).buckets
  assert.deepEqual(weeks.slice(0, 3).map(bucket => [bucket.start, bucket.end]), [['2026-11-01', '2026-11-01'], ['2026-11-02', '2026-11-08'], ['2026-11-09', '2026-11-15']], 'ISO weeks start on Monday, first one clipped')
  assert.equal(weeks[1].ordersSold, 2, 'Sunday 23:30 Vietnam time is still that week')
  assert.equal(weeks[2].ordersSold, 1, 'Monday 00:30 Vietnam time starts the next one')
  assert.deepEqual(salesSeries(store, range, 'MONTH', NOW).buckets.map(bucket => [bucket.start, bucket.end, bucket.ordersSold]), [['2026-11-01', '2026-11-30', 3], ['2026-12-01', '2026-12-02', 1]])

  const products = productSales(store, range, 'NET_SALES', 100, NOW).products
  for (const key of ['grossSales', 'discounts', 'netSales', 'deliveredRefunds']) assert.equal(sum(products, key), summary[key], key)
  assert.equal(products[0].productId, P1)
  assert.equal(Math.round(sum(products, 'sharePercent')), 100)
  const byQuantity = productSales(store, range, 'QUANTITY', 1, NOW)
  assert.equal(byQuantity.products.length, 1)
  assert.deepEqual([byQuantity.products[0].productId, byQuantity.products[0].quantity, byQuantity.products[0].status], [P1, 3, 'ACTIVE'], '3 single bowls beat 1 double, ties by name')
  const machines = machineSales(store, range, NOW).machines
  assert.deepEqual(machines.map(row => row.code), ['M-01', 'M-02'], 'every machine, zeros included')
  for (const key of ['ordersSold', 'netSales', 'deliveredRefunds', 'netRevenue']) assert.equal(sum(machines, key), summary[key], key)
  assert.deepEqual(machineSales(store, scope(store, { from: '2026-11-01', to: '2026-11-02', machineId: M2 }), NOW).machines.map(row => [row.code, row.ordersSold]), [['M-02', 0]])

  const peak = peakHours(store, range, NOW)
  assert.equal(peak.hours.length, 24)
  assert.equal(sum(peak.hours, 'ordersSold'), summary.ordersSold)
  assert.equal(peak.hours[23].ordersSold, 1)
  assert.equal(peak.hours[0].ordersSold, 1)
  assert.equal(peak.weekdayHours.length, 7)
  assert.equal(peak.weekdayHours[6][23], 1, 'Sunday is the last row')
  assert.equal(peak.weekdayHours[0][0], 1, 'Monday is the first row')
  assert.equal(peak.weekdayHours.flat().reduce((a, b) => a + b, 0), summary.ordersSold)
})

test('mock 400: missing / reversed / over 366 days, malformed or more than 20 ids, unknown id named', () => {
  const store = handMade([])
  const fails = (params, check) => assert.throws(() => scope(store, params), error => error.status === 400 && check(error))
  fails({ to: TODAY }, error => !!error.fieldErrors.from)
  fails({ from: TODAY, to: '2026-11-12' }, error => !!error.fieldErrors.to)
  fails({ from: '2025-11-12', to: TODAY }, error => /366/.test(error.fieldErrors.to))
  fails({ from: TODAY, to: TODAY, machineId: 'abc' }, error => !!error.fieldErrors.machineId)
  const many = new URLSearchParams({ from: TODAY, to: TODAY })
  for (let index = 0; index < 21; index += 1) many.append('productId', `40000000-0000-0000-0000-${String(index).padStart(12, '0')}`)
  assert.throws(() => readScope(store, many), error => error.status === 400 && /20/.test(error.fieldErrors.productId))
  const unknown = '20000000-0000-0000-0000-000000009999'
  fails({ from: TODAY, to: TODAY, machineId: unknown }, error => error.message.includes(unknown))
  assert.deepEqual(scope(store, { from: '2025-11-13', to: TODAY }).from, '2025-11-13', '366 days is accepted')
  const repeated = new URLSearchParams({ from: TODAY, to: TODAY })
  repeated.append('machineId', M1); repeated.append('machineId', M2); repeated.append('machineId', M1)
  assert.deepEqual(readScope(store, repeated).machineIds, [M1, M2])
})

// ---- through the API client (the screen's loaders)

function setup() {
  const state = { token: null, clock: Date.now(), search: '', calls: [] }
  const mock = createMockFetcher(parseSelection('all'), { now: () => state.clock, getSearch: () => state.search })
  const fetcher = (input, init) => { state.calls.push(String(input)); return mock(input, init) }
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}
async function signIn(state, account) {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
  state.calls.length = 0
}
const reject = promise => promise.then(() => assert.fail('expected an error'), error => error)

test('mock: the screen loads five endpoints with the same contract parameters; the seed keeps discount and refunds apart', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const today = vietnamDate(state.clock)
  const filters = { ...DEFAULTS, ...presetRange('7d', today), granularity: 'WEEK', productSort: 'QUANTITY' }
  const report = await loadSalesReport(filters)
  assert.equal(report.key, revenueKey(filters))
  const urls = state.calls.map(call => new URL(call, 'https://x.invalid'))
  assert.deepEqual(urls.map(url => url.pathname).sort(), ['summary', 'timeseries', 'peak-hours', 'products', 'machines'].map(name => `/api/v1/reports/sales/${name}`).sort())
  for (const url of urls) {
    assert.equal(url.searchParams.get('from'), filters.from)
    assert.equal(url.searchParams.get('to'), filters.to)
    const extra = [...url.searchParams.keys()].filter(name => !['from', 'to'].includes(name))
    assert.deepEqual(extra, { '/api/v1/reports/sales/timeseries': ['granularity'], '/api/v1/reports/sales/products': ['sortBy', 'limit'] }[url.pathname] ?? [], url.pathname)
  }
  assert.equal(urls.find(url => url.pathname.endsWith('/products')).searchParams.get('limit'), String(PRODUCT_LIMIT))
  const { summary } = report
  assert.ok(summary.ordersSold > 0)
  assert.equal(summary.discounts, 17500, 'the near-expiry order of the seed (FE 7.5)')
  assert.equal(summary.netSales, summary.grossSales - summary.discounts)
  assert.equal(summary.netRevenue, summary.netSales - summary.deliveredRefunds)
  assert.ok(summary.moneyRefunded.total > 0, 'refunds of the seed (failed dispenses) are in the cash view only')
  assert.equal(summary.deliveredRefunds, 0)
  assert.ok(summary.pendingRefunds.count > 0)
  assert.equal(report.series.granularity, 'WEEK')
  assert.equal(report.products.sortBy, 'QUANTITY')
  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0)
  assert.equal(sum(report.series.buckets, 'netRevenue'), summary.netRevenue)
  assert.equal(sum(report.machines.machines, 'ordersSold'), summary.ordersSold)
  // Machine filter as a repeated parameter.
  state.calls.length = 0
  const one = await loadSalesReport({ ...filters, machineId: M2 })
  assert.deepEqual(new URL(state.calls[0], 'https://x.invalid').searchParams.getAll('machineId'), [M2])
  assert.deepEqual(one.machines.machines.map(row => row.machineId), [M2])
  assert.deepEqual(one.summary.filters.machineIds, [M2])
})

test('mock: a quality refund recorded today for an order delivered days ago lowers today, not the day of the sale', async () => {
  const state = setup()
  state.clock += 3 * 86_400_000 // the seed's orders are now at least three days old
  await signIn(state, 'admin')
  const today = vietnamDate(state.clock)
  const completed = (await ordersApi.list({ status: 'COMPLETED', page: 0, size: 50 })).content.find(row => vietnamDate(Date.parse(row.createdAt)) !== today)
  const detail = await ordersApi.get(completed.id)
  const saleDay = vietnamDate(Date.parse(detail.completedAt))
  const before = { today: await salesReportsApi.summary({ from: today, to: today }), sale: await salesReportsApi.summary({ from: saleDay, to: saleDay }) }
  const paying = detail.payments.filter(payment => payment.status === 'SUCCESS').sort((a, b) => a.paidAt.localeCompare(b.paidAt))[0]
  const refunded = await refundsApi.record(paying.id, { reason: 'PRODUCT_QUALITY', transferReference: 'FT26317QUAL01' })
  const after = { today: await salesReportsApi.summary({ from: today, to: today }), sale: await salesReportsApi.summary({ from: saleDay, to: saleDay }) }
  assert.equal(after.today.deliveredRefunds - before.today.deliveredRefunds, refunded.amount)
  assert.equal(after.today.netRevenue - before.today.netRevenue, -refunded.amount)
  assert.equal(after.today.netSales, before.today.netSales, 'refunds never change the sales')
  assert.equal(after.today.moneyRefunded.byReason.PRODUCT_QUALITY - before.today.moneyRefunded.byReason.PRODUCT_QUALITY, refunded.amount)
  assert.deepEqual(after.sale.ordersSold, before.sale.ordersSold, 'the order stays a sale of its day (REFUNDED after delivery)')
  assert.equal(after.sale.netRevenue, before.sale.netRevenue)
})

test('mock: export CSV / PDF is the server file (attachment name, BOM, sections, same numbers); REPORT_EXPORT only', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const today = vietnamDate(state.clock)
  const filters = { ...DEFAULTS, ...presetRange('7d', today) }
  const summary = await salesReportsApi.summary(salesQuery(filters))
  const csv = await salesReportsApi.export(exportQuery(filters, 'CSV'))
  assert.equal(csv.fileName, `freshvend-sales_${filters.from}_${filters.to}.csv`)
  assert.match(csv.contentType, /^text\/csv/)
  const bytes = new Uint8Array(await csv.blob.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel')
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  for (const section of ['[Filters]', '[Summary]', '[Daily]', '[Products]', '[Peak hours]', '[Machines]']) assert.ok(text.includes(`${section}\r\n`), section)
  const rows = text.replace(/^﻿/, '').split('\r\n').map(row => row.split(','))
  const value = key => Number(rows.find(row => row[0] === key)[1])
  for (const key of ['ordersSold', 'grossSales', 'discounts', 'netSales', 'deliveredRefunds', 'netRevenue']) assert.equal(value(key), summary[key], key)
  const pdf = await salesReportsApi.export(exportQuery(filters, 'PDF'))
  assert.equal(pdf.fileName, `freshvend-sales_${filters.from}_${filters.to}.pdf`)
  assert.equal(pdf.contentType, 'application/pdf')
  assert.equal(new TextDecoder().decode((await pdf.blob.arrayBuffer()).slice(0, 5)), '%PDF-')
  const bad = await reject(salesReportsApi.export({ format: 'CSV', from: filters.to, to: filters.from }))
  assert.equal(bad.status, 400)
  assert.ok(bad.fieldErrors.to)
  await signIn(state, 'staff')
  assert.equal((await reject(salesReportsApi.export(exportQuery(filters, 'CSV')))).status, 403)
})

test('mock: STAFF gets 403 on every report; 400 for a bad range or an unknown product (named in the message)', async () => {
  const state = setup()
  await signIn(state, 'staff')
  const today = vietnamDate(state.clock)
  const forbidden = await reject(loadSalesReport({ ...DEFAULTS, ...presetRange('7d', today) }))
  assert.ok(forbidden instanceof ApiError && forbidden.status === 403)
  await signIn(state, 'admin')
  const reversed = await reject(salesReportsApi.summary({ from: today, to: '2020-01-01' }))
  assert.equal(reversed.status, 400)
  assert.ok(reversed.fieldErrors.to)
  const tooLong = await reject(salesReportsApi.timeseries({ from: '2025-01-01', to: '2026-12-31' }))
  assert.ok(tooLong.fieldErrors.to)
  const unknown = '40000000-0000-0000-0000-000000009999'
  const missing = await reject(loadSalesReport({ ...DEFAULTS, from: today, to: today, productId: unknown }))
  assert.equal(missing.status, 400)
  assert.ok(missing.message.includes(unknown))
  assert.equal(reportRejected(missing), true)
  const granularity = await reject(salesReportsApi.timeseries({ from: today, to: today, granularity: 'HOUR' }))
  assert.ok(granularity.fieldErrors.granularity)
  const limit = await reject(salesReportsApi.products({ from: today, to: today, limit: 101 }))
  assert.ok(limit.fieldErrors.limit)
  // A range with no sale is zeros, not an error.
  const past = await loadSalesReport({ ...DEFAULTS, from: '2020-01-01', to: '2020-01-07' })
  assert.equal(past.summary.ordersSold, 0)
  assert.equal(past.series.buckets.length, 7)
  assert.deepEqual(past.products.products, [])
})

test('mock: the overview numbers equal the report the overview links to (today from the dashboard, 7 days from the summary)', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const dashboard = await dashboardApi.overview()
  const today = dashboard.today.date
  assert.equal(today, vietnamDate(state.clock))
  const todayReport = await loadSalesReport(readRevenueFilters(new URL(revenueHref({ from: today, to: today }), 'https://x.invalid').searchParams, today).filters)
  assert.equal(dashboard.today.netSales, todayReport.summary.netSales)
  assert.equal(dashboard.today.ordersSold, todayReport.summary.ordersSold)
  assert.equal(dashboard.today.yesterdayNetSales, (await salesReportsApi.summary({ from: addDays(today, -1), to: addDays(today, -1) })).netSales)
  assert.deepEqual([dashboard.refunds.pendingCount, dashboard.refunds.pendingAmount], [todayReport.summary.pendingRefunds.count, todayReport.summary.pendingRefunds.amount])
  const week = await loadWeekSummary(today)
  const weekReport = await loadSalesReport(readRevenueFilters(new URL(revenueHref(overviewWeek(today)), 'https://x.invalid').searchParams, today).filters)
  for (const key of ['ordersSold', 'netSales', 'discounts', 'deliveredRefunds', 'netRevenue']) assert.equal(week[key], weekReport.summary[key], key)
})

test('export over HTTP: Authorization sent, 401 resets the session, a 400 JSON body gives its message, a missing name falls back', async () => {
  const seen = []
  let unauthorized = null
  const answers = [
    new Response('a,b\r\n', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="freshvend-sales_2026-11-07_2026-11-13.csv"' } }),
    new Response('%PDF-1.4', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
    jsonResponse(400, { status: 400, message: 'Unknown productId: 40000000-0000-0000-0000-000000009999' }),
    jsonResponse(401, { status: 401, message: 'Authentication required' }),
  ]
  configureClient({ baseUrl: '', fetcher: async (input, init) => { seen.push({ url: String(input), init }); return answers.shift() }, getToken: () => 'token-1', onUnauthorized: token => { unauthorized = token } })
  const query = exportQuery({ ...DEFAULTS, productId: P1 }, 'CSV')
  const csv = await salesReportsApi.export(query)
  assert.equal(csv.fileName, 'freshvend-sales_2026-11-07_2026-11-13.csv')
  assert.equal(seen[0].init.headers.Authorization, 'Bearer token-1')
  assert.match(seen[0].init.headers.Accept, /text\/csv/)
  assert.equal(seen[0].url, `/api/v1/reports/sales/export?format=CSV&from=2026-11-07&to=${TODAY}&productId=${P1}`)
  const pdf = await salesReportsApi.export(exportQuery(DEFAULTS, 'PDF'))
  assert.equal(pdf.fileName, undefined, 'a cross-origin response may hide Content-Disposition')
  assert.equal(exportFileName(DEFAULTS, 'PDF', pdf.fileName), 'freshvend-sales_2026-11-07_2026-11-13.pdf')
  const bad = await reject(salesReportsApi.export(query))
  assert.equal(bad.status, 400)
  assert.match(bad.message, /^Unknown productId/)
  const expired = await reject(salesReportsApi.export(query))
  assert.equal(expired.status, 401)
  assert.equal(unauthorized, 'token-1')
})

test('mock groups: VITE_API_MOCK=reports mocks the sales reports only; the dashboard has its own group', async () => {
  const real = []
  const mock = createMockFetcher(parseSelection('reports,auth'), { realFetch: async input => { real.push(String(input)); return jsonResponse(200, { data: { ok: true } }) } })
  let token = null
  configureClient({ baseUrl: '', fetcher: mock, getToken: () => token, onUnauthorized: () => {} })
  token = (await authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin })).accessToken
  const today = vietnamDate(Date.now())
  assert.equal((await salesReportsApi.summary({ from: today, to: today })).filters.from, today)
  assert.deepEqual(await dashboardApi.overview(), { ok: true })
  assert.deepEqual(real.map(url => new URL(url, 'https://x.invalid').pathname), ['/api/v1/dashboard/overview'])
})
