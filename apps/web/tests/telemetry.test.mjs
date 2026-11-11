// FE 6.4 Cảm biến & Sự kiện: the single connectivity rule (OFFLINE after 180 s without a message), Wi-Fi level from RSSI,
// FAULT codes and events, readings against thresholds, URL state of the tab, and the mock of the draft contract
// drafts/machine-telemetry.yaml (live heartbeat, a machine that goes silent, missing endpoint).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient, noteServerTime, serverClockOffset, serverNow } from '../src/api/client.ts'
import { authApi, machinesApi, telemetryApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  CONNECTION_POLL_MS, OFFLINE_AFTER_MS, OFFLINE_HELP, STALE_AFTER_MS, connectionDetail, connectionOf, formatAge, latestSeen, msUntilOffline,
  msUntilStale, shownConnection, staleness, unknownDetail,
} from '../src/admin/connection.ts'
import {
  EVENT_LABELS, EVENT_TYPES, FAULT_CODES, LATEST_FAULT_QUERY, TELEMETRY_POLL_MS, activeFault, describeFault, dispenseStateLabel, eventQuery,
  eventView, faultCode, formatHumidity, formatRssi, formatTemperature, formatUptime, payloadText, readSensorParams, readingProblems,
  readingQuery, readingStats, signalLevel, telemetryAvailability,
} from '../src/admin/telemetry.ts'
import { STATUS_CATALOG } from '../src/lib/status.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const T0 = Date.parse('2026-11-30T06:00:00Z') // 13:00 in Vietnam
const ago = seconds => new Date(T0 - seconds * 1000).toISOString()
const MACHINE_1 = '20000000-0000-0000-0000-000000000001'
const MACHINE_2 = '20000000-0000-0000-0000-000000000002'
const MACHINE_3 = '20000000-0000-0000-0000-000000000003'

// ---- the 180 s rule

test('acceptance rule: silent for 179 s or exactly 180 s is online; 181 s is OFFLINE', () => {
  assert.equal(OFFLINE_AFTER_MS, 180_000)
  assert.deepEqual(connectionOf(ago(0), T0), { state: 'ONLINE', never: false, ageMs: 0 })
  assert.equal(connectionOf(ago(179), T0).state, 'ONLINE')
  assert.equal(connectionOf(ago(180), T0).state, 'ONLINE')
  assert.equal(connectionOf(ago(181), T0).state, 'OFFLINE')
  assert.equal(connectionOf(new Date(T0 - 180_001).toISOString(), T0).state, 'OFFLINE', 'one millisecond past is enough')
  assert.equal(connectionOf(ago(35 * 60), T0).ageMs, 35 * 60_000)
})

test('never connected or an unreadable time is OFFLINE; a server clock ahead of ours is not', () => {
  for (const value of [null, undefined, '', 'not a date']) assert.deepEqual(connectionOf(value, T0), { state: 'OFFLINE', never: true, ageMs: null }, String(value))
  assert.deepEqual(connectionOf(new Date(T0 + 5_000).toISOString(), T0), { state: 'ONLINE', never: false, ageMs: 0 })
})

test('the screen flips at the right moment: time left before OFFLINE, none once OFFLINE', () => {
  assert.equal(msUntilOffline(ago(0), T0), 180_001)
  assert.equal(msUntilOffline(ago(179), T0), 1_001)
  assert.equal(msUntilOffline(ago(180), T0), 1)
  assert.equal(msUntilOffline(ago(181), T0), null)
  assert.equal(msUntilOffline(null, T0), null)
  // A reload every 30 s brings a machine that came back online within one poll.
  assert.equal(CONNECTION_POLL_MS, 30_000)
  assert.ok(CONNECTION_POLL_MS < OFFLINE_AFTER_MS)
})

test('the newer of two lastSeenAt values wins; words for the badge line', () => {
  assert.equal(latestSeen(ago(200), ago(10), null), ago(10))
  assert.equal(latestSeen(null, undefined, 'x'), null)
  assert.equal(latestSeen(ago(5)), ago(5))
  assert.equal(formatAge(45_000), '45 giây')
  assert.equal(formatAge(181_000), '3 phút')
  assert.equal(formatAge(2 * 3_600_000 + 5), '2 giờ')
  assert.equal(formatAge(5 * 86_400_000), '5 ngày')
  assert.equal(connectionDetail(connectionOf(null, T0), null), 'Chưa từng kết nối')
  assert.equal(connectionDetail(connectionOf(ago(30), T0), ago(30)), 'Tín hiệu lần cuối 30/11/2026 12:59')
  assert.equal(connectionDetail(connectionOf(ago(35 * 60), T0), ago(35 * 60)), 'Mất tín hiệu từ 30/11/2026 12:25 (hơn 35 phút)')
})

