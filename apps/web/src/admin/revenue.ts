// R1 Báo cáo doanh thu (FE 9.1) and the revenue block of O1 Tổng quan (FE 9.2). Pure rules, unit-tested: filters in
// the URL, the request, the figures shown, the chart scale and the CSV file. One source for every number: the screen,
// the CSV and the overview all read the same GET /reports/revenue response (draft api-contract/drafts/revenue-reports.yaml,
// waiting for BE 6.1) through loadRevenueReport, and display it with the same FIGURES list.
import { api, ApiError } from '../api/client.ts'
import type { components } from '../api/drafts/revenue-reports'
import { formatDate, formatMoney } from '../lib/format.ts'
import { uuidParam } from '../lib/table-query.ts'
import { addDays, daysBetween, isDateString } from './maintenance-schedules.ts'

type R = components['schemas']
export type RevenueReport = R['RevenueReportResponse']
export type RevenueFigures = R['RevenueFigures']
export type RevenueBucket = R['RevenueBucket']
export type ProductRevenue = R['ProductRevenue']
export type RevenueGroupBy = R['RevenueGroupBy']

export const REVENUE_PATH = '/admin/reports/revenue'
/** Longest range the draft accepts (counting both ends). */
export const MAX_RANGE_DAYS = 92

export const revenueApi = {
  report: (query: { fromDate: string; toDate: string; productId?: string; groupBy?: RevenueGroupBy }, signal?: AbortSignal) =>
    api.get<RevenueReport>('/reports/revenue', query, signal),
}

// ---- filters (URL: from, to, productId, group=day|hour)

export interface RevenueFilters { from: string; to: string; productId: string; groupBy: RevenueGroupBy }

export type RevenuePreset = 'today' | '7d' | '30d' | 'month'
export const PRESETS: { key: RevenuePreset; label: string }[] = [
  { key: 'today', label: 'Hôm nay' }, { key: '7d', label: '7 ngày qua' }, { key: '30d', label: '30 ngày qua' }, { key: 'month', label: 'Tháng này' },
]

/** Vietnam calendar range of a preset, ending today (`today` is a Vietnam date, YYYY-MM-DD). */
export function presetRange(preset: RevenuePreset, today: string): { from: string; to: string } {
  if (preset === 'today') return { from: today, to: today }
  if (preset === '30d') return { from: addDays(today, -29), to: today }
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today }
  return { from: addDays(today, -6), to: today }
}
/** The preset a range is, if any (to highlight its button). */
export function presetOf(range: { from: string; to: string }, today: string): RevenuePreset | undefined {
  return PRESETS.find(({ key }) => { const preset = presetRange(key, today); return preset.from === range.from && preset.to === range.to })?.key
}

/**
 * Filters from the URL. Missing dates default to the last 7 days; values that are not valid are dropped (and named in
 * `ignored`, so the screen can say why the URL was not followed). Order of from/to is NOT fixed here: validateRange says so.
 */
export function readRevenueFilters(params: URLSearchParams, today: string): { filters: RevenueFilters; ignored: string[] } {
  const ignored: string[] = []
  const fallback = presetRange('7d', today)
  const date = (name: 'from' | 'to') => {
    const raw = params.get(name)
    if (raw && !isDateString(raw)) ignored.push(name)
    return raw && isDateString(raw) ? raw : fallback[name]
  }
  const from = date('from'), to = date('to')
  const rawProduct = params.get('productId') ?? ''
  const productId = uuidParam(rawProduct)
  if (rawProduct && !productId) ignored.push('productId')
  const rawGroup = params.get('group')
  if (rawGroup && rawGroup !== 'day' && rawGroup !== 'hour') ignored.push('group')
  return { filters: { from, to, productId, groupBy: rawGroup === 'hour' ? 'HOUR_OF_DAY' : 'DAY' }, ignored }
}

export const FILTER_LABELS: Record<string, string> = { from: 'Từ ngày', to: 'Đến ngày', productId: 'Sản phẩm', group: 'Nhóm theo' }

