// O1 Tổng quan (FE 6.5 + 9.2) on GET /dashboard/overview of backend #76: which machines are listed, the counts and their
// one-click targets, the route (DASHBOARD_READ), money only for REPORT_SALES_READ, and the mock dashboard (one request,
// health-check predicates, STAFF without today/refunds, failures and the empty scenario).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, dashboardApi, rolesApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS, SEED_ROLE_IDS, SEED_STAFF_PERMISSIONS } from '../src/api/mock/seed.ts'
import {
  CRITICAL_LIST_PATH, CRITICAL_QUERY, EMPTY_TEXT, MAINTENANCE_LIST_PATH, OVERDUE_TICKETS_PATH, OVERVIEW_POLL_MS, OVERVIEW_ROWS, alertRows, inventoryPath, loadCritical,
  loadDashboard, machineDetailPath, machineFacts, machineSummary, maintenanceMachines, offlineMachines, sensorsPath, stockRows, temperatureText, versusYesterday,
  visibleRows, workOrderRows,
} from '../src/admin/overview.ts'
import { NAV, breadcrumbFor, canOpen, homeFor, matchRoute, navFor } from '../src/admin/routes.ts'
import { can } from '../src/admin/permissions.ts'

const M1 = '20000000-0000-0000-0000-000000000001'
const M2 = '20000000-0000-0000-0000-000000000002'
const NOW = Date.parse('2026-11-30T03:00:00Z')
const ago = ms => new Date(NOW - ms).toISOString()
const machine = (n, fields = {}) => ({ machineId: `20000000-0000-0000-0000-00000000000${n}`, code: `M-0${n}`, name: `Machine ${n}`, status: 'ACTIVE', connectivity: 'ONLINE', lastSeenAt: ago(10_000), sellableBowls: 5, openAlerts: 0, ...fields })

// ---- links: one click to the right place

test('every row links straight to where it is handled, and every target is a known route', () => {
  assert.equal(sensorsPath(M2), `/admin/machines/${M2}?tab=sensors`)
  assert.equal(machineDetailPath(M2), `/admin/machines/${M2}`)
  assert.equal(inventoryPath(M1), `/admin/inventory?machineId=${M1}`)
  assert.equal(inventoryPath(), '/admin/inventory')
  assert.equal(MAINTENANCE_LIST_PATH, '/admin/machines?status=MAINTENANCE')
  assert.equal(CRITICAL_LIST_PATH, '/admin/alerts?status=OPEN&severity=CRITICAL')
  assert.equal(OVERDUE_TICKETS_PATH, '/admin/tickets?overdue=true')
  // A malformed id never builds a broken link.
  assert.equal(sensorsPath('../x'), '/admin/machines')
  assert.equal(machineDetailPath(undefined), '/admin/machines')
  const targets = [sensorsPath(M2), machineDetailPath(M2), inventoryPath(M1), CRITICAL_LIST_PATH,
    ...stockRows({}).map(row => row.to), ...alertRows({}).map(row => row.to), ...workOrderRows({}).map(row => row.to)]
  for (const path of targets) assert.ok(matchRoute(new URL(path, 'https://x.invalid').pathname), path)
})

// ---- route, nav, landing

test('Tổng quan needs DASHBOARD_READ: first item of Vận hành and the landing screen for ADMIN and STAFF', () => {
  assert.deepEqual(matchRoute('/admin/overview'), { page: 'overview', id: undefined, permission: 'DASHBOARD_READ', roles: ['ADMIN', 'STAFF'] })
  assert.equal(NAV[0].to, '/admin/overview')
  assert.equal(NAV[0].group, 'Vận hành')
  assert.equal(NAV[0].label, 'Tổng quan')
  assert.equal(NAV[0].permission, 'DASHBOARD_READ')
  for (const role of ['ADMIN', 'STAFF']) {
    assert.equal(homeFor([role]), '/admin/overview')
    assert.equal(navFor([role])[0].to, '/admin/overview')
    assert.equal(canOpen([role], matchRoute('/admin/overview')), true)
  }
  assert.deepEqual(breadcrumbFor(matchRoute('/admin/overview')), [{ label: 'Vận hành' }, { label: 'Tổng quan', to: undefined }])
  // MACHINE_READ alone no longer opens it: the dashboard endpoint is DASHBOARD_READ.
  assert.equal(canOpen({ roles: ['STAFF'], permissions: ['MACHINE_READ'] }, matchRoute('/admin/overview')), false)
  assert.equal(homeFor({ roles: ['STAFF'], permissions: ['MACHINE_READ'] }), '/admin/machines')
  assert.equal(can(['STAFF'], 'REPORT_SALES_READ'), false, 'STAFF never sees the revenue block')
})

// ---- machines (machinesDetail)