test('connection badges: OFFLINE is named as such and kept apart from the administrative status', () => {
  assert.equal(STATUS_CATALOG.connection.ONLINE.label, 'Trực tuyến')
  assert.match(STATUS_CATALOG.connection.OFFLINE.label, /OFFLINE/)
  assert.match(STATUS_CATALOG.connection.OFFLINE.description, /180 giây/)
  assert.deepEqual(Object.keys(STATUS_CATALOG.machine).sort(), ['ACTIVE', 'INACTIVE', 'MAINTENANCE'])
})

test('a failed or overdue reload never claims OFFLINE: "Chưa rõ" with the time of the last good data', () => {
  assert.equal(STALE_AFTER_MS, 75_000, 'two 30 s cycles plus a margin')
  const fresh = { data: {}, updatedAt: T0 - 10_000 }
  assert.deepEqual(staleness(fresh, T0), { stale: false, since: T0 - 10_000 })
  assert.deepEqual(staleness({ ...fresh, error: new ApiError(500, 'x') }, T0), { stale: true, since: T0 - 10_000 })
  assert.deepEqual(staleness({ data: {}, updatedAt: T0 - 76_000 }, T0), { stale: true, since: T0 - 76_000 })
  assert.deepEqual(staleness({ error: new ApiError(0, 'x') }, T0), { stale: true, since: undefined })
  assert.deepEqual(staleness(undefined, T0), { stale: false })
  assert.equal(msUntilStale(fresh, T0), 65_001)
  assert.equal(msUntilStale({ data: {}, updatedAt: T0 - 80_000 }, T0), null)
  const offline = connectionOf(ago(400), T0), online = connectionOf(ago(30), T0)
  assert.equal(shownConnection(offline, true), 'UNKNOWN')
  assert.equal(shownConnection(offline, false), 'OFFLINE')
  assert.equal(shownConnection(online, true), 'ONLINE', 'a message less than 180 s old still proves the machine online')
  assert.equal(unknownDetail(Date.parse('2026-11-30T05:05:00Z')), 'Chưa rõ – không cập nhật được trạng thái kết nối từ 30/11/2026 12:05')
  assert.equal(unknownDetail(undefined), 'Chưa rõ – không cập nhật được trạng thái kết nối')
  assert.match(OFFLINE_HELP, /có thể không tới được máy/)
})

test('clock skew: the server time of each 2xx envelope corrects "now" (PC clock 5 minutes off either way)', async () => {
  const lastSeen = new Date(T0 - 60_000).toISOString() // 60 s before the server's "now"
  for (const skew of [5 * 60_000, -5 * 60_000]) {
    // The PC clock is off by `skew`: what it calls T0 is really T0 - skew on the server.
    const clientNow = T0 + skew
    noteServerTime(T0, clientNow)
    assert.equal(serverClockOffset(), -skew)
    assert.equal(connectionOf(lastSeen, clientNow + serverClockOffset()).state, 'ONLINE', `skew ${skew}`)
    assert.equal(msUntilOffline(lastSeen, clientNow + serverClockOffset()), 120_001)
  }
  // Uncorrected, +5 min would have said OFFLINE and -5 min would have kept it online for 5 more minutes.
  assert.equal(connectionOf(lastSeen, T0 + 5 * 60_000).state, 'OFFLINE')
  // Through the real client: the offset follows the envelope's timestamp.
  const serverTime = Date.now() - 5 * 60_000
  configureClient({ baseUrl: '', getToken: () => null, onUnauthorized: () => {}, fetcher: async () => new Response(JSON.stringify({ timestamp: new Date(serverTime).toISOString(), data: {} }), { status: 200 }) })
  await machinesApi.get(MACHINE_1)
  assert.ok(Math.abs(serverNow() - serverTime) < 1_000)
  noteServerTime(undefined)
  assert.ok(Math.abs(serverNow() - serverTime) < 1_000, 'an envelope without a time keeps the last offset')
  noteServerTime(Date.now())
})

