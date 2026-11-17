// FE 8.1 Ghi nhận hoàn tiền (T3 / W-12) on the real API of backend #72 (api.yaml, docs/refunds.md): pure rules (URL
// filters, which payment can be refunded and with which reasons, why not, form, 409 codes), the ADMIN-only permissions
// (REFUND_READ, PAYMENT_REFUND), and the mock of POST /payments/{id}/refund, GET /refunds, /refunds/candidates and
// /refunds/summary (a second refund is refused with 409, STAFF gets 403).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, ordersApi, paymentsApi, refundsApi, workOrdersApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { can } from '../src/admin/permissions.ts'
import { NAV, canOpen, matchRoute, navFor } from '../src/admin/routes.ts'
import { describeFormFailure } from '../src/admin/form-error.ts'
import {
  NO_PAYER, REFUND_BAD_WORK_ORDER, REFUND_CONFLICT, REFUND_IN_PROGRESS, REFUND_MISMATCH, REFUND_NOT_FOUND, REFUND_REF_USED, REFUND_SUCCESS_TITLE, blockedText,
  candidateQuery, candidateTypeLabel, defaultReason, pageValue, payerLines, payingPayment, readRefundFilters, refundActionError, refundBody, refundCase, refundEntry,
  refundListQuery, refundOf, refundPathFor, refundReasonLabel, refundSuccessText, refundedText, reloadsAfter, summaryQuery, summaryRows, validateRefund,
} from '../src/admin/refunds.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORDER_FAILED = id('90000000', 8), PAY_FAILED = id('a0000000', 8)
const ORDER_LATE = id('90000000', 4), PAY_LATE = id('a0000000', 4)
const ORDER_DUP = id('90000000', 1), PAY_DUP_FIRST = id('a0000000', 1), PAY_DUP_LATER = id('a0000000', 99)
const ORDER_REFUNDED = id('90000000', 10), PAY_REFUNDED = id('a0000000', 10)
const ORDER_COMPLETED = id('90000000', 2), PAY_COMPLETED = id('a0000000', 2)
const ORDER_PAID = id('90000000', 6), PAY_PAID = id('a0000000', 6)
const PAY_PENDING = id('a0000000', 5)
const MACHINE_1 = id('20000000', 1), MACHINE_2 = id('20000000', 2)
const ADMIN = id('11000000', 1)

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
const code = prefix => error => error.message.startsWith(`${prefix}:`)
const record = (paymentId, body) => refundsApi.record(paymentId, { transferReference: `FT${Math.random().toString().slice(2, 14)}`, ...body })

// ---- permission: ADMIN only, never STAFF

test('REFUND_READ and PAYMENT_REFUND are ADMIN only: STAFF sees no menu and the route is refused before the screen mounts', () => {
  for (const code of ['PAYMENT_REFUND', 'REFUND_READ']) {
    assert.equal(can(['ADMIN'], code), true)
    assert.equal(can(['STAFF'], code), false)
  }
  assert.deepEqual(matchRoute('/admin/refunds'), { page: 'refunds', id: undefined, permission: 'REFUND_READ', roles: ['ADMIN'] })
  assert.equal(canOpen(['STAFF'], matchRoute('/admin/refunds')), false)
  assert.equal(canOpen(['ADMIN'], matchRoute('/admin/refunds')), true)
  assert.equal(navFor(['STAFF']).some(item => item.to === '/admin/refunds'), false)
  const item = NAV.find(entry => entry.to === '/admin/refunds')
  assert.equal(item.group, 'Giao dịch')
  assert.equal(item.label, 'Hoàn tiền')
  assert.equal(canOpen({ roles: ['ADMIN'], permissions: ['PAYMENT_READ'] }, matchRoute('/admin/refunds')), false)
})

// ---- URL filters and queries

