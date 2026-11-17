// FE 8.3 on the real API of backend #74 (docs/customer-reports.md): a customer report opens or joins an INCIDENT work
// order (source CUSTOMER_REPORT, linkedReports, no contact data), shows in "Cần hoàn tiền" (CUSTOMER_REPORT candidates)
// and is closed by the refund; the management screens of customer reports (rules, filters, review / resolve / reject,
// photos read with the token, masked contact) and the visibility rule: STAFF hold CUSTOMER_REPORT_READ but only see
// the reports of work orders assigned to them. Also the rotation of a machine's report QR.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, customerReportsApi, machinesApi, ordersApi, publicReportsApi, refundsApi, workOrdersApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { seedReportToken } from '../src/api/mock/customer-reports.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { buildReportForm, emptyDraft } from '../src/features/incident/incident.ts'
import { can } from '../src/admin/permissions.ts'
import { NAV, canOpen, matchRoute, navFor } from '../src/admin/routes.ts'
import {
  CREATABLE_TICKET_TYPES, NEW_TICKET, TICKET_TYPES, TICKET_TYPE_OPTIONS, incidentTypeLabel, nextActions, nextStepText, readTicketFilters, safePhotoUrl,
  ticketOrigin, ticketTypeLabel, validateTicket,
} from '../src/admin/tickets.ts'
import {
  REPORT_CLOSED, REPORT_NOT_NEW, contactText, customerReportPath, decisionBody, readReportFilters, refundLinkOf, reportActionError, reportActions, reportListQuery,
  reportNextStep, resolutionLabel, sizeText, validateDecision, verdictHelp, verdictLabel,
} from '../src/admin/customer-reports.ts'
import { describeFormFailure } from '../src/admin/form-error.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_1 = id('20000000', 1)
const TOKEN_1 = seedReportToken('DEV-MACHINE-01')
const ORDER_FAILED = id('90000000', 8), PAY_FAILED = id('a0000000', 8)
const ORDER_COMPLETED = id('90000000', 2), PAY_COMPLETED = id('a0000000', 2)
const STAFF = id('11000000', 2), OTHER_STAFF = id('11000000', 7)

function setup() {
  const state = { token: null, clock: Date.parse('2026-11-30T03:00:00Z') }
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
const codeOf = async orderId => (await ordersApi.get(orderId)).orderCode
/** The customer sends a report from the phone (no account); a minute apart so the 5/minute limit never interferes. */
async function report(state, patch, photos = []) {
  const token = state.token
  state.token = null
  state.clock += 15_000
  try {
    const form = buildReportForm({ ...emptyDraft(), consent: true, ...patch })
    for (const photo of photos) form.append('photos', photo)
    return await publicReportsApi.submit(TOKEN_1, form)
  } finally { state.token = token }
}
const findReport = async code => (await customerReportsApi.list({ page: 0, size: 100 })).content.find(row => row.code === code)
const png = () => { const bytes = new Uint8Array(40); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 1, 0]); return new File([bytes], 'hop.png', { type: 'image/png' }) }

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
  assert.equal(incidentTypeLabel('PRODUCT_QUALITY'), 'Trái cây không đạt chất lượng')
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
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '/p.jpg', 'http://evil.example/p.jpg', '', null, undefined]) assert.equal(safePhotoUrl(bad), null, String(bad))
})

// ---- customer report screens: permissions and rules

test('CUSTOMER_REPORT_READ opens the report screens for ADMIN and STAFF; managing stays ADMIN only', () => {
  assert.equal(can(['STAFF'], 'CUSTOMER_REPORT_READ'), true)
  assert.equal(can(['STAFF'], 'CUSTOMER_REPORT_MANAGE'), false)
  assert.equal(can(['STAFF'], 'MACHINE_REPORT_LINK_MANAGE'), false)
  assert.deepEqual(matchRoute('/admin/customer-reports'), { page: 'customer-reports', id: undefined, permission: 'CUSTOMER_REPORT_READ', roles: ['ADMIN', 'STAFF'] })
  assert.equal(matchRoute(`/admin/customer-reports/${id('70000000', 1)}`).page, 'customer-report-detail')
  assert.equal(canOpen(['STAFF'], matchRoute('/admin/customer-reports')), true)
  const item = NAV.find(entry => entry.to === '/admin/customer-reports')
  assert.deepEqual([item.group, item.label], ['Vận hành', 'Phản ánh của khách'])
  assert.ok(navFor(['STAFF']).includes(item))
  assert.equal(customerReportPath(id('70000000', 1)), `/admin/customer-reports/${id('70000000', 1)}`)
  assert.equal(customerReportPath('nope'), '/admin/customer-reports')
})

