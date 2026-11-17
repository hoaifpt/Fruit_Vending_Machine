// FE 8.3: kiosk QR with the order code, INCIDENT work orders opened from customer reports (real /work-orders of api.yaml,
// source CUSTOMER_REPORT, linkedReports), and the flagged reports of W-12 "Cần hoàn tiền" (drafts incident-reports.yaml,
// refunds.yaml, still FM8) on the mock API.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, incidentReportsApi, refundsApi, workOrdersApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { buildIncidentForm, draftFromSearch, emptyDraft } from '../src/features/incident/incident.ts'
import {
  CREATABLE_TICKET_TYPES, NEW_TICKET, TICKET_TYPES, TICKET_TYPE_OPTIONS, incidentTypeLabel, nextActions, nextStepText, readTicketFilters, safePhotoUrl,
  ticketOrigin, ticketTypeLabel, validateTicket,
} from '../src/admin/tickets.ts'
import { REPORT_CHECK_MACHINE, flaggedReportsQuery, readRefundFilters, reportMark, reportRowAction, reportsByOrder } from '../src/admin/refunds.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_1 = id('20000000', 1)
const ORDER_PAID = id('90000000', 6)
const ORDER_FAILED = id('90000000', 8), PAY_FAILED = id('a0000000', 8)
const ORDER_COMPLETED = id('90000000', 2)
const STAFF = id('11000000', 2)

function setup() {
  const state = { token: null, clock: Date.now() }
  const fetcher = createMockFetcher(parseSelection('all'), { now: () => state.clock, getSearch: () => '' })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}
async function signIn(state, account) {
  state.token = account ? (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken : null
}
async function rejects(promise, status, check = () => true) {
  await assert.rejects(promise, error => error instanceof ApiError && error.status === status && check(error))
}
async function codeOf(orderId) {
  const { ordersApi } = await import('../src/api/resources.ts')
  return (await ordersApi.get(orderId)).orderCode
}
/** The customer sends a report from the phone (no account). */
async function report(state, patch) {
  const token = state.token
  state.token = null
  try { return await incidentReportsApi.create(buildIncidentForm({ ...emptyDraft('DEV-MACHINE-01'), ...patch })) } finally { state.token = token }
}

// ---- kiosk QR → form

test('the form opened from K-07 pre-selects "Đã trả tiền nhưng không nhận hàng" with the order code; a bad code is ignored', () => {
  assert.deepEqual(draftFromSearch('?machine=dev-machine-01&order=ord-20261109-ab12cd34'), {
    ...emptyDraft('DEV-MACHINE-01'), type: 'PAID_NOT_RECEIVED', orderCode: 'ORD-20261109-AB12CD34',
  })
  assert.deepEqual(draftFromSearch('?machine=DEV-MACHINE-01'), emptyDraft('DEV-MACHINE-01'))
  for (const bad of ['?machine=DEV-MACHINE-01&order=<script>', '?machine=DEV-MACHINE-01&order=', '?machine=DEV-MACHINE-01&order=ORD-1']) {
    assert.deepEqual(draftFromSearch(bad), emptyDraft('DEV-MACHINE-01'), bad)
  }
  // Without a machine the form still asks for it, but keeps the order.
  assert.equal(draftFromSearch('?order=ORD-20261109-AB12CD34').machineCode, '')
  assert.equal(draftFromSearch('?order=ORD-20261109-AB12CD34').orderCode, 'ORD-20261109-AB12CD34')
})

// ---- ticket vocabulary

test('INCIDENT is a listed work order type "Sự cố"; the real API also lets a manager create one by hand', () => {
  assert.deepEqual([...TICKET_TYPES], ['RESTOCK', 'MAINTENANCE', 'INCIDENT'])
  assert.deepEqual([...CREATABLE_TICKET_TYPES], ['RESTOCK', 'MAINTENANCE', 'INCIDENT'])
  assert.equal(ticketTypeLabel('INCIDENT'), 'Sự cố')
  assert.ok(TICKET_TYPE_OPTIONS.some(option => option.value === 'INCIDENT' && option.label === 'Sự cố'))
  assert.equal(readTicketFilters(new URLSearchParams('type=INCIDENT')).type, 'INCIDENT')
  assert.deepEqual(validateTicket({ ...NEW_TICKET, type: 'INCIDENT', machineId: MACHINE_1, title: 'x' }), {})
  const yaml = readFileSync(`${root}api-contract/api.yaml`, 'utf8').replace(/\r\n/g, '\n')
  assert.ok(yaml.includes('"CUSTOMER_REPORT"') && yaml.includes('"linkedReports"'))
})

test('incident labels, list origin, next step and photo links', () => {
  assert.equal(incidentTypeLabel('PAID_NOT_RECEIVED'), 'Đã trả tiền nhưng không nhận hàng')
  assert.equal(incidentTypeLabel('MACHINE_FAULT'), 'Máy lỗi')
  assert.equal(incidentTypeLabel('NEW_KIND'), 'NEW_KIND')
  assert.equal(ticketOrigin({ source: 'CUSTOMER_REPORT' }), 'từ phản ánh của khách')
  assert.equal(ticketOrigin({ source: 'ALERT' }), 'từ cảnh báo')
  assert.equal(ticketOrigin({ source: 'MANUAL' }), '')
  const base = { id: 't', type: 'INCIDENT', status: 'OPEN' }
  const admin = { userId: 'admin', canReadAll: true, canWrite: true, canExecute: true }, staff = { userId: STAFF, canReadAll: false, canWrite: false, canExecute: true }
  assert.match(nextStepText(base, admin), /Chọn nhân viên phụ trách/)
  assert.deepEqual(nextActions(base, admin), ['assign', 'cancel'])
  const working = { ...base, status: 'IN_PROGRESS', assignee: { id: STAFF, fullName: 'Nhân viên vận hành' } }
  assert.deepEqual(nextActions(working, staff), ['complete'])
  assert.match(nextStepText(working, staff), /không hoàn tiền/)
  assert.equal(safePhotoUrl('https://files.example/p.jpg?sig=1'), 'https://files.example/p.jpg?sig=1')
  assert.equal(safePhotoUrl('http://localhost:9000/p.jpg'), 'http://localhost:9000/p.jpg')
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '/p.jpg', 'http://evil.example/p.jpg', '', null, undefined]) assert.equal(safePhotoUrl(bad), null, String(bad))
})