test('URL filters keep only contract values; each list sends only contract parameters (Vietnam days, no sort)', () => {
  const filters = readRefundFilters(new URLSearchParams(`view=weird&orderId=nope&workOrderId=x&machineId=${MACHINE_1}&type=LOST&reason=PAYMENT_LATE&from=2026-11-01&to=bad&page=-1&refundedBy=${ADMIN}`))
  assert.deepEqual(filters, { view: 'pending', orderId: '', workOrderId: '', machineId: MACHINE_1, type: '', reason: '', refundedBy: ADMIN, from: '2026-11-01', to: '', page: 0 })
  assert.deepEqual(candidateQuery({ ...filters, type: 'CUSTOMER_REPORT', page: 2 }, 20), { page: 2, size: 20, type: 'CUSTOMER_REPORT', machineId: MACHINE_1, from: '2026-11-01', to: undefined })
  const refunded = readRefundFilters(new URLSearchParams('view=refunded&reason=LATE_PAYMENT&from=2026-11-09&to=2026-11-01&page=3'))
  assert.deepEqual([refunded.from, refunded.to], ['2026-11-01', '2026-11-09'], 'a reversed range is put in order')
  assert.deepEqual(refundListQuery(refunded, 20), { page: 3, size: 20, reason: 'LATE_PAYMENT', machineId: undefined, refundedBy: undefined, from: '2026-11-01', to: '2026-11-09' })
  assert.ok(!('sort' in refundListQuery(refunded, 20)) && !('sort' in candidateQuery(refunded, 20)))
  assert.deepEqual(summaryQuery(refunded), { from: '2026-11-01', to: '2026-11-09', machineId: undefined })
  assert.equal(pageValue(0), undefined)
  assert.equal(pageValue(2), '2')
  assert.equal(refundPathFor(ORDER_FAILED), `/admin/refunds?orderId=${ORDER_FAILED}`)
  assert.equal(refundPathFor(ORDER_FAILED, id('61000000', 1)), `/admin/refunds?orderId=${ORDER_FAILED}&workOrderId=${id('61000000', 1)}`)
  assert.equal(refundPathFor('not-a-uuid'), '/admin/refunds')
  assert.deepEqual(summaryRows({ byReason: [{ reason: 'OTHER', count: 2, totalAmount: 70000 }] }).map(row => [row.reason, row.count, row.totalAmount]), [
    ['DISPENSE_FAILED', 0, 0], ['LATE_PAYMENT', 0, 0], ['DUPLICATE_PAYMENT', 0, 0], ['PRODUCT_QUALITY', 0, 0], ['OTHER', 2, 70000],
  ])
})

// ---- which payment can be refunded, with which reasons

const pay = (paymentId, status, paidAt, amount = 35000) => ({ id: paymentId, provider: 'MOCK', status, amount, createdAt: paidAt, paidAt })

test('refundCase follows docs/refunds.md: reasons per case, expected or only on a complaint', () => {
  const failed = refundCase({ status: 'DISPENSE_FAILED', payments: [pay('p1', 'SUCCESS', '2026-11-09T06:00:00Z')] })
  assert.deepEqual([failed.kind, failed.paymentId, failed.amount, failed.reasons, failed.expected], ['ready', 'p1', 35000, ['DISPENSE_FAILED', 'OTHER'], true])
  const late = refundCase({ status: 'CANCELLED', payments: [pay('p1', 'EXPIRED', null), pay('p2', 'SUCCESS', '2026-11-09T06:00:00Z')] }, 'p2')
  assert.deepEqual([late.kind, late.reasons, late.expected], ['ready', ['LATE_PAYMENT'], true])
  const dup = { status: 'COMPLETED', payments: [pay('first', 'SUCCESS', '2026-11-09T06:00:00Z'), pay('later', 'SUCCESS', '2026-11-09T06:03:00Z')] }
  assert.equal(payingPayment(dup).id, 'first')
  assert.deepEqual(refundCase(dup, 'later').reasons, ['DUPLICATE_PAYMENT'])
  const delivered = refundCase(dup, 'first')
  assert.deepEqual([delivered.kind, delivered.reasons, delivered.expected], ['ready', ['PRODUCT_QUALITY', 'OTHER'], false])
  // Without a payment: the expected case first (the later duplicate), never the delivered one.
  assert.equal(refundCase(dup).paymentId, 'later')
  assert.equal(refundReasonLabel('DUPLICATE_PAYMENT'), 'Thanh toán trùng')
  assert.equal(candidateTypeLabel('CUSTOMER_REPORT'), 'Khách phản ánh')
  assert.equal(defaultReason(['PRODUCT_QUALITY', 'OTHER'], 'CUSTOMER_REPORT'), 'PRODUCT_QUALITY')
  assert.equal(defaultReason(['DISPENSE_FAILED', 'OTHER'], 'DISPENSE_FAILED'), 'DISPENSE_FAILED')
  assert.equal(defaultReason([], 'LATE_PAYMENT'), '')
})