test('report filters live in the URL and only contract parameters are sent (Vietnam days, no sort)', () => {
  const filters = readReportFilters(new URLSearchParams(`status=NEW&type=MACHINE_FAULT&verdict=WHAT&machineId=${MACHINE_1}&from=2026-11-30&to=2026-11-01&hasOrder=true&page=2`))
  assert.deepEqual(filters, { status: 'NEW', type: 'MACHINE_FAULT', verdict: '', machineId: MACHINE_1, from: '2026-11-01', to: '2026-11-30', hasOrder: 'true', page: 2 })
  assert.deepEqual(reportListQuery(filters, 20), { page: 2, size: 20, status: 'NEW', type: 'MACHINE_FAULT', verdict: undefined, machineId: MACHINE_1, from: '2026-11-01', to: '2026-11-30', hasOrder: true })
  assert.equal(reportListQuery(readReportFilters(new URLSearchParams('hasOrder=false')), 20).hasOrder, false)
  assert.equal(reportListQuery(readReportFilters(new URLSearchParams('hasOrder=maybe')), 20).hasOrder, undefined)
})

test('detail rules: actions by status and permission, next step, refund link, decisions and 409 codes', () => {
  assert.deepEqual(reportActions({ status: 'NEW' }, true), ['review', 'resolve', 'reject'])
  assert.deepEqual(reportActions({ status: 'IN_REVIEW' }, true), ['resolve', 'reject'])
  assert.deepEqual(reportActions({ status: 'RESOLVED' }, true), [])
  assert.deepEqual(reportActions({ status: 'NEW' }, false), [])
  const eligible = { status: 'NEW', verdict: 'REFUND_ELIGIBLE', order: { id: id('90000000', 8) }, workOrder: { id: id('61000000', 9) } }
  assert.equal(refundLinkOf(eligible, true), `/admin/refunds?orderId=${id('90000000', 8)}&workOrderId=${id('61000000', 9)}`)
  assert.equal(refundLinkOf(eligible, false), null)
  assert.equal(refundLinkOf({ ...eligible, status: 'RESOLVED' }, true), null)
  assert.equal(refundLinkOf({ ...eligible, verdict: 'DISPENSE_PENDING' }, true), null)
  assert.match(reportNextStep(eligible, true, true), /tự chuyển sang “Đã giải quyết · Đã hoàn tiền”/)
  assert.match(reportNextStep(eligible, false, false), /phiếu sự cố được giao/)
  assert.match(reportNextStep({ status: 'REJECTED', resolution: 'SPAM' }, true, true), /Đã từ chối: tin rác/)
  assert.equal(verdictLabel('DELIVERED_PER_MACHINE'), 'Máy báo đã giao')
  assert.match(verdictHelp('NOT_PAID'), /không có tiền để hoàn/)
  assert.equal(resolutionLabel('NO_ACTION_NEEDED'), 'Không cần xử lý')
  assert.equal(contactText({ name: 'A***', phone: '090****567', email: null, masked: true }), 'A*** · 090****567')
  assert.equal(contactText(undefined), '—')
  assert.equal(sizeText(512), '1 KB')
  assert.equal(sizeText(1_572_864), '1,5 MB')
  assert.deepEqual(validateDecision({ resolution: 'SPAM', note: '' }, ['FIXED', 'NO_ACTION_NEEDED', 'REFUNDED']), { resolution: 'Chọn kết quả xử lý.' })
  assert.match(validateDecision({ resolution: 'FIXED', note: 'x'.repeat(1001) }, ['FIXED']).note, /1000/)
  assert.deepEqual(decisionBody({ resolution: 'FIXED', note: '  ' }), { resolution: 'FIXED' })
  assert.deepEqual(decisionBody({ resolution: 'SPAM', note: ' quảng cáo ' }), { resolution: 'SPAM', note: 'quảng cáo' })
  assert.equal(describeFormFailure(reportActionError(new ApiError(409, 'REPORT_ALREADY_CLOSED: x'))).message, REPORT_CLOSED)
  assert.equal(reportActionError(new ApiError(409, 'REPORT_NOT_NEW: x')).message, REPORT_NOT_NEW)
  const other = new ApiError(400, 'x')
  assert.equal(reportActionError(other), other)
})