/** Field errors of a range, checked before any request (the server checks the same rules). */
export function validateRange(from: string, to: string): Partial<Record<'from' | 'to', string>> {
  if (!isDateString(from)) return { from: 'Chọn ngày bắt đầu.' }
  if (!isDateString(to)) return { to: 'Chọn ngày kết thúc.' }
  if (to < from) return { to: 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.' }
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return { from: `Mỗi lần xem tối đa ${MAX_RANGE_DAYS} ngày. Thu hẹp khoảng ngày.` }
  return {}
}

export function revenueQuery(filters: RevenueFilters) {
  return { fromDate: filters.from, toDate: filters.to, productId: filters.productId || undefined, groupBy: filters.groupBy }
}
export function revenueKey(filters: RevenueFilters): string {
  return `${filters.from}|${filters.to}|${filters.productId}|${filters.groupBy}`
}
/** Link to the report with these filters (dates always written, so the link shows the same numbers tomorrow). */
export function revenueHref(filters: Partial<RevenueFilters> & { from: string; to: string }): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to })
  if (filters.productId) params.set('productId', filters.productId)
  if (filters.groupBy === 'HOUR_OF_DAY') params.set('group', 'hour')
  return `${REVENUE_PATH}?${params}`
}

/** What the overview (O1) loads: the "7 ngày qua" report of the screen, all products, per day (today is its last row). */
export function overviewRevenueFilters(today: string): RevenueFilters {
  return { ...presetRange('7d', today), productId: '', groupBy: 'DAY' }
}

/** The single loader of revenue figures (report screen and overview). */
export function loadRevenueReport(filters: RevenueFilters, signal?: AbortSignal): Promise<RevenueReport> {
  return revenueApi.report(revenueQuery(filters), signal)
}

/**
 * A backend without BE 6.1 answers 404 for the path. With a product filter a 404 may also be an unknown product (the
 * client shows 404 messages generically), so that case is reported separately (productNotFound).
 */
export function revenueMissing(error: unknown, productFiltered = false): boolean {
  return error instanceof ApiError && error.status === 404 && !productFiltered
}
export function productNotFound(error: unknown, productFiltered: boolean): boolean {
  return error instanceof ApiError && error.status === 404 && productFiltered
}
export const REVENUE_MISSING = 'Chưa có dữ liệu doanh thu: máy chủ chưa có API báo cáo (BE 6.1). Màn này sẽ có số liệu khi API được triển khai.'

// ---- figures (same list for the screen and the CSV)

export type FigureKey = keyof RevenueFigures
export interface Figure { key: FigureKey; label: string; money: boolean; hint: string }
export const FIGURES: readonly Figure[] = [
  { key: 'orderCount', label: 'Số đơn', money: false, hint: 'Đơn đã thanh toán, tính theo giờ thanh toán.' },
  { key: 'quantity', label: 'Số hộp', money: false, hint: 'Hộp bán ra trong các đơn đó.' },
  { key: 'grossAmount', label: 'Giá gốc', money: true, hint: 'Tổng giá niêm yết trước giảm giá.' },
  { key: 'discountAmount', label: 'Tiền giảm', money: true, hint: 'Giảm giá cận hạn đã cho khách.' },
  { key: 'paidAmount', label: 'Khách trả', money: true, hint: 'Giá gốc trừ tiền giảm.' },
  { key: 'refundCount', label: 'Số đơn hoàn', money: false, hint: 'Đơn đã hoàn tiền, tính theo lúc hoàn.' },
  { key: 'refundAmount', label: 'Tiền hoàn', money: true, hint: 'Tiền đã trả lại khách, tính theo lúc hoàn.' },
  { key: 'netAmount', label: 'Thực thu', money: true, hint: 'Khách trả trừ tiền hoàn.' },
]
export const ZERO_FIGURES: RevenueFigures = { orderCount: 0, quantity: 0, grossAmount: 0, discountAmount: 0, paidAmount: 0, refundCount: 0, refundAmount: 0, netAmount: 0 }

/** A figure as the screen shows it: `35.000 ₫` for money, `1.234` for counts. */
export function figureText(figure: Pick<Figure, 'money'>, value: number): string {
  return figure.money ? formatMoney(value) : value.toLocaleString('vi-VN')
}

export function hasActivity(figures: RevenueFigures): boolean {
  return figures.orderCount > 0 || figures.refundCount > 0
}