test('OFFLINE: by the server connectivity or the 180 s rule, not INACTIVE; longest silence first, never-connected last', () => {
  const machines = [
    machine(1),                                                                 // online
    machine(2, { lastSeenAt: ago(180_000) }),                                   // exactly 180 s: still online
    machine(3, { lastSeenAt: ago(181_000) }),                                   // OFFLINE by time (dashboard polled 30 s ago)
    machine(4, { status: 'MAINTENANCE', connectivity: 'OFFLINE', lastSeenAt: ago(35 * 60_000) }), // OFFLINE in maintenance: listed
    machine(5, { status: 'INACTIVE', connectivity: 'NEVER_SEEN', lastSeenAt: undefined }),      // out of service on purpose
    machine(6, { connectivity: 'NEVER_SEEN', lastSeenAt: undefined }),          // never connected: last
    machine(7, { connectivity: 'OFFLINE', lastSeenAt: ago(20_000) }),           // Last Will: the server says OFFLINE
  ]
  const result = offlineMachines(machines, NOW)
  assert.deepEqual(result.map(entry => entry.machine.code), ['M-04', 'M-03', 'M-07', 'M-06'])
  assert.equal(result.at(-1).connection.never, true)
  assert.equal(result[2].connection.lastWill, true)
  assert.deepEqual(offlineMachines([machine(1)], NOW), [])
})

test('maintenance machines by code; machine facts: sellable bowls, temperature, open alerts', () => {
  const list = maintenanceMachines([machine(3, { status: 'MAINTENANCE' }), machine(1), machine(2, { status: 'MAINTENANCE' })])
  assert.deepEqual(list.map(entry => entry.code), ['M-02', 'M-03'])
  assert.equal(temperatureText(5.25), '5,3 °C')
  assert.equal(temperatureText(4), '4 °C')
  assert.equal(temperatureText(undefined), 'Chưa có số đo')
  assert.equal(machineFacts({ sellableBowls: 14, temperature: 4, openAlerts: 3 }), '14 hộp sẵn bán · 4 °C · 3 cảnh báo chưa xử lý')
  assert.equal(machineFacts({ sellableBowls: 0 }), '0 hộp sẵn bán · Chưa có số đo')
})

test('machine summary reads every status and connectivity count of the dashboard', () => {
  const text = machineSummary({ total: 3, active: 1, maintenance: 1, inactive: 1, online: 1, warning: 0, offline: 1, neverSeen: 1 })
  assert.equal(text.status, '3 máy: 1 đang bán, 1 bảo trì, 1 ngừng hoạt động')
  assert.equal(text.connectivity, '1 trực tuyến, 0 chậm tín hiệu, 1 mất kết nối, 1 chưa từng kết nối')
  assert.equal(machineSummary(undefined).status, '0 máy: 0 đang bán, 0 bảo trì, 0 ngừng hoạt động')
})

// ---- counts

test('stock, alert and work-order counts: the dashboard figures, red only where someone must act', () => {
  assert.deepEqual(stockRows({ lowStockSlots: 3, blockedSlots: 1, bowlsExpiringToday: 0 }).map(row => [row.key, row.value, row.tone]),
    [['lowStockSlots', 3, 'warning'], ['blockedSlots', 1, 'danger'], ['bowlsExpiringToday', 0, 'neutral']])
  assert.deepEqual(alertRows({ open: 5, critical: 2, warning: 2, info: 1 }).map(row => [row.key, row.value, row.tone]),
    [['critical', 2, 'danger'], ['warning', 2, 'warning'], ['info', 1, 'neutral']])
  assert.equal(alertRows({}).find(row => row.key === 'critical').to, '/admin/alerts?severity=CRITICAL')
  const tickets = workOrderRows({ open: 3, inProgress: 2, overdue: 2, assignedToMe: 0 })
  assert.deepEqual(tickets.map(row => [row.key, row.value, row.tone]), [['overdue', 2, 'danger'], ['open', 3, 'neutral'], ['inProgress', 2, 'neutral'], ['assignedToMe', 0, 'neutral']])
  assert.equal(tickets[0].to, OVERDUE_TICKETS_PATH)
  assert.equal(tickets[2].to, '/admin/tickets?status=IN_PROGRESS')
})

test('today versus yesterday, in VND', () => {
  assert.match(versusYesterday({ netSales: 120000, yesterdayNetSales: 70000 }), /^\+50\.000\s₫ so với hôm qua \(70\.000\s₫\)$/)
  assert.match(versusYesterday({ netSales: 0, yesterdayNetSales: 35000 }), /^−35\.000\s₫ so với hôm qua/)
  assert.equal(versusYesterday({ netSales: 35000, yesterdayNetSales: 35000 }), 'bằng hôm qua')
  assert.equal(versusYesterday(undefined), undefined, 'STAFF: no today block')
})

test('rows: a few, then all in place; empty states are worded positively; 30 s poll; alerts list has no sort', () => {
  assert.equal(OVERVIEW_ROWS, 5)
  assert.equal(OVERVIEW_POLL_MS, 30_000)
  const rows = Array.from({ length: 8 }, (_, index) => index)
  assert.deepEqual(visibleRows(rows, false), [0, 1, 2, 3, 4])
  assert.equal(visibleRows(rows, true).length, 8)
  for (const text of Object.values(EMPTY_TEXT)) assert.match(text, /^Không có /)
  assert.deepEqual(CRITICAL_QUERY, { status: 'OPEN', severity: 'CRITICAL', page: 0, size: OVERVIEW_ROWS }, 'GET /alerts has no sort parameter')
})