// ---- mock: report → INCIDENT work order → refund

test('Tiêu chí xong (mock): a "đã trả nhưng không nhận hàng" report opens an INCIDENT work order, shows in "Cần hoàn tiền" and is closed by the refund', async () => {
  const state = setup()
  await signIn(state, 'admin')
  assert.equal((await refundsApi.candidates({ type: 'CUSTOMER_REPORT', page: 0, size: 20 })).totalElements, 0)
  const failedCode = await codeOf(ORDER_FAILED)
  const sent = await report(state, { type: 'PAID_NOT_RECEIVED', orderCode: failedCode, description: 'Cửa không mở', contactName: 'An', contactPhone: '0912345678' })
  const row = await findReport(sent.reportCode)
  assert.deepEqual([row.type, row.status, row.verdict, row.orderId, row.machineCode], ['PAID_NOT_RECEIVED', 'NEW', 'REFUND_ELIGIBLE', ORDER_FAILED, 'DEV-MACHINE-01'])
  assert.deepEqual(row.contact, { name: 'A***', phone: '091****678', masked: true }, 'masked in the list, even for ADMIN')
  assert.equal((await customerReportsApi.get(row.id)).contact.phone, '0912345678', 'full for CUSTOMER_REPORT_MANAGE')

  // One OPEN INCIDENT work order created by the system: HIGH, due in 24 h, linking the report, no contact anywhere.
  const ticket = await workOrdersApi.get(row.workOrder.id)
  assert.deepEqual([ticket.type, ticket.status, ticket.source, ticket.priority, ticket.createdBy, ticket.machineId], ['INCIDENT', 'OPEN', 'CUSTOMER_REPORT', 'HIGH', null, MACHINE_1])
  assert.equal(ticket.title, `[${sent.reportCode}] Paid, not received`)
  assert.equal(Date.parse(ticket.dueAt) - Date.parse(ticket.createdAt), 24 * 3_600_000)
  assert.deepEqual(ticket.linkedReports, [{ id: row.id, code: sent.reportCode, type: 'PAID_NOT_RECEIVED', verdict: 'REFUND_ELIGIBLE', status: 'NEW' }])
  assert.doesNotMatch(JSON.stringify(ticket), /0912345678|An\b/)

  // "Cần hoàn tiền": the order's own case, with the report (masked) and its work order.
  const candidate = (await refundsApi.candidates({ type: 'CUSTOMER_REPORT', page: 0, size: 20 })).content
  assert.deepEqual(candidate.map(entry => entry.paymentId), [PAY_FAILED])
  assert.equal(candidate[0].type, 'DISPENSE_FAILED')
  assert.deepEqual(candidate[0].customerReport, { id: row.id, reportCode: sent.reportCode, verdict: 'REFUND_ELIGIBLE', contactName: 'A***', contactPhone: '091****678' })
  assert.deepEqual(candidate[0].relatedWorkOrder, { id: ticket.id, code: ticket.code })

  // Recording the refund (noted on the work order) resolves the open report as REFUNDED.
  await refundsApi.record(PAY_FAILED, { reason: 'DISPENSE_FAILED', transferReference: 'FT26316000000009', workOrderId: ticket.id })
  const closed = await customerReportsApi.get(row.id)
  assert.deepEqual([closed.status, closed.resolution, closed.resolvedBy.fullName], ['RESOLVED', 'REFUNDED', 'Quản trị viên'])
  assert.equal((await workOrdersApi.get(ticket.id)).linkedReports[0].status, 'RESOLVED')
  assert.ok((await workOrdersApi.events(ticket.id)).some(event => event.type === 'NOTE' && /^Refunded/.test(event.note)))
  assert.equal((await refundsApi.candidates({ type: 'CUSTOMER_REPORT', page: 0, size: 20 })).totalElements, 0)
})

