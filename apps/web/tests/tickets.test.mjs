// FE 7.1 Phiếu công việc on the real API (/work-orders of api-contract/api.yaml, backend #66): pure rules (filters, next
// step per permission and status, forms with the version, error text) and the mock that plays the backend (READ_ALL lists
// everyone's, /me the caller's own, someone else's work order is 404, STALE_VERSION, INVALID_WORK_ORDER_TRANSITION).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, buildUrl, configureClient } from '../src/api/client.ts'
import { alertsApi, authApi, machinesApi, workOrdersApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { STATUS_CATALOG } from '../src/lib/status.ts'
import { activeFilterCount } from '../src/lib/table-query.ts'
import { ROLE_PERMISSIONS } from '../src/admin/permissions.ts'
import { NAV, matchRoute } from '../src/admin/routes.ts'
import { NAV_ICONS } from '../src/admin/shell/nav-icons.ts'
import {
  NEW_TICKET, TICKETS_PATH, TICKET_STATUSES, TICKET_STATUS_ALL, TICKET_STATUS_FILTER_OPTIONS, TICKET_TYPES, UNFINISHED_TICKET_STATUSES, actionLabel, assigneeText, cancelBody, completeBody, createTicketBody, editValues, isOverdue, isStale,
  myTicketQuery, nextActions, nextStepText, readTicketFilters, restockFromSuggestionsBody, ticketActionError, ticketFilterKeys, ticketFromAlert, ticketListQuery,
  ticketPath, ticketSteps, ticketsAvailability, updateTicketBody, validateTicket,
} from '../src/admin/tickets.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const yaml = readFileSync(`${root}api-contract/api.yaml`, 'utf8').replace(/\r\n/g, '\n')
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = id('11000000', 1)
const STAFF = id('11000000', 2)
const OTHER = id('11000000', 7)
const MACHINE_1 = id('20000000', 1)
const MACHINE_2 = id('20000000', 2)
const MACHINE_3 = id('20000000', 3)
const W = n => id('61000000', n)

function setup() {
  const state = { token: null, clock: Date.parse('2026-12-04T03:00:00Z'), search: '' }
  const fetcher = createMockFetcher(parseSelection('all'), { now: () => state.clock, getSearch: () => state.search })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return { state, fetcher }
}
async function signIn(state, account) {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
async function rejects(promise, status, check) {
  await assert.rejects(promise, error => error instanceof ApiError && error.status === status && (!check || check(error)))
}
const adminViewer = { userId: ADMIN, canReadAll: true, canWrite: true, canExecute: true }
const staffViewer = { userId: STAFF, canReadAll: false, canWrite: false, canExecute: true }
const order = (status, fields = {}) => ({ id: 'w', type: 'MAINTENANCE', status, assignee: status === 'OPEN' ? undefined : { id: STAFF, fullName: 'Nhân viên vận hành' }, ...fields })

// ---- contract and vocabulary

test('statuses are WorkOrderStatus of api.yaml (DONE), in lifecycle order, and the ticket domain of status.ts', () => {
  assert.deepEqual([...TICKET_STATUSES], ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'])
  assert.deepEqual(Object.keys(STATUS_CATALOG.ticket), [...TICKET_STATUSES])
  assert.match(yaml, /- "OPEN"\n\s+- "ASSIGNED"\n\s+- "IN_PROGRESS"\n\s+- "DONE"\n\s+- "CANCELLED"/)
  assert.deepEqual([...TICKET_TYPES], ['RESTOCK', 'MAINTENANCE', 'INCIDENT'])
  for (const path of ['/work-orders', '/work-orders/me', '/work-orders/{id}/assign', '/work-orders/{id}/unassign', '/work-orders/{id}/complete']) assert.ok(yaml.includes(`"/api/v1${path}":`), path)
})

test('permissions: READ_ASSIGNED for both roles, READ_ALL and MANAGE ADMIN only, EXECUTE both; route and nav in "Vận hành"', () => {
  for (const code of ['WORK_ORDER_READ_ASSIGNED', 'WORK_ORDER_EXECUTE']) assert.ok(ROLE_PERMISSIONS.STAFF.includes(code), code)
  for (const code of ['WORK_ORDER_READ_ALL', 'WORK_ORDER_MANAGE']) assert.ok(!ROLE_PERMISSIONS.STAFF.includes(code) && ROLE_PERMISSIONS.ADMIN.includes(code), code)
  assert.equal(matchRoute(TICKETS_PATH)?.page, 'tickets')
  assert.equal(matchRoute(`${TICKETS_PATH}/${W(2)}/restock`)?.page, 'ticket-restock')
  assert.equal(NAV.find(item => item.to === TICKETS_PATH)?.group, 'Vận hành')
  for (const item of NAV) assert.ok(NAV_ICONS[item.to], item.to)
  assert.equal(groupOf('/work-orders'), 'tickets')
  assert.equal(groupOf(`/work-orders/${W(1)}/restock-lines`), 'tickets')
  assert.equal(groupOf(`/machines/${MACHINE_1}/restock-suggestions`), 'tickets')
})

test('URL filters keep contract values only; READ_ALL sends every filter, /me only status and overdue', () => {
  const filters = readTicketFilters(new URLSearchParams(`status=DONE&type=RESTOCK&source=SCHEDULE&priority=URGENT&machineId=${MACHINE_1}&assigneeId=${STAFF}&overdue=true&page=2`))
  assert.deepEqual(ticketListQuery(filters, 20), { page: 2, size: 20, status: ['DONE'], type: 'RESTOCK', source: 'SCHEDULE', priority: 'URGENT', machineId: MACHINE_1, assigneeId: STAFF, overdue: true })
  assert.deepEqual(myTicketQuery(filters, 20), { page: 2, size: 20, status: ['DONE'], overdue: true })
  const bad = readTicketFilters(new URLSearchParams('status=COMPLETED&type=X&machineId=abc&overdue=yes&page=-1'))
  // An unknown status is dropped like the other bad values, so the default "Chưa xong" applies.
  assert.deepEqual(ticketListQuery(bad, 20), { page: 0, size: 20, status: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'], type: undefined, source: undefined, priority: undefined, machineId: undefined, assigneeId: undefined, overdue: undefined })
  assert.deepEqual([...ticketFilterKeys(false)], ['status', 'overdue'])
  assert.equal(ticketFilterKeys(true).length, 7)
})

test('Tiêu chí xong: nút chỉ hiện đúng bước tiếp theo theo quyền và trạng thái', () => {
  const matrix = viewer => Object.fromEntries(TICKET_STATUSES.map(status => [status, nextActions(order(status), viewer)]))
  assert.deepEqual(matrix(staffViewer), { OPEN: [], ASSIGNED: ['start'], IN_PROGRESS: ['complete'], DONE: [], CANCELLED: [] })
  assert.deepEqual(matrix(adminViewer), { OPEN: ['assign', 'cancel'], ASSIGNED: ['start', 'assign', 'unassign', 'cancel'], IN_PROGRESS: ['complete', 'assign', 'cancel'], DONE: [], CANCELLED: [] })
  // Someone else's work order: staff get nothing; never a delete.
  assert.deepEqual(nextActions(order('ASSIGNED', { assignee: { id: OTHER } }), staffViewer), [])
  for (const status of TICKET_STATUSES) assert.ok(!nextActions(order(status), adminViewer).includes('delete'))
  // RESTOCK: one "Thực hiện nạp hàng" link replaces Bắt đầu / Hoàn tất.
  assert.deepEqual(nextActions(order('ASSIGNED', { type: 'RESTOCK' }), staffViewer), ['restock'])
  assert.deepEqual(nextActions(order('IN_PROGRESS', { type: 'RESTOCK' }), staffViewer), ['restock'])
  assert.equal(actionLabel('restock', { status: 'ASSIGNED' }), 'Thực hiện nạp hàng')
  assert.equal(actionLabel('assign', { status: 'OPEN' }), 'Phân công')
  assert.equal(actionLabel('assign', { status: 'IN_PROGRESS' }), 'Đổi người phụ trách')
})

test('next step sentence, assignee text and overdue as the server says', () => {
  assert.match(nextStepText(order('OPEN'), adminViewer), /Chọn nhân viên phụ trách/)
  assert.match(nextStepText(order('ASSIGNED'), staffViewer), /bấm “Bắt đầu”: máy chuyển sang Bảo trì/)
  assert.match(nextStepText(order('ASSIGNED', { type: 'RESTOCK' }), staffViewer), /mở “Thực hiện nạp hàng”/)
  assert.match(nextStepText(order('IN_PROGRESS', { type: 'RESTOCK' }), staffViewer), /cổng nạp đã đóng/)
  assert.match(nextStepText(order('DONE'), staffViewer), /Máy vẫn ở Bảo trì/)
  assert.equal(assigneeText(order('ASSIGNED'), staffViewer), 'Nhân viên vận hành (bạn)')
  assert.equal(assigneeText(order('OPEN')), 'Chưa phân công')
  assert.equal(isOverdue({ overdue: true, status: 'IN_PROGRESS' }), true)
  assert.equal(isOverdue({ overdue: true, status: 'DONE' }), false)
})

test('history: one row per event, the system when there is no actor, the note kept', () => {
  const steps = ticketSteps([
    { id: 'e1', type: 'CREATED', actor: null, createdAt: '2026-12-04T02:00:00Z' },
    { id: 'e2', type: 'COMPLETED', actor: { id: STAFF, fullName: 'Nhân viên vận hành' }, note: ' Đã vệ sinh ', createdAt: '2026-12-04T03:05:00Z' },
  ])
  assert.deepEqual(steps.map(step => [step.label, step.by, step.note]), [['Tạo phiếu', 'Hệ thống', undefined], ['Hoàn tất', 'Nhân viên vận hành', 'Đã vệ sinh']])
  assert.equal(steps[1].at, '04/12/2026 10:05')
})

test('forms: create body has only filled fields; edit sends the version and what changed; complete and cancel bodies', () => {
  const values = { ...NEW_TICKET, type: 'MAINTENANCE', machineId: MACHINE_1, title: ' Vệ sinh ', priority: 'HIGH' }
  assert.deepEqual(validateTicket(values), {})
  assert.deepEqual(createTicketBody(values), { type: 'MAINTENANCE', machineId: MACHINE_1, title: 'Vệ sinh', priority: 'HIGH' })
  assert.ok(validateTicket({ ...NEW_TICKET }).type && validateTicket({ ...NEW_TICKET }).machineId)
  assert.deepEqual(validateTicket({ ...NEW_TICKET, type: 'RESTOCK', machineId: MACHINE_1 }, Date.now(), true), {}, 'a restock from suggestions needs no title')
  assert.deepEqual(restockFromSuggestionsBody({ ...NEW_TICKET, type: 'RESTOCK', machineId: MACHINE_1, assigneeId: STAFF }), { fromSuggestions: true, priority: 'NORMAL', assigneeId: STAFF })
  const ticket = { id: 'w', title: 'Cũ', description: 'Mô tả', priority: 'NORMAL', dueAt: null, version: 4 }
  assert.equal(updateTicketBody(ticket, editValues(ticket)), undefined)
  assert.deepEqual(updateTicketBody(ticket, { ...editValues(ticket), title: 'Mới', description: '' }), { version: 4, title: 'Mới', description: '' })
  assert.deepEqual(completeBody(' xong '), { body: { resultNote: 'xong' } })
  assert.match(completeBody('  ').error, /bắt buộc/)
  assert.deepEqual(cancelBody('Máy hỏng', 4), { body: { reason: 'Máy hỏng', version: 4 } })
})

test('"Mở phiếu" from an alert: stock alerts open a RESTOCK, others a MAINTENANCE on the alert machine', () => {
  assert.equal(ticketFromAlert({ id: 'a', type: 'LOW_STOCK', machineId: MACHINE_1, machineCode: 'DEV-MACHINE-01', slotCode: 'A2' }).type, 'RESTOCK')
  const maintenance = ticketFromAlert({ id: 'a', type: 'MACHINE_OFFLINE', machineId: MACHINE_2, machineCode: 'DEV-MACHINE-02', slotCode: null })
  assert.equal(maintenance.type, 'MAINTENANCE')
  assert.equal(maintenance.machineId, MACHINE_2)
  assert.match(maintenance.title, /DEV-MACHINE-02/)
})

test('errors: STALE_VERSION, wrong step, known blockers and a lost assignment in Vietnamese; 404 on the list means no API', () => {
  const stale = ticketActionError(new ApiError(409, 'STALE_VERSION: work order WO-1 was changed'), 'assign', 'detail')
  assert.match(stale.message, /vừa bị người khác thay đổi, đã tải lại/)
  assert.equal(isStale(new ApiError(409, 'STALE_VERSION: x'), 'assign'), true)
  const blocked = ticketActionError(new ApiError(409, 'RESTOCK_WITHOUT_LINES: x'), 'start')
  assert.match(blocked.message, /chưa có dòng nạp/)
  assert.equal(isStale(new ApiError(409, 'MACHINE_HAS_ACTIVE_ORDERS: x'), 'start'), false, 'a blocker keeps the dialog open')
  assert.match(ticketActionError(new ApiError(409, 'INVALID_WORK_ORDER_TRANSITION: x'), 'start', 'list').message, /Danh sách đã được tải lại/)
  assert.match(ticketActionError(new ApiError(404, 'x'), 'complete').message, /không còn giao cho bạn/)
  assert.equal(ticketsAvailability(new ApiError(404, 'x')), 'missing')
  assert.equal(ticketsAvailability(new ApiError(403, 'x')), 'forbidden')
  assert.equal(ticketPath(W(1)), `/admin/tickets/${W(1)}`)
})

// ---- mock of the real backend

test('status filter: default "Chưa xong" sends OPEN, ASSIGNED, IN_PROGRESS (repeated param) on both lists; "Tất cả" sends none; one status sends that one', () => {
  const unfinished = ['OPEN', 'ASSIGNED', 'IN_PROGRESS']
  assert.deepEqual([...UNFINISHED_TICKET_STATUSES], unfinished)
  const byDefault = readTicketFilters(new URLSearchParams(''))
  assert.equal(byDefault.status, '')
  assert.deepEqual(ticketListQuery(byDefault, 20).status, unfinished)
  assert.deepEqual(myTicketQuery(byDefault, 20).status, unfinished)
  // The default is not an active filter: "Xóa bộ lọc" comes back to it.
  assert.equal(activeFilterCount(ticketFilterKeys(false).map(key => byDefault[key])), 0)
  assert.equal(buildUrl('/work-orders/me', myTicketQuery(byDefault, 20), 'http://x'), 'http://x/api/v1/work-orders/me?page=0&size=20&status=OPEN&status=ASSIGNED&status=IN_PROGRESS')
  assert.equal(buildUrl('/work-orders', ticketListQuery(byDefault, 20), 'http://x'), 'http://x/api/v1/work-orders?page=0&size=20&status=OPEN&status=ASSIGNED&status=IN_PROGRESS')

  const all = readTicketFilters(new URLSearchParams(`status=${TICKET_STATUS_ALL}`))
  assert.equal(all.status, 'ALL')
  assert.equal(activeFilterCount(ticketFilterKeys(false).map(key => all[key])), 1)
  assert.equal(ticketListQuery(all, 20).status, undefined)
  assert.equal(myTicketQuery(all, 20).status, undefined)
  assert.equal(buildUrl('/work-orders/me', myTicketQuery(all, 20), 'http://x'), 'http://x/api/v1/work-orders/me?page=0&size=20')

  const done = readTicketFilters(new URLSearchParams('status=DONE'))
  assert.deepEqual(myTicketQuery(done, 20).status, ['DONE'])
  // Options after the default: "Tất cả", then every status with its Vietnamese label, in lifecycle order.
  assert.deepEqual(TICKET_STATUS_FILTER_OPTIONS.map(option => option.value), ['ALL', ...TICKET_STATUSES])
  assert.deepEqual(TICKET_STATUS_FILTER_OPTIONS.map(option => option.label), ['Tất cả', 'Chưa phân công', 'Đã phân công', 'Đang thực hiện', 'Hoàn tất', 'Đã hủy'])
})

test('mock: the default query keeps old finished work orders out of the list, for READ_ALL and for /me', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const byDefault = readTicketFilters(new URLSearchParams(''))
  const admin = await workOrdersApi.list(ticketListQuery(byDefault, 50))
  assert.deepEqual(admin.content.map(row => row.id).sort(), [W(1), W(2), W(3), W(5), W(6)])
  assert.ok(admin.content.every(row => unfinishedStatus(row.status)))
  assert.equal((await workOrdersApi.list(ticketListQuery(readTicketFilters(new URLSearchParams('status=ALL')), 50))).totalElements, 7)
  await signIn(state, 'staff')
  const mine = await workOrdersApi.mine(myTicketQuery(byDefault, 50))
  assert.deepEqual(mine.content.map(row => row.id).sort(), [W(2), W(3)])
  assert.deepEqual((await workOrdersApi.mine(myTicketQuery(readTicketFilters(new URLSearchParams('status=ALL')), 50))).content.map(row => row.id).sort(), [W(2), W(3), W(4)])
})
const unfinishedStatus = status => status === 'OPEN' || status === 'ASSIGNED' || status === 'IN_PROGRESS'

test('Tiêu chí xong (mock): READ_ALL lists everyone\'s by priority then due time; staff get only their own (/me) and 404 on others', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const all = await workOrdersApi.list({ page: 0, size: 50 })
  assert.equal(all.totalElements, 7)
  assert.equal(all.content[0].priority, 'URGENT')
  assert.ok(all.content.every(row => /^WO-\d{8}-[0-9A-F]{4}$/.test(row.code)))
  assert.deepEqual((await workOrdersApi.list({ status: ['DONE', 'CANCELLED'], page: 0, size: 50 })).content.map(row => row.id).sort(), [W(4), W(7)])
  assert.deepEqual((await workOrdersApi.list({ source: 'SCHEDULE', page: 0, size: 50 })).content.map(row => row.id).sort(), [W(4), W(5)])
  assert.deepEqual((await workOrdersApi.list({ overdue: true, page: 0, size: 50 })).content.map(row => row.id).sort(), [W(3), W(5)])
  await rejects(workOrdersApi.list({ status: ['COMPLETED'], page: 0, size: 5 }), 400)

  await signIn(state, 'staff')
  await rejects(workOrdersApi.list({ page: 0, size: 5 }), 403)
  const mine = await workOrdersApi.mine({ page: 0, size: 50 })
  assert.deepEqual(mine.content.map(row => row.id).sort(), [W(2), W(3), W(4)])
  assert.ok(mine.content.every(row => row.assignee.id === STAFF))
  await rejects(workOrdersApi.get(W(6)), 404)
  const restock = await workOrdersApi.get(W(2))
  assert.deepEqual(restock.restockSummary, { lines: 2, plannedTotal: 10, loadedTotal: 0, varianceLines: 2 })
  assert.equal(restock.linkedAlerts[0].type, 'LOW_STOCK')
  const done = await workOrdersApi.get(W(4))
  assert.deepEqual([done.status, done.source, done.maintenancePlan.title, done.completedBy.id], ['DONE', 'SCHEDULE', 'Vệ sinh khay nhả hàng', STAFF])
  assert.deepEqual((await workOrdersApi.events(W(4))).map(event => event.type), ['CREATED', 'ASSIGNED', 'STARTED', 'COMPLETED'])
})

test('mock: staff start (machine → MAINTENANCE) and complete their own work order with a result note; wrong steps 409', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const created = await workOrdersApi.create({ type: 'MAINTENANCE', machineId: MACHINE_1, title: 'Lau kính', assigneeId: STAFF })
  assert.deepEqual([created.status, created.source, created.assignee.id, created.version], ['ASSIGNED', 'MANUAL', STAFF, 0])
  await signIn(state, 'staff')
  await rejects(workOrdersApi.complete(created.id, { resultNote: 'x' }), 409, error => error.message.startsWith('INVALID_WORK_ORDER_TRANSITION'))
  const started = await workOrdersApi.start(created.id)
  assert.equal(started.status, 'IN_PROGRESS')
  assert.equal((await workOrdersApi.start(created.id)).status, 'IN_PROGRESS', 'starting again answers it unchanged')
  await signIn(state, 'admin')
  assert.equal((await machinesApi.get(MACHINE_1)).status, 'MAINTENANCE')
  await signIn(state, 'staff')
  await workOrdersApi.note(created.id, 'Đã tháo khay')
  await rejects(workOrdersApi.complete(created.id, { resultNote: ' ' }), 400, error => !!error.fieldErrors.resultNote)
  const done = await workOrdersApi.complete(created.id, { resultNote: 'Đã lau kính' })
  assert.deepEqual([done.status, done.resultNote, done.completedBy.id], ['DONE', 'Đã lau kính', STAFF])
  assert.deepEqual((await workOrdersApi.events(created.id)).map(event => event.type), ['CREATED', 'ASSIGNED', 'STARTED', 'NOTE', 'COMPLETED'])
  await rejects(workOrdersApi.note(created.id, 'muộn'), 409)
})

test('mock: admin assigns, unassigns, edits and cancels with the version; a stale version is 409 STALE_VERSION', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const open = await workOrdersApi.get(W(1))
  assert.equal(open.status, 'OPEN')
  await rejects(workOrdersApi.assign(W(1), { assigneeId: id('11000000', 3), version: open.version }), 400, error => !!error.fieldErrors.assigneeId)
  const assigned = await workOrdersApi.assign(W(1), { assigneeId: STAFF, version: open.version })
  assert.equal(assigned.version, open.version + 1)
  await rejects(workOrdersApi.assign(W(1), { assigneeId: OTHER, version: open.version }), 409, error => error.message.startsWith('STALE_VERSION'))
  const back = await workOrdersApi.unassign(W(1), assigned.version)
  assert.deepEqual([back.status, back.assignee], ['OPEN', null])
  const edited = await workOrdersApi.update(W(1), { version: back.version, title: 'Kiểm tra Wi-Fi', priority: 'HIGH' })
  assert.deepEqual([edited.title, edited.priority], ['Kiểm tra Wi-Fi', 'HIGH'])
  await rejects(workOrdersApi.cancel(W(1), { reason: 'Trùng', version: back.version }), 409, error => error.message.startsWith('STALE_VERSION'))
  const cancelled = await workOrdersApi.cancel(W(1), { reason: 'Trùng việc', version: edited.version })
  assert.deepEqual([cancelled.status, cancelled.cancelReason], ['CANCELLED', 'Trùng việc'])
  await rejects(workOrdersApi.cancel(W(1), { reason: 'x', version: cancelled.version }), 409)
  await signIn(state, 'staff')
  await rejects(workOrdersApi.create({ type: 'MAINTENANCE', machineId: MACHINE_1, title: 'x' }), 403)
})

test('mock: start checks: INACTIVE machine, RESTOCK without lines; an INCIDENT keeps the machine selling unless stopMachine', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const inactive = await workOrdersApi.create({ type: 'MAINTENANCE', machineId: MACHINE_3, title: 'Lắp đặt', assigneeId: ADMIN })
  await rejects(workOrdersApi.start(inactive.id), 409, error => error.message.startsWith('MACHINE_INACTIVE'))
  const empty = await workOrdersApi.create({ type: 'RESTOCK', machineId: MACHINE_1, title: 'Nạp', assigneeId: ADMIN })
  await rejects(workOrdersApi.start(empty.id), 409, error => error.message.startsWith('RESTOCK_WITHOUT_LINES'))
  const incident = await workOrdersApi.create({ type: 'INCIDENT', machineId: MACHINE_1, title: 'Khách báo', assigneeId: ADMIN })
  await workOrdersApi.start(incident.id)
  assert.equal((await machinesApi.get(MACHINE_1)).status, 'ACTIVE')
  await rejects(workOrdersApi.create({ type: 'MAINTENANCE', machineId: MACHINE_1, title: 'x', restockLines: [] }), 400, error => !!error.fieldErrors.restockLines)
})

test('mock: a work order from an alert links it (alert ACKNOWLEDGED, workOrderCode); completing resolves it unless asked not to', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const alert = (await alertsApi.list({ type: 'HIGH_TEMPERATURE', page: 0, size: 5 })).content[0]
  const created = await alertsApi.createWorkOrder(alert.id, { assigneeId: ADMIN })
  assert.deepEqual([created.source, created.type, created.priority, created.status], ['ALERT', 'MAINTENANCE', 'HIGH', 'ASSIGNED'])
  const linked = await alertsApi.get(alert.id)
  assert.deepEqual([linked.status, linked.workOrderId, linked.workOrderCode], ['ACKNOWLEDGED', created.id, created.code])
  await rejects(alertsApi.createWorkOrder(alert.id, {}), 409, error => error.message.startsWith('ALERT_ALREADY_HANDLED'))
  await workOrdersApi.start(created.id)
  await workOrdersApi.complete(created.id, { resultNote: 'Đã chỉnh nhiệt độ' })
  const resolved = await alertsApi.get(alert.id)
  assert.deepEqual([resolved.status, resolved.resolutionNote, resolved.workOrderId], ['RESOLVED', `Resolved by ${created.code}`, null])
})
