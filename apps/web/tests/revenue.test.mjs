// FE 9.1 Báo cáo doanh thu (R1) and FE 9.2 Tổng quan bước 2 (O1): URL filters, range rules, figures, chart scale, the
// CSV file (same numbers as the screen) and the mock of the draft GET /reports/revenue (discount and refunds kept apart,
// invariants, permissions, the overview's numbers equal the report's).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { mockRefundedAt } from '../src/api/mock/revenue.ts'
import { can } from '../src/admin/permissions.ts'
import { matchRoute, navFor } from '../src/admin/routes.ts'
import { vietnamDate } from '../src/admin/maintenance-schedules.ts'
import {
  FIGURES, MAX_RANGE_DAYS, REVENUE_PATH, ZERO_FIGURES, bucketLabel, bucketShortLabel, chartScale, compactMoney, consistencyIssues, csvCell, csvFileName,
  figureText, figuresOfDay, hasActivity, labelEvery, loadRevenueReport, overviewRevenueFilters, parseCsv, productNotFound, presetOf, presetRange, readRevenueFilters,
  revenueCsv, revenueHref, revenueMissing, revenueQuery, scopeText, validateRange,
} from '../src/admin/revenue.ts'

const TODAY = '2026-11-13'
const P1 = '40000000-0000-0000-0000-000000000001'

// ---- filters and range

test('presets end today, in Vietnam calendar days', () => {
  assert.deepEqual(presetRange('today', TODAY), { from: TODAY, to: TODAY })
  assert.deepEqual(presetRange('7d', TODAY), { from: '2026-11-07', to: TODAY })
  assert.deepEqual(presetRange('30d', TODAY), { from: '2026-10-15', to: TODAY })
  assert.deepEqual(presetRange('month', TODAY), { from: '2026-11-01', to: TODAY })
  assert.equal(presetOf({ from: '2026-11-07', to: TODAY }, TODAY), '7d')
  assert.equal(presetOf({ from: '2026-11-08', to: TODAY }, TODAY), undefined)
})

test('URL filters: defaults to the last 7 days, invalid values are ignored and named', () => {
  const empty = readRevenueFilters(new URLSearchParams(''), TODAY)
  assert.deepEqual(empty, { filters: { from: '2026-11-07', to: TODAY, productId: '', groupBy: 'DAY' }, ignored: [] })
  const full = readRevenueFilters(new URLSearchParams(`from=2026-11-01&to=2026-11-10&productId=${P1}&group=hour`), TODAY)
  assert.deepEqual(full.filters, { from: '2026-11-01', to: '2026-11-10', productId: P1, groupBy: 'HOUR_OF_DAY' })
  const bad = readRevenueFilters(new URLSearchParams('from=2026-02-30&to=x&productId=../1&group=week'), TODAY)
  assert.deepEqual(bad.filters, { from: '2026-11-07', to: TODAY, productId: '', groupBy: 'DAY' })
  assert.deepEqual(bad.ignored, ['from', 'to', 'productId', 'group'])
})

test('range rules are checked before any request', () => {
  assert.deepEqual(validateRange('2026-11-01', '2026-11-13'), {})
  assert.deepEqual(validateRange(TODAY, TODAY), {})
  assert.match(validateRange('2026-11-13', '2026-11-12').to, /bằng hoặc sau/)
  assert.deepEqual(validateRange('2026-08-14', '2026-11-13'), {}, '92 days counting both ends')
  assert.match(validateRange('2026-08-13', '2026-11-13').from, new RegExp(`tối đa ${MAX_RANGE_DAYS} ngày`))
  assert.ok(validateRange('', TODAY).from)
})

test('query and links send only the contract parameters, dates always written', () => {
  assert.deepEqual(revenueQuery({ from: '2026-11-07', to: TODAY, productId: '', groupBy: 'DAY' }), { fromDate: '2026-11-07', toDate: TODAY, productId: undefined, groupBy: 'DAY' })
  assert.equal(revenueHref({ from: TODAY, to: TODAY }), `${REVENUE_PATH}?from=${TODAY}&to=${TODAY}`)
  assert.equal(revenueHref({ from: '2026-11-07', to: TODAY, productId: P1, groupBy: 'HOUR_OF_DAY' }), `${REVENUE_PATH}?from=2026-11-07&to=${TODAY}&productId=${P1}&group=hour`)
  assert.deepEqual(overviewRevenueFilters(TODAY), { from: '2026-11-07', to: TODAY, productId: '', groupBy: 'DAY' })
})

