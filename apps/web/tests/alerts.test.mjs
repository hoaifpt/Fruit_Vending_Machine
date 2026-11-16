// FE 6.3 Cảnh báo & chuông thông báo: pure rules (filters, who handled, 409 text, bell, work order from an alert), the
// bell's polling with fake timers against the mock API (a new alert shows within one poll), and the mock of the real
// API (api-contract/api.yaml, backend #58): GET /alerts without sort, default OPEN + ACKNOWLEDGED, acknowledge/resolve,
// POST /alerts/{alertId}/work-orders.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { alertsApi, authApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  ALERTS_MISSING, ALERT_DEFAULT_STATUS_LABEL, ALERT_NOT_FOUND, ALERT_SEVERITIES, ALERT_STATUSES, ALERT_TYPES, ALERT_TYPE_HINTS, ALERT_TYPE_LABELS, BELL_CRITICAL_QUERY,
  BELL_POLL_MS, BELL_QUERY, BELL_SIZE, NEW_ALERT_WORK_ORDER, TICKETS_AVAILABLE,
  actorText, alertActionError, alertListQuery, alertPath, alertRangeInvalid, alertWorkOrderBody, alertsAvailability, badgeText, bellAnnouncement, bellLabel,
  canAcknowledge, canResolve, detailFailure, freshAlerts, handledByLines, handlingSteps, machinePath, readAlertFilters, resolveBody, resolutionNoteText,
  validateAlertWorkOrder, workOrderDefaults, workOrderError, workOrderPath,
} from '../src/admin/alerts.ts'
import { createAlertBell, notifyAlertsChanged, onAlertsChanged } from '../src/admin/alert-bell.ts'
import { PERMISSIONS, can, permissionsOf } from '../src/admin/permissions.ts'
import { NAV, canOpen, matchRoute, navFor } from '../src/admin/routes.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const MACHINE_1 = '20000000-0000-0000-0000-000000000001'
const SEEDED = '60000000-0000-0000-0000-000000000001'
const alertId = n => `60000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const STAFF_ID = '11000000-0000-0000-0000-000000000002'

/** Constant names of a backend alert enum, comments stripped (AlertType documents HARDWARE_FAULT with a Javadoc). */
function javaEnum(name) {
  const body = readFileSync(`${root}backend/src/main/java/com/fruitmachine/backend/alert/enums/${name}.java`, 'utf8').match(new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`))
  return body[1].replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '').split(';')[0].split(',').map(item => item.trim()).filter(Boolean)
}

