// R1 Báo cáo bán hàng (FE 9.1) and the revenue block of O1 Tổng quan (FE 9.2) on the real sales report API of backend
// #76 (api.yaml, docs/reports.md). Pure rules, unit-tested: filters in the URL, the requests, labels of the figures,
// the chart scale and the export. Every number is the server's: the screen shows the five GET /reports/sales/* answers
// for one set of filters, and the CSV / PDF file is GET /reports/sales/export with the same filters (rendered by the
// server from the same query, so the file says what the screen says). Definitions (docs/reports.md §1): a sale is a
// delivered order, counted at completed_at; refunds are counted at refunded_at; discounts and refunds stay separate.
import { ApiError } from '../api/client.ts'
import { salesReportsApi } from '../api/resources.ts'
import type {
  MachineReport, PeakHours, ProductReport, ProductSort, SalesBucket, SalesExportFormat, SalesGranularity, SalesQuery, SalesSeries, SalesSummary,
} from '../api/resources.ts'
import { formatDate, formatMoney } from '../lib/format.ts'
import { uuidParam } from '../lib/table-query.ts'
import { addDays, daysBetween, isDateString } from './maintenance-schedules.ts'
import { REFUND_REASONS, REFUND_REASON_LABELS } from './refunds.ts'

export const REVENUE_PATH = '/admin/reports/revenue'
/** Longest range the API accepts (both ends counted, docs/reports.md §2). */
export const MAX_RANGE_DAYS = 366
/** Rows of the product table (the API allows 1..100; the export always has every product). */
export const PRODUCT_LIMIT = 20

// ---- filters (URL: from, to, machineId, productId, granularity=week|month, productSort=quantity)

export interface RevenueFilters {
  from: string; to: string
  /** One machine / product (the API accepts up to 20; the screen filters on one). '' = all. */
  machineId: string; productId: string
  granularity: SalesGranularity
  productSort: ProductSort
}

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

export const GRANULARITIES: readonly SalesGranularity[] = ['DAY', 'WEEK', 'MONTH']
export const GRANULARITY_LABELS: Record<SalesGranularity, string> = { DAY: 'Theo ngày', WEEK: 'Theo tuần', MONTH: 'Theo tháng' }
export const PRODUCT_SORT_LABELS: Record<ProductSort, string> = { NET_SALES: 'Doanh số cao nhất', QUANTITY: 'Bán nhiều hộp nhất' }

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
  const id = (name: 'machineId' | 'productId') => {
    const raw = params.get(name) ?? ''
    const value = uuidParam(raw)
    if (raw && !value) ignored.push(name)
    return value
  }
  const machineId = id('machineId'), productId = id('productId')
  const rawGranularity = (params.get('granularity') ?? '').toUpperCase()
  if (rawGranularity && !GRANULARITIES.includes(rawGranularity as SalesGranularity)) ignored.push('granularity')
  const granularity = GRANULARITIES.includes(rawGranularity as SalesGranularity) ? rawGranularity as SalesGranularity : 'DAY'
  const rawSort = (params.get('productSort') ?? '').toUpperCase()
  if (rawSort && rawSort !== 'QUANTITY' && rawSort !== 'NET_SALES') ignored.push('productSort')
  return { filters: { from, to, machineId, productId, granularity, productSort: rawSort === 'QUANTITY' ? 'QUANTITY' : 'NET_SALES' }, ignored }
}

export const FILTER_LABELS: Record<string, string> = {
  from: 'Từ ngày', to: 'Đến ngày', machineId: 'Máy', productId: 'Sản phẩm', granularity: 'Chia theo', productSort: 'Sắp xếp sản phẩm',
}