export const GROUP_LABELS: Record<RevenueGroupBy, string> = { DAY: 'Theo ngày', HOUR_OF_DAY: 'Theo giờ trong ngày' }
const hh = (hour: number) => String(hour).padStart(2, '0')
/** Row label of a bucket: `13/11/2026`, or `13:00–13:59`. */
export function bucketLabel(bucket: Pick<RevenueBucket, 'date' | 'hour'>): string {
  if (bucket.date) return formatDate(bucket.date)
  return typeof bucket.hour === 'number' ? `${hh(bucket.hour)}:00–${hh(bucket.hour)}:59` : '—'
}
/** Short axis label: `13/11`, or `13h`. */
export function bucketShortLabel(bucket: Pick<RevenueBucket, 'date' | 'hour'>): string {
  if (bucket.date) return `${bucket.date.slice(8, 10)}/${bucket.date.slice(5, 7)}`
  return typeof bucket.hour === 'number' ? `${bucket.hour}h` : ''
}
export function bucketKey(bucket: Pick<RevenueBucket, 'date' | 'hour'>): string {
  return bucket.date ?? `h${bucket.hour ?? ''}`
}

/** Today's bucket of a DAY report (zero when the day has no bucket, e.g. the date rolled over since the request). */
export function figuresOfDay(report: RevenueReport, date: string): RevenueFigures {
  const bucket = report.buckets.find(candidate => candidate.date === date)
  return bucket ? pickFigures(bucket) : ZERO_FIGURES
}
export function pickFigures(source: RevenueFigures): RevenueFigures {
  return Object.fromEntries(FIGURES.map(({ key }) => [key, source[key] ?? 0])) as unknown as RevenueFigures
}

/**
 * Checks the invariants of the draft (gross - discount = paid, paid - refund = net, buckets and products add up to the
 * totals; across products only boxes and amounts, since an order with several products counts once per product). Returns what is off, in words; empty when the report is consistent. The screen shows these, so a backend
 * bug is visible instead of silently showing numbers that do not add up.
 */
export function consistencyIssues(report: RevenueReport): string[] {
  const issues: string[] = []
  const rowRules = (name: string, row: RevenueFigures) => {
    if (row.grossAmount - row.discountAmount !== row.paidAmount) issues.push(`${name}: giá gốc trừ tiền giảm khác khách trả.`)
    if (row.paidAmount - row.refundAmount !== row.netAmount) issues.push(`${name}: khách trả trừ tiền hoàn khác thực thu.`)
  }
  rowRules('Tổng', report.totals)
  for (const bucket of report.buckets) rowRules(bucketLabel(bucket), bucket)
  for (const product of report.byProduct) rowRules(product.productName, product)
  const sum = (rows: readonly RevenueFigures[], key: FigureKey) => rows.reduce((total, row) => total + row[key], 0)
  for (const { key, label } of FIGURES) {
    if (report.buckets.length && sum(report.buckets, key) !== report.totals[key]) issues.push(`${label} của các dòng ${report.groupBy === 'DAY' ? 'ngày' : 'giờ'} không cộng ra tổng.`)
    // An order with several products counts once per product, so only boxes and amounts add up across products.
    if (report.byProduct.length && key !== 'orderCount' && key !== 'refundCount' && sum(report.byProduct, key) !== report.totals[key]) issues.push(`${label} của các sản phẩm không cộng ra tổng.`)
  }
  return issues
}

// ---- chart

export interface ChartScale { min: number; max: number; ticks: number[] }
/** "Nice" axis from 0 that covers every value (negative net days included), with 3–5 ticks at 1/2/5 × 10^k steps. */
export function chartScale(values: readonly number[]): ChartScale {
  const high = Math.max(0, ...values), low = Math.min(0, ...values)
  const span = high - low
  if (span <= 0) return { min: 0, max: 1, ticks: [0] }
  const rough = span / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map(factor => factor * power).find(candidate => candidate >= rough) ?? 10 * power
  const min = Math.floor(low / step) * step, max = Math.ceil(high / step) * step
  const ticks: number[] = []
  for (let value = min; value <= max + step / 2; value += step) ticks.push(Math.round(value))
  return { min, max, ticks }
}
/** Every how many bars an axis label is printed, so at most `room` labels fit. */
export function labelEvery(count: number, room = 12): number {
  return Math.max(1, Math.ceil(count / room))
}
/** Axis money, short: `0`, `500 N`, `1,2 Tr`. */
export function compactMoney(value: number): string {
  const abs = Math.abs(value)
  const number = (amount: number) => amount.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
  if (abs >= 1_000_000) return `${number(value / 1_000_000)} Tr`
  if (abs >= 1_000) return `${number(value / 1_000)} N`
  return number(value)
}

// ---- describing the report (screen subtitle, CSV header, print)

