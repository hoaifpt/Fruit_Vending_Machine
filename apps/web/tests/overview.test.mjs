// FE 6.5 Tổng quan: which machines/slots/alerts need attention, the low-stock threshold, the one-click links, the route
// and the loaders against the mock API (bounded requests, per-block failures, 403 not hidden).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  CRITICAL_LIST_PATH, CRITICAL_QUERY, EMPTY_TEXT, LOW_STOCK_THRESHOLD, MAINTENANCE_LIST_PATH, OVERVIEW_POLL_MS, OVERVIEW_ROWS,
  combineStock, countSellable, loadCritical, loadLowStock, loadMachineScan, loadMaintenance, lowStockPath, lowStockSlots, lowStockText,
  machineDetailPath, offlineMachines, sensorsPath, sortLowStock, visibleRows,
} from '../src/admin/overview.ts'
import { NAV, breadcrumbFor, canOpen, homeFor, matchRoute, navFor } from '../src/admin/routes.ts'

const M1 = '20000000-0000-0000-0000-000000000001'
const M2 = '20000000-0000-0000-0000-000000000002'
const NOW = Date.parse('2026-11-30T03:00:00Z')
const ago = ms => new Date(NOW - ms).toISOString()
const machine = (n, fields = {}) => ({ id: `20000000-0000-0000-0000-00000000000${n}`, code: `M-0${n}`, name: `Machine ${n}`, status: 'ACTIVE', lastSeenAt: ago(10_000), minTemperature: 2, maxTemperature: 8, minHumidity: 0, maxHumidity: 100, createdAt: ago(0), updatedAt: ago(0), ...fields })
const slot = (n, machineId, fields = {}) => ({ id: `30000000-0000-0000-0000-00000000000${n}`, machineId, slotCode: `A${n}`, capacity: 8, status: 'ACTIVE', createdAt: ago(0), updatedAt: ago(0), ...fields })
const box = (slotId, fields = {}) => ({ id: `${slotId}-${Math.random()}`, slotId, status: 'AVAILABLE', expired: false, expiresAt: new Date(NOW + 86_400_000).toISOString(), ...fields })

// ---- links: one click to the right place

test('every row links straight to where it is handled', () => {
  assert.equal(sensorsPath(M2), `/admin/machines/${M2}?tab=sensors`)
  assert.equal(machineDetailPath(M2), `/admin/machines/${M2}`)
  assert.equal(lowStockPath(M1, '30000000-0000-0000-0000-000000000003'), `/admin/inventory?machineId=${M1}&slotId=30000000-0000-0000-0000-000000000003`)
  assert.equal(MAINTENANCE_LIST_PATH, '/admin/machines?status=MAINTENANCE')
  assert.equal(CRITICAL_LIST_PATH, '/admin/alerts?status=OPEN&severity=CRITICAL')
  // A malformed id never builds a broken link.
  assert.equal(sensorsPath('../x'), '/admin/machines')
  assert.equal(machineDetailPath(undefined), '/admin/machines')
  // Each target is a route the app knows, and sensors is a real tab of the machine page.
  for (const path of [sensorsPath(M2), machineDetailPath(M2), lowStockPath(M1, M1), '/admin/alerts/60000000-0000-0000-0000-000000000002']) {
    assert.ok(matchRoute(new URL(path, 'https://x.invalid').pathname), path)
  }
})

// ---- route, nav, landing

test('Tổng quan is the first item of Vận hành and the landing screen for ADMIN and STAFF', () => {
  assert.deepEqual(matchRoute('/admin/overview'), { page: 'overview', id: undefined, permission: 'MACHINE_READ', roles: ['ADMIN', 'STAFF'] })
  assert.equal(NAV[0].to, '/admin/overview')
  assert.equal(NAV[0].group, 'Vận hành')
  assert.equal(NAV[0].label, 'Tổng quan')
  for (const role of ['ADMIN', 'STAFF']) {
    assert.equal(homeFor([role]), '/admin/overview')
    assert.equal(navFor([role])[0].to, '/admin/overview')
    assert.equal(canOpen([role], matchRoute('/admin/overview')), true)
  }
  assert.deepEqual(breadcrumbFor(matchRoute('/admin/overview')), [{ label: 'Vận hành' }, { label: 'Tổng quan', to: undefined }])
  assert.equal(canOpen({ roles: ['STAFF'], permissions: ['ORDER_READ'] }, matchRoute('/admin/overview')), false)
})

