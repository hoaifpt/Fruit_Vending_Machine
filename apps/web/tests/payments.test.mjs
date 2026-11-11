// Payments and webhook logs (T2/T4, FE 6.2): URL filters limited to the contract, the "Cần xử lý" view, the anomaly of
// one payment, the amount inside a webhook body, verbatim payloads and the mock rows that prove the done criterion.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { configureClient } from '../src/api/client.ts'
import { authApi, ordersApi, paymentsApi, webhookLogsApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { payloadText, prettyPayload, storedPayload } from '../src/admin/payload.ts'
import {
  ATTENTION_PATH, amountVsOrder, isCheckedWebhook, isMismatch, listAnomalies, orderPaymentsPath, payloadAmount, paymentFindings, paymentListQuery, readPaymentFilters, readWebhookFilters,
  sameAmount, webhookAmountCheck, webhookEventText, webhookListQuery, webhookLogPath, webhookLogsByReferencePath,
} from '../src/admin/payments.ts'
import { jsonResponse } from './helpers.mjs'

const UUID = '90000000-0000-0000-0000-000000000004'
const contract = fs.readFileSync(path.resolve(import.meta.dirname, '../../../api-contract/api.yaml'), 'utf8')
/** Query parameter names of one operation, read from api-contract/api.yaml. */
function contractParams(operationId) {
  const start = contract.indexOf(`"operationId": "${operationId}"`)
  assert.ok(start > 0, operationId)
  const block = contract.slice(start, contract.indexOf('"responses":', start))
  return [...block.matchAll(/"name": "([^"]+)"\s+"in": "query"/g)].map(match => match[1])
}

test('payment filters: values the API would reject are dropped, the query only has contract parameters', () => {
  const filters = readPaymentFilters(new URLSearchParams('status=NOPE&orderId=abc&machineId=<x>&from=2026-13&sort=qrCode,asc&page=-2&requiresAttention=yes&provider= payos '))
  assert.deepEqual({ ...filters, sort: undefined }, { status: '', provider: 'payos', orderId: '', machineId: '', from: '', to: '', attention: false, sort: undefined, page: 0 })
  assert.deepEqual(filters.sort, { field: 'createdAt', direction: 'desc' }, 'unknown sort falls back to the default')

  const full = readPaymentFilters(new URLSearchParams(`status=SUCCESS&orderId=${UUID}&from=2026-11-01&to=2026-11-02&sort=paidAt,asc&page=3&requiresAttention=true`))
  const query = paymentListQuery(full, 20)
  assert.deepEqual(query, {
    page: 3, size: 20, sort: 'paidAt,asc', status: 'SUCCESS', provider: undefined, orderId: UUID, machineId: undefined,
    createdFrom: '2026-10-31T17:00:00.000Z', createdTo: '2026-11-02T17:00:00.000Z', requiresAttention: true,
  })
  const allowed = contractParams('listPayments')
  assert.deepEqual(Object.keys(query).filter(key => !allowed.includes(key)), [])
  assert.equal(paymentListQuery(readPaymentFilters(new URLSearchParams()), 20).requiresAttention, undefined, 'not sent unless in effect')
})

test('webhook filters: verified is a boolean, reference is exact, only contract parameters', () => {
  const filters = readWebhookFilters(new URLSearchParams('verified=maybe&reference= MOCKREF000001 &sort=reference,asc'))
  assert.equal(filters.verified, '')
  assert.equal(filters.reference, 'MOCKREF000001')
  assert.deepEqual(filters.sort, { field: 'receivedAt', direction: 'desc' })
  const query = webhookListQuery(readWebhookFilters(new URLSearchParams('verified=false&sort=provider,asc&from=2026-11-01')), 20)
  assert.equal(query.verified, false)
  assert.equal(query.sort, 'provider,asc')
  assert.equal(query.receivedFrom, '2026-10-31T17:00:00.000Z')
  const allowed = contractParams('listPaymentWebhookLogs')
  assert.deepEqual(Object.keys(query).filter(key => !allowed.includes(key)), [])
})

test('links between payment, order and webhook logs', () => {
  assert.equal(webhookLogPath('b1'), '/admin/webhook-logs/b1')
  assert.equal(webhookLogPath(undefined), '')
  assert.equal(webhookLogsByReferencePath('REF 1&x'), '/admin/webhook-logs?reference=REF%201%26x')
  assert.equal(orderPaymentsPath(UUID), `/admin/payments?orderId=${UUID}`)
  assert.equal(orderPaymentsPath('nope'), '/admin/payments', 'a non-UUID would be a 400')
  assert.equal(ATTENTION_PATH, '/admin/payments?requiresAttention=true')
  // The webhook list reads back the reference the payment detail links to.
  assert.equal(readWebhookFilters(new URL(webhookLogsByReferencePath('REF 1&x'), 'http://x').searchParams).reference, 'REF 1&x')
})

test('"Cần xử lý" rows: two SUCCESS rows of one order are a duplicate (the one paid last is the refund candidate); others are to review', () => {
  const rows = [
    { id: 'p1', orderId: 'o1', status: 'SUCCESS', paidAt: '2026-11-11T02:00:00Z', createdAt: '2026-11-11T01:59:00Z' },
    { id: 'p2', orderId: 'o2', status: 'SUCCESS', paidAt: '2026-11-11T01:00:00Z', createdAt: '2026-11-11T00:59:00Z' },
    { id: 'p3', orderId: 'o1', status: 'SUCCESS', paidAt: '2026-11-11T00:00:00Z', createdAt: '2026-11-10T23:59:00Z' },
    // Not returned today; if the backend adds amount mismatches to requiresAttention, such a row must not pair up.
    { id: 'p4', orderId: 'o2', status: 'EXPIRED', createdAt: '2026-11-11T00:00:00Z' },
  ]
  const kinds = listAnomalies(rows)
  assert.deepEqual(kinds.get('p1'), { kind: 'duplicate', refundCandidate: true })
  assert.deepEqual(kinds.get('p3'), { kind: 'duplicate', refundCandidate: false })
  assert.deepEqual(kinds.get('p2'), { kind: 'review', refundCandidate: false }, 'alone on the page: not called late without the order')
  assert.deepEqual(kinds.get('p4'), { kind: 'review', refundCandidate: false }, 'a future anomaly kind is still shown, as to review')
})

test('one payment: late, duplicate and amount mismatch, each with the next step', () => {
  const payment = { id: 'p1', status: 'SUCCESS', amount: 30000, paidAt: '2026-11-11T02:00:00Z', createdAt: '2026-11-11T01:00:00Z' }
  const late = paymentFindings(payment, { status: 'CANCELLED', payments: [payment] })
  assert.deepEqual(late.map(item => item.kind), ['late'])
  assert.match(late[0].text, /hoàn tiền thủ công/)
  const twin = { id: 'p0', status: 'SUCCESS', paidAt: '2026-11-11T01:30:00Z' }
  const second = paymentFindings(payment, { status: 'COMPLETED', payments: [twin, payment] })
  assert.deepEqual(second.map(item => [item.kind, item.refundCandidate]), [['duplicate', true]])
  assert.deepEqual(paymentFindings({ ...twin, amount: 30000 }, { status: 'COMPLETED', payments: [twin, payment] }).map(item => item.refundCandidate), [false])
  assert.deepEqual(paymentFindings(payment, { status: 'COMPLETED', payments: [payment] }), [], 'a normal payment needs nothing')
  assert.deepEqual(paymentFindings({ ...payment, status: 'EXPIRED' }, { status: 'CANCELLED', payments: [] }), [], 'no money, nothing to refund')
  assert.deepEqual(paymentFindings(payment, { status: 'PAYMENT_FAILED', payments: [payment] }), [], 'late is only CANCELLED, as the backend')
  const mismatch = paymentFindings({ ...payment, status: 'EXPIRED' }, undefined, 1)
  assert.deepEqual(mismatch.map(item => item.kind), ['mismatch'])
  assert.deepEqual(paymentFindings(payment, undefined, 0), [])
})

test('amount inside a webhook body: MOCK at the top, payOS under data; anything else is unknown', () => {
  assert.equal(payloadAmount('{"paymentReference":"R","amount":35000.00}'), 35000)
  assert.equal(payloadAmount('{"code":"00","data":{"orderCode":123,"amount":20000}}'), 20000)
  assert.equal(payloadAmount('{"amount":"1000"}'), 1000)
  // The real backend sends rawPayload as a JSON object (jsonb), not a string.
  assert.equal(payloadAmount({ paymentReference: 'R', amount: 35000 }), 35000)
  assert.equal(payloadAmount({ code: '00', data: { amount: 20000 } }), 20000)
  assert.equal(payloadAmount({ data: null }), undefined)
  assert.equal(payloadAmount(42), undefined)
  assert.equal(payloadAmount('{"amount":"1e9"}'), undefined)
  assert.equal(payloadAmount('[1,2]'), undefined)
  assert.equal(payloadAmount('not json'), undefined)
  assert.equal(payloadAmount(null), undefined)
  assert.ok(sameAmount(35000, 35000.001) && !sameAmount(35000, 35001) && !sameAmount(undefined, 1))
  assert.equal(webhookAmountCheck({ verified: true, eventType: 'PAYMENT_SUCCESS' }, 1000, 30000), 'mismatch')
  assert.equal(webhookAmountCheck({ verified: true, eventType: 'PAYMENT_SUCCESS' }, 30000, 30000), 'match')
  // Backend rule (PaymentConfirmationService): SUCCESS without an amount is a mismatch; FAILED only with another amount.
  assert.equal(webhookAmountCheck({ verified: true, eventType: 'PAYMENT_SUCCESS' }, undefined, 30000), 'missing')
  assert.ok(isMismatch('missing') && isMismatch('mismatch') && !isMismatch('unknown') && !isMismatch('not-checked'))
  assert.equal(webhookAmountCheck({ verified: true, eventType: 'PAYMENT_FAILED' }, 1000, 30000), 'mismatch')
  assert.equal(webhookAmountCheck({ verified: true, eventType: 'PAYMENT_FAILED' }, undefined, 30000), 'not-checked')
  assert.equal(webhookAmountCheck({ verified: true, eventType: 'PAYMENT_FAILED' }, 30000, 30000), 'match')
  assert.equal(webhookAmountCheck({ verified: false, eventType: 'PAYMENT_SUCCESS' }, 1000, 30000), 'not-checked', 'a rejected call was never applied')
  assert.equal(webhookAmountCheck({ verified: true, eventType: 'UNKNOWN' }, 1000, 30000), 'not-checked')
  assert.ok(isCheckedWebhook({ verified: true, eventType: 'PAYMENT_FAILED' }) && !isCheckedWebhook({ verified: true, eventType: 'UNKNOWN' }))
  assert.equal(amountVsOrder(60000, 60000), 'match')
  assert.equal(amountVsOrder(30000, 60000), 'mismatch')
  assert.equal(webhookEventText('PAYMENT_SUCCESS'), 'Báo thanh toán thành công')
  assert.equal(webhookEventText('OTHER'), 'OTHER')
})

test('stored payload: a string is kept, an object (real backend) is serialised once, null stays empty; never HTML', () => {
  const stored = '{"b": 1, "a": "<img src=x onerror=alert(1)>"}'
  assert.deepEqual(storedPayload(stored, null), { kind: 'json', text: stored })
  assert.notEqual(prettyPayload(stored, null).text, stored)
  const object = { b: 1, a: '<img src=x onerror=alert(1)>' }
  assert.equal(payloadText(object), '{"b":1,"a":"<img src=x onerror=alert(1)>"}')
  assert.deepEqual(storedPayload(object, null), { kind: 'json', text: '{"b":1,"a":"<img src=x onerror=alert(1)>"}' })
  assert.equal(prettyPayload(object, null).text, '{\n  "b": 1,\n  "a": "<img src=x onerror=alert(1)>"\n}')
  assert.equal(payloadText(null), null)
  assert.equal(payloadText(undefined), null)
  assert.equal(payloadText([1, 'x']), '[1,"x"]')
  assert.deepEqual(storedPayload(null, '<script>x</script>'), { kind: 'raw', text: '<script>x</script>' })
  assert.deepEqual(storedPayload(null, null), { kind: 'none', text: '' })
})

// ---- mock rows behind the done criterion

function setup() {
  const state = { token: null }
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.parse('2026-11-11T03:00:00Z'), realFetch: async () => jsonResponse(404, {}) })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}
async function signIn(state, account = 'admin') {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`

test('mock: "Cần xử lý" lists the late payment and both payments of the duplicate, nothing else', async () => {
  const state = setup()
  await signIn(state)
  const rows = (await paymentsApi.list({ requiresAttention: true, size: 100 })).content
  assert.deepEqual(rows.map(row => row.id).sort(), [id('a0000000', 1), id('a0000000', 4), id('a0000000', 99)])
  assert.ok(rows.every(row => row.status === 'SUCCESS'))
  const kinds = listAnomalies(rows)
  assert.equal(kinds.get(id('a0000000', 99)).refundCandidate, true, 'the duplicate paid later is the one to refund')
  assert.equal(kinds.get(id('a0000000', 4)).kind, 'review')
  assert.equal((await ordersApi.get(id('90000000', 4))).status, 'CANCELLED', 'the lone one is the late payment')
})

test('mock: rawPayload is a JSON object like the real backend; a non-JSON body is only in rawBody', async () => {
  const state = setup()
  await signIn(state)
  const json = await webhookLogsApi.get(id('b0000000', 1))
  assert.equal(typeof json.rawPayload, 'object')
  assert.equal(json.rawBody, null)
  const markup = await webhookLogsApi.get(id('b0000000', 10))
  assert.equal(markup.rawPayload, null)
  assert.match(markup.rawBody, /<script>/)
})

test('mock: every verified success body matches its payment, except the seeded amount mismatch', async () => {
  const state = setup()
  await signIn(state)
  const payments = (await paymentsApi.list({ size: 100 })).content
  const logs = (await webhookLogsApi.list({ size: 100, verified: true })).content.filter(log => log.eventType === 'PAYMENT_SUCCESS')
  const mismatches = []
  for (const log of logs) {
    const detail = await webhookLogsApi.get(log.id)
    const payment = payments.find(row => row.paymentReference === log.reference)
    assert.ok(payment, `payment for ${log.reference}`)
    if (!sameAmount(payloadAmount(detail.rawPayload), payment.amount)) mismatches.push([log.id, payment.id, payloadAmount(detail.rawPayload)])
  }
  assert.deepEqual(mismatches, [[id('b2000000', 24), id('a0000000', 24), 1000]])
  // The two-bowl order (6.1 doubled its total): its webhook now says the doubled amount.
  const mixed = await ordersApi.get(id('90000000', 3))
  const mixedPayment = payments.find(row => row.orderId === mixed.id)
  const mixedLog = await webhookLogsApi.get((await webhookLogsApi.list({ reference: mixedPayment.paymentReference })).content[0].id)
  assert.equal(payloadAmount(mixedLog.rawPayload), mixed.totalAmount)
  assert.equal(mixed.totalAmount, 60000)
  // The mismatch is found from its payment: webhooks by reference, then each body's amount.
  const target = await paymentsApi.get(id('a0000000', 24))
  assert.equal(target.status, 'EXPIRED', 'a mismatch leaves the payment unchanged')
  const related = (await webhookLogsApi.list({ reference: target.paymentReference })).content
  const checks = await Promise.all(related.filter(isCheckedWebhook).map(async log => webhookAmountCheck(log, payloadAmount((await webhookLogsApi.get(log.id)).rawPayload), target.amount)))
  assert.deepEqual(paymentFindings(target, await ordersApi.get(target.orderId), checks.filter(isMismatch).length).map(item => item.kind), ['mismatch'])
})

test('mock: payments and webhook logs are ADMIN only', async () => {
  const state = setup()
  await signIn(state, 'staff')
  await assert.rejects(paymentsApi.list({ requiresAttention: true }), error => error.status === 403)
  await assert.rejects(webhookLogsApi.get(id('b0000000', 1)), error => error.status === 403)
})
