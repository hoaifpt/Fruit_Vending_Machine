// FE 8.1 Ghi nhận hoàn tiền (T3 / W-12): pure rules (URL filters, which payment can be refunded, why not, form, error
// texts), the ADMIN-only permission, and the mock of the draft contract api-contract/drafts/refunds.yaml (a second
// refund is refused with 409, STAFF gets 403).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, ordersApi, paymentsApi, refundsApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { can } from '../src/admin/permissions.ts'
import { NAV, canOpen, matchRoute, navFor } from '../src/admin/routes.ts'
import { describeFormFailure } from '../src/admin/form-error.ts'
import {
  REFUND_BAD_PAYMENT, REFUND_CONFLICT, REFUND_NOT_FOUND, REFUND_SUCCESS_TITLE, attentionPaymentsQuery, blockedText, failedOrdersQuery,
  pageValue, paymentRowAction, readRefundFilters, refundActionError, refundBody, refundCase, refundEntry, refundListQuery, refundOf,
  refundPathFor, refundReasonLabel, refundSuccessText, refundedText, refundsMissing, validateRefund,
} from '../src/admin/refunds.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORDER_FAILED = id('90000000', 8), PAY_FAILED = id('a0000000', 8)
const ORDER_LATE = id('90000000', 4), PAY_LATE = id('a0000000', 4)
const ORDER_DUP = id('90000000', 1), PAY_DUP_FIRST = id('a0000000', 1), PAY_DUP_LATER = id('a0000000', 99)
const ORDER_REFUNDED = id('90000000', 10), PAY_REFUNDED = id('a0000000', 10)
const ORDER_COMPLETED = id('90000000', 2)
const MACHINE_1 = '20000000-0000-0000-0000-000000000001'