/** Field errors of a range, checked before any request (the server checks the same rules and answers 400). */
export function validateRange(from: string, to: string): Partial<Record<'from' | 'to', string>> {
  if (!isDateString(from)) return { from: 'Chọn ngày bắt đầu.' }
  if (!isDateString(to)) return { to: 'Chọn ngày kết thúc.' }
  if (to < from) return { to: 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.' }
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return { from: `Mỗi lần xem tối đa ${MAX_RANGE_DAYS} ngày. Thu hẹp khoảng ngày.` }
  return {}
}

/** The common parameters of every /reports/sales/* call: only what the contract names; an empty filter is not sent. */
export function salesQuery(filters: Pick<RevenueFilters, 'from' | 'to' | 'machineId' | 'productId'>): SalesQuery {
  return {
    from: filters.from, to: filters.to,
    ...(filters.machineId ? { machineId: [filters.machineId] } : {}),
    ...(filters.productId ? { productId: [filters.productId] } : {}),
  }
}
export function revenueKey(filters: RevenueFilters): string {
  return [filters.from, filters.to, filters.machineId, filters.productId, filters.granularity, filters.productSort].join('|')
}
/** Link to the report with these filters (dates always written, so the link shows the same numbers tomorrow). */
export function revenueHref(filters: Partial<RevenueFilters> & { from: string; to: string }): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to })
  if (filters.machineId) params.set('machineId', filters.machineId)
  if (filters.productId) params.set('productId', filters.productId)
  if (filters.granularity && filters.granularity !== 'DAY') params.set('granularity', filters.granularity.toLowerCase())
  if (filters.productSort === 'QUANTITY') params.set('productSort', 'quantity')
  return `${REVENUE_PATH}?${params}`
}

// ---- loading

/** The five answers shown for one set of filters; `key` says which filters they answer. */
export interface SalesReport {
  key: string
  summary: SalesSummary; series: SalesSeries; peak: PeakHours; products: ProductReport; machines: MachineReport
}

/** The screen's loader: the five report endpoints in parallel, for exactly the same filters. */
export async function loadSalesReport(filters: RevenueFilters, signal?: AbortSignal): Promise<SalesReport> {
  const query = salesQuery(filters)
  const [summary, series, peak, products, machines] = await Promise.all([
    salesReportsApi.summary(query, signal),
    salesReportsApi.timeseries({ ...query, granularity: filters.granularity }, signal),
    salesReportsApi.peakHours(query, signal),
    salesReportsApi.products({ ...query, sortBy: filters.productSort, limit: PRODUCT_LIMIT }, signal),
    salesReportsApi.machines(query, signal),
  ])
  return { key: revenueKey(filters), summary, series, peak, products, machines }
}

/** What the overview (O1) loads besides the dashboard: the summary of the last 7 days (today is its last day). */
export function overviewWeek(today: string): { from: string; to: string } {
  return presetRange('7d', today)
}
export function loadWeekSummary(today: string, signal?: AbortSignal): Promise<SalesSummary> {
  return salesReportsApi.summary(salesQuery({ ...overviewWeek(today), machineId: '', productId: '' }), signal)
}

/**
 * 400 of the report API: the range or an id was refused (the message names the id). Field errors, when the server
 * sends them, are keyed by query parameter (from, to, machineId, productId).
 */
export function reportRejected(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 400
}

// ---- figures (labels and hints; the values are the server's)