test('refundCase blocks a second refund, an unfinished order and anything without money, with the reason', () => {
  const refunded = refundCase({ status: 'REFUNDED', payments: [pay('p1', 'REFUNDED', '2026-11-09T06:00:00Z')] })
  assert.deepEqual([refunded.kind, refunded.why, refunded.paymentId], ['blocked', 'refunded', 'p1'])
  assert.equal(refundCase({ status: 'PAID', payments: [pay('p1', 'SUCCESS', '2026-11-09T06:00:00Z')] }, 'p1').why, 'in-progress')
  assert.equal(refundCase({ status: 'DISPENSING', payments: [pay('p1', 'SUCCESS', '2026-11-09T06:00:00Z')] }).why, 'in-progress')
  assert.equal(refundCase({ status: 'CANCELLED', payments: [pay('p1', 'EXPIRED', null)] }, 'p1').why, 'not-success')
  assert.equal(refundCase({ status: 'PENDING_PAYMENT', payments: [] }).why, 'no-payment')
  assert.equal(refundCase({ status: 'DISPENSE_FAILED', payments: [] }, 'missing').why, 'unknown-payment')
  assert.equal(refundCase({ status: 'PAYMENT_FAILED', payments: [pay('p1', 'SUCCESS', '2026-11-09T06:00:00Z')] }, 'p1').why, 'not-case')

  const refund = { refundedAt: '2026-11-09T06:05:00Z', transferReference: 'FT26316123456789', refundedBy: { id: ADMIN, fullName: 'Quản trị viên' } }
  assert.equal(refundedText(refund), 'Đã hoàn tiền lúc 09/11/2026 13:05, mã CK FT26316123456789, người ghi nhận Quản trị viên.')
  assert.equal(refundedText({ ...refund, refundedBy: undefined }), 'Đã hoàn tiền lúc 09/11/2026 13:05, mã CK FT26316123456789.')
  assert.match(blockedText(refunded, refund), /^Đã hoàn tiền lúc 09\/11\/2026 13:05, mã CK FT26316123456789.*Không ghi nhận lần nữa/)
  assert.match(blockedText(refunded), /đã được hoàn tiền trước đó/)
  assert.match(blockedText({ kind: 'blocked', why: 'in-progress' }), /Chờ máy báo kết quả/)
  assert.match(blockedText(refundCase({ status: 'CANCELLED', payments: [pay('p1', 'EXPIRED', null)] }, 'p1')), /đã hết hạn nên không có tiền để hoàn/)
  assert.equal(refundOf([{ paymentId: 'p1', transferReference: 'X' }], 'p1').transferReference, 'X')
  assert.equal(refundOf(undefined, 'p1'), undefined)
})

test('entries from the order/payment detail: only expected refunds, or the refund already recorded', () => {
  assert.equal(refundEntry({ status: 'DISPENSE_FAILED', payments: [pay('p1', 'SUCCESS', 'x')] }), 'record')
  assert.equal(refundEntry({ status: 'REFUNDED', payments: [pay('p1', 'REFUNDED', 'x')] }), 'refunded')
  assert.equal(refundEntry({ status: 'COMPLETED', payments: [pay('p1', 'SUCCESS', 'x')] }, 'p1'), null, 'a delivered order is refunded from a report, not suggested')
  assert.equal(refundEntry(undefined), null)
  assert.deepEqual(payerLines({ accountName: ' NGUYEN VAN AN ', accountNumber: '0071000123456', bankName: 'Vietcombank' }), { name: 'NGUYEN VAN AN', account: '0071000123456', bank: 'Vietcombank' })
  assert.equal(payerLines(null), null)
  assert.equal(payerLines({ accountName: null, accountNumber: null }), null)
  assert.match(NO_PAYER, /Ngân hàng không gửi tài khoản/)
})

// ---- form, body, messages

