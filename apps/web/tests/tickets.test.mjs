// FE 7.1 Phiếu công việc: pure rules (filters, next step per role and status, forms, error text) and the mock of the
// draft contract api-contract/drafts/work-tickets.yaml (staff only receive their own tickets, 409 on a wrong step,
// 403 when staff try an admin step or someone else's step).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, ticketsApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { STATUS_CATALOG } from '../src/lib/status.ts'
import { DRAFT_PERMISSIONS, can } from '../src/admin/permissions.ts'
import { NAV, matchRoute, navFor } from '../src/admin/routes.ts'
import {
  NEW_TICKET, TICKETS_PATH, TICKET_STATUSES, TICKET_TYPES, actionLabel, assigneeText, cancelBody, completeBody, createTicketBody, isOverdue, isStale,
  nextActions, nextStepText, readTicketFilters, ticketActionError, ticketFilterKeys, ticketFromAlert, ticketListQuery, ticketPath, ticketSteps,
  ticketsAvailability, validateTicket,
} from '../src/admin/tickets.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = id('11000000', 1)
const STAFF = id('11000000', 2)
const OTHER = id('11000000', 7)
const MACHINE_1 = id('20000000', 1)
const MACHINE_2 = id('20000000', 2)
const T = n => id('61000000', n)

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

// ---- vocabulary and contract

test('statuses are the ticket domain of status.ts (COMPLETED, not DONE), in lifecycle order; the draft uses the same', () => {
  assert.deepEqual([...TICKET_STATUSES], Object.keys(STATUS_CATALOG.ticket))
  assert.ok(!TICKET_STATUSES.includes('DONE'))
  const yaml = readFileSync(`${root}api-contract/drafts/work-tickets.yaml`, 'utf8')
  assert.ok(yaml.includes(`enum: [${TICKET_STATUSES.join(', ')}]`))
  assert.ok(yaml.includes(`enum: [${TICKET_TYPES.join(', ')}]`))
  for (const path of ['/api/v1/work-tickets:', '/api/v1/work-tickets/{id}:', '/assign:', '/start:', '/complete:', '/cancel:']) assert.ok(yaml.includes(path), path)
  for (const field of ['assignedByName', 'startedByName', 'completedByName', 'completionNote', 'cancelledByName', 'cancelReason']) assert.match(yaml, new RegExp(`\\n        ${field}:`), field)
  assert.doesNotMatch(yaml, /\n\s+delete:/, 'tickets are never deleted')
})

test('draft permissions: TICKET_READ for ADMIN and STAFF, TICKET_WRITE for ADMIN only; route, nav in "Vận hành"', () => {
  assert.ok(DRAFT_PERMISSIONS.includes('TICKET_READ') && DRAFT_PERMISSIONS.includes('TICKET_WRITE'))
  assert.equal(can(['ADMIN'], 'TICKET_READ'), true)
  assert.equal(can(['ADMIN'], 'TICKET_WRITE'), true)
  assert.equal(can(['STAFF'], 'TICKET_READ'), true)
  assert.equal(can(['STAFF'], 'TICKET_WRITE'), false)
  assert.deepEqual(matchRoute('/admin/tickets'), { page: 'tickets', id: undefined, permission: 'TICKET_READ', roles: ['ADMIN', 'STAFF'] })
  assert.equal(matchRoute(`/admin/tickets/${T(1)}`).page, 'ticket-detail')
  const item = NAV.find(entry => entry.to === TICKETS_PATH)
  assert.equal(item.group, 'Vận hành')
  assert.equal(item.label, 'Phiếu công việc')
  // Once GET /auth/me lists permissions, an account without TICKET_READ has no ticket screen.
  assert.equal(navFor({ roles: ['STAFF'], permissions: ['ALERT_READ'] }).some(entry => entry.to === TICKETS_PATH), false)
  assert.equal(ticketPath(T(1)), `/admin/tickets/${T(1)}`)
})

// ---- list filters