// ---- W-12 rules

test('flagged report rows: refund only a DISPENSE_FAILED (or cancelled) order, check the machine while PAID; query is contract only', () => {
  assert.equal(reportRowAction({ orderId: 'o', orderStatus: 'DISPENSE_FAILED' }), 'record')
  assert.equal(reportRowAction({ orderId: 'o', orderStatus: 'CANCELLED' }), 'record')
  assert.equal(reportRowAction({ orderId: 'o', orderStatus: 'PAID' }), 'check-machine')
  assert.equal(reportRowAction({ orderId: 'o', orderStatus: 'DISPENSING' }), 'check-machine')
  assert.equal(reportRowAction({ orderId: 'o', orderStatus: 'REFUNDED' }), 'none')
  assert.equal(reportRowAction({ orderId: null, orderStatus: null }), 'none')
  assert.equal(REPORT_CHECK_MACHINE, 'Đơn chưa ở trạng thái nhả thất bại; kiểm tra máy trước.')
  assert.equal(reportMark({ reportCode: 'INC-20261109-7KQ2' }), 'Khách báo sự cố INC-20261109-7KQ2')
  const map = reportsByOrder([{ id: '1', orderId: 'a', reportCode: 'INC-2' }, { id: '2', orderId: 'a', reportCode: 'INC-1' }, { id: '3', orderId: null }])
  assert.deepEqual([...map.keys()], ['a'])
  assert.equal(map.get('a').reportCode, 'INC-2')
  const filters = readRefundFilters(new URLSearchParams(`machineId=${MACHINE_1}&reportPage=2`))
  assert.equal(filters.reportPage, 2)
  assert.deepEqual(flaggedReportsQuery(filters, 20), { page: 2, size: 20, sort: 'createdAt,desc', flagged: true, machineId: MACHINE_1 })
  assert.equal(readRefundFilters(new URLSearchParams('reportPage=-3')).reportPage, 0)
  const yaml = readFileSync(`${root}api-contract/drafts/incident-reports.yaml`, 'utf8').replace(/\r\n/g, '\n')
  assert.match(yaml, /\/api\/v1\/incident-reports:\n {4}get:/)
  assert.match(yaml, /x-required-permission: REFUND_RECORD/)
  assert.doesNotMatch(yaml, /\n\s+delete:/)
})

// ---- mock: report → INCIDENT ticket → W-12