test('form: reason required and allowed, transfer reference 4–64 safe characters, note ≤ 500 and required for OTHER; body sends only contract fields', () => {
  const valid = { reason: 'DISPENSE_FAILED', transferReference: ' FT26316.12/3_4-5 ', note: '' }
  assert.deepEqual(validateRefund(valid), {})
  assert.deepEqual(Object.keys(validateRefund({ ...valid, reason: '' })), ['reason'])
  assert.match(validateRefund(valid, ['LATE_PAYMENT']).reason, /không áp dụng/)
  assert.match(validateRefund({ ...valid, transferReference: '   ' }).transferReference, /Nhập mã giao dịch/)
  assert.match(validateRefund({ ...valid, transferReference: 'FT 123' }).transferReference, /không có khoảng trắng/)
  assert.match(validateRefund({ ...valid, transferReference: 'FT1' }).transferReference, /Tối thiểu 4/)
  assert.match(validateRefund({ ...valid, transferReference: 'A'.repeat(65) }).transferReference, /Tối đa 64/)
  assert.deepEqual(validateRefund({ ...valid, transferReference: '-abc' }), {}, 'the contract pattern allows a leading dash')
  assert.match(validateRefund({ ...valid, note: 'x'.repeat(501) }).note, /Tối đa 500/)
  assert.match(validateRefund({ ...valid, reason: 'OTHER', note: '  ' }).note, /Lý do khác/)
  assert.deepEqual(refundBody({ reason: 'DISPENSE_FAILED', transferReference: ' FT1234 ', note: '   ' }), { reason: 'DISPENSE_FAILED', transferReference: 'FT1234' })
  assert.deepEqual(refundBody({ reason: 'OTHER', transferReference: 'FT1234', note: ' VCB ' }, id('61000000', 1)), { reason: 'OTHER', transferReference: 'FT1234', note: 'VCB', workOrderId: id('61000000', 1) })
})

test('messages: MSG36 on success, each 409 code explained (reference and reason on their field), 404 and a bad work order at form level', () => {
  assert.equal(REFUND_SUCCESS_TITLE, 'Đã ghi nhận hoàn tiền')
  assert.equal(refundSuccessText('ORD-20261109-00000008'), 'Thanh toán của đơn ORD-20261109-00000008 đã được đánh dấu hoàn tiền.')
  const conflict = refundActionError(new ApiError(409, 'PAYMENT_ALREADY_REFUNDED: the payment is already refunded'))
  assert.equal(conflict.message, REFUND_CONFLICT)
  assert.equal(describeFormFailure(conflict).message, REFUND_CONFLICT)
  const used = refundActionError(new ApiError(409, 'REFUND_TRANSFER_REF_USED: x'))
  assert.deepEqual(describeFormFailure(used).fieldErrors, { transferReference: REFUND_REF_USED })
  assert.equal(reloadsAfter(new ApiError(409, 'REFUND_TRANSFER_REF_USED: x')), false)
  assert.equal(reloadsAfter(new ApiError(409, 'PAYMENT_ALREADY_REFUNDED: x')), true)
  assert.equal(refundActionError(new ApiError(409, 'DISPENSE_IN_PROGRESS: x')).message, REFUND_IN_PROGRESS)
  assert.deepEqual(refundActionError(new ApiError(409, 'REFUND_REASON_MISMATCH: x')).fieldErrors, { reason: REFUND_MISMATCH })
  assert.match(refundActionError(new ApiError(409, 'PAYMENT_NOT_REFUNDABLE: x')).message, /chưa nhận được tiền/)
  assert.match(refundActionError(new ApiError(409, 'Something else')).message, /vừa thay đổi/)
  assert.equal(refundActionError(new ApiError(404, 'x')).message, REFUND_NOT_FOUND)
  const bad = refundActionError(new ApiError(400, 'Validation Failed', { workOrderId: 'Must be an INCIDENT work order', note: 'x' }))
  assert.equal(bad.message, REFUND_BAD_WORK_ORDER)
  assert.deepEqual(bad.fieldErrors, { note: 'x' })
  const plain = new ApiError(400, 'Validation Failed', { transferReference: 'must match' })
  assert.equal(refundActionError(plain), plain)
})