test('URL filters keep contract values only; the assignee filter is sent only by those who see every ticket', () => {
  const filters = readTicketFilters(new URLSearchParams(`status=DONE&type=RESTOCK&machineId=x&assigneeId=${STAFF}&sort=title,asc&page=-1`))
  assert.deepEqual(filters, { status: '', type: 'RESTOCK', machineId: '', assigneeId: STAFF, sort: { field: 'createdAt', direction: 'desc' }, page: 0 })
  assert.deepEqual(ticketListQuery(filters, 20, true), { page: 0, size: 20, sort: 'createdAt,desc', status: undefined, type: 'RESTOCK', machineId: undefined, assigneeId: STAFF })
  assert.equal(ticketListQuery(filters, 20, false).assigneeId, undefined)
  assert.deepEqual(readTicketFilters(new URLSearchParams('sort=dueAt,asc&status=IN_PROGRESS')).sort, { field: 'dueAt', direction: 'asc' })
  assert.deepEqual([...ticketFilterKeys(false)], ['status', 'type', 'machineId'])
  assert.deepEqual([...ticketFilterKeys(true)], ['status', 'type', 'machineId', 'assigneeId'])
})

// ---- next step per role and status (done criterion)

test('Tiêu chí xong: nút chỉ hiện đúng bước tiếp theo theo vai trò và trạng thái', () => {
  const admin = { userId: ADMIN, canWrite: true }
  const staff = { userId: STAFF, canWrite: false }
  const ticket = (status, assigneeId = STAFF) => ({ status, assigneeId: status === 'OPEN' ? null : assigneeId })
  const matrix = viewer => Object.fromEntries(TICKET_STATUSES.map(status => [status, nextActions(ticket(status), viewer)]))
  assert.deepEqual(matrix(admin), { OPEN: ['assign', 'cancel'], ASSIGNED: ['assign', 'cancel'], IN_PROGRESS: ['cancel'], COMPLETED: [], CANCELLED: [] })
  assert.deepEqual(matrix(staff), { OPEN: [], ASSIGNED: ['start'], IN_PROGRESS: ['complete'], COMPLETED: [], CANCELLED: [] })
  // Someone else's ticket: staff never get a button for it.
  assert.deepEqual(TICKET_STATUSES.map(status => nextActions(ticket(status, OTHER), staff)), [[], [], [], [], []])
  // An admin who is the assignee also gets the assignee's step.
  assert.deepEqual(nextActions({ status: 'ASSIGNED', assigneeId: ADMIN }, admin), ['assign', 'start', 'cancel'])
  // No session id: nothing is "mine".
  assert.deepEqual(nextActions(ticket('ASSIGNED'), { userId: undefined, canWrite: false }), [])
  assert.equal(actionLabel('assign', { status: 'OPEN' }), 'Phân công')
  assert.equal(actionLabel('assign', { status: 'ASSIGNED' }), 'Đổi người phụ trách')
  assert.deepEqual(['start', 'complete', 'cancel'].map(action => actionLabel(action, { status: 'ASSIGNED' })), ['Bắt đầu', 'Hoàn tất', 'Hủy phiếu'])
})

test('next step sentence, assignee text and overdue hint', () => {
  const base = { assigneeId: STAFF, assigneeName: 'Nhân viên vận hành' }
  const staff = { userId: STAFF, canWrite: false }
  assert.match(nextStepText({ ...base, status: 'ASSIGNED' }, staff), /bấm “Bắt đầu”/)
  assert.equal(nextStepText({ ...base, status: 'ASSIGNED' }, { userId: ADMIN, canWrite: true }), 'Chờ Nhân viên vận hành bắt đầu tại máy.')
  assert.match(nextStepText({ ...base, status: 'IN_PROGRESS' }, staff), /“Hoàn tất”/)
  assert.match(nextStepText({ status: 'OPEN', assigneeId: null }, { userId: ADMIN, canWrite: true }), /Chọn nhân viên/)
  assert.match(nextStepText({ ...base, status: 'CANCELLED' }, staff), /đã hủy/)
  assert.equal(assigneeText(base, staff), 'Nhân viên vận hành (bạn)')
  assert.equal(assigneeText({ assigneeId: null }), 'Chưa phân công')
  assert.equal(assigneeText({ assigneeId: OTHER, assigneeName: null }), `Tài khoản …${OTHER.slice(-8)}`)
  const now = Date.parse('2026-12-04T03:00:00Z')
  assert.equal(isOverdue({ status: 'IN_PROGRESS', dueAt: '2026-12-04T02:00:00Z' }, now), true)
  assert.equal(isOverdue({ status: 'COMPLETED', dueAt: '2026-12-04T02:00:00Z' }, now), false)
  assert.equal(isOverdue({ status: 'ASSIGNED', dueAt: null }, now), false)
})