test('mock: a second report of the same order joins its work order (IN_REVIEW); machine faults share one; a delivered order is a CUSTOMER_REPORT candidate', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const failedCode = await codeOf(ORDER_FAILED), doneCode = await codeOf(ORDER_COMPLETED)
  const first = await report(state, { type: 'PAID_NOT_RECEIVED', orderCode: failedCode, contactEmail: 'an@example.com' })
  const second = await report(state, { type: 'PAID_NOT_RECEIVED', orderCode: failedCode, contactPhone: '0987654321' })
  const [a, b] = [await findReport(first.reportCode), await findReport(second.reportCode)]
  assert.equal(b.workOrder.id, a.workOrder.id)
  assert.equal(b.status, 'IN_REVIEW')
  assert.equal(a.contact.email, 'a***@example.com')
  const fault1 = await findReport((await report(state, { type: 'MACHINE_FAULT', description: 'Màn hình đen' })).reportCode)
  const fault2 = await findReport((await report(state, { type: 'OTHER', description: 'Khay bẩn' })).reportCode)
  // MACHINE_FAULT / OTHER join the machine's unfinished INCIDENT work order from customer reports (docs, rule 2).
  assert.equal(fault1.workOrder.id, a.workOrder.id)
  assert.equal(fault2.workOrder.id, a.workOrder.id)
  assert.deepEqual((await workOrdersApi.get(a.workOrder.id)).linkedReports.map(row => row.code), [a.code, b.code, fault1.code, fault2.code])
  assert.equal((await workOrdersApi.list({ type: 'INCIDENT', page: 0, size: 20 })).totalElements, 1)

  const quality = await findReport((await report(state, { type: 'PRODUCT_QUALITY', orderCode: doneCode, description: 'Dưa bị dập', contactPhone: '0912345678' }, [png()])).reportCode)
  assert.equal(quality.verdict, 'DELIVERED_PER_MACHINE')
  const candidates = (await refundsApi.candidates({ type: 'CUSTOMER_REPORT', page: 0, size: 20 })).content
  assert.ok(candidates.some(entry => entry.paymentId === PAY_COMPLETED && entry.type === 'CUSTOMER_REPORT' && entry.customerReport.id === quality.id))

  // Filters of the list.
  assert.deepEqual((await customerReportsApi.list({ type: 'PRODUCT_QUALITY', page: 0, size: 20 })).content.map(row => row.id), [quality.id])
  assert.equal((await customerReportsApi.list({ hasOrder: false, page: 0, size: 20 })).totalElements, 2)
  assert.equal((await customerReportsApi.list({ status: 'IN_REVIEW', page: 0, size: 20 })).totalElements, 1)
  assert.equal((await customerReportsApi.list({ verdict: 'REFUND_ELIGIBLE', page: 0, size: 20 })).totalElements, 2)
  assert.equal((await customerReportsApi.list({ from: '2026-11-30', to: '2026-11-30', page: 0, size: 20 })).totalElements, 5)
  assert.equal((await customerReportsApi.list({ from: '2026-11-29', to: '2026-11-29', page: 0, size: 20 })).totalElements, 0)
  await rejects(customerReportsApi.list({ status: 'OPEN', page: 0, size: 20 }), 400)

  // The photo, read with the token: the stored image with its content type.
  const detail = await customerReportsApi.get(quality.id)
  assert.deepEqual(detail.photos.map(photo => [photo.contentType, photo.sizeBytes]), [['image/png', 40]])
  const blob = await customerReportsApi.photo(quality.id, detail.photos[0].id)
  assert.equal(blob.type, 'image/png')
  assert.equal(blob.size, 40)
  await rejects(customerReportsApi.photo(quality.id, id('71000000', 1)), 404)
  const token = state.token
  state.token = null
  await rejects(customerReportsApi.photo(quality.id, detail.photos[0].id), 401)
  state.token = token
})

