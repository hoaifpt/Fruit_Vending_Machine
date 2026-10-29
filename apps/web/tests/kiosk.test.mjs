import test from 'node:test'
import assert from 'node:assert/strict'
import { configureClient } from '../src/api/client.ts'
import { createKioskApi } from '../src/kiosk/api.ts'
import { clockOffset, configuredSeconds, formatCountdown, pollDelay, secondsLeft, viewForOrder } from '../src/kiosk/flow.ts'
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
  assert.deepEqual(viewForOrder(order('PAID', { status: 'SUCCESS' }), now), { kind: 'dispensing' })
  assert.deepEqual(viewForOrder(order('DISPENSING', { status: 'SUCCESS' }), now), { kind: 'dispensing' })
  assert.deepEqual(viewForOrder(order('COMPLETED', { status: 'SUCCESS' }), now), { kind: 'paid' })
  assert.deepEqual(viewForOrder(order('DISPENSE_FAILED', { status: 'SUCCESS' }), now), { kind: 'dispense-failed' })
  assert.deepEqual(viewForOrder(order('CANCELLED', { status: 'PENDING' }), now), { kind: 'cancelled' })
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

test('polling backs off on failures up to 10 s', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(pollDelay), [2500, 5000, 10000, 10000, 10000])
})

test('idle timeout configuration falls back to a safe default', () => {
  assert.equal(configuredSeconds('90', 120), 90)
  for (const bad of [undefined, '', '0', '-5', 'abc', '1.5']) assert.equal(configuredSeconds(bad, 120), 120)
})