test('history lists who did each step and when, with the note and the cancel reason', () => {
  const steps = ticketSteps({
    status: 'CANCELLED', createdAt: '2026-12-04T01:00:00Z', createdById: ADMIN, createdByName: 'Quản trị viên',
    assignedAt: '2026-12-04T01:05:00Z', assignedById: ADMIN, assignedByName: 'Quản trị viên', assigneeId: STAFF, assigneeName: 'Nhân viên vận hành',
    startedAt: null, completedAt: null, cancelledAt: '2026-12-04T02:00:00Z', cancelledById: ADMIN, cancelledByName: null, cancelReason: '  Máy đã thay  ',
  })
  assert.deepEqual(steps.map(step => step.key), ['created', 'assigned', 'cancelled'])
  assert.equal(steps[0].at, '04/12/2026 08:00')
  assert.equal(steps[1].note, 'Giao cho Nhân viên vận hành')
  assert.equal(steps[2].by, `Tài khoản …${ADMIN.slice(-8)}`)
  assert.equal(steps[2].note, 'Lý do: Máy đã thay')
})

// ---- forms

test('create form: client checks, and only filled optional fields are sent', () => {
  const now = Date.parse('2026-12-04T03:00:00Z')
  assert.deepEqual(Object.keys(validateTicket({ ...NEW_TICKET }, now)).sort(), ['machineId', 'title', 'type'])
  assert.equal(validateTicket({ ...NEW_TICKET, type: 'RESTOCK', machineId: MACHINE_1, title: 'x', dueAt: '2026-12-04T09:00' }, now).dueAt, 'Thời hạn phải ở tương lai.')
  assert.deepEqual(validateTicket({ ...NEW_TICKET, type: 'RESTOCK', machineId: MACHINE_1, title: 'x', dueAt: '2026-12-04T11:00' }, now), {})
  assert.deepEqual(createTicketBody({ ...NEW_TICKET, type: 'MAINTENANCE', machineId: MACHINE_1, title: '  Vệ sinh  ', description: '   ' }), { type: 'MAINTENANCE', machineId: MACHINE_1, title: 'Vệ sinh' })
  assert.deepEqual(createTicketBody({ ...NEW_TICKET, type: 'RESTOCK', machineId: MACHINE_1, title: 'Nạp', description: 'Ngăn A2', dueAt: '2026-12-04T11:00', alertId: id('60000000', 5), assigneeId: STAFF }),
    { type: 'RESTOCK', machineId: MACHINE_1, title: 'Nạp', description: 'Ngăn A2', dueAt: '2026-12-04T04:00:00.000Z', alertId: id('60000000', 5), assigneeId: STAFF })
  assert.deepEqual(completeBody('  '), {})
  assert.deepEqual(completeBody(' Đã nạp 6 hộp '), { note: 'Đã nạp 6 hộp' })
  assert.ok(cancelBody('   ').error)
  assert.ok(cancelBody('x'.repeat(501)).error)
  assert.deepEqual(cancelBody(' Trùng phiếu ').body, { reason: 'Trùng phiếu' })
})

test('"Mở phiếu" from an alert: same machine and alert id; restock for stock alerts, maintenance otherwise', () => {
  const values = ticketFromAlert({ id: id('60000000', 5), type: 'LOW_STOCK', machineId: MACHINE_1, machineCode: 'DEV-MACHINE-01', slotCode: 'A2' })
  assert.equal(values.type, 'RESTOCK')
  assert.equal(values.machineId, MACHINE_1)
  assert.equal(values.alertId, id('60000000', 5))
  assert.equal(values.title, 'Ngăn sắp hết hàng · máy DEV-MACHINE-01, ngăn A2')
  assert.equal(values.assigneeId, '')
  assert.equal(ticketFromAlert({ id: id('60000000', 2), type: 'MACHINE_OFFLINE', machineId: MACHINE_2, machineCode: 'DEV-MACHINE-02', slotCode: null }).type, 'MAINTENANCE')
})

