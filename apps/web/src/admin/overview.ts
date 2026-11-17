// O1 Tổng quan (FE 6.5 + 9.2) on GET /dashboard/overview of backend #76 (docs/reports.md §5): one request, polled every
// 30 s, answers machines, alerts, work orders, stock and (with REPORT_SALES_READ) today's sales and pending refunds.
// Pure rules (which machines are listed, links, wording) and the loaders, unit-tested. Besides the dashboard the screen
// only reads the newest OPEN CRITICAL alerts (one GET /alerts, ALERT_READ) so each one is a click away, and, for the
// revenue block, the summary of the last 7 days (revenue.ts).
import { serverNow } from '../api/client.ts'
import { alertsApi, dashboardApi } from '../api/resources.ts'
import type { Alert, AlertListQuery, DashboardMachine, DashboardOverview, Page } from '../api/resources.ts'
import { formatMoney } from '../lib/format.ts'
import { uuidParam } from '../lib/table-query.ts'
import { connectionOf } from './connection.ts'
import type { Connection } from './connection.ts'

/** Every block reloads this often while the tab is visible (like the alert bell). */
export const OVERVIEW_POLL_MS = 30_000
/** Rows shown per block before "Hiện tất cả". */
export const OVERVIEW_ROWS = 5

// ---- loading

/** `at`: when the dashboard arrived, on the server's clock (serverNow of client.ts), so a wrong PC clock does not matter. */
export interface DashboardState { dashboard: DashboardOverview; at: number }
export async function loadDashboard(signal?: AbortSignal): Promise<DashboardState> {
  const dashboard = await dashboardApi.overview(signal)
  return { dashboard, at: serverNow() }
}

export const CRITICAL_QUERY: AlertListQuery = { status: 'OPEN', severity: 'CRITICAL', page: 0, size: OVERVIEW_ROWS }
export function loadCritical(signal?: AbortSignal): Promise<Page<Alert>> {
  return alertsApi.list(CRITICAL_QUERY, signal)
}

// ---- links: one click to where the problem is handled

/** OFFLINE machine → its "Cảm biến & Sự kiện" tab (heartbeat, Wi-Fi, last events). */
export function sensorsPath(machineId: string | undefined): string {
  const id = uuidParam(machineId ?? '')
  return id ? `/admin/machines/${id}?tab=sensors` : '/admin/machines'
}
/** Machine in maintenance → its detail page (status, slots, why it does not sell). */
export function machineDetailPath(machineId: string | undefined): string {
  const id = uuidParam(machineId ?? '')
  return id ? `/admin/machines/${id}` : '/admin/machines'
}
/** Stock figures → the inventory map of that machine (FM4 URL), or the map's machine picker. */
export function inventoryPath(machineId?: string): string {
  const id = uuidParam(machineId ?? '')
  return id ? `/admin/inventory?machineId=${id}` : '/admin/inventory'
}
export const MAINTENANCE_LIST_PATH = '/admin/machines?status=MAINTENANCE'
export const ALERTS_PATH = '/admin/alerts'
export const CRITICAL_LIST_PATH = '/admin/alerts?status=OPEN&severity=CRITICAL'
export const TICKETS_PATH = '/admin/tickets'
export const OVERDUE_TICKETS_PATH = '/admin/tickets?overdue=true'
export const IN_PROGRESS_TICKETS_PATH = '/admin/tickets?status=IN_PROGRESS'
export const REFUNDS_PATH = '/admin/refunds'

// ---- machines (machinesDetail)

export interface OfflineMachine { machine: DashboardMachine; connection: Connection }

/**
 * Machines that should be talking to the server but are not: OFFLINE (connectivity of the server, or the 180 s rule on
 * lastSeenAt) and not INACTIVE (out of service on purpose; a MAINTENANCE one that went silent still needs a look).
 * Longest silence first; never-connected machines last (usually not installed yet).
 */
