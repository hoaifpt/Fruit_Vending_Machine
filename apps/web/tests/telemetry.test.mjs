// FE 6.4 Cảm biến & Sự kiện: the single connectivity rule (backend's connectivity: WARNING after 60 s, OFFLINE after
// 180 s or on the Last Will, NEVER_SEEN), Wi-Fi level from RSSI, FAULT codes and events, readings against thresholds,
// URL state of the tab, and the mock of the real API (api.yaml, backend #53/#56): MachineResponse presence fields,
// GET /machines/{id}/telemetry(/latest), GET /machines/{id}/events.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient, noteServerTime, serverClockOffset, serverNow } from '../src/api/client.ts'
import { authApi, machinesApi, telemetryApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  CONNECTION_POLL_MS, OFFLINE_AFTER_MS, OFFLINE_HELP, STALE_AFTER_MS, WARNING_AFTER_MS, connectionDetail, connectionOf, connectivityOf, formatAge, latestSeen,
  msUntilChange, msUntilOffline, msUntilStale, shownConnection, staleness, unknownDetail,
} from '../src/admin/connection.ts'
import {
  EVENT_LABELS, EVENT_TYPES, FAULT_CODES, LATEST_CLEARED_QUERY, LATEST_FAULT_QUERY, TELEMETRY_POLL_MS, activeFault, describeFault, dispenseStateLabel, eventQuery,
  eventView, faultCode, formatHeap, formatHumidity, formatRssi, formatTemperature, formatUptime, latestProblems, payloadField, payloadText, readSensorParams,
  readingProblems, readingQuery, readingStats, signalLevel, telemetryAvailability,
} from '../src/admin/telemetry.ts'
import { STATUS_CATALOG } from '../src/lib/status.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const T0 = Date.parse('2026-11-30T06:00:00Z') // 13:00 in Vietnam
const ago = seconds => new Date(T0 - seconds * 1000).toISOString()
const MACHINE_1 = '20000000-0000-0000-0000-000000000001'
const MACHINE_2 = '20000000-0000-0000-0000-000000000002'
const MACHINE_3 = '20000000-0000-0000-0000-000000000003'

// ---- the connectivity rule (docs/machine-health.md)

test('acceptance rule: 60 s still ONLINE, 61 s WARNING, 180 s still WARNING, 181 s OFFLINE', () => {
  assert.equal(WARNING_AFTER_MS, 60_000)
  assert.equal(OFFLINE_AFTER_MS, 180_000)
  assert.deepEqual(connectionOf(ago(0), T0), { state: 'ONLINE', never: false, ageMs: 0 })
  assert.equal(connectionOf(ago(60), T0).state, 'ONLINE')
  assert.equal(connectionOf(ago(61), T0).state, 'WARNING')
  assert.equal(connectionOf(ago(179), T0).state, 'WARNING')
  assert.equal(connectionOf(ago(180), T0).state, 'WARNING')
  assert.equal(connectionOf(ago(181), T0).state, 'OFFLINE')
  assert.equal(connectionOf(new Date(T0 - 180_001).toISOString(), T0).state, 'OFFLINE', 'one millisecond past is enough')
  assert.equal(connectionOf(ago(35 * 60), T0).ageMs, 35 * 60_000)
})

test('never connected is NEVER_SEEN (OFFLINE for actions); the Last Will OFFLINE of the backend wins over a recent lastSeenAt', () => {
  for (const value of [null, undefined, '', 'not a date']) assert.deepEqual(connectionOf(value, T0), { state: 'OFFLINE', never: true, ageMs: null }, String(value))
  assert.equal(connectivityOf(connectionOf(null, T0)), 'NEVER_SEEN')
  assert.deepEqual(connectionOf(new Date(T0 + 5_000).toISOString(), T0), { state: 'ONLINE', never: false, ageMs: 0 })
  const lastWill = connectionOf(ago(20), T0, 'OFFLINE')
  assert.deepEqual(lastWill, { state: 'OFFLINE', never: false, ageMs: 20_000, lastWill: true })
  assert.equal(connectivityOf(lastWill), 'OFFLINE')
  assert.match(connectionDetail(lastWill, ago(20)), /^Máy báo ngắt kết nối/)
  // A reported value is never better than what time says: the clock moved on since it was read.
  assert.equal(connectionOf(ago(200), T0, 'ONLINE').state, 'OFFLINE')
  assert.equal(connectionOf(ago(30), T0, 'WARNING').state, 'WARNING')
  assert.equal(connectionOf(ago(30), T0, 'ONLINE').state, 'ONLINE')
})