test('errors: 409 and a lost assignment explained in Vietnamese with the next step; others kept; 404 means BE 4.3 missing', () => {
  const conflict = ticketActionError(new ApiError(409, 'Ticket is not ASSIGNED'), 'start', 'detail')
  assert.match(conflict.message, /không còn ở trạng thái chờ bắt đầu.*Trang đã được tải lại/)
  assert.match(ticketActionError(new ApiError(409, 'x'), 'cancel').message, /Danh sách đã được tải lại/)
  assert.match(ticketActionError(new ApiError(403, 'Only the assignee'), 'complete').message, /không còn giao cho bạn/)
  const forbidden = new ApiError(403, 'Access denied')
  assert.equal(ticketActionError(forbidden, 'cancel'), forbidden)
  assert.equal(isStale(new ApiError(409, 'x'), 'assign'), true)
  assert.equal(isStale(new ApiError(403, 'x'), 'start'), true)
  assert.equal(isStale(new ApiError(403, 'x'), 'cancel'), false)
  assert.equal(isStale(new ApiError(400, 'x'), 'complete'), false)
  assert.equal(ticketsAvailability(new ApiError(404, 'x')), 'missing')
  assert.equal(ticketsAvailability(new ApiError(500, 'x')), 'error')
})

// ---- mock of the draft contract

test('mock: the endpoints form their own group "tickets"', () => {
  assert.equal(groupOf('/work-tickets'), 'tickets')
  assert.equal(groupOf(`/work-tickets/${T(1)}/start`), 'tickets')
  assert.deepEqual(parseSelection('tickets').groups, ['tickets'])
})

test('Tiêu chí xong (mock): staff only receive their own tickets, whatever filter they send; admins see all', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const all = await ticketsApi.list({ page: 0, size: 100 })
  assert.equal(all.totalElements, 7)
  assert.deepEqual([...new Set(all.content.map(ticket => ticket.status))].sort(), [...TICKET_STATUSES].sort())
  assert.equal((await ticketsApi.list({ page: 0, size: 100, assigneeId: OTHER })).totalElements, 2)
  assert.equal((await ticketsApi.list({ page: 0, size: 100, status: 'OPEN' })).content[0].assigneeId, null)

  await signIn(state, 'staff')
  const mine = await ticketsApi.list({ page: 0, size: 100 })
  assert.equal(mine.totalElements, 3)
  assert.ok(mine.content.every(ticket => ticket.assigneeId === STAFF))
  // Asking for someone else's tickets still answers with the caller's own.
  assert.ok((await ticketsApi.list({ page: 0, size: 100, assigneeId: OTHER })).content.every(ticket => ticket.assigneeId === STAFF))
  assert.equal((await ticketsApi.list({ page: 0, size: 100, status: 'OPEN' })).totalElements, 0)
  // Someone else's ticket is not disclosed: 404 like an unknown id.
  await rejects(ticketsApi.get(T(5)), 404)
  await rejects(ticketsApi.get('nope'), 400)
  assert.equal((await ticketsApi.get(T(2))).status, 'ASSIGNED')
  // Bad filters are a 400 with the field.
  await rejects(ticketsApi.list({ page: 0, size: 20, status: 'DONE' }), 400, error => !!error.fieldErrors.status)
})