// ---- mock of the real API

test('mock: groups, and "Cần hoàn tiền" lists failed dispenses, the late and the later duplicate payment, oldest first, with the payer', async () => {
  assert.equal(groupOf(`/payments/${PAY_FAILED}/refund`), 'refunds')
  assert.equal(groupOf('/refunds/candidates'), 'refunds')
  assert.equal(groupOf('/refunds/summary'), 'refunds')
  assert.equal(groupOf(`/payments/${PAY_FAILED}`), 'payments')
  const { state } = setup()
  await signIn(state, 'admin')
  const page = await refundsApi.candidates({ page: 0, size: 100 })
  const byPayment = new Map(page.content.map(row => [row.paymentId, row]))
  assert.equal(byPayment.get(PAY_FAILED).type, 'DISPENSE_FAILED')
  assert.equal(byPayment.get(PAY_LATE).type, 'LATE_PAYMENT')
  assert.equal(byPayment.get(PAY_DUP_LATER).type, 'DUPLICATE_PAYMENT')
  assert.equal(byPayment.has(PAY_DUP_FIRST), false, 'the paying payment of a delivered order is no candidate')
  assert.equal(byPayment.has(PAY_PAID), false, 'an order still PAID has no final result')
  assert.equal(byPayment.has(PAY_REFUNDED), false)
  const waits = page.content.map(row => row.waitingSince)
  assert.deepEqual(waits, [...waits].sort(), 'oldest waiting first')
  const failed = byPayment.get(PAY_FAILED)
  assert.deepEqual(failed.order, { id: ORDER_FAILED, orderCode: (await ordersApi.get(ORDER_FAILED)).orderCode, status: 'DISPENSE_FAILED', machineCode: 'DEV-MACHINE-01' })
  assert.equal(failed.waitingSince, failed.paidAt)
  assert.ok(page.content.some(row => row.payer?.accountNumber) && page.content.some(row => !row.payer), 'payer present or null')
  assert.equal((await refundsApi.candidates({ type: 'LATE_PAYMENT', page: 0, size: 100 })).content.map(row => row.paymentId).join(), PAY_LATE)
  assert.ok((await refundsApi.candidates({ machineId: MACHINE_2, page: 0, size: 100 })).content.every(row => row.order.machineCode === 'DEV-MACHINE-02'))
  assert.equal((await refundsApi.candidates({ type: 'CUSTOMER_REPORT', page: 0, size: 100 })).totalElements, 0, 'no customer report in the seed')
  await rejects(refundsApi.candidates({ from: '30/11/2026', page: 0, size: 5 }), 400, error => !!error.fieldErrors.from)
  await rejects(refundsApi.candidates({ type: 'LOST', page: 0, size: 5 }), 400)
})

test('mock: recording a failed dispense refunds payment and order, shows on the order and the payment, and a second recording is 409', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const payment = await refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: ' FT26316000000001 ', note: 'VCB' })
  assert.equal(payment.status, 'REFUNDED')
  assert.deepEqual(payment.refund, { refundedAt: new Date(state.clock).toISOString(), refundedBy: { id: ADMIN, fullName: 'Quản trị viên' }, reason: 'DISPENSE_FAILED', transferReference: 'FT26316000000001', note: 'VCB' })
  assert.equal((await paymentsApi.get(PAY_FAILED)).refund.transferReference, 'FT26316000000001')
  assert.equal((await paymentsApi.get(PAY_COMPLETED)).refund, null)
  const order = await ordersApi.get(ORDER_FAILED)
  assert.equal(order.status, 'REFUNDED')
  assert.equal(order.refundedAt, new Date(state.clock).toISOString())
  assert.deepEqual(order.refunds.map(refund => [refund.paymentId, refund.amount, refund.reason, refund.transferReference]), [[PAY_FAILED, payment.amount, 'DISPENSE_FAILED', 'FT26316000000001']])
  assert.equal(refundCase(order, PAY_FAILED).why, 'refunded')
  assert.match(blockedText(refundCase(order, PAY_FAILED), refundOf(order.refunds, PAY_FAILED)), /mã CK FT26316000000001, người ghi nhận Quản trị viên/)
  await rejects(refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: 'FT26316000000002' }), 409, code('PAYMENT_ALREADY_REFUNDED'))
  assert.equal((await refundsApi.candidates({ page: 0, size: 100 })).content.some(row => row.paymentId === PAY_FAILED), false, 'gone from "Cần hoàn tiền"')
})

