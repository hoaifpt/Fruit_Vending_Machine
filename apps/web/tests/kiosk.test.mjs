import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { createStore } from '../src/api/mock/seed.ts'
import { createKioskApi } from '../src/kiosk/api.ts'
import { MACHINE_STATE_COPY, chargeOutcome, clockOffset, configuredSeconds, formatCountdown, holdSeconds, machineStateOf, pollDelay, productImage, secondsLeft, viewForOrder } from '../src/kiosk/flow.ts'
import { mockWebhookSecret } from '../src/kiosk/mock-pay.ts'
import { incidentReportConfig, reportLinkProblem, safeReportUrl } from '../src/kiosk/incident.ts'
import { resolvePage } from '../src/routing.ts'
import { jsonResponse } from './helpers.mjs'

const KEY = 'fvk_test_secret'
function setup(handler) {
  const calls = []
  let unauthorized = 0
  configureClient({ baseUrl: '', getToken: () => 'user-jwt', onUnauthorized: () => { unauthorized += 1 }, fetcher: async (url, init) => { calls.push({ url, init }); return handler(url, init) } })
  return { calls, unauthorized: () => unauthorized }
}

test('purchase route is isolated from admin and supports trailing slash', () => {
  assert.equal(resolvePage('/buy'), 'purchase')
  assert.equal(resolvePage('/buy/'), 'purchase')
})

test('kiosk calls send X-Kiosk-Key, never the user JWT, and do not reset the admin session on 401', async () => {
  const { calls, unauthorized } = setup(() => jsonResponse(401, { message: 'Authentication required' }))
  await assert.rejects(createKioskApi(KEY).me(), error => error.status === 401)
  assert.equal(calls[0].url, '/api/v1/kiosk/me')
  assert.equal(calls[0].init.headers['X-Kiosk-Key'], KEY)
  assert.equal(calls[0].init.headers.Authorization, undefined)
  assert.equal(unauthorized(), 0)
})

test('order creation sends only { productId } and exposes the server timestamp', async () => {
  const { calls } = setup(() => jsonResponse(201, { timestamp: '2026-10-18T07:00:00Z', data: { id: 'o1', status: 'PENDING_PAYMENT', totalAmount: 35000 } }))
  const result = await createKioskApi(KEY).createOrder('p1')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.body, '{"productId":"p1"}')
  assert.equal(result.status, 201)
  assert.equal(result.serverTime, Date.parse('2026-10-18T07:00:00Z'))
  assert.equal(result.data.totalAmount, 35000)
})

test('payment creation has no body and distinguishes reuse (200) from new (201)', async () => {
  const { calls } = setup(() => jsonResponse(200, { data: { paymentId: 'pay1', status: 'PENDING', qrCode: 'MOCK-QR|REF|35000.00' } }))
  const result = await createKioskApi(KEY).createPayment('o 1')
  assert.equal(calls[0].url, '/api/v1/kiosk/orders/o%201/payments')
  assert.equal(calls[0].init.body, undefined)
  assert.equal(result.status, 200)
})

test('a 502 from the provider surfaces as status 502 for the retry button', async () => {
  setup(() => jsonResponse(502, { message: 'Payment provider is currently unavailable' }))
  await assert.rejects(createKioskApi(KEY).createPayment('o1'), error => error.status === 502 && !/provider/i.test(error.message))
})

const now = Date.parse('2026-10-18T07:00:00Z')
const order = (status, currentPayment, expiresAt = '2026-10-18T07:05:00Z') => ({ id: 'o1', status, totalAmount: 35000, expiresAt, currentPayment })