export type FigureKey = 'netRevenue' | 'netSales' | 'grossSales' | 'discounts' | 'deliveredRefunds' | 'ordersSold' | 'averageOrderValue' | 'moneyCollected' | 'moneyRefunded' | 'failedDispenses'
export interface Figure { key: FigureKey; label: string; money: boolean; hint: string }
/** Tiles in reading order: what the business keeps first, then how it is made up, then the cash view. */
export const FIGURES: readonly Figure[] = [
  { key: 'netRevenue', label: 'Doanh thu thuần', money: true, hint: 'Doanh số sau giảm giá trừ tiền hoàn của đơn đã giao.' },
  { key: 'netSales', label: 'Doanh số sau giảm giá', money: true, hint: 'Khách trả cho các đơn đã giao trong khoảng.' },
  { key: 'grossSales', label: 'Doanh số gốc', money: true, hint: 'Giá niêm yết của các đơn đó, trước giảm giá.' },
  { key: 'discounts', label: 'Tiền giảm', money: true, hint: 'Giảm giá cận hạn đã cho khách.' },
  { key: 'deliveredRefunds', label: 'Hoàn tiền đơn đã giao', money: true, hint: 'Hoàn vì chất lượng hoặc lý do khác, tính theo lúc hoàn.' },
  { key: 'ordersSold', label: 'Số đơn đã giao', money: false, hint: 'Đơn nhả hộp xong trong khoảng.' },
  { key: 'averageOrderValue', label: 'Giá trị trung bình/đơn', money: true, hint: 'Doanh số sau giảm giá chia số đơn, làm tròn xuống.' },
  { key: 'moneyCollected', label: 'Tiền đã thu', money: true, hint: 'Khoản thanh toán thành công theo lúc trả (dòng tiền).' },
  { key: 'moneyRefunded', label: 'Tiền đã hoàn', money: true, hint: 'Mọi khoản hoàn theo lúc hoàn, gồm cả đơn không giao được.' },
  { key: 'failedDispenses', label: 'Đơn nhả hàng lỗi', money: false, hint: 'Đơn trả tiền trong khoảng mà máy không nhả được hộp.' },
]

/** A figure of the summary (0 when the server left it out). */
export function figureValue(summary: SalesSummary, key: FigureKey): number {
  if (key === 'moneyRefunded') return summary.moneyRefunded?.total ?? 0
  return summary[key] ?? 0
}
/** A figure as the screen shows it: `35.000 ₫` for money, `1.234` for counts. */
export function figureText(figure: Pick<Figure, 'money'>, value: number | undefined): string {
  return figure.money ? formatMoney(value ?? 0) : (value ?? 0).toLocaleString('vi-VN')
}

/** Anything happened in the range (a sale, a refund or a payment); otherwise the screen shows its empty state. */
export function hasActivity(summary: SalesSummary): boolean {
  return (summary.ordersSold ?? 0) > 0 || (summary.deliveredRefunds ?? 0) > 0 || (summary.moneyRefunded?.total ?? 0) > 0
    || (summary.moneyCollected ?? 0) > 0 || (summary.failedDispenses ?? 0) > 0
}

/** Refunds of the range by reason, every reason listed in the refunds screen's order (absent reasons are 0). */
export function refundsByReason(summary: SalesSummary): { reason: string; label: string; amount: number }[] {
  const byReason = summary.moneyRefunded?.byReason ?? {}
  return REFUND_REASONS.map(reason => ({ reason, label: REFUND_REASON_LABELS[reason], amount: byReason[reason] ?? 0 }))
}