// ---- OFFLINE

test('OFFLINE: silent > 180 s and not INACTIVE; longest silence first, never-connected last', () => {
  const machines = [
    machine(1),                                              // online
    machine(2, { lastSeenAt: ago(180_000) }),               // exactly 180 s: still online
    machine(3, { lastSeenAt: ago(181_000) }),               // OFFLINE
    machine(4, { status: 'MAINTENANCE', lastSeenAt: ago(35 * 60_000) }), // OFFLINE in maintenance: listed
    machine(5, { status: 'INACTIVE', lastSeenAt: null }),   // out of service on purpose: not listed
    machine(6, { lastSeenAt: null }),                       // never connected: last
  ]
  const result = offlineMachines(machines, NOW)
  assert.deepEqual(result.map(entry => entry.machine.code), ['M-04', 'M-03', 'M-06'])
  assert.equal(result[2].connection.never, true)
  assert.deepEqual(offlineMachines([machine(1)], NOW), [])
})

// ---- low stock

test('sellable = AVAILABLE and not expired (by flag or by date)', () => {
  const s = 'slot-1'
  const counts = countSellable([
    box(s), box(s, { status: 'RESERVED' }), box(s, { status: 'EXPIRED' }), box(s, { expired: true }),
    box(s, { expiresAt: ago(1) }), box('slot-2'), box(undefined),
  ], NOW)
  assert.equal(counts.get(s), 1)
  assert.equal(counts.get('slot-2'), 1)
})

test(`low stock: ACTIVE slot of an ACTIVE machine with ≤ ${LOW_STOCK_THRESHOLD} sellable box, emptiest first`, () => {
  assert.equal(LOW_STOCK_THRESHOLD, 1)
  const m = machine(1)
  const slots = [slot(1, m.id), slot(2, m.id), slot(3, m.id), slot(4, m.id, { status: 'INACTIVE' }), slot(5, m.id, { status: 'ERROR' }), slot(6, M2)]
  const items = [box(slots[0].id), box(slots[0].id), box(slots[1].id)]
  const low = lowStockSlots(m, slots, items, NOW)
  assert.deepEqual(low.map(entry => [entry.slotCode, entry.sellable]), [['A3', 0], ['A2', 1]])
  assert.deepEqual(low[0], { machineId: m.id, machineCode: 'M-01', machineName: 'Machine 1', slotId: slots[2].id, slotCode: 'A3', capacity: 8, sellable: 0 })
  // A machine in maintenance does not sell: its slots are not "sắp hết hàng".
  assert.deepEqual(lowStockSlots(machine(1, { status: 'MAINTENANCE' }), slots, [], NOW), [])
  assert.equal(lowStockText({ sellable: 0, capacity: 8 }), 'Hết hàng: còn 0/8 hộp sẵn bán')
  assert.equal(lowStockText({ sellable: 1, capacity: 10 }), 'Còn 1/10 hộp sẵn bán')
})

test('low stock across machines: emptiest first, then machine and slot code', () => {
  const row = (machineCode, slotCode, sellable) => ({ machineId: '', machineCode, machineName: '', slotId: `${machineCode}${slotCode}`, slotCode, capacity: 8, sellable })
  assert.deepEqual(sortLowStock([row('M-02', 'A1', 1), row('M-01', 'B1', 0), row('M-01', 'A1', 1), row('M-02', 'A2', 0)]).map(entry => entry.slotId),
    ['M-01B1', 'M-02A2', 'M-01A1', 'M-02A1'])
})

