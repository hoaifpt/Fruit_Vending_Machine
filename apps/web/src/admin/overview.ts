// O1 Tổng quan (FE 6.5, bước 1): which machines need someone now, in four blocks, each row one click from the place
// where it is handled. Pure rules (which machines/slots/alerts count, thresholds, links) and the loaders, unit-tested.
//
// There is no dashboard endpoint yet (BE 6.1). Until it ships the screen is assembled from what api.yaml and the drafts
// already offer, with bounded request counts:
// - Mất kết nối (OFFLINE): GET /machines (one page of MACHINE_SCAN_SIZE) and the 180 s rule of connection.ts on
//   `lastSeenAt`; the API has no connectivity filter, so it is decided here.
// - Bảo trì: GET /machines?status=MAINTENANCE (server-side filter; count = totalElements).
// - Sắp hết hàng: for the first LOW_STOCK_MACHINE_LIMIT ACTIVE machines, GET /machines/{id}/slots?status=ACTIVE and
//   GET /inventory?machineId&status=AVAILABLE&expired=false (2 requests per machine, LOW_STOCK_CONCURRENCY at a time).
// - Cảnh báo nghiêm trọng: GET /alerts?status=OPEN&severity=CRITICAL (draft alerts.yaml, BE 3.6).
// TODO(BE 6.1): replace the low-stock fan-out and the OFFLINE scan with the dashboard endpoint when it ships.
import { ApiError, serverNow } from '../api/client.ts'
import { alertsApi, inventoryApi, machinesApi, slotsApi } from '../api/resources.ts'
import type { Alert, AlertListQuery, InventoryItem, Machine, Page, Slot } from '../api/resources.ts'
import { uuidParam } from '../lib/table-query.ts'
import { connectionOf } from './connection.ts'
import type { Connection } from './connection.ts'
import { settleLimited } from './inventory-map.ts'
import { inventoryMapPath } from './order-detail.ts'

/** Every block reloads this often while the tab is visible (like the alert bell). */
export const OVERVIEW_POLL_MS = 30_000
/** Rows shown per block before "Xem tất cả". */
export const OVERVIEW_ROWS = 5
/** Machines read for the OFFLINE block (API maximum page size). */
export const MACHINE_SCAN_SIZE = 100
/**
 * A slot is "sắp hết hàng" when it is ACTIVE, in an ACTIVE machine, and holds at most this many sellable boxes
 * (AVAILABLE and not expired). 1: after the next sale the slot is empty, so someone should bring boxes now.
 */
export const LOW_STOCK_THRESHOLD = 1
/** ACTIVE machines checked for low stock (by name); more are reported as not checked until BE 6.1. */
export const LOW_STOCK_MACHINE_LIMIT = 20
/** Machines whose stock is read at the same time. */
export const LOW_STOCK_CONCURRENCY = 4
/** API maximum page size. */
const PAGE = 100
/** Pages of AVAILABLE boxes read per machine before giving up (500 sellable boxes in one machine is far beyond a real one). */
const MAX_STOCK_PAGES = 5

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
/** Low-stock slot → that slot on the inventory map (FM4 URL), where boxes are loaded. */
export function lowStockPath(machineId: string | undefined, slotId: string | undefined): string {
  return inventoryMapPath(machineId, slotId)
}
/** "Xem tất cả" of the server-filtered blocks. */
export const MAINTENANCE_LIST_PATH = '/admin/machines?status=MAINTENANCE'
export const CRITICAL_LIST_PATH = '/admin/alerts?status=OPEN&severity=CRITICAL'

// ---- OFFLINE

export interface OfflineMachine { machine: Machine; connection: Connection }

/**
 * Machines that should be talking to the server but are not: OFFLINE by the 180 s rule and not INACTIVE (an INACTIVE
 * machine is out of service on purpose; a MAINTENANCE one that went silent still needs a look). Longest silence
 * first; never-connected machines last (usually not installed yet).
 */