/** Real client wired to a fresh mock. */
function setup(overrides = {}) {
  const state = { token: null, clock: Date.parse('2026-11-30T03:00:00Z'), search: '' }
  const fetcher = createMockFetcher(parseSelection('all'), { now: () => state.clock, getSearch: () => state.search, ...overrides })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return { state, fetcher }
}
async function signIn(state, account) {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
async function rejects(promise, status, check = () => true) {
  await assert.rejects(promise, error => error instanceof ApiError && error.status === status && check(error))
}

// ---- names follow the backend

test('types, severities and statuses are the backend enums AlertType (with HARDWARE_FAULT), AlertSeverity, AlertStatus', () => {
  assert.deepEqual([...ALERT_TYPES], javaEnum('AlertType'))
  assert.ok(ALERT_TYPES.includes('HARDWARE_FAULT'))
  assert.deepEqual([...ALERT_SEVERITIES], javaEnum('AlertSeverity'))
  assert.deepEqual([...ALERT_STATUSES], javaEnum('AlertStatus'))
  for (const type of ALERT_TYPES) { assert.ok(ALERT_TYPE_LABELS[type], type); assert.ok(ALERT_TYPE_HINTS[type], type) }
  assert.equal(ALERT_TYPE_LABELS.HARDWARE_FAULT, 'Lỗi phần cứng')
})
test('the web calls the alert paths of api.yaml, never a draft', () => {
  const yaml = readFileSync(`${root}api-contract/api.yaml`, 'utf8')
  for (const path of ['"/api/v1/alerts":', '"/api/v1/alerts/{id}":', '"/api/v1/alerts/{id}/acknowledge":', '"/api/v1/alerts/{id}/resolve":', '"/api/v1/alerts/{alertId}/work-orders":']) assert.ok(yaml.includes(path), path)
  const resources = readFileSync(`${root}apps/web/src/api/resources.ts`, 'utf8')
  assert.doesNotMatch(resources, /drafts\/alerts/)
  assert.match(resources, /\/alerts\/\$\{id\(alertId\)\}\/work-orders/)
})

// ---- permissions

test('ALERT_READ / ALERT_MANAGE (V17): both roles hold them; opening a work order needs WORK_ORDER_MANAGE (admin only)', () => {
  assert.ok(PERMISSIONS.includes('ALERT_READ') && PERMISSIONS.includes('ALERT_MANAGE'))
  for (const role of ['ADMIN', 'STAFF']) {
    assert.equal(can([role], 'ALERT_READ'), true, role)
    assert.equal(can([role], 'ALERT_MANAGE'), true, role)
  }
  assert.equal(can(['ADMIN'], 'WORK_ORDER_MANAGE'), true)
  assert.equal(can(['STAFF'], 'WORK_ORDER_MANAGE'), false)
  // An account without the alert codes sees neither the screen nor the bell.
  const subject = { roles: ['ADMIN'], permissions: ['MACHINE_READ', 'ORDER_READ'] }
  assert.equal(can(subject, 'ALERT_READ'), false)
  assert.equal(navFor(subject).some(item => item.to === '/admin/alerts'), false)
  assert.equal(canOpen(subject, matchRoute('/admin/alerts')), false)
  assert.deepEqual([...permissionsOf({ roles: ['STAFF'], permissions: ['ALERT_READ'] })], ['ALERT_READ'])
})
test('routes: list and detail need ALERT_READ; the nav item sits in "Vận hành"', () => {
  assert.deepEqual(matchRoute('/admin/alerts'), { page: 'alerts', id: undefined, permission: 'ALERT_READ', roles: ['ADMIN', 'STAFF'] })
  assert.equal(matchRoute(`/admin/alerts/${SEEDED}`).page, 'alert-detail')
  assert.equal(matchRoute(`/admin/alerts/${SEEDED}`).id, SEEDED)
  const item = NAV.find(entry => entry.to === '/admin/alerts')
  assert.equal(item.group, 'Vận hành')
  assert.deepEqual(item.match, ['alerts', 'alert-detail'])
})

// ---- list filters

test('URL filters keep only values the contract accepts; the query sends from/to, one status at most, never sort', () => {
  const filters = readAlertFilters(new URLSearchParams(`status=OPEN&severity=LOUD&type=HARDWARE_FAULT&machineId=nope&from=2026-11-30&to=bad&sort=severity,asc&page=2&x=1`))
  assert.deepEqual(filters, { status: 'OPEN', severity: '', type: 'HARDWARE_FAULT', machineId: '', from: '2026-11-30', to: '', page: 2 })
  assert.deepEqual(alertListQuery(filters, 20), {
    page: 2, size: 20, status: 'OPEN', severity: undefined, type: 'HARDWARE_FAULT', machineId: undefined, from: '2026-11-29T17:00:00.000Z', to: undefined,
  })
  assert.equal('sort' in alertListQuery(filters, 20), false, 'GET /alerts has no sort parameter')
  assert.equal(readAlertFilters(new URLSearchParams(`machineId=${MACHINE_1}`)).machineId, MACHINE_1)
  // No status: the backend default (OPEN + ACKNOWLEDGED), so nothing is sent.
  const open = alertListQuery(readAlertFilters(new URLSearchParams('')), 20)
  assert.equal(open.status, undefined)
  assert.match(ALERT_DEFAULT_STATUS_LABEL, /Chưa đóng/)
  assert.equal(readAlertFilters(new URLSearchParams('status=ALL')).status, '', 'there is no "all statuses" value')
})
test('dates: "Đến ngày" includes that day (to = next midnight, exclusive); an end before the start is not sent', () => {
  const both = readAlertFilters(new URLSearchParams('from=2026-11-29&to=2026-11-30'))
  assert.deepEqual([alertListQuery(both, 20).from, alertListQuery(both, 20).to], ['2026-11-28T17:00:00.000Z', '2026-11-30T17:00:00.000Z'])
  const reversed = readAlertFilters(new URLSearchParams('from=2026-11-30&to=2026-11-29'))
  assert.equal(alertRangeInvalid(reversed), true)
  assert.equal(alertListQuery(reversed, 20).to, undefined, 'the backend would answer 400 (to must be after from)')
  assert.equal(alertRangeInvalid(both), false)
})
test('links: detail by id, machine only for a UUID, work order on the ticket screens', () => {
  assert.equal(alertPath(SEEDED), `/admin/alerts/${SEEDED}`)
  assert.equal(machinePath(MACHINE_1), `/admin/machines/${MACHINE_1}`)
  assert.equal(machinePath('x'), '')
  assert.equal(workOrderPath('62000000-0000-0000-0000-000000000001'), '/admin/tickets/62000000-0000-0000-0000-000000000001')
  assert.equal(workOrderPath(null), '')
  assert.equal(workOrderPath('WO-1'), '')
})

// ---- availability, actions, who handled it

test('availability: 404/405/501 mean the alerts path is missing; 401/403 stop; the rest is an ordinary failure', () => {
  assert.equal(alertsAvailability(new ApiError(404, 'x')), 'missing')
  assert.equal(alertsAvailability(new ApiError(405, 'x')), 'missing')
  assert.equal(alertsAvailability(new ApiError(501, 'x')), 'missing')
  assert.equal(alertsAvailability(new ApiError(403, 'x')), 'forbidden')
  assert.equal(alertsAvailability(new ApiError(401, 'x')), 'unauthorized')
  assert.equal(alertsAvailability(new ApiError(500, 'x')), 'error')
  assert.equal(alertsAvailability(new TypeError('Failed to fetch')), 'error')
})
test('actions follow the status: acknowledge only OPEN, close OPEN or ACKNOWLEDGED, never delete', () => {
  assert.deepEqual(ALERT_STATUSES.map(status => [canAcknowledge({ status }), canResolve({ status })]), [[true, true], [false, true], [false, false]])
  assert.deepEqual(resolveBody('   '), {})
  assert.deepEqual(resolveBody('  Đã rút hộp  '), { note: 'Đã rút hộp' })
  assert.equal(TICKETS_AVAILABLE, true)
})
test('detail 404: "chưa có chức năng" only when the list is missing too; otherwise the neutral "không tìm thấy"', () => {
  assert.equal(detailFailure(new ApiError(404, 'x')), 'missing')
  assert.equal(detailFailure(new ApiError(501, 'x')), 'missing')
  assert.equal(detailFailure(undefined), 'not-found', 'list answered: the id is unknown')
  assert.equal(detailFailure(new ApiError(500, 'x')), 'not-found', 'unsure: neutral wording')
  assert.equal(detailFailure(new TypeError('Failed to fetch')), 'not-found')
  assert.doesNotMatch(ALERT_NOT_FOUND, /máy chủ chưa/)
  assert.match(ALERTS_MISSING, /máy chủ chưa cung cấp/)
})
test('a 409 (alert already resolved) becomes a Vietnamese explanation with the next step; other errors are kept', () => {
  const ack = alertActionError(new ApiError(409, 'Alert is already resolved'), 'acknowledge')
  assert.equal(ack.status, 409)
  assert.match(ack.message, /vừa được đóng/)
  assert.match(ack.message, /tải lại/)
  assert.match(alertActionError(new ApiError(409, 'Alert is already resolved'), 'resolve').message, /đã được đóng trước đó/)
  for (const action of ['acknowledge', 'resolve']) {
    const text = alertActionError(new ApiError(409, 'x'), action, 'detail').message
    assert.match(text, /Trang đã được tải lại; xem người (xử lý|đã đóng) ở mục Xử lý./)
    assert.doesNotMatch(text, /Danh sách|cột/)
  }
  const other = new ApiError(500, 'Hệ thống đang gặp sự cố.')
  assert.equal(alertActionError(other, 'resolve'), other)
})
test('who acknowledged and who closed: emails as sent, "system" and "Condition cleared" in Vietnamese, Vietnam time', () => {
  const alert = {
    id: SEEDED, status: 'RESOLVED', triggeredAt: '2026-11-30T05:00:00Z',
    acknowledgedAt: '2026-11-30T06:05:00Z', acknowledgedBy: 'staff@freshvend.test',
    resolvedAt: '2026-11-30T07:10:00Z', resolvedBy: 'system', resolutionNote: 'Condition cleared',
  }
  assert.deepEqual(handlingSteps(alert), [
    { key: 'triggered', label: 'Phát sinh', at: '30/11/2026 12:00' },
    { key: 'acknowledged', label: 'Xác nhận', at: '30/11/2026 13:05', by: 'staff@freshvend.test' },
    { key: 'resolved', label: 'Đóng', at: '30/11/2026 14:10', by: 'Hệ thống (tự đóng khi sự cố hết)', note: 'Điều kiện gây cảnh báo đã hết.' },
  ])
  assert.deepEqual(handledByLines(alert), ['Xác nhận: staff@freshvend.test, 30/11/2026 13:05', 'Đóng: Hệ thống (tự đóng khi sự cố hết), 30/11/2026 14:10'])
  assert.deepEqual(handledByLines({ ...alert, status: 'OPEN', acknowledgedAt: null, resolvedAt: null }), [])
  assert.equal(actorText(null), 'Không rõ người thực hiện')
  assert.equal(resolutionNoteText('  Đã rút hộp  '), 'Đã rút hộp')
  assert.equal(resolutionNoteText(''), undefined)
})

// ---- work order from an alert (POST /alerts/{alertId}/work-orders)

test('work order form: only the fields filled in are sent; defaults follow the backend (type by alert, priority by severity)', () => {
  assert.deepEqual(alertWorkOrderBody(NEW_ALERT_WORK_ORDER), {}, 'body optional: the backend fills everything from the alert')
  assert.deepEqual(alertWorkOrderBody({ type: 'MAINTENANCE', title: '  Kiểm tra cửa  ', description: ' ', priority: 'HIGH', assigneeId: STAFF_ID, dueAt: '2026-12-04T11:00' }),
    { type: 'MAINTENANCE', priority: 'HIGH', title: 'Kiểm tra cửa', dueAt: '2026-12-04T04:00:00.000Z', assigneeId: STAFF_ID })
  assert.deepEqual(alertWorkOrderBody({ ...NEW_ALERT_WORK_ORDER, type: 'OTHER', priority: 'P1', assigneeId: 'x' }), {}, 'unknown values never reach the API')
  assert.deepEqual(workOrderDefaults({ type: 'LOW_STOCK', severity: 'INFO' }), { type: 'RESTOCK', priority: 'NORMAL' })
  assert.deepEqual(workOrderDefaults({ type: 'HARDWARE_FAULT', severity: 'CRITICAL' }), { type: 'MAINTENANCE', priority: 'URGENT' })
  assert.deepEqual(workOrderDefaults({ type: 'HIGH_TEMPERATURE', severity: 'WARNING' }), { type: 'MAINTENANCE', priority: 'HIGH' })
  const now = Date.parse('2026-12-04T03:00:00Z')
  assert.deepEqual(validateAlertWorkOrder({ ...NEW_ALERT_WORK_ORDER, title: 'x'.repeat(201), dueAt: '2026-12-04T09:00' }, now), { title: 'Tối đa 200 ký tự.', dueAt: 'Thời hạn phải ở tương lai.' })
  assert.deepEqual(validateAlertWorkOrder(NEW_ALERT_WORK_ORDER, now), {})
})
test('work order 409s in Vietnamese: ALERT_ALREADY_HANDLED names the work order, ALERT_RESOLVED says it is closed', () => {
  const handled = workOrderError(new ApiError(409, 'ALERT_ALREADY_HANDLED: the alert is handled by work order WO-20261130-AB12 (62000000-0000-0000-0000-000000000001)'))
  assert.match(handled.message, /đã có phiếu công việc WO-20261130-AB12 chưa hoàn tất/)
  assert.match(workOrderError(new ApiError(409, 'ALERT_RESOLVED: the alert is already resolved')).message, /đã được đóng/)
  const other = new ApiError(400, 'x')
  assert.equal(workOrderError(other), other)
})

// ---- bell (pure)

test('bell: nothing is new on the first load; later only unseen ids; polite text names the newest new alert', () => {
  const a = { id: 'a', type: 'HIGH_TEMPERATURE', machineCode: 'DEV-MACHINE-01', triggeredAt: '2026-11-30T05:00:00Z' }
  const b = { id: 'b', type: 'MACHINE_OFFLINE', machineCode: 'DEV-MACHINE-02', triggeredAt: '2026-11-30T06:00:00Z' }
  assert.deepEqual(freshAlerts(null, [a, b]), [])
  assert.deepEqual(freshAlerts(new Set(['a']), [b, a]), [b])
  assert.equal(bellAnnouncement([], false), '')
  assert.equal(bellAnnouncement([b], false), 'Cảnh báo mới: Máy mất kết nối tại máy DEV-MACHINE-02.')
  // The list comes CRITICAL first: the newest one is named, whatever its position.
  assert.equal(bellAnnouncement([a, b], false), 'Có 2 cảnh báo mới. Mới nhất: Máy mất kết nối tại máy DEV-MACHINE-02.')
  assert.match(bellAnnouncement(Array.from({ length: BELL_SIZE }, (_, i) => ({ ...a, id: String(i) })), true), /^Có ít nhất 5 cảnh báo mới/)
  assert.equal(badgeText(7), '7')
  assert.equal(badgeText(120), '99+')
  assert.equal(bellLabel(undefined), 'Cảnh báo')
  assert.equal(bellLabel(0), 'Cảnh báo: không có cảnh báo đang mở')
  assert.equal(bellLabel(3), 'Cảnh báo: 3 đang mở')
  assert.equal(bellLabel(3, 1), 'Cảnh báo: 3 đang mở, 1 nghiêm trọng')
  assert.equal(BELL_POLL_MS, 30_000)
  assert.deepEqual(BELL_QUERY, { status: 'OPEN', page: 0, size: 5 }, 'GET /alerts?status=OPEN&size=5, no sort')
  assert.deepEqual(BELL_CRITICAL_QUERY, { status: 'OPEN', severity: 'CRITICAL', page: 0, size: 1 })
})

// ---- bell polling with fake timers

function bellHarness(load, { hidden = false } = {}) {
  const timers = new Map()
  let nextId = 1
  let isHidden = hidden
  const listeners = new Set()
  const snapshots = []
  const bell = createAlertBell({
    load, intervalMs: BELL_POLL_MS, onChange: snapshot => snapshots.push(snapshot),
    visibility: { hidden: () => isHidden, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } },
    setTimer: (callback, ms) => { const id = nextId++; timers.set(id, { callback, ms }); return id },
    clearTimer: id => { timers.delete(id) },
  })
  const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve)) }
  return {
    bell, timers, snapshots, flush,
    get last() { return snapshots.at(-1) },
    /** One poll interval passes: the scheduled timer fires and the load settles. */
    async tick() { const [id, timer] = [...timers][0]; assert.equal(timer.ms, BELL_POLL_MS); timers.delete(id); timer.callback(); await flush() },
    setHidden(value) { isHidden = value; listeners.forEach(listener => listener()) },
  }
}