test('route R1: REPORT_READ (draft), ADMIN only, in the Giao dịch group', () => {
  const route = matchRoute(REVENUE_PATH)
  assert.equal(route.page, 'revenue-report')
  assert.equal(route.permission, 'REPORT_READ')
  assert.deepEqual(route.roles, ['ADMIN'])
  assert.equal(can(['ADMIN'], 'REPORT_READ'), true)
  assert.equal(can(['STAFF'], 'REPORT_READ'), false)
  const item = navFor(['ADMIN']).find(entry => entry.to === REVENUE_PATH)
  assert.equal(item.group, 'Giao dịch')
  assert.equal(item.label, 'Báo cáo doanh thu')
  assert.equal(navFor(['STAFF']).some(entry => entry.to === REVENUE_PATH), false)
})

// ---- display

test('figures: money as VND, counts plain, buckets labelled in Vietnam time', () => {
  assert.match(figureText({ money: true }, 35000), /^35\.000\s₫$/)
  assert.equal(figureText({ money: false }, 1234), '1.234')
  assert.equal(bucketLabel({ date: TODAY, hour: null }), '13/11/2026')
  assert.equal(bucketLabel({ date: null, hour: 9 }), '09:00–09:59')
  assert.equal(bucketShortLabel({ date: TODAY, hour: null }), '13/11')
  assert.equal(bucketShortLabel({ date: null, hour: 21 }), '21h')
  assert.deepEqual(FIGURES.map(figure => figure.label), ['Số đơn', 'Số hộp', 'Giá gốc', 'Tiền giảm', 'Khách trả', 'Số đơn hoàn', 'Tiền hoàn', 'Thực thu'])
  assert.equal(scopeText({ fromDate: TODAY, toDate: TODAY, groupBy: 'DAY' }, undefined), 'Ngày 13/11/2026 · Tất cả sản phẩm · Theo ngày')
  assert.equal(hasActivity(ZERO_FIGURES), false)
})

test('chart scale: nice ticks from zero, negatives kept, all-zero safe', () => {
  assert.deepEqual(chartScale([0, 0]), { min: 0, max: 1, ticks: [0] })
  const scale = chartScale([35000, 70000, 17500])
  assert.equal(scale.min, 0)
  assert.ok(scale.max >= 70000)
  assert.deepEqual(scale.ticks, [0, 20000, 40000, 60000, 80000])
  const negative = chartScale([-35000, 52500])
  assert.ok(negative.min <= -35000 && negative.ticks.includes(0))
  assert.equal(labelEvery(7, 8), 1)
  assert.equal(labelEvery(30, 8), 4)
  assert.equal(labelEvery(24, 8), 3)
  assert.equal(compactMoney(0), '0')
  assert.equal(compactMoney(500000), '500 N')
  assert.equal(compactMoney(1200000), '1,2 Tr')
})

const sample = () => ({
  fromDate: '2026-11-12', toDate: TODAY, productId: null, groupBy: 'DAY', timeZone: 'Asia/Ho_Chi_Minh', generatedAt: '2026-11-13T06:05:00Z',
  totals: { orderCount: 3, quantity: 4, grossAmount: 140000, discountAmount: 17500, paidAmount: 122500, refundCount: 1, refundAmount: 35000, netAmount: 87500 },
  buckets: [
    { date: '2026-11-12', hour: null, orderCount: 1, quantity: 2, grossAmount: 70000, discountAmount: 0, paidAmount: 70000, refundCount: 0, refundAmount: 0, netAmount: 70000 },
    { date: TODAY, hour: null, orderCount: 2, quantity: 2, grossAmount: 70000, discountAmount: 17500, paidAmount: 52500, refundCount: 1, refundAmount: 35000, netAmount: 17500 },
  ],
  byProduct: [
    { productId: P1, sku: '=HYPERLINK("x")', productName: 'Hộp "thập cẩm", lớn', orderCount: 2, quantity: 3, grossAmount: 105000, discountAmount: 17500, paidAmount: 87500, refundCount: 1, refundAmount: 35000, netAmount: 52500 },
    { productId: '40000000-0000-0000-0000-000000000002', sku: 'FRUIT-2', productName: 'Dưa hấu', orderCount: 1, quantity: 1, grossAmount: 35000, discountAmount: 0, paidAmount: 35000, refundCount: 0, refundAmount: 0, netAmount: 35000 },
  ],
})