test('mock: late and duplicate payments keep the order; reasons that do not fit and a transfer reference used twice are 409', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  await rejects(record(PAY_LATE, { reason: 'DISPENSE_FAILED' }), 409, code('REFUND_REASON_MISMATCH'))
  await record(PAY_LATE, { reason: 'LATE_PAYMENT', transferReference: 'FT-LATE-01' })
  assert.equal((await ordersApi.get(ORDER_LATE)).status, 'CANCELLED')
  await rejects(record(PAY_DUP_FIRST, { reason: 'DUPLICATE_PAYMENT' }), 409, code('REFUND_REASON_MISMATCH'))
  await rejects(record(PAY_DUP_LATER, { reason: 'DUPLICATE_PAYMENT', transferReference: 'ft-late-01' }), 409, code('REFUND_TRANSFER_REF_USED'))
  await record(PAY_DUP_LATER, { reason: 'DUPLICATE_PAYMENT' })
  assert.equal((await ordersApi.get(ORDER_DUP)).status, 'COMPLETED')
  // A delivered order: refundable on a complaint (PRODUCT_QUALITY), the order then becomes REFUNDED.
  await record(PAY_COMPLETED, { reason: 'PRODUCT_QUALITY' })
  assert.equal((await ordersApi.get(ORDER_COMPLETED)).status, 'REFUNDED')
  const attention = (await paymentsApi.list({ requiresAttention: true, page: 0, size: 100 })).content.map(payment => payment.id)
  assert.equal(attention.includes(PAY_LATE) || attention.includes(PAY_DUP_LATER), false)
})

test('mock: validation 400, unknown payment 404, unpaid payment and unfinished order 409', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const fields = (...names) => error => names.every(name => !!error.fieldErrors[name])
  await rejects(refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: '  ' }), 400, fields('transferReference'))
  await rejects(refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: 'FT 1234' }), 400, fields('transferReference'))
  await rejects(refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: 'FT1' }), 400, fields('transferReference'))
  await rejects(refundsApi.record(PAY_FAILED, { transferReference: 'FT1234' }), 400, fields('reason'))
  await rejects(refundsApi.record(PAY_FAILED, { reason: 'OTHER', transferReference: 'FT1234' }), 400, fields('note'))
  await rejects(refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: 'FT1234', note: 'x'.repeat(501) }), 400, fields('note'))
  await rejects(refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: 'FT1234', amount: 1 }), 400, fields('amount'))
  await rejects(refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: 'FT1234', workOrderId: 'nope' }), 400, fields('workOrderId'))
  await rejects(refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: 'FT1234', workOrderId: id('61000000', 1) }), 400, fields('workOrderId'))
  await rejects(refundsApi.record(id('a0000000', 999), { reason: 'DISPENSE_FAILED', transferReference: 'FT1234' }), 404)
  await rejects(refundsApi.record(PAY_PENDING, { reason: 'OTHER', transferReference: 'FT1234', note: 'x' }), 409, code('PAYMENT_NOT_REFUNDABLE'))
  await rejects(refundsApi.record(PAY_PAID, { reason: 'DISPENSE_FAILED', transferReference: 'FT1234' }), 409, code('DISPENSE_IN_PROGRESS'))
  assert.equal((await ordersApi.get(ORDER_PAID)).status, 'PAID')
  assert.equal((await ordersApi.get(ORDER_FAILED)).status, 'DISPENSE_FAILED', 'nothing changed')
})