// ---- Wi-Fi, firmware, controller

test('RSSI in dBm with its level in words; 0 or missing is "no reading"', () => {
  assert.deepEqual(signalLevel(-50), { label: 'Rất tốt', tone: 'success', bars: 4 })
  assert.equal(signalLevel(-55).label, 'Rất tốt')
  assert.equal(signalLevel(-56).label, 'Tốt')
  assert.equal(signalLevel(-67).label, 'Tốt')
  assert.equal(signalLevel(-68).label, 'Trung bình')
  assert.equal(signalLevel(-75).label, 'Trung bình')
  assert.equal(signalLevel(-76).label, 'Yếu')
  assert.equal(signalLevel(-85).label, 'Yếu')
  assert.equal(signalLevel(-86).label, 'Rất yếu, dễ mất kết nối')
  assert.equal(signalLevel(-86).tone, 'danger')
  for (const value of [null, undefined, 0, 5, Number.NaN]) assert.equal(signalLevel(value).bars, 0, String(value))
  assert.equal(formatRssi(-58), '-58 dBm (Tốt)')
  assert.equal(formatRssi(null), 'Chưa có số đo (máy chưa gửi RSSI)')
})

test('uptime, units and the dispense controller state in Vietnamese', () => {
  assert.equal(formatUptime(45), '45 giây')
  assert.equal(formatUptime(240), '4 phút')
  assert.equal(formatUptime(2 * 3600 + 5 * 60), '2 giờ 5 phút')
  assert.equal(formatUptime(3 * 86_400 + 4 * 3600), '3 ngày 4 giờ')
  assert.equal(formatUptime(null), '—')
  assert.equal(formatTemperature(9.5), '9,5 °C')
  assert.equal(formatTemperature(4), '4 °C')
  assert.equal(formatHumidity(62), '62 %')
  assert.equal(formatHumidity(null), '—')
  assert.equal(dispenseStateLabel('IDLE'), 'Sẵn sàng')
  assert.match(dispenseStateLabel('FAULT'), /FAULT.*RESET/)
  assert.equal(dispenseStateLabel('HOLD_LOWER'), 'Đang nhả hàng')
  assert.equal(dispenseStateLabel('NEW_STATE'), 'NEW_STATE')
  assert.match(dispenseStateLabel(null), /Chưa rõ/)
})

test('firmware DispenseState names are the ones the web knows', () => {
  const header = readFileSync(`${root}firmware/fruit/src/application/DispenseState.h`, 'utf8')
  const states = header.match(/enum class DispenseState\s*\{([^}]*)\}/)[1].split('\n').map(line => line.replace(/\/\/.*/, '').trim().replace(/,$/, '')).filter(Boolean)
  for (const state of states) assert.notEqual(dispenseStateLabel(state), state, state)
})

// ---- FAULT and events

test('FAULT codes: known codes in Vietnamese with the next step; unknown or missing codes are named, never hidden', () => {
  for (const [code, text] of Object.entries(FAULT_CODES)) { assert.ok(text.title && text.action, code); assert.deepEqual(describeFault(code), text) }
  assert.match(describeFault('CYCLE_INTERRUPTED').action, /RESET/)
  assert.match(describeFault('GATE_POSITION_LOST').title, /Mã lỗi GATE_POSITION_LOST chưa có mô tả/)
  assert.match(describeFault(null).title, /không gửi mã lỗi/)
  assert.equal(faultCode({ code: ' CYCLE_INTERRUPTED ' }), 'CYCLE_INTERRUPTED')
  assert.equal(faultCode({ code: 42 }), null)
  assert.equal(faultCode(null), null)
  assert.equal(faultCode({ code: 'X'.repeat(200) }).length, 64, 'untrusted input is cut short')
  // Object.hasOwn: a code such as "constructor" is not mistaken for a known one.
  assert.match(describeFault('constructor').title, /chưa có mô tả/)
})