test('consistency: a coherent report has no issue, a broken one is reported in words', () => {
  assert.deepEqual(consistencyIssues(sample()), [])
  const broken = sample()
  broken.totals.netAmount = 1
  broken.buckets[0].paidAmount = 1
  const issues = consistencyIssues(broken)
  assert.ok(issues.some(issue => issue.startsWith('Tổng: khách trả trừ tiền hoàn')))
  assert.ok(issues.some(issue => issue.startsWith('12/11/2026: giá gốc')))
  assert.ok(issues.some(issue => issue.includes('không cộng ra tổng')))
  assert.deepEqual(figuresOfDay(sample(), TODAY).netAmount, 17500)
  assert.deepEqual(figuresOfDay(sample(), '2026-01-01'), ZERO_FIGURES)
})

test('CSV cells: numbers plain, formulas neutralised, quotes and commas escaped', () => {
  assert.equal(csvCell(35000), '35000')
  assert.equal(csvCell(-17500), '-17500')
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)")
  assert.equal(csvCell('-1'), "'-1")
  assert.equal(csvCell('@x'), "'@x")
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell(null), '')
})

test('CSV holds exactly the figures of the screen (totals, every row, every product)', () => {
  const report = sample()
  const text = revenueCsv(report, undefined)
  assert.ok(text.startsWith('﻿'), 'BOM for Excel')
  assert.ok(text.includes('\r\n'))
  const rows = parseCsv(text)
  const heads = FIGURES.map(({ label, money }) => money ? `${label} (VND)` : label)
  assert.deepEqual(rows[1], ['Từ ngày', '12/11/2026'])
  assert.deepEqual(rows[3], ['Sản phẩm', 'Tất cả sản phẩm'])
  const totalRow = rows.find(row => row[0] === 'Tổng' && row.length > 1)
  assert.deepEqual(totalRow.slice(1).map(Number), FIGURES.map(({ key }) => report.totals[key]))
  const dayHead = rows.findIndex(row => row[0] === 'Ngày')
  assert.deepEqual(rows[dayHead].slice(1), heads)
  for (const [index, bucket] of report.buckets.entries()) {
    assert.equal(rows[dayHead + 1 + index][0], bucketLabel(bucket))
    assert.deepEqual(rows[dayHead + 1 + index].slice(1).map(Number), FIGURES.map(({ key }) => bucket[key]))
  }
  const productHead = rows.findIndex(row => row[0] === 'SKU')
  assert.deepEqual(rows[productHead + 1].slice(0, 2), ["'=HYPERLINK(\"x\")", 'Hộp "thập cẩm", lớn'])
  assert.deepEqual(rows[productHead + 1].slice(2).map(Number), FIGURES.map(({ key }) => report.byProduct[0][key]))
  assert.equal(csvFileName(report), 'doanh-thu_2026-11-12_2026-11-13.csv')
  assert.equal(csvFileName(report, 'FRUIT MIX/01'), 'doanh-thu_2026-11-12_2026-11-13_FRUIT-MIX-01.csv')
})

// ---- mock API (draft revenue-reports.yaml)