// ---- the mock dashboard

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

test('mock: one request answers every block; the seed has the cases each block shows', async () => {
  const state = setup()
  await signIn(state, 'staff')
  const { dashboard, at } = await loadDashboard()
  assert.equal(state.calls.length, 1)
  assert.equal(new URL(state.calls[0], 'https://x.invalid').pathname, '/api/v1/dashboard/overview')
  assert.equal(new URL(state.calls[0], 'https://x.invalid').search, '', 'no parameter')
  assert.equal(typeof at, 'number')
  assert.deepEqual(dashboard.machines, { total: 3, active: 1, maintenance: 1, inactive: 1, online: 1, warning: 0, offline: 1, neverSeen: 1 })
  const details = dashboard.machinesDetail
  assert.deepEqual(details.map(row => row.code), ['DEV-MACHINE-01', 'DEV-MACHINE-02', 'DEV-MACHINE-03'])
  // DEV-MACHINE-02 is silent for 35 min and in maintenance; DEV-MACHINE-03 is INACTIVE and never seen (not listed).
  assert.deepEqual(offlineMachines(details, at).map(entry => entry.machine.machineId), [M2])
  assert.deepEqual(maintenanceMachines(details).map(entry => entry.machineId), [M2])
  assert.ok(details[0].sellableBowls > 0)
  assert.equal(details[1].sellableBowls, 0, 'a machine in maintenance sells nothing')
  assert.equal(details[2].temperature, undefined, 'never sent a reading')
  assert.equal(dashboard.alerts.open, dashboard.alerts.critical + dashboard.alerts.warning + dashboard.alerts.info)
  assert.ok(dashboard.alerts.critical >= 1)
  assert.equal(details.reduce((sum, row) => sum + row.openAlerts, 0), dashboard.alerts.open)
  assert.ok(dashboard.stock.lowStockSlots >= 1, 'DEV-MACHINE-01 B1 only holds expired bowls')
  assert.ok(dashboard.stock.blockedSlots >= 1, 'the failed head bowl of DEV-MACHINE-02')
  assert.ok(dashboard.workOrders.assignedToMe > 0, 'staff has work orders assigned')
  const critical = await loadCritical()
  assert.deepEqual(critical.content.map(alert => [alert.type, alert.severity, alert.status]), [['MACHINE_OFFLINE', 'CRITICAL', 'OPEN']])
})

test('mock: today and refunds only with REPORT_SALES_READ (absent for STAFF, not zero)', async () => {
  const state = setup()
  await signIn(state, 'staff')
  const staff = await dashboardApi.overview()
  assert.equal('today' in staff, false)
  assert.equal('refunds' in staff, false)
  await signIn(state, 'admin')
  const admin = await dashboardApi.overview()
  assert.equal(typeof admin.today.netSales, 'number')
  assert.equal(typeof admin.today.yesterdayNetSales, 'number')
  assert.match(admin.today.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(admin.refunds.pendingCount > 0 && admin.refunds.pendingAmount > 0)
  assert.equal(admin.workOrders.assignedToMe, 0, 'assigned to the caller, not to anyone')
  // A permission change applies to the next call (backend #48 style): STAFF given REPORT_SALES_READ now gets money.
  await rolesApi.replacePermissions(SEED_ROLE_IDS.STAFF, { permissions: [...SEED_STAFF_PERMISSIONS, 'REPORT_SALES_READ'] })
  await signIn(state, 'staff')
  assert.equal(typeof (await dashboardApi.overview()).today.netSales, 'number')
})

test('mock: DASHBOARD_READ is required; failures and the empty scenario are per request', async () => {
  const state = setup()
  await signIn(state, 'admin')
  await rolesApi.replacePermissions(SEED_ROLE_IDS.STAFF, { permissions: SEED_STAFF_PERMISSIONS.filter(code => code !== 'DASHBOARD_READ') })
  await signIn(state, 'staff')
  await assert.rejects(loadDashboard(), error => error instanceof ApiError && error.status === 403)
  await signIn(state, 'admin')
  state.search = '?scenario=error500:dashboard'
  await assert.rejects(loadDashboard(), error => error instanceof ApiError && error.status === 500)
  state.search = '?scenario=empty'
  const empty = (await loadDashboard()).dashboard
  assert.deepEqual(empty.machinesDetail, [])
  assert.equal(empty.alerts.critical, 0)
  assert.equal(empty.stock.lowStockSlots, 0)
  assert.equal(empty.today.netSales, 0)
  assert.match(empty.today.date, /^\d{4}-\d{2}-\d{2}$/, 'the date stays')
  state.search = '?scenario=missing:alerts'
  await assert.rejects(loadCritical(), error => error instanceof ApiError && error.status === 404)
  assert.equal((await loadDashboard()).dashboard.machines.total, 3, 'the dashboard still loads')
  state.search = '?scenario=none'
  assert.equal(groupOf('/dashboard/overview'), 'dashboard')
  assert.equal(groupOf('/reports/sales/summary'), 'reports')
})