function setup() {
  const state = { token: null, clock: Date.parse('2026-11-30T03:00:00Z'), search: '' }
  const fetcher = createMockFetcher(parseSelection('all'), { now: () => state.clock, getSearch: () => state.search })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return { state, fetcher }
}
async function signIn(state, account) {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
async function rejects(promise, status, check = () => true) {
  await assert.rejects(promise, error => error instanceof ApiError && error.status === status && check(error))
}

// ---- permission: ADMIN only, never STAFF

test('REFUND_RECORD is ADMIN only: STAFF sees no menu and the route is refused before the screen mounts', () => {
  assert.equal(can(['ADMIN'], 'REFUND_RECORD'), true)
  assert.equal(can(['STAFF'], 'REFUND_RECORD'), false)
  assert.deepEqual(matchRoute('/admin/refunds'), { page: 'refunds', id: undefined, permission: 'REFUND_RECORD', roles: ['ADMIN'] })
  assert.equal(canOpen(['STAFF'], matchRoute('/admin/refunds')), false)
  assert.equal(canOpen(['ADMIN'], matchRoute('/admin/refunds')), true)
  assert.equal(navFor(['STAFF']).some(item => item.to === '/admin/refunds'), false)
  const item = NAV.find(entry => entry.to === '/admin/refunds')
  assert.equal(item.group, 'Giao dịch')
  assert.equal(item.label, 'Hoàn tiền')
  // Once GET /auth/me lists permissions, an admin account without the code loses the screen too.
  assert.equal(canOpen({ roles: ['ADMIN'], permissions: ['PAYMENT_READ'] }, matchRoute('/admin/refunds')), false)
})

// ---- URL filters and queries

test('URL filters keep only contract values; each list sends only contract parameters', () => {
  const filters = readRefundFilters(new URLSearchParams('view=weird&orderId=nope&machineId=' + MACHINE_1 + '&reason=LOST&from=2026-11-01&to=bad&sort=transferRef,asc&page=-1&failedPage=2&paymentPage=x'))
  assert.equal(filters.view, 'pending')
  assert.equal(filters.orderId, '')
  assert.equal(filters.machineId, MACHINE_1)
  assert.equal(filters.reason, '')
  assert.equal(filters.from, '2026-11-01')
  assert.equal(filters.to, '')
  assert.deepEqual(filters.sort, { field: 'refundedAt', direction: 'desc' })
  assert.equal(filters.page, 0)
  assert.equal(filters.failedPage, 2)
  assert.equal(filters.paymentPage, 0)
  assert.deepEqual(failedOrdersQuery(filters, 20), { page: 2, size: 20, sort: 'createdAt,desc', status: 'DISPENSE_FAILED', machineId: MACHINE_1 })
  assert.deepEqual(attentionPaymentsQuery(filters, 20), { page: 0, size: 20, sort: 'paidAt,desc', requiresAttention: true, machineId: MACHINE_1 })
  const refunded = readRefundFilters(new URLSearchParams('view=refunded&reason=PAYMENT_LATE&from=2026-11-09&to=2026-11-09&sort=amount,asc&page=3'))
  assert.deepEqual(refundListQuery(refunded, 20), {
    page: 3, size: 20, sort: 'amount,asc', machineId: undefined, reason: 'PAYMENT_LATE',
    refundedFrom: '2026-11-08T17:00:00.000Z', refundedTo: '2026-11-09T17:00:00.000Z',
  })
  assert.equal(pageValue(0), undefined)
  assert.equal(pageValue(2), '2')
  assert.equal(refundPathFor(ORDER_FAILED), `/admin/refunds?orderId=${ORDER_FAILED}`)
  assert.equal(refundPathFor('not-a-uuid'), '/admin/refunds')
})

// ---- which payment can be refunded

const pay = (paymentId, status, paidAt, amount = 35000) => ({ id: paymentId, provider: 'MOCK', status, amount, createdAt: paidAt, paidAt })

test('refundCase: failed dispense, late payment and the later duplicate are refundable', () => {
  const failed = refundCase({ status: 'DISPENSE_FAILED', payments: [pay('p1', 'SUCCESS', '2026-11-09T06:00:00Z')] })
  assert.equal(failed.kind, 'ready'); assert.equal(failed.reason, 'DISPENSE_FAILED'); assert.equal(failed.paymentId, 'p1'); assert.equal(failed.amount, 35000)
  const late = refundCase({ status: 'CANCELLED', payments: [pay('p1', 'EXPIRED', null), pay('p2', 'SUCCESS', '2026-11-09T06:00:00Z')] }, 'p2')
  assert.equal(late.kind, 'ready'); assert.equal(late.reason, 'PAYMENT_LATE')
  const order = { status: 'COMPLETED', payments: [pay('first', 'SUCCESS', '2026-11-09T06:00:00Z'), pay('later', 'SUCCESS', '2026-11-09T06:03:00Z')] }
  const later = refundCase(order, 'later')
  assert.equal(later.kind, 'ready'); assert.equal(later.reason, 'PAYMENT_DUPLICATE')
  // Without a payment, the later one is chosen.
  assert.equal(refundCase(order).paymentId, 'later')
  assert.equal(refundReasonLabel('PAYMENT_DUPLICATE'), 'Thanh toán trùng')
})

test('refundCase blocks a second refund and anything that is not a refund case, with the reason', () => {
  const refunded = refundCase({ status: 'REFUNDED', payments: [pay('p1', 'REFUNDED', '2026-11-09T06:00:00Z')] })
  assert.deepEqual([refunded.kind, refunded.why, refunded.paymentId], ['blocked', 'refunded', 'p1'])
  assert.equal(refundCase({ status: 'COMPLETED', payments: [pay('p1', 'REFUNDED', null)] }, 'p1').why, 'refunded')
  const dup = { status: 'COMPLETED', payments: [pay('first', 'SUCCESS', '2026-11-09T06:00:00Z'), pay('later', 'SUCCESS', '2026-11-09T06:03:00Z')] }
  assert.equal(refundCase(dup, 'first').why, 'kept')
  // Once the later duplicate is refunded, the earlier one is no longer a case.
  assert.equal(refundCase({ status: 'COMPLETED', payments: [dup.payments[0], { ...dup.payments[1], status: 'REFUNDED' }] }, 'first').why, 'not-case')
  assert.equal(refundCase({ status: 'COMPLETED', payments: [pay('p1', 'SUCCESS', '2026-11-09T06:00:00Z')] }).why, 'not-case')
  assert.equal(refundCase({ status: 'CANCELLED', payments: [pay('p1', 'EXPIRED', null)] }, 'p1').why, 'not-success')
  assert.equal(refundCase({ status: 'PENDING_PAYMENT', payments: [] }).why, 'no-payment')
  assert.equal(refundCase({ status: 'DISPENSE_FAILED', payments: [] }, 'missing').why, 'unknown-payment')

  const refund = { refundedAt: '2026-11-09T06:05:00Z', transferRef: 'FT26316123456789', refundedByName: 'Quản trị viên' }
  assert.equal(refundedText(refund), 'Đã hoàn tiền lúc 09/11/2026 13:05, mã CK FT26316123456789, người ghi nhận Quản trị viên.')
  assert.equal(refundedText({ ...refund, refundedByName: null }), 'Đã hoàn tiền lúc 09/11/2026 13:05, mã CK FT26316123456789.')
  assert.match(blockedText(refunded, refund), /^Đã hoàn tiền lúc 09\/11\/2026 13:05, mã CK FT26316123456789.*Không ghi nhận lần nữa/)
  assert.match(blockedText(refunded), /đã được hoàn tiền trước đó/)
  assert.match(blockedText(refundCase(dup, 'first')), /được tính cho đơn nên không hoàn/)
  assert.match(blockedText(refundCase({ status: 'CANCELLED', payments: [pay('p1', 'EXPIRED', null)] }, 'p1')), /đã hết hạn nên không có tiền để hoàn/)
  assert.equal(refundOf([{ paymentId: 'p1', transferRef: 'X' }], 'p1').transferRef, 'X')
  assert.equal(refundOf(undefined, 'p1'), undefined)
})

test('entries from the order/payment detail and the list rows', () => {
  assert.equal(refundEntry({ status: 'DISPENSE_FAILED', payments: [pay('p1', 'SUCCESS', 'x')] }), 'record')
  assert.equal(refundEntry({ status: 'REFUNDED', payments: [pay('p1', 'REFUNDED', 'x')] }), 'refunded')
  assert.equal(refundEntry({ status: 'COMPLETED', payments: [pay('p1', 'SUCCESS', 'x')] }, 'p1'), null)
  assert.equal(refundEntry(undefined), null)
  assert.equal(paymentRowAction({ kind: 'duplicate', refundCandidate: false }), 'kept')
  assert.equal(paymentRowAction({ kind: 'duplicate', refundCandidate: true }), 'record')
  assert.equal(paymentRowAction({ kind: 'review', refundCandidate: false }), 'record')
  assert.equal(paymentRowAction(undefined), 'record')
})

// ---- form, body, messages

test('form: transfer reference required, 3–64 safe characters, note ≤ 500; body sends only contract fields', () => {
  assert.deepEqual(Object.keys(validateRefund({ transferRef: '   ', note: '' })), ['transferRef'])
  assert.match(validateRefund({ transferRef: 'FT 123', note: '' }).transferRef, /không có khoảng trắng/)
  assert.match(validateRefund({ transferRef: 'ab', note: '' }).transferRef, /Tối thiểu 3/)
  assert.match(validateRefund({ transferRef: 'A'.repeat(65), note: '' }).transferRef, /Tối đa 64/)
  assert.match(validateRefund({ transferRef: '-abc', note: '' }).transferRef, /bắt đầu bằng chữ hoặc số/)
  assert.match(validateRefund({ transferRef: 'FT1', note: 'x'.repeat(501) }).note, /Tối đa 500/)
  assert.deepEqual(validateRefund({ transferRef: ' FT26316.12/3_4-5 ', note: 'ok' }), {})
  assert.deepEqual(refundBody({ transferRef: ' FT123 ', note: '   ' }, 'p1'), { transferRef: 'FT123', paymentId: 'p1' })
  assert.deepEqual(refundBody({ transferRef: 'FT123', note: ' VCB ' }, 'p1'), { transferRef: 'FT123', paymentId: 'p1', note: 'VCB' })
})

test('messages: MSG36 on success, 409 and 404 explained with the next step, paymentId 400 at form level', () => {
  assert.equal(REFUND_SUCCESS_TITLE, 'Đã ghi nhận hoàn tiền')
  assert.equal(refundSuccessText('ORD-20261109-00000008'), 'Thanh toán của đơn ORD-20261109-00000008 đã được đánh dấu hoàn tiền.')
  const conflict = refundActionError(new ApiError(409, 'Payment is already REFUNDED'))
  assert.equal(conflict.status, 409)
  assert.equal(conflict.message, REFUND_CONFLICT)
  assert.match(REFUND_CONFLICT, /vừa được hoàn tiền/)
  assert.equal(describeFormFailure(conflict).message, REFUND_CONFLICT)
  assert.equal(refundActionError(new ApiError(404, 'x')).message, REFUND_NOT_FOUND)
  const bad = refundActionError(new ApiError(400, 'Validation Failed', { paymentId: 'Required', transferRef: 'must match' }))
  assert.equal(bad.message, REFUND_BAD_PAYMENT)
  assert.deepEqual(bad.fieldErrors, { transferRef: 'must match' })
  const plain = new ApiError(400, 'Validation Failed', { transferRef: 'must not be blank' })
  assert.equal(refundActionError(plain), plain)
  assert.equal(refundsMissing(new ApiError(404, 'x')), true)
  assert.equal(refundsMissing(new ApiError(500, 'x')), false)
})

// ---- mock of the draft contract

test('mock: groups, and the seed has a failed dispense, a late payment, a duplicate pair and recorded refunds', async () => {
  assert.equal(groupOf(`/orders/${ORDER_FAILED}/refund`), 'refunds')
  assert.equal(groupOf('/refunds'), 'refunds')
  assert.equal(groupOf(`/orders/${ORDER_FAILED}`), 'orders')
  const { state } = setup()
  await signIn(state, 'admin')
  assert.ok((await ordersApi.list({ status: 'DISPENSE_FAILED', page: 0, size: 100 })).content.some(order => order.id === ORDER_FAILED))
  const attention = (await paymentsApi.list({ requiresAttention: true, page: 0, size: 100 })).content.map(payment => payment.id).sort()
  assert.deepEqual(attention, [PAY_DUP_FIRST, PAY_LATE, PAY_DUP_LATER].sort())
  const refunds = await refundsApi.list({ page: 0, size: 100 })
  assert.ok(refunds.totalElements >= 1)
  const seeded = refunds.content.find(refund => refund.paymentId === PAY_REFUNDED)
  assert.equal(seeded.orderId, ORDER_REFUNDED)
  assert.equal(seeded.paymentStatus, 'REFUNDED')
  assert.match(seeded.transferRef, /^[A-Za-z0-9][A-Za-z0-9._/-]{2,63}$/)
  assert.deepEqual((await refundsApi.list({ orderId: ORDER_REFUNDED, page: 0, size: 5 })).content.map(refund => refund.paymentId), [PAY_REFUNDED])
})

test('mock: recording a failed dispense refunds payment and order; the second recording is 409', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const refund = await refundsApi.record(ORDER_FAILED, { transferRef: 'FT26316000000001', paymentId: PAY_FAILED, note: 'VCB' })
  assert.equal(refund.paymentStatus, 'REFUNDED')
  assert.equal(refund.orderStatus, 'REFUNDED')
  assert.equal(refund.reason, 'DISPENSE_FAILED')
  assert.equal(refund.refundedAt, new Date(state.clock).toISOString())
  assert.ok(refund.refundedByName)
  const order = await ordersApi.get(ORDER_FAILED)
  assert.equal(order.status, 'REFUNDED')
  assert.equal(order.payments.find(payment => payment.id === PAY_FAILED).status, 'REFUNDED')
  assert.equal(refundCase(order, PAY_FAILED).why, 'refunded')
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: 'FT26316000000002', paymentId: PAY_FAILED }), 409, error => error.message === 'Payment is already REFUNDED')
  // Without paymentId the only payment is meant: still 409.
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: 'FT26316000000002' }), 409)
  assert.equal((await refundsApi.list({ orderId: ORDER_FAILED, page: 0, size: 5 })).totalElements, 1)
})