test('mock: staff start then complete their own ticket (who and when recorded); wrong step 409; admin steps 403', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await rejects(ticketsApi.complete(T(2), {}), 409, error => error.message === 'Ticket is not IN_PROGRESS')
  const started = await ticketsApi.start(T(2))
  assert.equal(started.status, 'IN_PROGRESS')
  assert.equal(started.startedById, STAFF)
  assert.equal(started.startedByName, 'Nhân viên vận hành')
  assert.equal(started.startedAt, '2026-12-04T03:00:00.000Z')
  await rejects(ticketsApi.start(T(2)), 409, error => error.message === 'Ticket is not ASSIGNED')
  await rejects(ticketsApi.complete(T(2), { note: 'x', extra: 1 }), 400, error => !!error.fieldErrors.extra)
  const done = await ticketsApi.complete(T(2), { note: 'Đã nạp 6 hộp vào ngăn A2' })
  assert.equal(done.status, 'COMPLETED')
  assert.equal(done.completedById, STAFF)
  assert.equal(done.completionNote, 'Đã nạp 6 hộp vào ngăn A2')
  // Admin steps.
  await rejects(ticketsApi.cancel(T(3), { reason: 'x' }), 403)
  await rejects(ticketsApi.assign(T(3), { assigneeId: STAFF }), 403)
  await rejects(ticketsApi.create({ type: 'RESTOCK', machineId: MACHINE_1, title: 'x' }), 403)

  // An admin is not the assignee: start/complete are refused even though they see the ticket.
  await signIn(state, 'admin')
  await rejects(ticketsApi.start(T(5)), 403)
  await rejects(ticketsApi.complete(T(6), {}), 403)
})

test('mock: admin creates (OPEN, or ASSIGNED with an assignee), assigns, cancels with a reason; 400 and 409 rules', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  await rejects(ticketsApi.create({ type: 'FIX', machineId: 'x', title: ' ', dueAt: '2026-12-01T00:00:00Z', assigneeId: ADMIN, id: 'x' }), 400, error =>
    ['type', 'machineId', 'title', 'dueAt', 'assigneeId', 'id'].every(field => error.fieldErrors[field]))
  await rejects(ticketsApi.create({ type: 'RESTOCK', machineId: MACHINE_2, title: 'x', alertId: id('60000000', 5) }), 400, error => error.fieldErrors.alertId === 'Alert belongs to another machine')
  await rejects(ticketsApi.create({ type: 'RESTOCK', machineId: MACHINE_1, title: 'x', alertId: id('60000000', 6) }), 409, error => error.message === 'Alert is already RESOLVED')

  const open = await ticketsApi.create({ type: 'MAINTENANCE', machineId: MACHINE_1, title: 'Kiểm tra cửa' })
  assert.equal(open.status, 'OPEN')
  assert.equal(open.createdById, ADMIN)
  assert.equal(open.assignedAt, null)
  const assigned = await ticketsApi.create({ type: 'RESTOCK', machineId: MACHINE_1, title: 'Nạp A2', alertId: id('60000000', 5), assigneeId: STAFF, dueAt: '2026-12-04T09:00:00Z' })
  assert.equal(assigned.status, 'ASSIGNED')
  assert.equal(assigned.assigneeName, 'Nhân viên vận hành')
  assert.equal(assigned.assignedByName, 'Quản trị viên')
  assert.equal(assigned.alertId, id('60000000', 5))

  await rejects(ticketsApi.assign(open.id, { assigneeId: id('11000000', 3) }), 400, error => !!error.fieldErrors.assigneeId) // INACTIVE staff
  assert.equal((await ticketsApi.assign(open.id, { assigneeId: OTHER })).assigneeId, OTHER)
  await rejects(ticketsApi.assign(T(3), { assigneeId: OTHER }), 409) // IN_PROGRESS
  await rejects(ticketsApi.cancel(open.id, { reason: '  ' }), 400, error => !!error.fieldErrors.reason)
  const cancelled = await ticketsApi.cancel(open.id, { reason: 'Trùng phiếu' })
  assert.equal(cancelled.status, 'CANCELLED')
  assert.equal(cancelled.cancelledById, ADMIN)
  assert.equal(cancelled.cancelReason, 'Trùng phiếu')
  assert.equal(cancelled.assigneeId, OTHER, 'the assignee stays on record')
  await rejects(ticketsApi.cancel(open.id, { reason: 'x' }), 409)
  await rejects(ticketsApi.cancel(T(4), { reason: 'x' }), 409) // COMPLETED

  // The new assigned ticket shows up in that staff member's own list.
  await signIn(state, 'staff')
  assert.equal((await ticketsApi.list({ page: 0, size: 100 })).totalElements, 4)
})
