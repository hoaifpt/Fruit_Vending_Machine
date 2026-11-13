// FE 6.3 Cảnh báo & chuông thông báo: pure rules (filters, who handled, 409 text, bell), the bell's polling with fake
// timers against the mock API (a new alert shows within one poll), and the mock of the draft contract drafts/alerts.yaml.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { alertsApi, authApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  ALERTS_MISSING, ALERT_NOT_FOUND, ALERT_SEVERITIES, ALERT_STATUSES, ALERT_TYPES, ALERT_TYPE_HINTS, ALERT_TYPE_LABELS, BELL_CRITICAL_QUERY, BELL_POLL_MS, BELL_QUERY, BELL_SIZE, TICKETS_AVAILABLE,
  alertActionError, alertListQuery, alertPath, alertsAvailability, badgeText, bellAnnouncement, bellLabel, canAcknowledge, canResolve,
  detailFailure, freshAlerts, handledByLines, handlingSteps, machinePath, readAlertFilters, resolveBody,
} from '../src/admin/alerts.ts'
import { createAlertBell, notifyAlertsChanged, onAlertsChanged } from '../src/admin/alert-bell.ts'
import { DRAFT_PERMISSIONS, PERMISSIONS, can, permissionsOf } from '../src/admin/permissions.ts'
import { NAV, canOpen, matchRoute, navFor } from '../src/admin/routes.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const MACHINE_1 = '20000000-0000-0000-0000-000000000001'
const SEEDED = '60000000-0000-0000-0000-000000000001'