test('mock: a late payment keeps the order CANCELLED and leaves the "Cần xử lý" list', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const refund = await refundsApi.record(ORDER_LATE, { transferRef: 'FT-LATE-01', paymentId: PAY_LATE })
  assert.deepEqual([refund.reason, refund.orderStatus, refund.paymentStatus], ['PAYMENT_LATE', 'CANCELLED', 'REFUNDED'])
  const attention = (await paymentsApi.list({ requiresAttention: true, page: 0, size: 100 })).content.map(payment => payment.id)
  assert.equal(attention.includes(PAY_LATE), false)
})

test('mock: a duplicate needs paymentId; after the later one is refunded the earlier one is 409', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  await rejects(refundsApi.record(ORDER_DUP, { transferRef: 'FT-DUP-01' }), 400, error => !!error.fieldErrors.paymentId)
  const refund = await refundsApi.record(ORDER_DUP, { transferRef: 'FT-DUP-01', paymentId: PAY_DUP_LATER })
  assert.deepEqual([refund.reason, refund.orderStatus], ['PAYMENT_DUPLICATE', 'COMPLETED'])
  await rejects(refundsApi.record(ORDER_DUP, { transferRef: 'FT-DUP-02', paymentId: PAY_DUP_FIRST }), 409, error => error.message === 'Order is not a refund case')
  const attention = (await paymentsApi.list({ requiresAttention: true, page: 0, size: 100 })).content.map(payment => payment.id)
  assert.deepEqual(attention, [PAY_LATE])
})