test('mock: review, resolve and reject follow the lifecycle; closed reports and wrong resolutions are refused', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const fault = await findReport((await report(state, { type: 'MACHINE_FAULT', description: 'Màn hình đen' })).reportCode)
  const reviewed = await customerReportsApi.review(fault.id)
  assert.equal(reviewed.status, 'IN_REVIEW')
  await rejects(customerReportsApi.review(fault.id), 409, error => error.message.startsWith('REPORT_NOT_NEW:'))
  await rejects(customerReportsApi.resolve(fault.id, { resolution: 'SPAM' }), 400, error => !!error.fieldErrors.resolution)
  await rejects(customerReportsApi.resolve(fault.id, { resolution: 'FIXED', note: 'x'.repeat(1001) }), 400, error => !!error.fieldErrors.note)
  const resolved = await customerReportsApi.resolve(fault.id, { resolution: 'FIXED', note: 'Khởi động lại bộ điều khiển.' })
  assert.deepEqual([resolved.status, resolved.resolution, resolved.resolutionNote], ['RESOLVED', 'FIXED', 'Khởi động lại bộ điều khiển.'])
  await rejects(customerReportsApi.reject(fault.id, { resolution: 'SPAM' }), 409, error => error.message.startsWith('REPORT_ALREADY_CLOSED:'))
  await rejects(customerReportsApi.review(fault.id), 409, error => error.message.startsWith('REPORT_ALREADY_CLOSED:'))
  const spam = await findReport((await report(state, { type: 'OTHER', description: 'quảng cáo' })).reportCode)
  await rejects(customerReportsApi.reject(spam.id, { resolution: 'FIXED' }), 400)
  assert.equal((await customerReportsApi.reject(spam.id, { resolution: 'SPAM' })).status, 'REJECTED')
  await rejects(customerReportsApi.get(id('70000000', 404)), 404)
  await rejects(customerReportsApi.get('nope'), 400)
})

test('mock: STAFF hold CUSTOMER_REPORT_READ but only see the reports of work orders assigned to them, contact masked, read only', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const mine = await findReport((await report(state, { type: 'MACHINE_FAULT', description: 'Màn hình đen', contactPhone: '0987654321' })).reportCode)
  const theirs = await findReport((await report(state, { type: 'PAID_NOT_RECEIVED', orderCode: await codeOf(ORDER_FAILED), contactPhone: '0912345678' })).reportCode)
  const unassigned = await findReport((await report(state, { type: 'PRODUCT_QUALITY', orderCode: await codeOf(ORDER_COMPLETED), description: 'x', contactEmail: 'b@example.com' })).reportCode)
  const mineOrder = await workOrdersApi.get(mine.workOrder.id)
  const theirOrder = await workOrdersApi.get(theirs.workOrder.id)
  await workOrdersApi.assign(mineOrder.id, { assigneeId: STAFF, version: mineOrder.version })
  await workOrdersApi.assign(theirOrder.id, { assigneeId: OTHER_STAFF, version: theirOrder.version })

  await signIn(state, 'staff')
  assert.deepEqual((await customerReportsApi.list({ page: 0, size: 20 })).content.map(row => row.id), [mine.id])
  const detail = await customerReportsApi.get(mine.id)
  assert.deepEqual(detail.contact, { phone: '098****321', masked: true })
  await rejects(customerReportsApi.get(theirs.id), 404)
  await rejects(customerReportsApi.get(unassigned.id), 404)
  await rejects(customerReportsApi.review(mine.id), 403)
  await rejects(customerReportsApi.resolve(mine.id, { resolution: 'FIXED' }), 403)
  await rejects(refundsApi.candidates({ page: 0, size: 20 }), 403)
  // Their own INCIDENT work order follows the usual lifecycle.
  const seen = (await workOrdersApi.mine({ page: 0, size: 20 })).content.filter(row => row.type === 'INCIDENT')
  assert.deepEqual(seen.map(row => row.id), [mineOrder.id])
  await rejects(workOrdersApi.get(theirOrder.id), 404)
  assert.equal((await workOrdersApi.start(mineOrder.id)).status, 'IN_PROGRESS')
  assert.equal((await workOrdersApi.complete(mineOrder.id, { resultNote: 'Khởi động lại bộ điều khiển, màn hình sáng lại.' })).status, 'DONE')
})

test('mock: rotating a machine\'s report QR (ADMIN) answers the new URL; the old token is 404 at once; STAFF are refused', async () => {
  const state = setup()
  await signIn(state, 'staff')
  await rejects(machinesApi.rotateReportToken(MACHINE_1), 403)
  await signIn(state, 'admin')
  const link = await machinesApi.rotateReportToken(MACHINE_1)
  assert.equal(link.machineId, MACHINE_1)
  const url = new URL(link.url)
  const token = url.pathname.split('/').pop()
  assert.equal(url.pathname, `/report/${token}`)
  assert.match(token, /^[A-Za-z0-9_-]{22}$/)
  assert.notEqual(token, TOKEN_1)
  state.token = null
  await rejects(publicReportsApi.form(TOKEN_1), 404)
  assert.equal((await publicReportsApi.form(token)).machineCode, 'DEV-MACHINE-01')
  await signIn(state, 'admin')
  await rejects(machinesApi.rotateReportToken(id('20000000', 99)), 404)
})