function setup() {
  const state = { token: null, clock: Date.now(), search: '' }
  const mock = createMockFetcher(parseSelection('all'), { now: () => state.clock, getSearch: () => state.search })
  configureClient({ baseUrl: '', fetcher: mock, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}
async function signIn(state, account) {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
const reject = promise => promise.then(() => assert.fail('expected an error'), error => error)

test('mock: 7-day report is consistent and keeps discount and refunds apart', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const today = vietnamDate(state.clock)
  const report = await loadRevenueReport(overviewRevenueFilters(today))
  assert.equal(report.buckets.length, 7)
  assert.equal(report.buckets.at(-1).date, today)
  assert.deepEqual(consistencyIssues(report), [])
  assert.ok(report.totals.orderCount > 0)
  assert.equal(report.totals.discountAmount, 17500, 'the near-expiry order of the seed (FE 7.5)')
  assert.ok(report.totals.refundCount > 0 && report.totals.refundAmount > 0, 'REFUNDED orders of the seed')
  assert.equal(report.totals.netAmount, report.totals.paidAmount - report.totals.refundAmount)
  assert.equal(report.totals.paidAmount, report.totals.grossAmount - report.totals.discountAmount)
})

test('mock: overview numbers equal the report the overview links to (same loader, same parameters)', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const today = vietnamDate(state.clock)
  const week = await loadRevenueReport(overviewRevenueFilters(today))
  const todayReport = await loadRevenueReport(readRevenueFilters(new URL(revenueHref({ from: today, to: today }), 'https://x.invalid').searchParams, today).filters)
  assert.deepEqual(figuresOfDay(week, today), todayReport.totals)
  const weekAgain = await loadRevenueReport(readRevenueFilters(new URL(revenueHref(overviewRevenueFilters(today)), 'https://x.invalid').searchParams, today).filters)
  assert.deepEqual(weekAgain.totals, week.totals)
})

test('mock: hour-of-day report adds up to the same totals; product filter keeps only that product', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const today = vietnamDate(state.clock)
  const filters = overviewRevenueFilters(today)
  const byDay = await loadRevenueReport(filters)
  const byHour = await loadRevenueReport({ ...filters, groupBy: 'HOUR_OF_DAY' })
  assert.equal(byHour.buckets.length, 24)
  assert.deepEqual(byHour.buckets.map(bucket => bucket.hour), Array.from({ length: 24 }, (_, hour) => hour))
  assert.deepEqual(byHour.totals, byDay.totals)
  assert.deepEqual(consistencyIssues(byHour), [])
  const top = byDay.byProduct[0]
  const one = await loadRevenueReport({ ...filters, productId: top.productId })
  assert.equal(one.productId, top.productId)
  assert.deepEqual(one.byProduct.map(row => row.productId), [top.productId])
  assert.equal(one.totals.netAmount, top.netAmount)
  assert.deepEqual(consistencyIssues(one), [])
})

test('mock: refunds count at refund time; a range with no sale is empty, not an error', async () => {
  const state = setup()
  await signIn(state, 'admin')
  assert.equal(mockRefundedAt({ status: 'REFUNDED', paidAt: '2026-11-13T00:00:00Z' }), Date.parse('2026-11-13T00:30:00Z'))
  assert.equal(mockRefundedAt({ status: 'COMPLETED', paidAt: '2026-11-13T00:00:00Z' }), null)
  const past = await loadRevenueReport({ from: '2020-01-01', to: '2020-01-07', productId: '', groupBy: 'DAY' })
  assert.equal(hasActivity(past.totals), false)
  assert.equal(past.buckets.length, 7)
  assert.deepEqual(past.byProduct, [])
})

test('mock: STAFF gets 403, bad ranges 400 with field errors, unknown product 404', async () => {
  const state = setup()
  await signIn(state, 'staff')
  const today = vietnamDate(state.clock)
  const forbidden = await reject(loadRevenueReport(overviewRevenueFilters(today)))
  assert.ok(forbidden instanceof ApiError && forbidden.status === 403)
  await signIn(state, 'admin')
  const reversed = await reject(loadRevenueReport({ from: today, to: '2020-01-01', productId: '', groupBy: 'DAY' }))
  assert.equal(reversed.status, 400)
  assert.ok(reversed.fieldErrors.toDate)
  const tooLong = await reject(loadRevenueReport({ from: '2026-01-01', to: '2026-12-31', productId: '', groupBy: 'DAY' }))
  assert.ok(tooLong.fieldErrors.fromDate)
  const unknown = await reject(loadRevenueReport({ from: today, to: today, productId: '40000000-0000-0000-0000-000000009999', groupBy: 'DAY' }))
  assert.equal(unknown.status, 404)
  assert.equal(revenueMissing(unknown, true), false, 'with a product filter a 404 is reported as an unknown product')
  assert.equal(productNotFound(unknown, true), true)
  assert.equal(revenueMissing(new ApiError(404, 'No static resource found.')), true)
  assert.equal(productNotFound(new ApiError(404, 'x'), false), false)
})