/** `12,5%` (one decimal as the server rounds it). */
export function shareText(percent: number | undefined): string {
  return `${(percent ?? 0).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

// ---- time series and peak hours

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const monthEnd = (date: string) => addDays(`${addDays(`${date.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1)

/** Row label of a bucket: `13/11/2026`, `02/11 – 08/11/2026`, `Tháng 11/2026` (with its days when the range cut it). */
export function bucketLabel(bucket: Pick<SalesBucket, 'start' | 'end'>, granularity: SalesGranularity): string {
  const start = bucket.start ?? '', end = bucket.end ?? start
  if (!isDateString(start)) return '—'
  if (granularity === 'DAY' || start === end) return formatDate(start)
  if (granularity === 'WEEK') return `${dm(start)} – ${formatDate(end)}`
  const month = `Tháng ${start.slice(5, 7)}/${start.slice(0, 4)}`
  return start.endsWith('-01') && end === monthEnd(start) ? month : `${month} (${dm(start)} – ${dm(end)})`
}
/** Short axis label: `13/11`, `02/11`, `11/2026`. */
export function bucketShortLabel(bucket: Pick<SalesBucket, 'start'>, granularity: SalesGranularity): string {
  const start = bucket.start ?? ''
  if (!isDateString(start)) return ''
  return granularity === 'MONTH' ? `${start.slice(5, 7)}/${start.slice(0, 4)}` : dm(start)
}
export const bucketKey = (bucket: Pick<SalesBucket, 'start'>) => bucket.start ?? ''

const hh = (hour: number) => String(hour).padStart(2, '0')
/** `09:00–09:59`. */
export const hourLabel = (hour: number) => `${hh(hour)}:00–${hh(hour)}:59`
/** Rows of the 7 × 24 matrix: Monday first, as the API sends them. */
export const WEEKDAYS: readonly { short: string; long: string }[] = [
  { short: 'T2', long: 'Thứ Hai' }, { short: 'T3', long: 'Thứ Ba' }, { short: 'T4', long: 'Thứ Tư' }, { short: 'T5', long: 'Thứ Năm' },
  { short: 'T6', long: 'Thứ Sáu' }, { short: 'T7', long: 'Thứ Bảy' }, { short: 'CN', long: 'Chủ nhật' },
]
/** The 24 hours 0..23 in order, each with its figures (an hour missing from the answer is 0). */
export function hoursOfDay(peak: Pick<PeakHours, 'hours'>): { hour: number; ordersSold: number; netSales: number }[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const row = peak.hours?.find(candidate => candidate.hour === hour)
    return { hour, ordersSold: row?.ordersSold ?? 0, netSales: row?.netSales ?? 0 }
  })
}
/** Busiest hours (most orders, then most sales, then earliest), at most `count`, only hours with a sale. */
export function busiestHours(peak: Pick<PeakHours, 'hours'>, count = 3): { hour: number; ordersSold: number; netSales: number }[] {
  return hoursOfDay(peak).filter(row => row.ordersSold > 0)
    .sort((a, b) => b.ordersSold - a.ordersSold || b.netSales - a.netSales || a.hour - b.hour).slice(0, count)
}
/** Largest cell of the weekday × hour matrix (scale of the heat map; at least 1). */
export function matrixMax(matrix: readonly (readonly number[])[] | undefined): number {
  return Math.max(1, ...(matrix ?? []).flat().filter(value => Number.isFinite(value)))
}
/** Shade step 0..4 of a heat-map cell (0 = no sale). */
export function heatLevel(value: number, max: number): number {
  if (!value || value <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)))
}

// ---- chart

export interface ChartScale { min: number; max: number; ticks: number[] }
/** "Nice" axis from 0 that covers every value (negative periods included), with 3–5 ticks at 1/2/5 × 10^k steps. */
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

// ---- describing the report

export function scopeText(filters: Pick<RevenueFilters, 'from' | 'to'>, machineName: string | undefined, productName: string | undefined): string {
  const range = filters.from === filters.to ? `Ngày ${formatDate(filters.from)}` : `Từ ${formatDate(filters.from)} đến ${formatDate(filters.to)}`
  return `${range} · ${machineName ? `Máy ${machineName}` : 'Tất cả máy'} · ${productName ? `Sản phẩm ${productName}` : 'Tất cả sản phẩm'}`
}

// ---- export (server-rendered CSV / PDF)

export const EXPORT_FORMATS: readonly SalesExportFormat[] = ['CSV', 'PDF']
/** Parameters of GET /reports/sales/export: the format and the screen's filters, nothing else. */
export function exportQuery(filters: RevenueFilters, format: SalesExportFormat) {
  return { format, ...salesQuery(filters) }
}
/** Name of the downloaded file: the server's (Content-Disposition) or the same pattern when it cannot be read. */
export function exportFileName(filters: Pick<RevenueFilters, 'from' | 'to'>, format: SalesExportFormat, serverName?: string): string {
  return serverName || `freshvend-sales_${filters.from}_${filters.to}.${format.toLowerCase()}`
}
/** Shown next to the export buttons. */
export const EXPORT_HINT = 'File do máy chủ tạo từ đúng bộ lọc đang xem: CSV mở được bằng Excel (UTF-8), PDF khổ A4. Mỗi lần xuất được ghi nhật ký.'