test('events: FAULT stands out with its code; a refusal because of FAULT too; unknown types are shown as they are', () => {
  const fault = eventView({ eventType: 'FAULT', payload: { code: 'CYCLE_INTERRUPTED', commandId: 'D-1' } })
  assert.equal(fault.tone, 'fault')
  assert.equal(fault.code, 'CYCLE_INTERRUPTED')
  assert.equal(fault.label, 'Lỗi bộ nhả hàng (FAULT)')
  assert.equal(fault.summary, FAULT_CODES.CYCLE_INTERRUPTED.title)
  assert.match(fault.details, /"code": "CYCLE_INTERRUPTED"/)

  const refused = eventView({ eventType: 'DISPENSE_REJECTED', payload: { commandId: 'D-ABC', state: 'FAULT' } })
  assert.equal(refused.tone, 'fault')
  assert.match(refused.summary, /FAULT.*lệnh D-ABC/)
  const busy = eventView({ eventType: 'DISPENSE_REJECTED', payload: { commandId: 'D-ABC', state: 'HOLD_LOWER' } })
  assert.equal(busy.tone, 'warning')
  assert.match(busy.summary, /bận \(HOLD_LOWER\)/)
  assert.equal(eventView({ eventType: 'DISPENSE_ABORTED', payload: {} }).tone, 'warning')
  assert.equal(eventView({ eventType: 'DISPENSE_COMPLETED', payload: { commandId: 'D-9' } }).summary, 'Lệnh D-9.')
  const odd = eventView({ eventType: 'VENDOR_THING', payload: {} })
  assert.deepEqual([odd.label, odd.tone, odd.details], ['VENDOR_THING', 'normal', ''])
  for (const type of EVENT_TYPES) assert.ok(EVENT_LABELS[type], type)
  // Payload text is data, never markup: returned as is for the UI to escape.
  assert.equal(payloadText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>')
  assert.equal(payloadText({}), '')
})

test('the firmware event names are all known to the web', () => {
  const main = readFileSync(`${root}firmware/fruit/src/main.cpp`, 'utf8')
  const published = [...main.matchAll(/publishEvent\("([A-Z_]+)"/g)].map(match => match[1])
  assert.ok(published.length >= 4)
  for (const type of published) assert.ok(EVENT_TYPES.includes(type), type)
})

test('active fault: only while the heartbeat says FAULT; the code comes from the newest FAULT event', () => {
  const latest = { payload: { code: 'CYCLE_INTERRUPTED' }, createdAt: ago(600) }
  assert.equal(activeFault({ dispenseState: 'IDLE' }, latest), null)
  assert.equal(activeFault(undefined, latest), null)
  assert.deepEqual(activeFault({ dispenseState: 'FAULT' }, latest), { code: 'CYCLE_INTERRUPTED', ...FAULT_CODES.CYCLE_INTERRUPTED, since: ago(600) })
  assert.equal(activeFault({ dispenseState: 'FAULT' }, undefined).code, null)
})

// ---- readings and URL state

test('readings against the machine thresholds; lowest/highest of the page', () => {
  const limits = { minTemperature: 2, maxTemperature: 8, minHumidity: 40, maxHumidity: 80 }
  assert.deepEqual(readingProblems({ temperature: 9.5, humidity: 60 }, limits), ['Nhiệt độ cao hơn ngưỡng 8 °C'])
  assert.deepEqual(readingProblems({ temperature: 1, humidity: 85 }, limits), ['Nhiệt độ thấp hơn ngưỡng 2 °C', 'Độ ẩm cao hơn ngưỡng 80 %'])
  assert.deepEqual(readingProblems({ temperature: 8, humidity: null }, limits), [], 'the limits themselves are allowed')
  assert.deepEqual(readingStats([{ temperature: 4, humidity: 60 }, { temperature: 9.5, humidity: null }]), { count: 2, minTemperature: 4, maxTemperature: 9.5, minHumidity: 60, maxHumidity: 60 })
  assert.deepEqual(readingStats([]), { count: 0 })
})

test('tab state from the URL: unknown values fall back, never reach the API', () => {
  assert.deepEqual(readSensorParams(new URLSearchParams('')), { range: '24h', readingPage: 0, eventType: '', eventPage: 0 })
  assert.deepEqual(readSensorParams(new URLSearchParams('range=7d&readingPage=2&eventType=FAULT&eventPage=1')), { range: '7d', readingPage: 2, eventType: 'FAULT', eventPage: 1 })
  assert.deepEqual(readSensorParams(new URLSearchParams('range=1y&readingPage=-1&eventType=<x>&eventPage=a')), { range: '24h', readingPage: 0, eventType: '', eventPage: 0 })
  assert.deepEqual(readingQuery('24h', 0, 20, T0), { page: 0, size: 20, recordedFrom: '2026-11-29T06:00:00.000Z', sort: 'recordedAt,desc' })
  assert.deepEqual(eventQuery('', 1, 20), { page: 1, size: 20, eventType: undefined, sort: 'createdAt,desc' })
  assert.deepEqual(LATEST_FAULT_QUERY, { page: 0, size: 1, eventType: 'FAULT', sort: 'createdAt,desc' })
  assert.equal(TELEMETRY_POLL_MS, 30_000)
})

test('availability: 404/405/501 is a backend without BE 3.4/3.5; 403 and 401 apart', () => {
  assert.equal(telemetryAvailability(new ApiError(404, 'x')), 'missing')
  assert.equal(telemetryAvailability(new ApiError(501, 'x')), 'missing')
  assert.equal(telemetryAvailability(new ApiError(403, 'x')), 'forbidden')
  assert.equal(telemetryAvailability(new ApiError(401, 'x')), 'unauthorized')
  assert.equal(telemetryAvailability(new ApiError(500, 'x')), 'error')
  assert.equal(telemetryAvailability(new TypeError('Failed to fetch')), 'error')
})

test('the draft contract: read only, names of the backend tables, MACHINE_READ', () => {
  const yaml = readFileSync(`${root}api-contract/drafts/machine-telemetry.yaml`, 'utf8')
  for (const path of ['/api/v1/machines/{machineId}/heartbeat:', '/api/v1/machines/{machineId}/sensor-readings:', '/api/v1/machines/{machineId}/events:']) assert.ok(yaml.includes(path), path)
  for (const field of ['recordedAt', 'temperature', 'humidity', 'eventType', 'payload', 'firmwareVersion', 'uptimeSeconds', 'rssi', 'lastSeenAt']) assert.match(yaml, new RegExp(`\\n        ${field}:`), field)
  assert.match(yaml, /x-required-permission: MACHINE_READ/)
  assert.doesNotMatch(yaml, /\n\s+(post|put|patch|delete):/)
})

// ---- mock

function setup() {
  const state = { token: null, clock: T0, search: '' }
  const fetcher = createMockFetcher(parseSelection('all'), { now: () => state.clock, getSearch: () => state.search })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return { state, fetcher }
}
async function signIn(state, account) {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}

test('mock: telemetry is its own group, so it can be mocked while machines are real', () => {
  assert.equal(groupOf(`/machines/${MACHINE_1}/heartbeat`), 'telemetry')
  assert.equal(groupOf(`/machines/${MACHINE_1}/sensor-readings`), 'telemetry')
  assert.equal(groupOf(`/machines/${MACHINE_1}/events`), 'telemetry')
  assert.equal(groupOf(`/machines/${MACHINE_1}`), 'machines')
  assert.deepEqual(parseSelection('telemetry').groups, ['telemetry'])
})

test('mock seed: one machine online, one silent for 35 min with a FAULT, one never connected', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  const machines = (await machinesApi.list({ page: 0, size: 20, sort: 'code,asc' })).content
  const byCode = Object.fromEntries(machines.map(machine => [machine.code, machine]))
  assert.equal(connectionOf(byCode['DEV-MACHINE-01'].lastSeenAt, state.clock).state, 'ONLINE')
  assert.equal(connectionOf(byCode['DEV-MACHINE-02'].lastSeenAt, state.clock).state, 'OFFLINE')
  assert.equal(connectionOf(byCode['DEV-MACHINE-03'].lastSeenAt, state.clock).never, true)

  const live = await telemetryApi.heartbeat(MACHINE_1)
  assert.deepEqual([live.state, live.firmwareVersion, live.rssi, live.dispenseState], ['ONLINE', '0.3.0', -58, 'IDLE'])
  assert.equal(live.lastSeenAt, new Date(state.clock).toISOString())
  assert.equal('live' in live || 'bootedAt' in live, false, 'only contract fields')
  const silent = await telemetryApi.heartbeat(MACHINE_2)
  assert.deepEqual([silent.state, silent.dispenseState, signalLevel(silent.rssi).label], ['OFFLINE', 'FAULT', 'Rất yếu, dễ mất kết nối'])
  const never = await telemetryApi.heartbeat(MACHINE_3)
  assert.deepEqual(never, { machineId: MACHINE_3, lastSeenAt: null, reportedAt: null, state: null, firmwareVersion: null, uptimeSeconds: null, rssi: null, dispenseState: null })

  const faults = await telemetryApi.events(MACHINE_2, LATEST_FAULT_QUERY)
  assert.equal(faultCode(faults.content[0].payload), 'CYCLE_INTERRUPTED')
  assert.equal(activeFault(silent, faults.content[0]).code, 'CYCLE_INTERRUPTED')
  assert.equal((await telemetryApi.events(MACHINE_3, eventQuery('', 0, 20))).totalElements, 0)
})

test('mock: readings follow backend/db/dev/seed.sql (24 hourly, 9.50 °C two hours ago), newest first, range on the server', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const day = await telemetryApi.readings(MACHINE_1, readingQuery('24h', 0, 100, state.clock))
  assert.equal(day.totalElements, 24)
  assert.equal(day.content[0].recordedAt, new Date(state.clock).toISOString())
  assert.equal(day.content[2].temperature, 9.5)
  const lastHours = await telemetryApi.readings(MACHINE_1, { page: 0, size: 100, recordedFrom: new Date(state.clock - 3 * 3_600_000).toISOString(), sort: 'recordedAt,desc' })
  assert.equal(lastHours.totalElements, 4)
  await assert.rejects(telemetryApi.readings(MACHINE_1, { page: 0, size: 20, sort: 'temperature,desc' }), error => error.status === 400)
  const events = await telemetryApi.events(MACHINE_1, eventQuery('FAULT', 0, 20))
  assert.deepEqual(events.content.map(event => faultCode(event.payload)), ['CYCLE_INTERRUPTED', 'GATE_POSITION_LOST'])
})