test('the screen flips at the right moment: time left before the next state, none once OFFLINE', () => {
  assert.equal(msUntilChange(ago(0), T0), 60_001, 'ONLINE → WARNING')
  assert.equal(msUntilChange(ago(60), T0), 1)
  assert.equal(msUntilChange(ago(61), T0), 119_001, 'WARNING → OFFLINE')
  assert.equal(msUntilChange(ago(181), T0), null)
  assert.equal(msUntilChange(ago(10), T0, 'OFFLINE'), null, 'Last Will: already OFFLINE')
  assert.equal(msUntilChange(null, T0), null)
  assert.equal(msUntilOffline(ago(0), T0), 180_001)
  assert.equal(msUntilOffline(ago(180), T0), 1)
  assert.equal(msUntilOffline(ago(181), T0), null)
  assert.equal(CONNECTION_POLL_MS, 30_000)
  assert.ok(CONNECTION_POLL_MS < WARNING_AFTER_MS)
})

test('the newer of two lastSeenAt values wins; words for the badge line', () => {
  assert.equal(latestSeen(ago(200), ago(10), null), ago(10))
  assert.equal(latestSeen(null, undefined, 'x'), null)
  assert.equal(formatAge(45_000), '45 giây')
  assert.equal(formatAge(181_000), '3 phút')
  assert.equal(formatAge(2 * 3_600_000 + 5), '2 giờ')
  assert.equal(formatAge(5 * 86_400_000), '5 ngày')
  assert.equal(connectionDetail(connectionOf(null, T0), null), 'Chưa từng kết nối')
  assert.equal(connectionDetail(connectionOf(ago(30), T0), ago(30)), 'Tín hiệu lần cuối 30/11/2026 12:59')
  assert.equal(connectionDetail(connectionOf(ago(90), T0), ago(90)), 'Chậm tín hiệu: lần cuối 30/11/2026 12:58 (hơn 1 phút)')
  assert.equal(connectionDetail(connectionOf(ago(35 * 60), T0), ago(35 * 60)), 'Mất tín hiệu từ 30/11/2026 12:25 (hơn 35 phút)')
})

test('connection badges: the four values of the backend, OFFLINE named as such, apart from the administrative status', () => {
  assert.deepEqual(Object.keys(STATUS_CATALOG.connection).sort(), ['NEVER_SEEN', 'OFFLINE', 'ONLINE', 'WARNING'])
  assert.equal(STATUS_CATALOG.connection.ONLINE.label, 'Trực tuyến')
  assert.equal(STATUS_CATALOG.connection.WARNING.label, 'Chậm tín hiệu')
  assert.equal(STATUS_CATALOG.connection.NEVER_SEEN.label, 'Chưa từng kết nối')
  assert.match(STATUS_CATALOG.connection.OFFLINE.label, /OFFLINE/)
  assert.match(STATUS_CATALOG.connection.OFFLINE.description, /180 giây/)
  assert.deepEqual(Object.keys(STATUS_CATALOG.machine).sort(), ['ACTIVE', 'INACTIVE', 'MAINTENANCE'])
})