export function offlineMachines(machines: readonly Machine[], now: number): OfflineMachine[] {
  return machines
    .filter(machine => machine.status !== 'INACTIVE')
    .map(machine => ({ machine, connection: connectionOf(machine.lastSeenAt, now) }))
    .filter(entry => entry.connection.state === 'OFFLINE')
    .sort((a, b) => {
      if (a.connection.never !== b.connection.never) return a.connection.never ? 1 : -1
      return (b.connection.ageMs ?? 0) - (a.connection.ageMs ?? 0) || a.machine.code.localeCompare(b.machine.code)
    })
}

/** `at`: when the list arrived, on the server's clock (serverNow of client.ts), so a wrong PC clock does not matter. */
export interface MachineScan { page: Page<Machine>; incomplete: boolean; at: number }
export async function loadMachineScan(signal?: AbortSignal): Promise<MachineScan> {
  const page = await machinesApi.list({ page: 0, size: MACHINE_SCAN_SIZE, sort: 'name,asc' }, signal)
  return { page, incomplete: page.totalElements > page.content.length, at: serverNow() }
}

// ---- maintenance

export function loadMaintenance(signal?: AbortSignal): Promise<Page<Machine>> {
  return machinesApi.list({ status: 'MAINTENANCE', page: 0, size: OVERVIEW_ROWS, sort: 'updatedAt,desc' }, signal)
}

// ---- low stock

export interface LowStockSlot {
  machineId: string; machineCode: string; machineName: string
  slotId: string; slotCode: string; capacity: number
  /** AVAILABLE, unexpired boxes in the slot. */
  sellable: number
}

/** Sellable boxes per slot id (AVAILABLE and not expired; the caller asks the API for exactly those). */
export function countSellable(items: readonly InventoryItem[], now: number): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (!item.slotId || item.status !== 'AVAILABLE' || item.expired) continue
    if (item.expiresAt && Date.parse(item.expiresAt) <= now) continue
    counts.set(item.slotId, (counts.get(item.slotId) ?? 0) + 1)
  }
  return counts
}

/** ACTIVE slots of an ACTIVE machine with at most `threshold` sellable boxes, emptiest first, then by slot code. */
export function lowStockSlots(machine: Machine, slots: readonly Slot[], items: readonly InventoryItem[], now: number, threshold = LOW_STOCK_THRESHOLD): LowStockSlot[] {
  if (machine.status !== 'ACTIVE') return []
  const counts = countSellable(items.filter(item => item.machineId === undefined || item.machineId === machine.id), now)
  return slots
    .filter(slot => slot.machineId === machine.id && slot.status === 'ACTIVE')
    .map(slot => ({ machineId: machine.id, machineCode: machine.code, machineName: machine.name, slotId: slot.id, slotCode: slot.slotCode, capacity: slot.capacity, sellable: counts.get(slot.id) ?? 0 }))
    .filter(slot => slot.sellable <= threshold)
    .sort((a, b) => a.sellable - b.sellable || a.slotCode.localeCompare(b.slotCode))
}

/** Across machines: emptiest first, then machine code, then slot code. */
export function sortLowStock(slots: readonly LowStockSlot[]): LowStockSlot[] {
  return [...slots].sort((a, b) => a.sellable - b.sellable || a.machineCode.localeCompare(b.machineCode) || a.slotCode.localeCompare(b.slotCode))
}

export function lowStockText(slot: Pick<LowStockSlot, 'sellable' | 'capacity'>): string {
  return slot.sellable === 0 ? `Hết hàng: còn 0/${slot.capacity} hộp sẵn bán` : `Còn ${slot.sellable}/${slot.capacity} hộp sẵn bán`
}

export interface LowStockReport {
  slots: LowStockSlot[]
  /** ACTIVE machines whose stock was read. */
  checked: number
  /** ACTIVE machines in total (more than `checked` when over LOW_STOCK_MACHINE_LIMIT). */
  activeTotal: number
  /** Machines whose slots or boxes could not be read this time. */
  failed: number
  /** A machine had more slots or boxes than were read. */
  incomplete: boolean
}

