// FE 8.3: kiosk QR with the order code, INCIDENT work tickets opened from customer reports, and the flagged reports of
// W-12 "Cần hoàn tiền" (drafts incident-reports.yaml, work-tickets.yaml, refunds.yaml) on the mock API.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, incidentReportsApi, refundsApi, ticketsApi } from '../src/api/resources.ts'
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

test('INCIDENT is a listed ticket type "Sự cố", but not one an admin can create by hand', () => {
  assert.deepEqual([...TICKET_TYPES], ['RESTOCK', 'MAINTENANCE', 'INCIDENT'])
  assert.deepEqual([...CREATABLE_TICKET_TYPES], ['RESTOCK', 'MAINTENANCE'])
  assert.equal(ticketTypeLabel('INCIDENT'), 'Sự cố')
  assert.ok(TICKET_TYPE_OPTIONS.some(option => option.value === 'INCIDENT' && option.label === 'Sự cố'))
  assert.equal(readTicketFilters(new URLSearchParams('type=INCIDENT')).type, 'INCIDENT')
  const errors = validateTicket({ ...NEW_TICKET, type: 'INCIDENT', machineId: MACHINE_1, title: 'x' })
  assert.match(errors.type, /tự động từ báo cáo của khách/)
  const yaml = readFileSync(`${root}api-contract/drafts/work-tickets.yaml`, 'utf8').replace(/\r\n/g, '\n')
  assert.ok(yaml.includes('enum: [RESTOCK, MAINTENANCE, INCIDENT]'))
  assert.match(yaml, /CreateWorkTicketRequest:[\s\S]*?enum: \[RESTOCK, MAINTENANCE\]\n/)
  assert.match(yaml, /\n {8}incidentReport:/)
  assert.match(yaml, /contactPhone is only sent to callers holding TICKET_WRITE/)
})

test('incident labels, list origin, next step and photo links', () => {
  assert.equal(incidentTypeLabel('PAID_NOT_RECEIVED'), 'Đã trả tiền nhưng không nhận hàng')
  assert.equal(incidentTypeLabel('MACHINE_FAULT'), 'Máy lỗi')
  assert.equal(incidentTypeLabel('NEW_KIND'), 'NEW_KIND')
  assert.equal(ticketOrigin({ type: 'INCIDENT', alertId: null, incidentReport: { reportCode: 'INC-20261109-7KQ2' } }), 'từ báo cáo INC-20261109-7KQ2')
  assert.equal(ticketOrigin({ type: 'INCIDENT', alertId: null }), 'từ báo cáo của khách')
  assert.equal(ticketOrigin({ type: 'MAINTENANCE', alertId: 'a' }), 'từ cảnh báo')
  assert.equal(ticketOrigin({ type: 'RESTOCK', alertId: null }), '')
  const base = { id: 't', type: 'INCIDENT', status: 'OPEN', assigneeId: null, assigneeName: null }
  const admin = { userId: 'admin', canWrite: true }, staff = { userId: STAFF, canWrite: false }
  assert.match(nextStepText(base, admin), /Đọc báo cáo của khách/)
  assert.deepEqual(nextActions(base, admin), ['assign', 'cancel'])
  const working = { ...base, status: 'IN_PROGRESS', assigneeId: STAFF, assigneeName: 'Nhân viên vận hành' }
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

  // One OPEN INCIDENT ticket per report, created by "Hệ thống", carrying the report.
  const incidents = await ticketsApi.list({ type: 'INCIDENT', page: 0, size: 20 })
  assert.equal(incidents.totalElements, 4)
  const ticket = await ticketsApi.get(paidRow.ticketId)
  assert.equal(ticket.type, 'INCIDENT')
  assert.equal(ticket.status, 'OPEN')
  assert.equal(ticket.createdById, null)
  assert.equal(ticket.createdByName, 'Hệ thống')
  assert.equal(ticket.machineId, MACHINE_1)
  assert.match(ticket.title, /^Sự cố: Đã trả tiền nhưng không nhận hàng · máy DEV-MACHINE-01$/)
  assert.equal(ticket.incidentReport.reportCode, paid.reportCode)
  assert.equal(ticket.incidentReport.orderCode, paidCode)
  assert.equal(ticket.incidentReport.orderFlagged, true)
  assert.equal(ticket.incidentReport.contactPhone, '0912345678')
  assert.equal(ticket.incidentReport.description, 'Cửa không mở')

  // Refunding the failed order takes its report off the list; the PAID one stays (BR-15: the report changed nothing).
  await refundsApi.record(ORDER_FAILED, { transferRef: 'FT26316000000009', paymentId: PAY_FAILED })
  assert.deepEqual((await incidentReportsApi.list({ flagged: true, page: 0, size: 20 })).content.map(row => row.reportCode), [paid.reportCode])
  const { ordersApi } = await import('../src/api/resources.ts')
  assert.equal((await ordersApi.get(ORDER_PAID)).status, 'PAID')
  // A refund of the PAID order is still refused: not a refund case.
  await rejects(refundsApi.record(ORDER_PAID, { transferRef: 'FT26316000000010', paymentId: id('a0000000', 6) }), 409)
})

test('mock: admins cannot create INCIDENT tickets by hand; STAFF never read the report list and only see INCIDENT tickets given to them, without the phone', async () => {
  const state = setup()
  await signIn(state, 'admin')
  await rejects(ticketsApi.create({ type: 'INCIDENT', machineId: MACHINE_1, title: 'Sự cố tự tạo' }), 400, error => !!error.fieldErrors.type)
  const mine = await report(state, { type: 'MACHINE_FAULT', description: 'Màn hình đen', contactPhone: '0987654321' })
  const other = await report(state, { type: 'OTHER', description: 'Khay bẩn' })
  const tickets = (await ticketsApi.list({ type: 'INCIDENT', page: 0, size: 20 })).content
  const mineTicket = tickets.find(ticket => ticket.incidentReport.reportCode === mine.reportCode)
  const otherTicket = tickets.find(ticket => ticket.incidentReport.reportCode === other.reportCode)
  await ticketsApi.assign(mineTicket.id, { assigneeId: STAFF })
  await ticketsApi.assign(otherTicket.id, { assigneeId: id('11000000', 7) })

  await signIn(state, 'staff')
  await rejects(incidentReportsApi.list({ flagged: true, page: 0, size: 20 }), 403)
  const seen = (await ticketsApi.list({ type: 'INCIDENT', page: 0, size: 20 })).content
  assert.deepEqual(seen.map(ticket => ticket.id), [mineTicket.id])
  assert.equal(seen[0].incidentReport.contactPhone, null)
  assert.equal(seen[0].incidentReport.description, 'Màn hình đen')
  await rejects(ticketsApi.get(otherTicket.id), 404)
  // Same lifecycle as the other tickets.
  const started = await ticketsApi.start(mineTicket.id)
  assert.equal(started.status, 'IN_PROGRESS')
  assert.equal(started.incidentReport.contactPhone, null)
  const done = await ticketsApi.complete(mineTicket.id, { note: 'Khởi động lại bộ điều khiển, màn hình sáng lại.' })
  assert.equal(done.status, 'COMPLETED')
})