test('a failed or overdue reload never claims WARNING/OFFLINE: "Chưa rõ" with the time of the last good data', () => {
  assert.equal(STALE_AFTER_MS, 75_000, 'two 30 s cycles plus a margin')
  const fresh = { data: {}, updatedAt: T0 - 10_000 }
  assert.deepEqual(staleness(fresh, T0), { stale: false, since: T0 - 10_000 })
  assert.deepEqual(staleness({ ...fresh, error: new ApiError(500, 'x') }, T0), { stale: true, since: T0 - 10_000 })
  assert.deepEqual(staleness({ data: {}, updatedAt: T0 - 76_000 }, T0), { stale: true, since: T0 - 76_000 })
  assert.deepEqual(staleness({ error: new ApiError(0, 'x') }, T0), { stale: true, since: undefined })
  assert.deepEqual(staleness(undefined, T0), { stale: false })
  assert.equal(msUntilStale(fresh, T0), 65_001)
  assert.equal(msUntilStale({ data: {}, updatedAt: T0 - 80_000 }, T0), null)
  assert.equal(shownConnection(connectionOf(ago(400), T0), true), 'UNKNOWN')
  assert.equal(shownConnection(connectionOf(ago(90), T0), true), 'UNKNOWN')
  assert.equal(shownConnection(connectionOf(ago(400), T0), false), 'OFFLINE')
  assert.equal(shownConnection(connectionOf(ago(30), T0), true), 'ONLINE', 'a message less than 60 s old still proves the machine online')
  assert.equal(unknownDetail(Date.parse('2026-11-30T05:05:00Z')), 'Chưa rõ – không cập nhật được trạng thái kết nối từ 30/11/2026 12:05')
  assert.match(OFFLINE_HELP, /có thể không tới được máy/)
})

test('clock skew: the server time of each 2xx envelope corrects "now" (PC clock 5 minutes off either way)', async () => {
  const lastSeen = new Date(T0 - 30_000).toISOString() // 30 s before the server's "now"
  for (const skew of [5 * 60_000, -5 * 60_000]) {
    const clientNow = T0 + skew
    noteServerTime(T0, clientNow)
    assert.equal(serverClockOffset(), -skew)
    assert.equal(connectionOf(lastSeen, clientNow + serverClockOffset()).state, 'ONLINE', `skew ${skew}`)
    assert.equal(msUntilChange(lastSeen, clientNow + serverClockOffset()), 30_001)
  }
  assert.equal(connectionOf(lastSeen, T0 + 5 * 60_000).state, 'OFFLINE', 'uncorrected, +5 min would have said OFFLINE')
  const serverTime = Date.now() - 5 * 60_000
  configureClient({ baseUrl: '', getToken: () => null, onUnauthorized: () => {}, fetcher: async () => new Response(JSON.stringify({ timestamp: new Date(serverTime).toISOString(), data: {} }), { status: 200 }) })
  await machinesApi.get(MACHINE_1)
  assert.ok(Math.abs(serverNow() - serverTime) < 1_000)
  noteServerTime(undefined)
  assert.ok(Math.abs(serverNow() - serverTime) < 1_000, 'an envelope without a time keeps the last offset')
  noteServerTime(Date.now())
})

// ---- Wi-Fi, firmware, heap, controller

test('RSSI in dBm with its level in words; 0 or missing is "no reading"; heap in KB', () => {
  assert.deepEqual(signalLevel(-50), { label: 'Rất tốt', tone: 'success', bars: 4 })
  assert.equal(signalLevel(-55).label, 'Rất tốt')
  assert.equal(signalLevel(-56).label, 'Tốt')
  assert.equal(signalLevel(-67).label, 'Tốt')
  assert.equal(signalLevel(-68).label, 'Trung bình')
  assert.equal(signalLevel(-76).label, 'Yếu')
  assert.equal(signalLevel(-86).label, 'Rất yếu, dễ mất kết nối')
  assert.equal(signalLevel(-86).tone, 'danger')
  for (const value of [null, undefined, 0, 5, Number.NaN]) assert.equal(signalLevel(value).bars, 0, String(value))
  assert.equal(formatRssi(-58), '-58 dBm (Tốt)')
  assert.equal(formatRssi(null), 'Chưa có số đo (máy chưa gửi RSSI)')
  assert.equal(formatHeap(18_240), '17,8 KB')
  assert.equal(formatHeap(512), '512 byte')
  assert.match(formatHeap(null), /Chưa có số đo/)
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
})