export function scopeText(report: Pick<RevenueReport, 'fromDate' | 'toDate' | 'groupBy'>, productName: string | undefined): string {
  const range = report.fromDate === report.toDate ? `Ngày ${formatDate(report.fromDate)}` : `Từ ${formatDate(report.fromDate)} đến ${formatDate(report.toDate)}`
  return `${range} · ${productName ? `Sản phẩm ${productName}` : 'Tất cả sản phẩm'} · ${GROUP_LABELS[report.groupBy]}`
}

// ---- CSV

/**
 * One cell. Numbers are written as plain integers (no thousands separator, no ₫) so a spreadsheet reads them as numbers.
 * Text that a spreadsheet would run as a formula (= + - @, tab, CR, LF) gets a leading apostrophe, also when spaces,
 * NBSP or zero-width spaces come first (Excel skips them before a formula); text with a comma, quote or line break is
 * quoted.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let text = /^[\s\u200b]*[=+\-@\t\r\n]/.test(value) ? `'${value}` : value
  if (/[",\r\n]/.test(text) || text !== text.trim()) text = `"${text.replaceAll('"', '""')}"`
  return text
}
const csvRow = (cells: readonly (string | number | null | undefined)[]) => cells.map(csvCell).join(',')
const figureCells = (row: RevenueFigures) => FIGURES.map(({ key }) => row[key])
const figureHeads = () => FIGURES.map(({ label, money }) => money ? `${label} (VND)` : label)

/** A day in the CSV: ISO `2026-11-13`, read as the same date by Excel whatever the regional settings (13/11 vs 11/13). */
export const csvDate = (date: string) => date
/** A moment in the CSV, Vietnam time: `2026-11-13 13:05`. */
export function csvDateTime(instant: string): string {
  const ms = Date.parse(instant)
  return Number.isFinite(ms) ? new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') : instant
}
/** Row label of a bucket in the CSV: the ISO day, or the same hour range as the screen. */
export const csvBucketLabel = (bucket: Pick<RevenueBucket, 'date' | 'hour'>) => bucket.date ? csvDate(bucket.date) : bucketLabel(bucket)
/** Shown next to the export button: what to do when Excel puts a whole row in one column (list separator `;`). */
export const CSV_EXCEL_HINT = 'Nếu Excel dồn mọi thứ vào một cột: mở bằng Dữ liệu > Từ văn bản/CSV, chọn dấu phẩy.'

/**
 * The CSV file of a report: the scope, the totals, one row per day/hour and one row per product, with exactly the
 * figures of the screen. UTF-8 with BOM (Excel reads Vietnamese), comma separated, CRLF line ends; dates are ISO
 * (yyyy-MM-dd, Vietnam calendar) so no regional setting can swap day and month. No `sep=,` line: Excel then ignores
 * the BOM and breaks the Vietnamese text.
 */
export function revenueCsv(report: RevenueReport, productName: string | undefined): string {
  const rows: (string | number | null | undefined)[][] = [
    ['Báo cáo doanh thu FreshVend'],
    ['Từ ngày', csvDate(report.fromDate)],
    ['Đến ngày', csvDate(report.toDate)],
    ['Sản phẩm', productName ?? 'Tất cả sản phẩm'],
    ['Nhóm theo', GROUP_LABELS[report.groupBy]],
    ['Múi giờ', report.timeZone],
    ['Lập lúc', csvDateTime(report.generatedAt)],
    [],
    ['Tổng'],
    ['', ...figureHeads()],
    ['Tổng', ...figureCells(report.totals)],
    [],
    [GROUP_LABELS[report.groupBy]],
    [report.groupBy === 'DAY' ? 'Ngày' : 'Giờ', ...figureHeads()],
    ...report.buckets.map(bucket => [csvBucketLabel(bucket), ...figureCells(bucket)]),
    [],
    ['Theo sản phẩm'],
    ['SKU', 'Sản phẩm', ...figureHeads()],
    ...report.byProduct.map(product => [product.sku, product.productName, ...figureCells(product)]),
  ]
  return `﻿${rows.map(csvRow).join('\r\n')}\r\n`
}
/** `doanh-thu_2026-11-07_2026-11-13.csv`, with the SKU when one product is filtered. */
export function csvFileName(report: Pick<RevenueReport, 'fromDate' | 'toDate'>, sku?: string): string {
  const product = sku ? `_${sku.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')}` : ''
  return `doanh-thu_${report.fromDate}_${report.toDate}${product}.csv`
}

/** Splits a CSV produced by revenueCsv back into cells (quoted cells included); used by tests to compare with the screen. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const source = text.replace(/^﻿/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\r') continue
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}