test('per-machine failures: counted when some machines answer, 403/401 or all failing fail the block', () => {
  const ok = slots => ({ status: 'fulfilled', value: { slots, incomplete: false } })
  const failed = reason => ({ status: 'rejected', reason })
  const one = { machineId: '', machineCode: 'M-01', machineName: '', slotId: 's', slotCode: 'A1', capacity: 8, sellable: 0 }
  assert.deepEqual(combineStock([ok([one]), failed(new ApiError(500, 'x'))], 3), { slots: [one], checked: 1, activeTotal: 3, failed: 1, incomplete: false })
  assert.throws(() => combineStock([ok([]), failed(new ApiError(403, 'no'))], 2), error => error.status === 403)
  assert.throws(() => combineStock([failed(new ApiError(500, 'a')), failed(new ApiError(502, 'b'))], 2), error => error.status === 500)
  assert.deepEqual(combineStock([], 0), { slots: [], checked: 0, activeTotal: 0, failed: 0, incomplete: false })
})

test('rows: a few, then all in place; empty states are worded positively', () => {
  assert.equal(OVERVIEW_ROWS, 5)
  assert.equal(OVERVIEW_POLL_MS, 30_000)
  const rows = Array.from({ length: 8 }, (_, index) => index)
  assert.deepEqual(visibleRows(rows, false), [0, 1, 2, 3, 4])
  assert.equal(visibleRows(rows, true).length, 8)
  assert.equal(EMPTY_TEXT.offline.startsWith('Không có máy mất kết nối'), true)
  for (const text of Object.values(EMPTY_TEXT)) assert.match(text, /^Không có /)
})

// ---- loaders against the mock API

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

test('mock: the seed shows one item in every block, each with its one-click target', async () => {
  const state = setup()
  await signIn(state, 'staff')
  const scan = await loadMachineScan()
  assert.equal(scan.incomplete, false)
  assert.equal(typeof scan.at, 'number')
  const offline = offlineMachines(scan.page.content, scan.at)
  assert.deepEqual(offline.map(entry => entry.machine.id), [M2]) // DEV-MACHINE-02, silent 35 min, in maintenance
  const maintenance = await loadMaintenance()
  assert.deepEqual(maintenance.content.map(entry => entry.id), [M2])
  assert.equal(maintenance.totalElements, 1)
  const stock = await loadLowStock()
  // DEV-MACHINE-01 B1 only holds expired mango bowls: 0 sellable. A1 (8) and A2 (6) are fine.
  assert.deepEqual(stock.slots.map(entry => [entry.machineCode, entry.slotCode, entry.sellable]), [['DEV-MACHINE-01', 'B1', 0]])
  assert.equal(stock.checked, 1)
  assert.equal(stock.failed, 0)
  const critical = await loadCritical()
  assert.deepEqual(critical.content.map(alert => [alert.type, alert.severity, alert.status]), [['MACHINE_OFFLINE', 'CRITICAL', 'OPEN']])
})

test('mock: requests are bounded and only send contract parameters', async () => {
  const state = setup()
  await signIn(state, 'admin')
  await loadLowStock()
  const urls = state.calls.map(call => new URL(call, 'https://x.invalid'))
  // 1 machine list + (slots + boxes) for the single ACTIVE machine.
  assert.equal(urls.length, 3)
  const machines = urls.find(url => url.pathname.endsWith('/machines'))
  assert.equal(machines.searchParams.get('status'), 'ACTIVE')
  const boxes = urls.find(url => url.pathname.endsWith('/inventory'))
  assert.deepEqual([...boxes.searchParams.keys()].sort(), ['expired', 'machineId', 'page', 'size', 'sort', 'status'])
  assert.equal(boxes.searchParams.get('status'), 'AVAILABLE')
  assert.equal(boxes.searchParams.get('expired'), 'false')
  const slots = urls.find(url => url.pathname.endsWith('/slots'))
  assert.equal(slots.searchParams.get('status'), 'ACTIVE')
  assert.deepEqual(CRITICAL_QUERY, { status: 'OPEN', severity: 'CRITICAL', page: 0, size: OVERVIEW_ROWS, sort: 'triggeredAt,desc' })
})

test('mock: a 403 on inventory fails the low-stock block instead of reporting an empty list', async () => {
  const state = setup()
  await signIn(state, 'staff')
  state.search = '?scenario=403:inventory'
  await assert.rejects(loadLowStock(), error => error instanceof ApiError && error.status === 403)
  state.search = '?scenario=missing:alerts'
  await assert.rejects(loadCritical(), error => error instanceof ApiError && error.status === 404)
  state.search = '?scenario=none'
})