test('firmware DispenseState names are the ones the web knows', () => {
  const header = readFileSync(`${root}firmware/fruit/src/application/DispenseState.h`, 'utf8')
  const states = header.match(/enum class DispenseState\s*\{([^}]*)\}/)[1].split('\n').map(line => line.replace(/\/\/.*/, '').trim().replace(/,$/, '')).filter(Boolean)
  for (const state of states) assert.notEqual(dispenseStateLabel(state), state, state)
})

// ---- FAULT and events

test('FAULT codes of mqtt-contract §6.2 in Vietnamese with the next step; unknown or missing codes are named, never hidden', () => {
  const contract = readFileSync(`${root}api-contract/mqtt-contract.md`, 'utf8').replaceAll('\r\n', '\n')
  const section = contract.match(/### 6\.2 `FAULT` event `details\.code`\n([\s\S]*?)\n### /)[1]
  const codes = [...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map(match => match[1])
  assert.ok(codes.length >= 5)
  assert.deepEqual(Object.keys(FAULT_CODES).sort(), [...codes].sort())
  for (const [code, text] of Object.entries(FAULT_CODES)) { assert.ok(text.title && text.action, code); assert.deepEqual(describeFault(code), text) }
  assert.match(describeFault('GATE_POSITION_UNKNOWN').action, /RESET/)
  assert.match(describeFault('GATE_POSITION_LOST').title, /Mã lỗi GATE_POSITION_LOST chưa có mô tả/)
  assert.match(describeFault(null).title, /không gửi mã lỗi/)
  assert.match(describeFault('constructor').title, /chưa có mô tả/)
})

test('payload fields: MACHINE payloads keep { eventType, details }, BACKEND payloads are flat; untrusted input is cut short', () => {
  assert.equal(faultCode({ eventType: 'FAULT', details: { code: ' CONTROLLER_FAULT ' } }), 'CONTROLLER_FAULT')
  assert.equal(faultCode({ code: 'SERVO_INIT_FAILED' }), 'SERVO_INIT_FAILED')
  assert.equal(faultCode({ details: { code: 42 } }), null)
  assert.equal(faultCode(null), null)
  assert.equal(faultCode({ details: { code: 'X'.repeat(200) } }).length, 64)
  assert.equal(payloadField({ commandCode: 'D-1' }, 'commandCode'), 'D-1')
})

test('events: FAULT stands out with its code; refusals, backend decisions and unknown types are worded', () => {
  const fault = eventView({ eventType: 'FAULT', payload: { eventType: 'FAULT', details: { code: 'CONTROLLER_FAULT', state: 'FAULT' } } })
  assert.equal(fault.tone, 'fault')
  assert.equal(fault.code, 'CONTROLLER_FAULT')
  assert.equal(fault.label, 'Lỗi phần cứng (FAULT)')
  assert.equal(fault.summary, FAULT_CODES.CONTROLLER_FAULT.title)
  assert.match(fault.details, /"code": "CONTROLLER_FAULT"/)

  const refused = eventView({ eventType: 'DISPENSE_REJECTED', payload: { details: { commandId: 'D-ABC', state: 'FAULT' } } })
  assert.equal(refused.tone, 'fault')
  assert.match(refused.summary, /FAULT.*lệnh D-ABC/)
  const busy = eventView({ eventType: 'DISPENSE_REJECTED', payload: { details: { commandId: 'D-ABC', state: 'HOLD_LOWER' } } })
  assert.equal(busy.tone, 'warning')
  assert.match(busy.summary, /bận \(HOLD_LOWER\)/)
  assert.match(eventView({ eventType: 'DISPENSE_ABORTED', payload: { details: { reason: 'NO_BOWL_DETECTED' } } }).summary, /NO_BOWL_DETECTED/)
  assert.equal(eventView({ eventType: 'DISPENSE_COMPLETED', payload: { details: { commandId: 'D-9' } } }).summary, 'Lệnh D-9.')
  assert.equal(eventView({ eventType: 'STATUS_OFFLINE', payload: {} }).tone, 'warning')
  assert.equal(eventView({ eventType: 'BOOT', payload: { details: { resetReason: 'WATCHDOG' } } }).tone, 'warning')
  const failed = eventView({ eventType: 'BACKEND_DISPENSE_FAILED', payload: { commandCode: 'D-1', slotCode: 'A', reason: 'RESULT_TIMEOUT' } })
  assert.equal(failed.tone, 'fault')
  assert.match(failed.summary, /ngăn A.*RESULT_TIMEOUT.*lệnh D-1/)
  assert.match(eventView({ eventType: 'BACKEND_DISPENSE_MULTIPLE_BOWLS', payload: { bowlCount: 2 } }).summary, /nhả 2 hộp/)
  const odd = eventView({ eventType: 'VENDOR_THING', payload: {} })
  assert.deepEqual([odd.label, odd.tone, odd.details], ['VENDOR_THING', 'normal', ''])
  for (const type of EVENT_TYPES) assert.ok(EVENT_LABELS[type], type)
  // Payload text is data, never markup: returned as is for the UI to escape.
  assert.equal(payloadText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>')
  assert.equal(payloadText({}), '')
})

test('event vocabulary: firmware events, status messages and the backend decisions of docs/machine-event-logging.md', () => {
  const main = readFileSync(`${root}firmware/fruit/src/main.cpp`, 'utf8')
  const published = [...main.matchAll(/publishEvent\("([A-Z_]+)"/g)].map(match => match[1])
  assert.ok(published.length >= 4)
  for (const type of published) assert.ok(EVENT_TYPES.includes(type), type)
  const doc = readFileSync(`${root}docs/machine-event-logging.md`, 'utf8')
  const backend = [...new Set([...doc.matchAll(/`(BACKEND_[A-Z_]+|STATUS_(?:ONLINE|OFFLINE))`/g)].map(match => match[1]))]
  assert.ok(backend.length >= 7)
  for (const type of backend) assert.ok(EVENT_TYPES.includes(type), type)
})

test('active fault: the newest FAULT unless a FAULT_CLEARED came after it', () => {
  const fault = { payload: { details: { code: 'CONTROLLER_FAULT' } }, createdAt: ago(600) }
  assert.deepEqual(activeFault(fault, undefined), { code: 'CONTROLLER_FAULT', ...FAULT_CODES.CONTROLLER_FAULT, since: ago(600) })
  assert.deepEqual(activeFault(fault, { createdAt: ago(900) })?.code, 'CONTROLLER_FAULT', 'cleared before this fault')
  assert.equal(activeFault(fault, { createdAt: ago(300) }), null, 'cleared since')
  assert.equal(activeFault(undefined, undefined), null)
  assert.deepEqual(LATEST_FAULT_QUERY, { page: 0, size: 1, type: 'FAULT', source: 'MACHINE' })
  assert.deepEqual(LATEST_CLEARED_QUERY, { page: 0, size: 1, type: 'FAULT_CLEARED', source: 'MACHINE' })
})

// ---- readings and URL state

test('readings against the machine thresholds; the latest reading by the server statuses; lowest/highest of the page', () => {
  const limits = { minTemperature: 2, maxTemperature: 8, minHumidity: 40, maxHumidity: 80 }
  assert.deepEqual(readingProblems({ temperature: 9.5, humidity: 60 }, limits), ['Nhiệt độ cao hơn ngưỡng 8 °C'])
  assert.deepEqual(readingProblems({ temperature: 1, humidity: 85 }, limits), ['Nhiệt độ thấp hơn ngưỡng 2 °C', 'Độ ẩm cao hơn ngưỡng 80 %'])
  assert.deepEqual(readingProblems({ temperature: 8, humidity: null }, limits), [], 'the limits themselves are allowed')
  assert.deepEqual(latestProblems({ temperatureStatus: 'HIGH', humidityStatus: 'NORMAL' }, limits), ['Nhiệt độ cao hơn ngưỡng 8 °C'])
  assert.deepEqual(latestProblems({ temperatureStatus: 'LOW', humidityStatus: 'HIGH' }, limits), ['Nhiệt độ thấp hơn ngưỡng 2 °C', 'Độ ẩm cao hơn ngưỡng 80 %'])
  assert.deepEqual(latestProblems({ temperatureStatus: null, humidityStatus: null }, limits), [])
  assert.deepEqual(readingStats([{ temperature: 4, humidity: 60 }, { temperature: 9.5, humidity: null }]), { count: 2, minTemperature: 4, maxTemperature: 9.5, minHumidity: 60, maxHumidity: 60 })
  assert.deepEqual(readingStats([]), { count: 0 })
})

test('tab state from the URL: unknown values fall back, never reach the API; queries carry the required from/to', () => {
  assert.deepEqual(readSensorParams(new URLSearchParams('')), { range: '24h', readingPage: 0, eventType: '', eventSource: '', eventPage: 0 })
  assert.deepEqual(readSensorParams(new URLSearchParams('range=7d&readingPage=2&eventType=FAULT&eventSource=BACKEND&eventPage=1')), { range: '7d', readingPage: 2, eventType: 'FAULT', eventSource: 'BACKEND', eventPage: 1 })
  assert.deepEqual(readSensorParams(new URLSearchParams('range=1y&readingPage=-1&eventType=<x>&eventSource=BOTH&eventPage=a')), { range: '24h', readingPage: 0, eventType: '', eventSource: '', eventPage: 0 })
  assert.deepEqual(readingQuery('24h', 0, 20, T0), { page: 0, size: 20, from: '2026-11-29T06:00:00.000Z', to: '2026-11-30T06:01:00.000Z' })
  const month = readingQuery('30d', 0, 20, T0)
  assert.ok(Date.parse(month.to) - Date.parse(month.from) <= 31 * 86_400_000, 'at most 31 days')
  assert.deepEqual(eventQuery('', 1, 20), { page: 1, size: 20, type: undefined, source: undefined })
  assert.deepEqual(eventQuery('FAULT', 0, 20, 'MACHINE'), { page: 0, size: 20, type: 'FAULT', source: 'MACHINE' })
  assert.ok(!('sort' in readingQuery('24h', 0, 20, T0)) && !('sort' in eventQuery('', 0, 20)), 'no sort: the order is fixed')
  assert.equal(TELEMETRY_POLL_MS, 30_000)
})

test('availability: 404/405/501 is a backend without the paths; 403 and 401 apart', () => {
  assert.equal(telemetryAvailability(new ApiError(404, 'x')), 'missing')
  assert.equal(telemetryAvailability(new ApiError(501, 'x')), 'missing')
  assert.equal(telemetryAvailability(new ApiError(403, 'x')), 'forbidden')
  assert.equal(telemetryAvailability(new ApiError(401, 'x')), 'unauthorized')
  assert.equal(telemetryAvailability(new ApiError(500, 'x')), 'error')
  assert.equal(telemetryAvailability(new TypeError('Failed to fetch')), 'error')
})

test('the web calls the telemetry paths of api.yaml (no heartbeat endpoint, no sensor-readings)', () => {
  const yaml = readFileSync(`${root}api-contract/api.yaml`, 'utf8')
  for (const path of ['"/api/v1/machines/{machineId}/telemetry":', '"/api/v1/machines/{machineId}/telemetry/latest":', '"/api/v1/machines/{machineId}/events":']) assert.ok(yaml.includes(path), path)
  const resources = readFileSync(`${root}apps/web/src/api/resources.ts`, 'utf8')
  assert.doesNotMatch(resources, /\/heartbeat|sensor-readings|drafts\/machine-telemetry/)
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

test('mock: telemetry and events are their own group, so they can be mocked while machines are real', () => {
  assert.equal(groupOf(`/machines/${MACHINE_1}/telemetry`), 'telemetry')
  assert.equal(groupOf(`/machines/${MACHINE_1}/telemetry/latest`), 'telemetry')
  assert.equal(groupOf(`/machines/${MACHINE_1}/events`), 'telemetry')
  assert.equal(groupOf(`/machines/${MACHINE_1}`), 'machines')
  assert.deepEqual(parseSelection('telemetry').groups, ['telemetry'])
})

test('mock seed: one machine online, one silent for 35 min after its Last Will with a FAULT, one never seen', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  const machines = (await machinesApi.list({ page: 0, size: 20, sort: 'code,asc' })).content
  const byCode = Object.fromEntries(machines.map(machine => [machine.code, machine]))
  assert.deepEqual(machines.map(machine => machine.connectivity), ['ONLINE', 'OFFLINE', 'NEVER_SEEN'])
  const live = byCode['DEV-MACHINE-01']
  assert.deepEqual([live.firmwareVersion, live.wifiRssi, live.freeHeapBytes, live.lastHeartbeatAt], ['0.3.0', -58, 182_400, new Date(state.clock).toISOString()])
  assert.equal(connectionOf(live.lastSeenAt, state.clock, live.connectivity).state, 'ONLINE')
  const silent = byCode['DEV-MACHINE-02']
  assert.equal(signalLevel(silent.wifiRssi).label, 'Rất yếu, dễ mất kết nối')
  assert.equal(connectionOf(silent.lastSeenAt, state.clock, silent.connectivity).state, 'OFFLINE')
  const never = await machinesApi.get(MACHINE_3)
  assert.deepEqual([never.connectivity, never.lastSeenAt, never.lastHeartbeatAt, never.firmwareVersion, never.wifiRssi], ['NEVER_SEEN', null, null, null, null])
  assert.equal((await machinesApi.list({ connectivity: 'OFFLINE' })).totalElements, 1, 'connectivity filter on the server')

  const [faults, cleared] = await Promise.all([telemetryApi.events(MACHINE_2, LATEST_FAULT_QUERY), telemetryApi.events(MACHINE_2, LATEST_CLEARED_QUERY)])
  assert.equal(activeFault(faults.content[0], cleared.content[0]).code, 'CONTROLLER_FAULT')
  const m1 = await Promise.all([telemetryApi.events(MACHINE_1, LATEST_FAULT_QUERY), telemetryApi.events(MACHINE_1, LATEST_CLEARED_QUERY)])
  assert.equal(activeFault(m1[0].content[0], m1[1].content[0]), null, 'DEV-MACHINE-01: last FAULT was cleared')
  assert.equal((await telemetryApi.events(MACHINE_3, eventQuery('', 0, 20))).totalElements, 0)
})

test('mock: latest reading with LOW/NORMAL/HIGH and connectivity; null fields when the machine never sent one', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  const latest = await telemetryApi.latest(MACHINE_1)
  assert.deepEqual(latest, { machineId: MACHINE_1, recordedAt: new Date(state.clock).toISOString(), temperature: 4, humidity: 60, temperatureStatus: 'NORMAL', humidityStatus: 'NORMAL', connectivity: 'ONLINE' })
  const none = await telemetryApi.latest(MACHINE_3)
  assert.deepEqual(none, { machineId: MACHINE_3, recordedAt: null, temperature: null, humidity: null, temperatureStatus: null, humidityStatus: null, connectivity: 'NEVER_SEEN' })
  assert.equal((await telemetryApi.latest(MACHINE_2)).humidityStatus, null, 'last reading of DEV-MACHINE-02 has no humidity')
})

test('mock: readings follow backend/db/dev/seed.sql (24 hourly, 9.50 °C two hours ago), newest first, from/to required', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const day = await telemetryApi.readings(MACHINE_1, readingQuery('24h', 0, 100, state.clock))
  assert.equal(day.totalElements, 24)
  assert.deepEqual(Object.keys(day.content[0]).sort(), ['humidity', 'recordedAt', 'temperature'], 'only TelemetryReadingResponse fields')
  assert.equal(day.content[0].recordedAt, new Date(state.clock).toISOString())
  assert.equal(day.content[2].temperature, 9.5)
  const lastHours = await telemetryApi.readings(MACHINE_1, { page: 0, size: 100, from: new Date(state.clock - 3 * 3_600_000).toISOString(), to: new Date(state.clock + 1).toISOString() })
  assert.equal(lastHours.totalElements, 4)
  assert.equal((await telemetryApi.readings(MACHINE_1, { from: new Date(state.clock - 86_400_000).toISOString(), to: new Date(state.clock + 1).toISOString() })).size, 100, 'default size 100')
  await assert.rejects(telemetryApi.readings(MACHINE_1, { page: 0, size: 20 }), error => error.status === 400 && 'from' in error.fieldErrors && 'to' in error.fieldErrors)
  await assert.rejects(telemetryApi.readings(MACHINE_1, { from: new Date(state.clock - 40 * 86_400_000).toISOString(), to: new Date(state.clock).toISOString() }), error => error.status === 400)
  const events = await telemetryApi.events(MACHINE_1, eventQuery('FAULT', 0, 20))
  assert.deepEqual(events.content.map(event => faultCode(event.payload)), ['GATE_POSITION_UNKNOWN', 'GATE_POSITION_LOST'])
  assert.deepEqual(Object.keys(events.content[0]).sort(), ['createdAt', 'eventType', 'id', 'messageId', 'payload', 'source'], 'only MachineEventResponse fields')
  const backend = await telemetryApi.events(MACHINE_1, eventQuery('', 0, 20, 'BACKEND'))
  assert.ok(backend.totalElements >= 2 && backend.content.every(event => event.source === 'BACKEND' && event.messageId === null))
  await assert.rejects(telemetryApi.events(MACHINE_1, { source: 'DEVICE' }), error => error.status === 400)
})

test('mock acceptance: a machine that goes silent is ONLINE at 60 s, WARNING at 61 s and 180 s, OFFLINE at 181 s, on every read', async () => {
  const { state, fetcher } = setup()
  await signIn(state, 'staff')
  const last = fetcher.control.stopHeartbeat('DEV-MACHINE-01')
  assert.equal(last, new Date(state.clock).toISOString())
  state.clock += 60_000
  assert.equal((await machinesApi.get(MACHINE_1)).connectivity, 'ONLINE')
  state.clock += 1_000
  const at61 = await machinesApi.get(MACHINE_1)
  assert.equal(at61.lastSeenAt, last, 'nothing new arrives')
  assert.equal(at61.connectivity, 'WARNING')
  assert.equal(connectionOf(at61.lastSeenAt, state.clock).state, 'WARNING', 'the web says the same on its own clock')
  state.clock += 119_000
  assert.equal((await machinesApi.get(MACHINE_1)).connectivity, 'WARNING', '180 s')
  state.clock += 1_000
  const list = (await machinesApi.list({ page: 0, size: 20, sort: 'code,asc' })).content.find(machine => machine.id === MACHINE_1)
  assert.equal(list.connectivity, 'OFFLINE')
  assert.equal(connectionOf(list.lastSeenAt, state.clock).state, 'OFFLINE')
  assert.equal((await telemetryApi.latest(MACHINE_1)).connectivity, 'OFFLINE')
  fetcher.control.resumeHeartbeat(MACHINE_1)
  state.clock += 10_000
  assert.equal((await machinesApi.get(MACHINE_1)).connectivity, 'ONLINE')
})

test('mock: ?scenario=missing:telemetry answers 404 like a backend without the paths; machines still load', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  state.search = '?scenario=missing:telemetry'
  await assert.rejects(telemetryApi.latest(MACHINE_1), error => telemetryAvailability(error) === 'missing')
  await assert.rejects(telemetryApi.events(MACHINE_1, eventQuery('', 0, 20)), error => telemetryAvailability(error) === 'missing')
  assert.equal((await machinesApi.get(MACHINE_1)).code, 'DEV-MACHINE-01')
  state.search = '?scenario=403:telemetry'
  await assert.rejects(telemetryApi.readings(MACHINE_1, readingQuery('24h', 0, 20, state.clock)), error => telemetryAvailability(error) === 'forbidden')
  state.search = '?scenario=none'
  state.token = null
  await assert.rejects(telemetryApi.latest(MACHINE_1), error => error instanceof ApiError && error.status === 401)
})