test('acceptance: a new alert raised between two polls is on the bell after exactly one poll interval', async () => {
  const { state, fetcher } = setup()
  await signIn(state, 'staff')
  const calls = []
  const load = async signal => {
    calls.push(state.clock)
    const [page, critical] = await Promise.all([alertsApi.list(BELL_QUERY, signal), alertsApi.list(BELL_CRITICAL_QUERY, signal)])
    return { page, criticalCount: critical.totalElements }
  }
  const h = bellHarness(load)
  h.bell.start()
  await h.flush()
  assert.equal(h.last.status, 'ready')
  assert.equal(h.last.openCount, 3, 'seed: 3 OPEN alerts')
  assert.equal(h.last.criticalCount, 1, 'seed: 1 OPEN CRITICAL alert')
  assert.equal(h.last.announcement, '', 'nothing announced on the first load')
  assert.equal(h.timers.size, 1)
  const logged = fetcher.control.requests('/alerts')
  assert.ok(logged.every(entry => entry.method === 'GET'))

  const raised = fetcher.control.raiseAlert({ type: 'MACHINE_OFFLINE', severity: 'CRITICAL', machineId: MACHINE_1, title: 'Máy mất kết nối' })
  state.clock += BELL_POLL_MS
  await h.tick()
  assert.equal(calls.length, 2, 'one poll (list + critical count) per interval')
  assert.equal(h.last.openCount, 4)
  assert.equal(h.last.criticalCount, 2)
  assert.equal(h.last.latest[0].id, raised.id, 'CRITICAL first, newest first within it')
  assert.deepEqual(h.last.fresh, [raised.id])
  assert.equal(h.last.announcement, 'Cảnh báo mới: Máy mất kết nối tại máy DEV-MACHINE-01.')
  assert.equal(h.last.announcementSeq, 1)

  state.clock += BELL_POLL_MS
  await h.tick()
  assert.deepEqual(h.last.fresh, [])
  assert.equal(h.last.announcementSeq, 1, 'nothing new: no announcement')
  fetcher.control.raiseAlert({ type: 'MACHINE_OFFLINE', severity: 'CRITICAL', machineId: MACHINE_1, title: 'Máy mất kết nối' })
  state.clock += BELL_POLL_MS
  await h.tick()
  assert.equal(h.last.announcement, 'Cảnh báo mới: Máy mất kết nối tại máy DEV-MACHINE-01.')
  assert.equal(h.last.announcementSeq, 2)
  h.bell.dispose()
})
test('bell: after acknowledging on a screen the count follows at once (refresh), not at the next poll', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const h = bellHarness(async signal => ({ page: await alertsApi.list(BELL_QUERY, signal) }))
  h.bell.start()
  await h.flush()
  const stop = onAlertsChanged(() => h.bell.refresh())
  await alertsApi.acknowledge(SEEDED)
  notifyAlertsChanged()
  await h.flush()
  assert.equal(h.last.openCount, 2)
  stop()
  h.bell.dispose()
})
test('bell: hidden tab pauses polling; a missing endpoint, 403 or 401 turns it off with no further request', async () => {
  for (const [status, reason] of [[404, 'missing'], [403, 'forbidden'], [401, 'unauthorized']]) {
    let calls = 0
    const h = bellHarness(async () => { calls += 1; throw new ApiError(status, 'x') })
    h.bell.start()
    await h.flush()
    assert.equal(h.last.status, 'off', String(status))
    assert.equal(h.last.offReason, reason)
    assert.equal(h.timers.size, 0, 'no poll scheduled')
    h.bell.refresh()
    await h.flush()
    assert.equal(calls, 1, 'refresh does not wake a bell that is off')
  }
  let fail = false
  const page = { content: [{ id: 'a', type: 'LOW_STOCK', machineCode: 'M' }], totalElements: 1 }
  const h = bellHarness(async () => { if (fail) throw new TypeError('Failed to fetch'); return { page } })
  h.bell.start()
  await h.flush()
  fail = true
  await h.tick()
  assert.equal(h.last.status, 'error')
  assert.equal(h.last.openCount, 1, 'last data kept')
  assert.equal(h.timers.size, 1, 'retried at the next interval')
  h.setHidden(true)
  assert.equal(h.timers.size, 0, 'paused while hidden')
  fail = false
  h.setHidden(false)
  await h.flush()
  assert.equal(h.last.status, 'ready', 'back in view: loads at once')
  h.bell.dispose()
})