test('state table §7 maps polled orders to screens', () => {
  assert.deepEqual(viewForOrder(order('PENDING_PAYMENT', undefined), now), { kind: 'create-payment' })
  assert.deepEqual(viewForOrder(order('PENDING_PAYMENT', { status: 'PENDING', qrCode: 'Q', amount: 35000, expiresAt: '2026-10-18T07:04:00Z' }), now),
    { kind: 'qr', qrCode: 'Q', amount: 35000, deadline: Date.parse('2026-10-18T07:04:00Z') })
  assert.deepEqual(viewForOrder(order('PENDING_PAYMENT', { status: 'PENDING', qrCode: null }), now), { kind: 'waiting-qr' })
  assert.deepEqual(viewForOrder(order('PENDING_PAYMENT', { status: 'EXPIRED' }), now), { kind: 'qr-expired', canRenew: true })
  assert.deepEqual(viewForOrder(order('PENDING_PAYMENT', { status: 'FAILED' }, '2026-10-18T06:59:00Z'), now), { kind: 'qr-expired', canRenew: false })
  assert.deepEqual(viewForOrder(order('PAID', { status: 'SUCCESS' }), now), { kind: 'dispensing', phase: 'sending' })
  assert.deepEqual(viewForOrder(order('DISPENSING', { status: 'SUCCESS' }), now), { kind: 'dispensing', phase: 'dispensing' })
  assert.deepEqual(viewForOrder(order('COMPLETED', { status: 'SUCCESS' }), now), { kind: 'paid' })
  assert.deepEqual(viewForOrder(order('DISPENSE_FAILED', { status: 'SUCCESS' }), now), { kind: 'dispense-failed' })
  assert.deepEqual(viewForOrder(order('CANCELLED', { status: 'PENDING' }), now), { kind: 'cancelled' })
  assert.deepEqual(viewForOrder(order('CANCELLED', { status: 'EXPIRED' }, '2026-10-18T06:59:59Z'), now), { kind: 'ended' }, 'released by the reservation sweep = expired')
  assert.deepEqual(viewForOrder(order('PAYMENT_FAILED', undefined), now), { kind: 'ended' })
})

test('the QR countdown never outlives the reservation', () => {
  const view = viewForOrder(order('PENDING_PAYMENT', { status: 'PENDING', qrCode: 'Q', expiresAt: '2026-10-18T07:09:00Z' }), now)
  assert.equal(view.deadline, Date.parse('2026-10-18T07:05:00Z'))
})

test('countdown uses server time corrected by clock skew', () => {
  const clientNow = now - 30_000 // client clock 30 s behind the server
  const offset = clockOffset(now, clientNow)
  assert.equal(offset, 30_000)
  assert.equal(secondsLeft(Date.parse('2026-10-18T07:01:00Z'), clientNow + offset), 60)
  assert.equal(secondsLeft(now - 1, now), 0)
  assert.equal(secondsLeft(undefined, now), undefined)
  assert.equal(formatCountdown(65), '1:05')
})

test('countdown never shows more than the hold: 600 s → 10:00, not 10:01', () => {
  const order = { createdAt: '2026-10-18T07:00:00Z', expiresAt: '2026-10-18T07:10:00Z' }
  assert.equal(holdSeconds(order), 600)
  const deadline = Date.parse(order.expiresAt)
  // Clock offset measured a little late (server time read 0.4 s before the order was created) and ceil rounding.
  const left = secondsLeft(deadline, Date.parse(order.createdAt) - 400, holdSeconds(order))
  assert.equal(left, 600)
  assert.equal(formatCountdown(left), '10:00')
  assert.equal(secondsLeft(deadline, Date.parse(order.createdAt) - 400), 601, 'uncapped it would read 10:01')
  assert.equal(secondsLeft(deadline, deadline - 59_500, 600), 60)
  assert.equal(holdSeconds({ createdAt: undefined, expiresAt: order.expiresAt }), undefined)
})