function javaEnum(name) {
  const body = readFileSync(`${root}backend/src/main/java/com/fruitmachine/backend/alert/enums/${name}.java`, 'utf8').match(new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`))
  return body[1].split(';')[0].split(',').map(item => item.trim()).filter(Boolean)
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
async function rejects(promise, status) {
  await assert.rejects(promise, error => error instanceof ApiError && error.status === status)
}

// ---- names follow the backend

test('types, severities and statuses are the backend enums AlertType, AlertSeverity, AlertStatus', () => {
  assert.deepEqual([...ALERT_TYPES], javaEnum('AlertType'))
  assert.deepEqual([...ALERT_SEVERITIES], javaEnum('AlertSeverity'))
  assert.deepEqual([...ALERT_STATUSES], javaEnum('AlertStatus'))
  for (const type of ALERT_TYPES) { assert.ok(ALERT_TYPE_LABELS[type], type); assert.ok(ALERT_TYPE_HINTS[type], type) }
})
test('the draft contract follows table alerts and records who acknowledged and closed', () => {
  const yaml = readFileSync(`${root}api-contract/drafts/alerts.yaml`, 'utf8')
  for (const field of ['triggeredAt', 'acknowledgedAt', 'acknowledgedByName', 'resolvedAt', 'resolvedByName', 'resolutionNote']) assert.match(yaml, new RegExp(`\\n        ${field}:`), field)
  for (const path of ['/api/v1/alerts:', '/api/v1/alerts/{id}:', '/api/v1/alerts/{id}/acknowledge:', '/api/v1/alerts/{id}/resolve:']) assert.ok(yaml.includes(path), path)
  assert.match(yaml, /"409":/)
  // Nothing deletes an alert.
  assert.doesNotMatch(yaml, /\n\s+delete:/)
})

// ---- permissions (draft codes)

test('ALERT_READ / ALERT_WRITE are draft codes: both roles hold them, the 15 codes of #48 are unchanged', () => {
  assert.equal(PERMISSIONS.length, 15)
  // FE 7.1 added the work ticket codes after the alert ones (tests/tickets.test.mjs); FE 8.1 added REFUND_RECORD.
  assert.deepEqual(DRAFT_PERMISSIONS.slice(0, 2), ['ALERT_READ', 'ALERT_WRITE'])
  assert.ok(DRAFT_PERMISSIONS.includes('REFUND_RECORD'))
  for (const role of ['ADMIN', 'STAFF']) {
    assert.equal(can([role], 'ALERT_READ'), true, role)
    assert.equal(can([role], 'ALERT_WRITE'), true, role)
  }
  // Once GET /auth/me lists permissions, an account without the alert codes sees neither the screen nor the bell.
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

test('URL filters keep only values the contract accepts, and the query sends only contract parameters', () => {
  const filters = readAlertFilters(new URLSearchParams(`status=OPEN&severity=LOUD&type=LOW_STOCK&machineId=nope&from=2026-11-30&to=bad&sort=severity,asc&page=2&x=1`))
  assert.deepEqual(filters, { status: 'OPEN', severity: '', type: 'LOW_STOCK', machineId: '', from: '2026-11-30', to: '', sort: { field: 'triggeredAt', direction: 'desc' }, page: 2 })
  assert.deepEqual(alertListQuery(filters, 20), {
    page: 2, size: 20, sort: 'triggeredAt,desc', status: 'OPEN', severity: undefined, type: 'LOW_STOCK', machineId: undefined,
    triggeredFrom: '2026-11-29T17:00:00.000Z', triggeredTo: undefined,
  })
  assert.equal(readAlertFilters(new URLSearchParams(`machineId=${MACHINE_1}&sort=triggeredAt,asc`)).machineId, MACHINE_1)
  assert.deepEqual(readAlertFilters(new URLSearchParams('sort=triggeredAt,asc')).sort, { field: 'triggeredAt', direction: 'asc' })
})
test('links: detail by id, machine only for a UUID', () => {
  assert.equal(alertPath(SEEDED), `/admin/alerts/${SEEDED}`)
  assert.equal(machinePath(MACHINE_1), `/admin/machines/${MACHINE_1}`)
  assert.equal(machinePath('x'), '')
})

// ---- availability, actions, who handled it

test('availability: 404/405/501 mean BE 3.6 is not there yet; 401/403 stop; the rest is an ordinary failure', () => {
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
  assert.equal(TICKETS_AVAILABLE, true, '"Mở phiếu" is on since FE 7.1')
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
test('a 409 becomes a Vietnamese explanation with the next step; other errors are kept', () => {
  const ack = alertActionError(new ApiError(409, 'Alert is not OPEN'), 'acknowledge')
  assert.equal(ack.status, 409)
  assert.match(ack.message, /vừa được người khác xác nhận hoặc đóng/)
  assert.match(ack.message, /tải lại/)
  assert.match(alertActionError(new ApiError(409, 'Alert is already RESOLVED'), 'resolve').message, /đã được đóng trước đó/)
  // On the detail screen the text speaks of the page and its "Xử lý" section, never of a list or a column.
  for (const action of ['acknowledge', 'resolve']) {
    const text = alertActionError(new ApiError(409, 'x'), action, 'detail').message
    assert.match(text, /Trang đã được tải lại; xem người (xử lý|đã đóng) ở mục Xử lý./)
    assert.doesNotMatch(text, /Danh sách|cột/)
  }
  const other = new ApiError(500, 'Hệ thống đang gặp sự cố.')
  assert.equal(alertActionError(other, 'resolve'), other)
})
test('who acknowledged and who closed, with Vietnam time and the note', () => {
  const alert = {
    id: SEEDED, status: 'RESOLVED', triggeredAt: '2026-11-30T05:00:00Z',
    acknowledgedAt: '2026-11-30T06:05:00Z', acknowledgedByName: 'Nhân viên vận hành', acknowledgedById: 'x',
    resolvedAt: '2026-11-30T07:10:00Z', resolvedByName: null, resolvedById: '11000000-0000-0000-0000-000000000001', resolutionNote: '  Đã rút hộp  ',
  }
  assert.deepEqual(handlingSteps(alert), [
    { key: 'triggered', label: 'Phát sinh', at: '30/11/2026 12:00' },
    { key: 'acknowledged', label: 'Xác nhận', at: '30/11/2026 13:05', by: 'Nhân viên vận hành' },
    { key: 'resolved', label: 'Đóng', at: '30/11/2026 14:10', by: 'Tài khoản …00000001', note: 'Đã rút hộp' },
  ])
  assert.deepEqual(handledByLines(alert), ['Xác nhận: Nhân viên vận hành, 30/11/2026 13:05', 'Đóng: Tài khoản …00000001, 30/11/2026 14:10'])
  assert.deepEqual(handledByLines({ ...alert, status: 'OPEN', acknowledgedAt: null, resolvedAt: null }), [])
})

// ---- bell (pure)

test('bell: nothing is new on the first load; later only unseen ids; polite text names type and machine', () => {
  const a = { id: 'a', type: 'HIGH_TEMPERATURE', machineCode: 'DEV-MACHINE-01' }
  const b = { id: 'b', type: 'MACHINE_OFFLINE', machineCode: 'DEV-MACHINE-02' }
  assert.deepEqual(freshAlerts(null, [a, b]), [])
  assert.deepEqual(freshAlerts(new Set(['a']), [b, a]), [b])
  assert.equal(bellAnnouncement([], false), '')
  assert.equal(bellAnnouncement([b], false), 'Cảnh báo mới: Máy mất kết nối tại máy DEV-MACHINE-02.')
  assert.equal(bellAnnouncement([b, a], false), 'Có 2 cảnh báo mới. Mới nhất: Máy mất kết nối tại máy DEV-MACHINE-02.')
  assert.match(bellAnnouncement(Array.from({ length: BELL_SIZE }, (_, i) => ({ ...a, id: String(i) })), true), /^Có ít nhất 5 cảnh báo mới/)
  assert.equal(badgeText(7), '7')
  assert.equal(badgeText(120), '99+')
  assert.equal(bellLabel(undefined), 'Cảnh báo')
  assert.equal(bellLabel(0), 'Cảnh báo: không có cảnh báo đang mở')
  assert.equal(bellLabel(3), 'Cảnh báo: 3 đang mở')
  assert.equal(bellLabel(3, 1), 'Cảnh báo: 3 đang mở, 1 nghiêm trọng')
  assert.equal(bellLabel(0, 0), 'Cảnh báo: không có cảnh báo đang mở')
  assert.deepEqual(BELL_CRITICAL_QUERY, { status: 'OPEN', severity: 'CRITICAL', page: 0, size: 1, sort: 'triggeredAt,desc' })
  assert.equal(BELL_POLL_MS, 30_000)
  assert.deepEqual(BELL_QUERY, { status: 'OPEN', page: 0, size: 5, sort: 'triggeredAt,desc' })
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

  const raised = fetcher.control.raiseAlert({ type: 'MACHINE_OFFLINE', severity: 'CRITICAL', machineId: MACHINE_1, title: 'Machine offline' })
  state.clock += BELL_POLL_MS
  await h.tick()
  assert.equal(calls.length, 2, 'one poll (list + critical count) per interval')
  assert.equal(h.last.openCount, 4)
  assert.equal(h.last.criticalCount, 2)
  assert.equal(h.last.latest[0].id, raised.id, 'newest first')
  assert.deepEqual(h.last.fresh, [raised.id])
  assert.equal(h.last.announcement, 'Cảnh báo mới: Máy mất kết nối tại máy DEV-MACHINE-01.')
  assert.equal(h.last.announcementSeq, 1)

  // Next poll without changes: no longer "new", the announcement is not repeated with other text.
  state.clock += BELL_POLL_MS
  await h.tick()
  assert.deepEqual(h.last.fresh, [])
  assert.equal(h.last.announcementSeq, 1, 'nothing new: no announcement')
  // A second alert with the same words is announced again (same text, new sequence number).
  fetcher.control.raiseAlert({ type: 'MACHINE_OFFLINE', severity: 'CRITICAL', machineId: MACHINE_1, title: 'Machine offline' })
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
  // 500 / network: keep the last data, try again next interval.
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

// ---- mock of the draft contract

test('mock: alerts are their own group; list filters and sorts on the server', async () => {
  assert.equal(groupOf('/alerts'), 'alerts')
  assert.equal(groupOf(`/alerts/${SEEDED}/acknowledge`), 'alerts')
  const { state } = setup()
  await signIn(state, 'staff')
  const all = await alertsApi.list({ page: 0, size: 100 })
  assert.equal(all.totalElements, 7)
  assert.deepEqual(all.content.map(alert => alert.triggeredAt), [...all.content.map(alert => alert.triggeredAt)].sort().reverse(), 'newest first by default')
  const seeded = all.content.find(alert => alert.id === SEEDED)
  assert.equal(seeded.title, 'Temperature above range', 'same alert as backend/db/dev/seed.sql')
  assert.equal((await alertsApi.list({ status: 'OPEN', severity: 'CRITICAL' })).totalElements, 1)
  assert.equal((await alertsApi.list({ type: 'DISPENSE_FAILED' })).content[0].resolvedByName, 'Quản trị viên')
  assert.equal((await alertsApi.list({ machineId: MACHINE_1, status: 'OPEN' })).totalElements, 2)
  await rejects(alertsApi.list({ sort: 'severity,asc' }), 400)
})
test('mock: acknowledge records the name; a second acknowledge is 409; resolve records name and note; RESOLVED again is 409', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  const acknowledged = await alertsApi.acknowledge(SEEDED)
  assert.equal(acknowledged.status, 'ACKNOWLEDGED')
  assert.equal(acknowledged.acknowledgedByName, 'Nhân viên vận hành')
  assert.equal(acknowledged.acknowledgedAt, new Date(state.clock).toISOString())
  await rejects(alertsApi.acknowledge(SEEDED), 409)

  await signIn(state, 'admin')
  state.clock += 60_000
  const resolved = await alertsApi.resolve(SEEDED, { note: 'Đã đóng cửa máy' })
  assert.equal(resolved.status, 'RESOLVED')
  assert.equal(resolved.resolvedByName, 'Quản trị viên')
  assert.equal(resolved.resolutionNote, 'Đã đóng cửa máy')
  assert.equal(resolved.acknowledgedByName, 'Nhân viên vận hành', 'acknowledgement kept')
  await rejects(alertsApi.resolve(SEEDED, {}), 409)
  await rejects(alertsApi.acknowledge(SEEDED), 409)
  // An OPEN alert can be closed directly, without a note.
  const offline = (await alertsApi.list({ type: 'MACHINE_OFFLINE', status: 'OPEN' })).content[0]
  const closed = await alertsApi.resolve(offline.id, resolveBody(''))
  assert.equal(closed.resolutionNote, null)
  assert.equal(closed.acknowledgedAt, null)
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
test('mock: ?scenario=missing:alerts answers 404 like a backend without BE 3.6', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  state.search = '?scenario=missing:alerts'
  await assert.rejects(alertsApi.list(BELL_QUERY), error => alertsAvailability(error) === 'missing')
})