test('mock acceptance: a machine that goes silent is online 179 s later and OFFLINE at 181 s, on every read', async () => {
  const { state, fetcher } = setup()
  await signIn(state, 'staff')
  const last = fetcher.control.stopHeartbeat('DEV-MACHINE-01')
  assert.equal(last, new Date(state.clock).toISOString())
  state.clock += 179_000
  const at179 = await machinesApi.get(MACHINE_1)
  assert.equal(at179.lastSeenAt, last, 'nothing new arrives')
  assert.equal(connectionOf(at179.lastSeenAt, state.clock).state, 'ONLINE')
  state.clock += 2_000
  const list = (await machinesApi.list({ page: 0, size: 20, sort: 'code,asc' })).content.find(machine => machine.id === MACHINE_1)
  assert.equal(connectionOf(list.lastSeenAt, state.clock).state, 'OFFLINE')
  assert.equal(connectionOf((await telemetryApi.heartbeat(MACHINE_1)).lastSeenAt, state.clock).state, 'OFFLINE')
  // Back on: the next read sees it online again.
  fetcher.control.resumeHeartbeat(MACHINE_1)
  state.clock += 10_000
  assert.equal(connectionOf((await machinesApi.get(MACHINE_1)).lastSeenAt, state.clock).state, 'ONLINE')
})

test('mock: ?scenario=missing:telemetry answers 404 like a backend without BE 3.4/3.5; machines still load', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  state.search = '?scenario=missing:telemetry'
  await assert.rejects(telemetryApi.heartbeat(MACHINE_1), error => telemetryAvailability(error) === 'missing')
  await assert.rejects(telemetryApi.events(MACHINE_1, eventQuery('', 0, 20)), error => telemetryAvailability(error) === 'missing')
  assert.equal((await machinesApi.get(MACHINE_1)).code, 'DEV-MACHINE-01')
  state.search = '?scenario=403:telemetry'
  await assert.rejects(telemetryApi.readings(MACHINE_1, readingQuery('24h', 0, 20, state.clock)), error => telemetryAvailability(error) === 'forbidden')
  state.search = '?scenario=none'
  state.token = null
  await assert.rejects(telemetryApi.heartbeat(MACHINE_1), error => error instanceof ApiError && error.status === 401)
})