test('a product without imageUrl gets the neutral placeholder, never another product photo', () => {
  assert.equal(productImage('https://cdn.test/tao.webp', '/placeholder.svg'), 'https://cdn.test/tao.webp')
  assert.equal(productImage(undefined, '/placeholder.svg'), '/placeholder.svg')
  assert.equal(productImage('  ', '/placeholder.svg'), '/placeholder.svg')
  const page = readFileSync(new URL('../src/pages/PurchasePage.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /orange-mark|fruit-still-life|productIndex/, 'no photo picked by position')
})

test('Mock Pay: no secret in the source; read from VITE_DEV_MOCK_WEBHOOK_SECRET only in a dev server', () => {
  const source = readFileSync(new URL('../src/kiosk/mock-pay.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /secret\s*=\s*['"`][^'"`]+['"`]/, 'no hard-coded secret')
  assert.doesNotMatch(source, /fvm_mock_webhook/)
  assert.equal(mockWebhookSecret({ DEV: true, VITE_DEV_MOCK_WEBHOOK_SECRET: ' s3cret ' }), 's3cret')
  assert.equal(mockWebhookSecret({ DEV: true }), '', 'missing: no button')
  assert.equal(mockWebhookSecret({ DEV: false, VITE_DEV_MOCK_WEBHOOK_SECRET: 's3cret' }), '', 'production build: never')
  const page = readFileSync(new URL('../src/pages/PurchasePage.tsx', import.meta.url), 'utf8')
  assert.match(page, /BACKEND_MOCK_PAY = import\.meta\.env\.DEV \? !!import\.meta\.env\.VITE_DEV_MOCK_WEBHOOK_SECRET/)
  assert.match(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'), /^VITE_DEV_MOCK_WEBHOOK_SECRET=$/m)
})

test('polling backs off on failures up to 10 s', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(pollDelay), [2500, 5000, 10000, 10000, 10000])
})

test('idle timeout configuration falls back to a safe default', () => {
  assert.equal(configuredSeconds('90', 120), 90)
  for (const bad of [undefined, '', '0', '-5', 'abc', '1.5']) assert.equal(configuredSeconds(bad, 120), 120)
})

test('FE 5.1: every machine state that blocks selling has an explanation and a next step', () => {
  assert.equal(machineStateOf('ACTIVE', true, 3), null)
  assert.equal(machineStateOf('ACTIVE', true, 0), 'sold-out')
  assert.equal(machineStateOf('MAINTENANCE', false, 0), 'maintenance')
  assert.equal(machineStateOf('INACTIVE', false, 0), 'inactive')
  assert.equal(machineStateOf('ACTIVE', false, 0), 'paused')
  assert.equal(machineStateOf(undefined, false, 0), 'paused')
  // A stale MAINTENANCE from /kiosk/me never hides a catalog that accepts orders.
  assert.equal(machineStateOf('MAINTENANCE', true, 2), null)
  for (const [state, copy] of Object.entries(MACHINE_STATE_COPY)) {
    assert.ok(copy.title && copy.text && copy.next, `${state} needs title, text and next step`)
  }
})

test('FE 5.2: an order that ended without a box says whether money was taken', () => {
  assert.equal(chargeOutcome({ currentPayment: null }), 'not-charged')
  assert.equal(chargeOutcome({ currentPayment: { status: 'EXPIRED' } }), 'not-charged')
  assert.equal(chargeOutcome({ currentPayment: { status: 'PENDING' } }), 'not-charged')
  assert.equal(chargeOutcome({ currentPayment: { status: 'SUCCESS' } }), 'paid-late')
})

test('FE 5.4 / 8.3: the incident button is on by default, off only when configured so', () => {
  // FE 8.3 switched the default on (the public form exists); false/0/off/no still hide it.
  assert.equal(incidentReportConfig({}).enabled, true)
  assert.equal(incidentReportConfig({ VITE_KIOSK_INCIDENT_REPORT: '' }).enabled, true)
  for (const off of ['false', '0', 'off', 'NO', ' False ']) assert.equal(incidentReportConfig({ VITE_KIOSK_INCIDENT_REPORT: off }).enabled, false, off)
  for (const on of ['true', '1', 'on', 'ON']) assert.equal(incidentReportConfig({ VITE_KIOSK_INCIDENT_REPORT: on }).enabled, true)
  // ?incident= only overrides the flag with the mock API (UX tests), never in a real build.
  assert.equal(incidentReportConfig({ VITE_KIOSK_INCIDENT_REPORT: 'false' }, 'on').enabled, false)
  assert.equal(incidentReportConfig({}, 'off').enabled, true, 'no override without the mock API')
  assert.equal(incidentReportConfig({ VITE_API_MOCK: 'all', VITE_KIOSK_INCIDENT_REPORT: 'false' }, 'on').enabled, true)
  assert.equal(incidentReportConfig({ VITE_API_MOCK: 'all', VITE_KIOSK_INCIDENT_REPORT: 'true' }, 'off').enabled, false)
  assert.equal(incidentReportConfig({ VITE_API_MOCK: 'orders,payments', VITE_KIOSK_INCIDENT_REPORT: 'false' }, 'on').enabled, false, 'the kiosk API itself must be mocked')
  assert.equal(incidentReportConfig({ VITE_API_MOCK: 'kiosk', VITE_KIOSK_INCIDENT_REPORT: 'off' }, 'on').enabled, true)
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  assert.match(example, /^VITE_KIOSK_INCIDENT_REPORT=true$/m)
  assert.doesNotMatch(example, /VITE_INCIDENT_REPORT_URL/, 'the kiosk no longer builds the link')
})

test('backend #74: the QR link comes from GET /kiosk/incident-report-link (X-Kiosk-Key), with ?order= only for this machine\'s order', async () => {
  const seen = []
  setup(async (url, init) => { seen.push({ url, init }); return jsonResponse(200, { data: { machineId: 'm1', url: 'https://web.example/report/Q2x9abc?order=ORD-20261109-AB12CD34' } }) })
  const api = createKioskApi(KEY)
  const { data } = await api.incidentReportLink('ORD-20261109-AB12CD34')
  assert.equal(seen[0].url, '/api/v1/kiosk/incident-report-link?orderCode=ORD-20261109-AB12CD34')
  assert.equal(seen[0].init.headers['X-Kiosk-Key'], KEY)
  assert.equal(seen[0].init.headers.Authorization, undefined)
  assert.equal(safeReportUrl(data.url), 'https://web.example/report/Q2x9abc?order=ORD-20261109-AB12CD34')
  await api.incidentReportLink(undefined)
  assert.equal(seen[1].url, '/api/v1/kiosk/incident-report-link')
  for (const bad of ['javascript:alert(1)', '/report/x', 'ftp://x.example/r', '', null]) assert.equal(safeReportUrl(bad), null, String(bad))
  assert.match(reportLinkProblem(new ApiError(409, 'REPORT_LINK_NOT_CONFIGURED: no base url')), /chưa bật trang báo sự cố/)
  assert.match(reportLinkProblem(new ApiError(0, 'x')), /Thử lại/)

  // Mock of the real API: the machine of the key, its report token, the order kept only when it is this machine's.
  const store = createStore(Date.now())
  const own = store.orders.find(order => order.machineCode === 'DEV-MACHINE-01').orderCode
  const other = store.orders.find(order => order.machineCode === 'DEV-MACHINE-02').orderCode
  configureClient({ baseUrl: '', fetcher: createMockFetcher(parseSelection('kiosk,customer-reports')), getToken: () => null })
  const mocked = createKioskApi('fvk_mockactive_notasecret')
  const mine = new URL((await mocked.incidentReportLink(own)).data.url)
  assert.equal(mine.pathname, '/report/mock-report-token-dev-machine-01')
  assert.equal(mine.searchParams.get('order'), own)
  assert.equal(new URL((await mocked.incidentReportLink(other)).data.url).searchParams.get('order'), null)
})