test('Tiêu chí xong (mock): a "đã trả nhưng không nhận hàng" report shows at once in "Cần hoàn tiền" and opens an INCIDENT ticket', async () => {
  assert.equal(groupOf('/incident-reports'), 'incident-reports')
  const state = setup()
  await signIn(state, 'admin')
  assert.equal((await incidentReportsApi.list({ flagged: true, page: 0, size: 20 })).totalElements, 0)
  const paidCode = await codeOf(ORDER_PAID), failedCode = await codeOf(ORDER_FAILED), doneCode = await codeOf(ORDER_COMPLETED)

  const paid = await report(state, { type: 'PAID_NOT_RECEIVED', orderCode: paidCode, description: 'Cửa không mở', contactPhone: '0912345678' })
  const failed = await report(state, { type: 'PAID_NOT_RECEIVED', orderCode: failedCode })
  await report(state, { type: 'SPOILED_FRUIT', orderCode: doneCode }) // a COMPLETED order is not flagged
  await report(state, { type: 'MACHINE_FAULT' })

  const flagged = await incidentReportsApi.list({ flagged: true, page: 0, size: 20 })
  assert.deepEqual(flagged.content.map(row => row.reportCode).sort(), [paid.reportCode, failed.reportCode].sort())
  const paidRow = flagged.content.find(row => row.reportCode === paid.reportCode)
  assert.equal(paidRow.orderId, ORDER_PAID)
  assert.equal(paidRow.orderStatus, 'PAID')
  assert.equal(reportRowAction(paidRow), 'check-machine')
  assert.equal(paidRow.contactPhone, '0912345678')
  assert.ok(paidRow.ticketId)
  assert.equal(reportRowAction(flagged.content.find(row => row.reportCode === failed.reportCode)), 'record')
  assert.equal((await incidentReportsApi.list({ page: 0, size: 20 })).totalElements, 4)
  assert.equal((await incidentReportsApi.list({ flagged: true, machineId: id('20000000', 2), page: 0, size: 20 })).totalElements, 0)
  await rejects(incidentReportsApi.list({ type: 'LOST', page: 0, size: 20 }), 400)

  // One OPEN INCIDENT work order per report (source CUSTOMER_REPORT), created by the system, linking the report.
  const incidents = await workOrdersApi.list({ type: 'INCIDENT', page: 0, size: 20 })
  assert.equal(incidents.totalElements, 4)
  const ticket = await workOrdersApi.get(paidRow.ticketId)
  assert.deepEqual([ticket.type, ticket.status, ticket.source, ticket.createdBy, ticket.machineId], ['INCIDENT', 'OPEN', 'CUSTOMER_REPORT', null, MACHINE_1])
  assert.match(ticket.title, /^Sự cố: Đã trả tiền nhưng không nhận hàng · máy DEV-MACHINE-01$/)
  assert.equal(ticket.description, 'Cửa không mở')
  assert.deepEqual(ticket.linkedReports.map(row => [row.code, row.type]), [[paid.reportCode, 'PAID_NOT_RECEIVED']])
  assert.ok(!('contactPhone' in ticket.linkedReports[0]), 'no contact on the work order')

  // Refunding the failed order takes its report off the list; the PAID one stays (BR-15: the report changed nothing).
  await refundsApi.record(ORDER_FAILED, { transferRef: 'FT26316000000009', paymentId: PAY_FAILED })
  assert.deepEqual((await incidentReportsApi.list({ flagged: true, page: 0, size: 20 })).content.map(row => row.reportCode), [paid.reportCode])
  const { ordersApi } = await import('../src/api/resources.ts')
  assert.equal((await ordersApi.get(ORDER_PAID)).status, 'PAID')
  // A refund of the PAID order is still refused: not a refund case.
  await rejects(refundsApi.record(ORDER_PAID, { transferRef: 'FT26316000000010', paymentId: id('a0000000', 6) }), 409)
})

test('mock: STAFF never read the report list and only see the INCIDENT work orders given to them; same lifecycle as the others', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const mine = await report(state, { type: 'MACHINE_FAULT', description: 'Màn hình đen', contactPhone: '0987654321' })
  const other = await report(state, { type: 'OTHER', description: 'Khay bẩn' })
  const orders = (await workOrdersApi.list({ type: 'INCIDENT', page: 0, size: 20 })).content
  const mineOrder = orders.find(row => row.linkedReports[0]?.code === mine.reportCode)
  const otherOrder = orders.find(row => row.linkedReports[0]?.code === other.reportCode)
  await workOrdersApi.assign(mineOrder.id, { assigneeId: STAFF, version: mineOrder.version })
  await workOrdersApi.assign(otherOrder.id, { assigneeId: id('11000000', 7), version: otherOrder.version })

  await signIn(state, 'staff')
  const seen = (await workOrdersApi.mine({ page: 0, size: 20 })).content.filter(row => row.type === 'INCIDENT')
  assert.deepEqual(seen.map(row => row.id), [mineOrder.id])
  await rejects(workOrdersApi.get(otherOrder.id), 404)
  const started = await workOrdersApi.start(mineOrder.id)
  assert.equal(started.status, 'IN_PROGRESS')
  const done = await workOrdersApi.complete(mineOrder.id, { resultNote: 'Khởi động lại bộ điều khiển, màn hình sáng lại.' })
  assert.equal(done.status, 'DONE')
  // FM8 (customer reports, not migrated yet): the draft list still expects STAFF to be refused.
  await rejects(incidentReportsApi.list({ flagged: true, page: 0, size: 20 }), 403)
})