export function offlineMachines(machines: readonly DashboardMachine[], now: number): OfflineMachine[] {
  return machines
    .filter(machine => machine.status !== 'INACTIVE')
    .map(machine => ({ machine, connection: connectionOf(machine.lastSeenAt, now, machine.connectivity) }))
    .filter(entry => entry.connection.state === 'OFFLINE')
    .sort((a, b) => {
      if (a.connection.never !== b.connection.never) return a.connection.never ? 1 : -1
      return (b.connection.ageMs ?? 0) - (a.connection.ageMs ?? 0) || (a.machine.code ?? '').localeCompare(b.machine.code ?? '')
    })
}
/** Machines in MAINTENANCE (they take no order), by code. */
export function maintenanceMachines(machines: readonly DashboardMachine[]): DashboardMachine[] {
  return machines.filter(machine => machine.status === 'MAINTENANCE').sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
}
/** `5,2 °C`, or `Chưa có số đo`. */
export function temperatureText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} °C` : 'Chưa có số đo'
}
/** Under a machine row: how many bowls it can sell now and its open alerts. */
export function machineFacts(machine: Pick<DashboardMachine, 'sellableBowls' | 'openAlerts' | 'temperature'>): string {
  const parts = [`${(machine.sellableBowls ?? 0).toLocaleString('vi-VN')} hộp sẵn bán`, temperatureText(machine.temperature)]
  if (machine.openAlerts) parts.push(`${machine.openAlerts} cảnh báo chưa xử lý`)
  return parts.join(' · ')
}

// ---- counts

const n = (value: number | undefined) => value ?? 0
/** "12 máy: 10 đang bán, 1 bảo trì, 1 ngừng" and the connectivity split, for the machines block. */
export function machineSummary(machines: DashboardOverview['machines']): { status: string; connectivity: string } {
  return {
    status: `${n(machines?.total)} máy: ${n(machines?.active)} đang bán, ${n(machines?.maintenance)} bảo trì, ${n(machines?.inactive)} ngừng hoạt động`,
    connectivity: `${n(machines?.online)} trực tuyến, ${n(machines?.warning)} chậm tín hiệu, ${n(machines?.offline)} mất kết nối, ${n(machines?.neverSeen)} chưa từng kết nối`,
  }
}

/** Tone of a count: red when someone must act, amber when it should be looked at, neutral at zero. */
export type CountTone = 'danger' | 'warning' | 'neutral'
export interface CountRow { key: string; label: string; value: number; to: string; tone: CountTone; hint?: string }

export function stockRows(stock: DashboardOverview['stock']): CountRow[] {
  return [
    { key: 'lowStockSlots', label: 'Ngăn sắp hết hàng', value: n(stock?.lowStockSlots), to: inventoryPath(), tone: n(stock?.lowStockSlots) ? 'warning' : 'neutral', hint: 'Ngăn đang hoạt động còn từ 2 hộp sẵn bán trở xuống.' },
    { key: 'blockedSlots', label: 'Ngăn bị chặn', value: n(stock?.blockedSlots), to: inventoryPath(), tone: n(stock?.blockedSlots) ? 'danger' : 'neutral', hint: 'Ngăn lỗi, hoặc hộp đầu ngăn nhả hàng lỗi: máy không bán được từ ngăn này.' },
    { key: 'bowlsExpiringToday', label: 'Hộp hết hạn trong hôm nay', value: n(stock?.bowlsExpiringToday), to: inventoryPath(), tone: n(stock?.bowlsExpiringToday) ? 'warning' : 'neutral', hint: 'Hộp còn hạn nhưng sẽ hết hạn trước 24:00 hôm nay.' },
  ]
}
export function alertRows(alerts: DashboardOverview['alerts']): CountRow[] {
  return [
    { key: 'critical', label: 'Nghiêm trọng', value: n(alerts?.critical), to: `${ALERTS_PATH}?severity=CRITICAL`, tone: n(alerts?.critical) ? 'danger' : 'neutral' },
    { key: 'warning', label: 'Cảnh báo', value: n(alerts?.warning), to: `${ALERTS_PATH}?severity=WARNING`, tone: n(alerts?.warning) ? 'warning' : 'neutral' },
    { key: 'info', label: 'Thông tin', value: n(alerts?.info), to: `${ALERTS_PATH}?severity=INFO`, tone: 'neutral' },
  ]
}
export function workOrderRows(workOrders: DashboardOverview['workOrders']): CountRow[] {
  return [
    { key: 'overdue', label: 'Quá hạn', value: n(workOrders?.overdue), to: OVERDUE_TICKETS_PATH, tone: n(workOrders?.overdue) ? 'danger' : 'neutral' },
    { key: 'open', label: 'Chờ làm (mới, đã giao)', value: n(workOrders?.open), to: TICKETS_PATH, tone: 'neutral' },
    { key: 'inProgress', label: 'Đang làm', value: n(workOrders?.inProgress), to: IN_PROGRESS_TICKETS_PATH, tone: 'neutral' },
    { key: 'assignedToMe', label: 'Giao cho tôi, chưa xong', value: n(workOrders?.assignedToMe), to: TICKETS_PATH, tone: n(workOrders?.assignedToMe) ? 'warning' : 'neutral' },
  ]
}

// ---- revenue of the dashboard (REPORT_SALES_READ only)

/** Today vs yesterday: `+12.000 ₫ so với hôm qua`, `bằng hôm qua`; undefined without figures. */
export function versusYesterday(today: DashboardOverview['today']): string | undefined {
  if (!today || typeof today.netSales !== 'number' || typeof today.yesterdayNetSales !== 'number') return undefined
  const diff = today.netSales - today.yesterdayNetSales
  if (diff === 0) return 'bằng hôm qua'
  return `${diff > 0 ? '+' : '−'}${formatMoney(Math.abs(diff))} so với hôm qua (${formatMoney(today.yesterdayNetSales)})`
}

// ---- block wording

/** How a block reads when nothing needs attention: said positively, so "0" is clearly good news. */
export const EMPTY_TEXT = {
  offline: 'Không có máy mất kết nối. Mọi máy đang hoạt động đều gửi tín hiệu trong 3 phút qua.',
  maintenance: 'Không có máy đang bảo trì.',
  stock: 'Không có ngăn sắp hết hàng, bị chặn hay hộp hết hạn hôm nay.',
  critical: 'Không có cảnh báo nghiêm trọng đang mở.',
  workOrders: 'Không có phiếu công việc đang chờ hay quá hạn.',
} as const

/** Rows shown: the first OVERVIEW_ROWS, or all of them once "Hiện tất cả" was pressed. */
export function visibleRows<T>(rows: readonly T[], expanded: boolean, limit = OVERVIEW_ROWS): T[] {
  return expanded ? [...rows] : rows.slice(0, limit)
}