test('mock: refunds and their totals by Vietnam day of refundedAt, reason, machine and person; every reason in the summary', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const seeded = await refundsApi.list({ page: 0, size: 100 })
  assert.ok(seeded.totalElements >= 1)
  const old = seeded.content.find(row => row.paymentId === PAY_REFUNDED)
  assert.equal(old.order.id, ORDER_REFUNDED)
  assert.equal(old.reason, 'DISPENSE_FAILED')
  assert.match(old.transferReference, /^[A-Za-z0-9._/-]{4,64}$/)
  await record(PAY_LATE, { reason: 'LATE_PAYMENT' })
  const today = '2026-11-30'
  const todays = await refundsApi.list({ from: today, to: today, page: 0, size: 100 })
  assert.deepEqual(todays.content.map(row => row.paymentId), [PAY_LATE])
  assert.equal(todays.content[0].refundedBy.id, ADMIN)
  const all = await refundsApi.list({ page: 0, size: 100 })
  assert.equal(all.content[0].paymentId, PAY_LATE, 'newest refund first')
  assert.deepEqual((await refundsApi.list({ reason: 'LATE_PAYMENT', page: 0, size: 100 })).content.map(row => row.paymentId), [PAY_LATE])
  assert.equal((await refundsApi.list({ refundedBy: id('11000000', 2), page: 0, size: 100 })).totalElements, 0)
  assert.equal((await refundsApi.list({ machineId: MACHINE_2, page: 0, size: 100 })).totalElements, 0)
  const summary = await refundsApi.summary({ from: today, to: today })
  assert.deepEqual([summary.from, summary.to, summary.count, summary.totalAmount], [today, today, 1, todays.content[0].amount])
  assert.deepEqual(summary.byReason.map(row => row.reason), ['DISPENSE_FAILED', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'PRODUCT_QUALITY', 'OTHER'])
  assert.equal(summary.byReason.find(row => row.reason === 'LATE_PAYMENT').count, 1)
  const total = await refundsApi.summary({})
  assert.equal(total.count, all.totalElements)
  await rejects(refundsApi.summary({ from: '2026-11-30', to: '2026-11-01' }), 400)
})

test('mock: a refund noted on an INCIDENT work order adds a NOTE event to it', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const incident = await workOrdersApi.create({ type: 'INCIDENT', machineId: MACHINE_1, title: 'Khách báo không nhận hàng', priority: 'HIGH' })
  await record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: 'FT26316000000077', workOrderId: incident.id })
  const notes = (await workOrdersApi.events(incident.id)).filter(event => event.type === 'NOTE')
  assert.equal(notes.length, 1)
  assert.match(notes[0].note, /^Refunded \d+ for order ORD-.* \(DISPENSE_FAILED, ref FT26316000000077\)$/)
})

test('mock: STAFF is refused (403) on every refund endpoint and gets no refunds on the order; nothing changes', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  await record(PAY_FAILED, { reason: 'DISPENSE_FAILED' })
  await signIn(state, 'staff')
  await rejects(refundsApi.record(PAY_LATE, { reason: 'LATE_PAYMENT', transferReference: 'FT1234' }), 403)
  await rejects(refundsApi.list({ page: 0, size: 5 }), 403)
  await rejects(refundsApi.candidates({ page: 0, size: 5 }), 403)
  await rejects(refundsApi.summary({}), 403)
  const order = await ordersApi.get(ORDER_FAILED)
  assert.equal(order.status, 'REFUNDED')
  assert.deepEqual(order.refunds, [], 'STAFF reads the order but not its refunds')
  state.token = null
  await rejects(refundsApi.record(PAY_LATE, { reason: 'LATE_PAYMENT', transferReference: 'FT1234' }), 401)
})

test('the real contract (api.yaml): endpoints, request fields, transfer reference pattern, no delete; the drafts are gone', async () => {
  const yaml = readFileSync(`${root}api-contract/api.yaml`, 'utf8').replace(/\r\n/g, '\n')
  for (const path of ['/api/v1/payments/{paymentId}/refund', '/api/v1/refunds', '/api/v1/refunds/candidates', '/api/v1/refunds/summary']) assert.ok(yaml.includes(`"${path}":`), path)
  assert.ok(yaml.includes('"^[A-Za-z0-9._/-]{4,64}$"'))
  const { existsSync } = await import('node:fs')
  assert.equal(existsSync(fileURLToPath(new URL('../src/api/drafts/refunds.d.ts', import.meta.url))), false)
  const resources = readFileSync(fileURLToPath(new URL('../src/api/resources.ts', import.meta.url)), 'utf8')
  assert.doesNotMatch(resources, /drafts\/refunds|drafts\/incident-reports/)
})