// ---- mock of the real API

test('mock: alerts are their own group; no status = not closed yet; CRITICAL first then newest; filters on the server', async () => {
  assert.equal(groupOf('/alerts'), 'alerts')
  assert.equal(groupOf(`/alerts/${SEEDED}/acknowledge`), 'alerts')
  assert.equal(groupOf(`/alerts/${SEEDED}/work-orders`), 'alerts')
  const { state } = setup()
  await signIn(state, 'staff')
  const open = await alertsApi.list({})
  assert.equal(open.size, 50, 'default size 50')
  assert.equal(open.totalElements, 5, 'seed: 3 OPEN + 2 ACKNOWLEDGED')
  assert.ok(open.content.every(alert => alert.status !== 'RESOLVED'))
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 }
  for (let i = 1; i < open.content.length; i += 1) {
    const [a, b] = [open.content[i - 1], open.content[i]]
    assert.ok(rank[a.severity] < rank[b.severity] || (rank[a.severity] === rank[b.severity] && a.triggeredAt >= b.triggeredAt), `${a.id} before ${b.id}`)
  }
  assert.equal((await alertsApi.list({ status: 'RESOLVED' })).totalElements, 3)
  const seeded = (await alertsApi.get(SEEDED))
  assert.equal(seeded.title, 'Temperature above range', 'same alert as backend/db/dev/seed.sql')
  assert.deepEqual(Object.keys(seeded).sort(), ['acknowledgedAt', 'acknowledgedBy', 'errorCode', 'id', 'machineCode', 'machineId', 'message', 'resolutionNote', 'resolvedAt', 'resolvedBy',
    'severity', 'slotCode', 'slotId', 'status', 'title', 'triggeredAt', 'type', 'workOrderCode', 'workOrderId'], 'only AlertResponse fields')
  assert.equal((await alertsApi.list({ status: 'OPEN', severity: 'CRITICAL' })).totalElements, 1)
  const failed = (await alertsApi.list({ type: 'DISPENSE_FAILED', status: 'RESOLVED' })).content[0]
  assert.equal(failed.resolvedBy, 'admin@freshvend.test')
  assert.equal(failed.errorCode, 'RESULT_TIMEOUT')
  const fault = (await alertsApi.list({ type: 'HARDWARE_FAULT', errorCode: 'CONTROLLER_FAULT' })).content[0]
  assert.equal(fault.status, 'ACKNOWLEDGED')
  assert.equal((await alertsApi.list({ type: 'HIGH_HUMIDITY', status: 'RESOLVED' })).content[0].resolvedBy, 'system')
  assert.equal((await alertsApi.list({ machineId: MACHINE_1, status: 'OPEN' })).totalElements, 2)
  // Linked unfinished work tickets show as workOrderId / workOrderCode.
  const offline = await alertsApi.get(alertId(2))
  assert.match(offline.workOrderCode, /^WO-\d{8}-[0-9A-F]{4}$/)
  assert.ok(offline.workOrderId)
  assert.equal(seeded.workOrderId, null)
  // Range: from inclusive, to exclusive; to must be after from.
  assert.equal((await alertsApi.list({ from: '2026-11-30T02:00:00Z', to: '2026-11-30T03:00:00Z' })).totalElements, 3, 'raised in the last hour (alerts 2, 5, 8)')
  await rejects(alertsApi.list({ from: '2026-11-30T03:00:00Z', to: '2026-11-30T02:00:00Z' }), 400)
  await rejects(alertsApi.list({ status: 'ALL' }), 400)
  await rejects(alertsApi.list({ size: 201 }), 400)
  assert.equal((await alertsApi.list({ sort: 'severity,asc' })).totalElements, 5, 'sort is not a parameter: ignored like Spring does')
})
test('mock: acknowledge records the email; again is 200 unchanged; resolve records email and note; RESOLVED again is 409', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  const acknowledged = await alertsApi.acknowledge(SEEDED)
  assert.equal(acknowledged.status, 'ACKNOWLEDGED')
  assert.equal(acknowledged.acknowledgedBy, 'staff@freshvend.test')
  assert.equal(acknowledged.acknowledgedAt, new Date(state.clock).toISOString())
  state.clock += 60_000
  assert.deepEqual(await alertsApi.acknowledge(SEEDED), acknowledged, 'acknowledging an ACKNOWLEDGED alert returns it unchanged')

  await signIn(state, 'admin')
  const resolved = await alertsApi.resolve(SEEDED, { note: 'Đã đóng cửa máy' })
  assert.equal(resolved.status, 'RESOLVED')
  assert.equal(resolved.resolvedBy, 'admin@freshvend.test')
  assert.equal(resolved.resolutionNote, 'Đã đóng cửa máy')
  assert.equal(resolved.acknowledgedBy, 'staff@freshvend.test', 'acknowledgement kept')
  await rejects(alertsApi.resolve(SEEDED, {}), 409)
  await rejects(alertsApi.acknowledge(SEEDED), 409)
  // An OPEN alert can be closed directly, without a note.
  const lowStock = await alertsApi.resolve(alertId(5), resolveBody(''))
  assert.equal(lowStock.resolutionNote, null)
  assert.equal(lowStock.acknowledgedAt, null)
})
test('mock: POST /alerts/{id}/work-orders opens a work order (admin), OPEN → ACKNOWLEDGED, then ALERT_ALREADY_HANDLED; RESOLVED is ALERT_RESOLVED', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await rejects(alertsApi.createWorkOrder(SEEDED, {}), 403, () => true)
  await signIn(state, 'admin')
  const workOrder = await alertsApi.createWorkOrder(SEEDED, { priority: 'HIGH', assigneeId: STAFF_ID })
  assert.equal(workOrder.source, 'ALERT')
  assert.equal(workOrder.type, 'MAINTENANCE', 'default from the alert type')
  assert.equal(workOrder.title, 'Temperature above range', 'default from the alert title')
  assert.equal(workOrder.priority, 'HIGH')
  assert.equal(workOrder.status, 'ASSIGNED')
  assert.equal(workOrder.machineId, MACHINE_1)
  assert.match(workOrder.code, /^WO-\d{8}-[0-9A-F]{4}$/)
  const alert = await alertsApi.get(SEEDED)
  assert.equal(alert.status, 'ACKNOWLEDGED')
  assert.equal(alert.acknowledgedBy, 'admin@freshvend.test')
  assert.equal(alert.workOrderId, workOrder.id)
  assert.equal(alert.workOrderCode, workOrder.code)
  await rejects(alertsApi.createWorkOrder(SEEDED, {}), 409, error => error.message.startsWith('ALERT_ALREADY_HANDLED') && error.message.includes(workOrder.code))
  await rejects(alertsApi.createWorkOrder(alertId(4), {}), 409, error => error.message.startsWith('ALERT_RESOLVED'))
  await rejects(alertsApi.createWorkOrder(alertId(1), { machineId: MACHINE_1 }), 400, error => 'machineId' in error.fieldErrors)
  const defaults = await alertsApi.createWorkOrder(alertId(8), {})
  assert.deepEqual([defaults.type, defaults.priority, defaults.status], ['MAINTENANCE', 'URGENT', 'OPEN'])
})
test('mock: 400 for unknown fields, a too long note or a bad id; 404 unknown alert; 401 signed out', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await assert.rejects(alertsApi.resolve(SEEDED, { note: 'x'.repeat(501) }), error => error.status === 400 && 'note' in error.fieldErrors)
  await assert.rejects(alertsApi.resolve(SEEDED, { note: 'ok', status: 'RESOLVED' }), error => error.status === 400 && 'status' in error.fieldErrors)
  await rejects(alertsApi.get('not-a-uuid'), 400)
  await rejects(alertsApi.get('60000000-0000-0000-0000-0000000000ff'), 404)
  state.token = null
  await rejects(alertsApi.list({}), 401)
})
test('mock: ?scenario=missing:alerts answers 404 like a backend without the alerts path', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  state.search = '?scenario=missing:alerts'
  await assert.rejects(alertsApi.list(BELL_QUERY), error => alertsAvailability(error) === 'missing')
})