test('mock: validation 400, unknown order or payment 404, not a refund case 409', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: '  ', paymentId: PAY_FAILED }), 400, error => !!error.fieldErrors.transferRef)
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: 'FT 1', paymentId: PAY_FAILED }), 400, error => !!error.fieldErrors.transferRef)
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: 'FT1', paymentId: PAY_FAILED, note: 'x'.repeat(501) }), 400, error => !!error.fieldErrors.note)
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: 'FT1', paymentId: 'nope' }), 400, error => !!error.fieldErrors.paymentId)
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: 'FT1', paymentId: PAY_FAILED, amount: 1 }), 400, error => !!error.fieldErrors.amount)
  await rejects(refundsApi.record(id('90000000', 999), { transferRef: 'FT1' }), 404)
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: 'FT1', paymentId: PAY_LATE }), 404)
  await rejects(refundsApi.record(ORDER_COMPLETED, { transferRef: 'FT1' }), 409, error => error.message === 'Order is not a refund case')
  await rejects(refundsApi.list({ page: 0, size: 5, sort: 'transferRef,asc' }), 400)
})

test('mock: STAFF is refused (403) on recording and on reading refunds; nothing changes', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: 'FT1', paymentId: PAY_FAILED }), 403)
  await rejects(refundsApi.list({ page: 0, size: 5 }), 403)
  assert.equal((await ordersApi.get(ORDER_FAILED)).status, 'DISPENSE_FAILED')
  state.token = null
  await rejects(refundsApi.record(ORDER_FAILED, { transferRef: 'FT1', paymentId: PAY_FAILED }), 401)
})

test('the draft contract: endpoints, body limits, 409, ADMIN-only permission, no delete', () => {
  const yaml = readFileSync(`${root}api-contract/drafts/refunds.yaml`, 'utf8').replace(/\r\n/g, '\n')
  for (const path of ['/api/v1/orders/{orderId}/refund:', '/api/v1/refunds:']) assert.ok(yaml.includes(path), path)
  for (const field of ['transferRef', 'note', 'paymentId', 'refundedAt', 'refundedByName', 'reason']) assert.match(yaml, new RegExp(`\\n        ${field}:`), field)
  assert.match(yaml, /maxLength: 64/)
  assert.match(yaml, /maxLength: 500/)
  assert.match(yaml, /"409":/)
  assert.match(yaml, /x-required-permission: REFUND_RECORD/)
  assert.match(yaml, /never granted to\s+STAFF/)
  assert.doesNotMatch(yaml, /\n\s+delete:/)
  const readme = readFileSync(`${root}api-contract/drafts/README.md`, 'utf8')
  assert.match(readme, /`refunds\.yaml`/)
})