interface MachineStock { slots: LowStockSlot[]; incomplete: boolean }

async function loadSellable(machineId: string, signal?: AbortSignal): Promise<{ items: InventoryItem[]; incomplete: boolean }> {
  const items: InventoryItem[] = []
  for (let page = 0; page < MAX_STOCK_PAGES; page += 1) {
    const result = await inventoryApi.list({ machineId, status: 'AVAILABLE', expired: false, page, size: PAGE, sort: 'loadedAt,asc' }, signal)
    items.push(...result.content)
    if (page + 1 >= result.totalPages || !result.content.length) return { items, incomplete: false }
  }
  return { items, incomplete: true }
}

async function loadMachineStock(machine: Machine, now: () => number, signal?: AbortSignal): Promise<MachineStock> {
  const [slotPage, stock] = await Promise.all([
    slotsApi.list(machine.id, { status: 'ACTIVE', page: 0, size: PAGE, sort: 'slotCode,asc' }, signal),
    loadSellable(machine.id, signal),
  ])
  return { slots: lowStockSlots(machine, slotPage.content, stock.items, now()), incomplete: stock.incomplete || slotPage.totalElements > slotPage.content.length }
}

/** 401/403 mean the whole block cannot be read: never hidden behind "N máy không đọc được". */
function isAccessError(reason: unknown): boolean {
  return reason instanceof ApiError && (reason.status === 401 || reason.status === 403)
}

/**
 * Per-machine results into one report. A 401/403 (or every machine failing) fails the block; otherwise the machines
 * that could not be read are counted and the rest is shown.
 */
export function combineStock(results: readonly PromiseSettledResult<MachineStock>[], activeTotal: number): LowStockReport {
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  const access = rejected.find(result => isAccessError(result.reason))
  if (access) throw access.reason
  if (rejected.length && rejected.length === results.length) throw rejected[0].reason
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<MachineStock> => result.status === 'fulfilled')
  return {
    slots: sortLowStock(fulfilled.flatMap(result => result.value.slots)),
    checked: fulfilled.length, activeTotal, failed: rejected.length,
    incomplete: fulfilled.some(result => result.value.incomplete),
  }
}

export async function loadLowStock(signal?: AbortSignal, now: () => number = serverNow): Promise<LowStockReport> {
  const machines = await machinesApi.list({ status: 'ACTIVE', page: 0, size: LOW_STOCK_MACHINE_LIMIT, sort: 'name,asc' }, signal)
  const results = await settleLimited(machines.content, LOW_STOCK_CONCURRENCY, machine => loadMachineStock(machine, now, signal))
  return combineStock(results, machines.totalElements)
}

// ---- CRITICAL alerts

export const CRITICAL_QUERY: AlertListQuery = { status: 'OPEN', severity: 'CRITICAL', page: 0, size: OVERVIEW_ROWS, sort: 'triggeredAt,desc' }
export function loadCritical(signal?: AbortSignal): Promise<Page<Alert>> {
  return alertsApi.list(CRITICAL_QUERY, signal)
}

// ---- block wording

/** How a block reads when nothing needs attention: said positively, so "0" is clearly good news. */
export const EMPTY_TEXT = {
  offline: 'Không có máy mất kết nối. Mọi máy đang hoạt động đều gửi tín hiệu trong 3 phút qua.',
  maintenance: 'Không có máy đang bảo trì.',
  lowStock: 'Không có ngăn sắp hết hàng.',
  critical: 'Không có cảnh báo nghiêm trọng đang mở.',
} as const

/** Rows shown: the first OVERVIEW_ROWS, or all of them once "Hiện tất cả" was pressed. */
export function visibleRows<T>(rows: readonly T[], expanded: boolean, limit = OVERVIEW_ROWS): T[] {
  return expanded ? [...rows] : rows.slice(0, limit)
}
