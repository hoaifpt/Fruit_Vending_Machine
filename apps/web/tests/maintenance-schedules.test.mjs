// FE 7.3 Lịch bảo trì: the due date rule (across months, years, leap days, Vietnam midnight), URL filters, form bodies
// (only fields of the draft), labels, and the mock of api-contract/drafts/maintenance-schedules.yaml (server nextDueAt,
// a COMPLETED ticket starts the next cycle, pause/resume with 409, staff read only).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, maintenanceSchedulesApi, ticketsApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { DRAFT_PERMISSIONS, can } from '../src/admin/permissions.ts'
import { NAV, matchRoute } from '../src/admin/routes.ts'
import { formatDate } from '../src/lib/format.ts'
import {
  SCHEDULES_PATH, addDays, createScheduleBody, daysBetween, dueInfo, dueInstant, dueLabel, isDateString, isStaleSchedule, newScheduleValues, nextDueDate,
  parseInterval, previewNextDue, readScheduleFilters, scheduleActionError, scheduleListQuery, scheduleValues, schedulesAvailability, updateScheduleBody,
  validateSchedule, vietnamDate, vietnamDateOf,
} from '../src/admin/maintenance-schedules.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const STAFF = id('11000000', 2)
const MACHINE_1 = id('20000000', 1)
const MACHINE_3 = id('20000000', 3)
const S = n => id('62000000', n)
/** 10:00 on 04/12/2026 in Vietnam. */
const CLOCK = Date.parse('2026-12-04T03:00:00Z')

function setup(clock = CLOCK) {
  const state = { token: null, clock, search: '' }
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
const schedule = (fields = {}) => ({
  id: S(9), machineId: MACHINE_1, machineCode: 'DEV-MACHINE-01', machineName: 'Máy 1', title: 'Vệ sinh khay', note: null, intervalDays: 7,
  startDate: '2026-11-30', assigneeId: null, assigneeName: null, active: true, nextDueAt: dueInstant('2026-12-07'), overdue: false,
  lastCompletedAt: null, openTicketId: null, openTicketStatus: null, createdById: id('11000000', 1), createdByName: 'Admin',
  deactivatedAt: null, deactivatedById: null, deactivatedByName: null, createdAt: '2026-11-30T03:00:00Z', updatedAt: '2026-11-30T03:00:00Z', ...fields,
})

// ---- the due date rule

test('calendar days in Vietnam: midnight is 17:00 UTC; dates cross months, years and 29/02', () => {
  assert.equal(vietnamDate(Date.parse('2026-12-31T16:59:00Z')), '2026-12-31')
  assert.equal(vietnamDate(Date.parse('2026-12-31T17:00:00Z')), '2027-01-01')
  assert.equal(vietnamDateOf('2026-11-30T20:00:00Z'), '2026-12-01')
  assert.equal(vietnamDateOf(null), undefined)
  assert.equal(addDays('2026-01-31', 1), '2026-02-01')
  assert.equal(addDays('2026-12-28', 7), '2027-01-04')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2027-02-28', 1), '2027-03-01')
  assert.equal(daysBetween('2026-12-30', '2027-01-02'), 3)
  assert.equal(daysBetween('2027-01-02', '2026-12-30'), -3)
  assert.equal(dueInstant('2027-01-01'), '2026-12-31T17:00:00.000Z')
  assert.equal(formatDate(dueInstant('2027-01-01')), '01/01/2027')
  assert.equal(formatDate('2026-11-09'), '09/11/2026')
  assert.equal(formatDate(null), '—')
  assert.equal(isDateString('2026-02-29'), false)
  assert.equal(isDateString('2028-02-29'), true)
  assert.equal(isDateString('2026-13-01'), false)
})

test('next due = start + N days; when that is past, add whole cycles until it is today or later', () => {
  assert.equal(nextDueDate('2026-12-04', 7, '2026-12-04'), '2026-12-11')
  assert.equal(nextDueDate('2026-12-28', 7, '2026-12-04'), '2027-01-04', 'future start, across the year')
  assert.equal(nextDueDate('2026-11-20', 14, '2026-12-04'), '2026-12-04', 'exactly today: due today, not rolled')
  assert.equal(nextDueDate('2026-11-01', 7, '2026-12-04'), '2026-12-06', '01/11 + 7·5 = 06/12')
  assert.equal(nextDueDate('2026-01-31', 30, '2026-02-01'), '2026-03-02', 'across February')
  assert.equal(nextDueDate('2025-12-15', 365, '2026-12-04'), '2026-12-15')
  assert.equal(nextDueDate('2026-12-03', 1, '2026-12-04'), '2026-12-04')
})

test('preview while typing: same rule, from the last completion when editing; nothing until interval and date are valid', () => {
  assert.deepEqual(previewNextDue({ intervalDays: '7', startDate: '2026-12-04' }, CLOCK), { state: 'later', date: '2026-12-11', days: 7 })
  assert.deepEqual(previewNextDue({ intervalDays: '30', startDate: '2026-12-02' }, CLOCK), { state: 'later', date: '2027-01-01', days: 28 })
  assert.deepEqual(previewNextDue({ intervalDays: '14', startDate: '2026-11-20' }, CLOCK), { state: 'today', date: '2026-12-04', days: 0 })
  assert.deepEqual(previewNextDue({ intervalDays: '3', startDate: '2026-12-04' }, CLOCK), { state: 'soon', date: '2026-12-07', days: 3 })
  assert.equal(previewNextDue({ intervalDays: '7', startDate: '2026-11-01' }, CLOCK, '2026-12-01T10:00:00Z').date, '2026-12-08')
  for (const intervalDays of ['', '0', '366', '2.5', '-1', 'abc']) assert.equal(previewNextDue({ intervalDays, startDate: '2026-12-04' }, CLOCK), undefined, intervalDays)
  assert.equal(previewNextDue({ intervalDays: '7', startDate: '' }, CLOCK), undefined)
  assert.equal(parseInterval(' 365 '), 365)
  assert.equal(parseInterval('1'), 1)
})

test('due state of a row: overdue, today, soon (≤ 3 days), later, paused, in words', () => {
  const at = n => schedule({ nextDueAt: dueInstant(addDays('2026-12-04', n)) })
  assert.deepEqual(dueInfo(at(-3), CLOCK), { state: 'overdue', date: '2026-12-01', days: -3 })
  assert.equal(dueLabel(dueInfo(at(-3), CLOCK)), 'Quá hạn 3 ngày')
  assert.equal(dueLabel(dueInfo(at(0), CLOCK)), 'Đến hạn hôm nay')
  assert.equal(dueLabel(dueInfo(at(3), CLOCK)), 'Sắp đến hạn · còn 3 ngày')
  assert.equal(dueLabel(dueInfo(at(4), CLOCK)), 'Còn 4 ngày')
  assert.equal(dueInfo({ ...at(5), overdue: true }, CLOCK).state, 'overdue', 'the server flag wins')
  assert.equal(dueLabel(dueInfo(schedule({ active: false, nextDueAt: null }), CLOCK)), 'Tạm dừng')
  // 23:30 in Vietnam on 04/12 is still 04/12: due "tomorrow" at 00:00 is 1 day away.
  assert.equal(dueInfo(at(1), Date.parse('2026-12-04T16:30:00Z')).days, 1)
})

// ---- contract, permissions, route

test('draft contract: paths, fields, rule and ticket link documented; no delete; permissions READ for both roles, WRITE admin only', () => {
  const yaml = readFileSync(`${root}api-contract/drafts/maintenance-schedules.yaml`, 'utf8')
  for (const path of ['/api/v1/maintenance-schedules:', '/api/v1/maintenance-schedules/{id}:', '/deactivate:', '/activate:']) assert.ok(yaml.includes(path), path)
  for (const field of ['nextDueAt', 'lastCompletedAt', 'overdue', 'openTicketId', 'intervalDays', 'startDate']) assert.match(yaml, new RegExp(`\\n        ${field}:`), field)
  assert.match(yaml, /maximum: 365/)
  assert.match(yaml, /COMPLETED the server sets lastCompletedAt/)
  assert.doesNotMatch(yaml, /\n\s+delete:/, 'schedules are never deleted')
  const readme = readFileSync(`${root}api-contract/drafts/README.md`, 'utf8')
  assert.ok(readme.includes('`maintenance-schedules.yaml`'))
  assert.ok(DRAFT_PERMISSIONS.includes('MAINTENANCE_SCHEDULE_READ') && DRAFT_PERMISSIONS.includes('MAINTENANCE_SCHEDULE_WRITE'))
  assert.equal(can(['STAFF'], 'MAINTENANCE_SCHEDULE_READ'), true)
  assert.equal(can(['STAFF'], 'MAINTENANCE_SCHEDULE_WRITE'), false)
  assert.equal(can(['ADMIN'], 'MAINTENANCE_SCHEDULE_WRITE'), true)
  assert.deepEqual(matchRoute(SCHEDULES_PATH), { page: 'maintenance-schedules', id: undefined, permission: 'MAINTENANCE_SCHEDULE_READ', roles: ['ADMIN', 'STAFF'] })
  const index = NAV.findIndex(entry => entry.to === SCHEDULES_PATH)
  assert.equal(NAV[index].group, 'Vận hành')
  assert.equal(NAV[index].label, 'Lịch bảo trì')
  assert.equal(NAV[index - 1].to, '/admin/tickets', 'right after "Phiếu công việc"')
})

test('URL filters keep contract values only and become the list query', () => {
  const filters = readScheduleFilters(new URLSearchParams(`machineId=x&active=yes&sort=title,asc&page=-2`))
  assert.deepEqual(filters, { machineId: '', active: '', sort: { field: 'nextDueAt', direction: 'asc' }, page: 0 })
  assert.deepEqual(scheduleListQuery(filters, 20), { page: 0, size: 20, sort: 'nextDueAt,asc', machineId: undefined, active: undefined })
  const set = readScheduleFilters(new URLSearchParams(`machineId=${MACHINE_1}&active=false&sort=createdAt,desc&page=2`))
  assert.deepEqual(scheduleListQuery(set, 20), { page: 2, size: 20, sort: 'createdAt,desc', machineId: MACHINE_1, active: false })
})

// ---- forms

test('create body: required fields, optional ones only when filled in, nothing outside CreateMaintenanceScheduleRequest', () => {
  const values = { ...newScheduleValues(CLOCK), machineId: MACHINE_1, title: '  Vệ sinh khay  ', intervalDays: ' 7 ' }
  assert.equal(values.startDate, '2026-12-04', 'start date defaults to today in Vietnam')
  assert.deepEqual(validateSchedule(values), {})
  assert.deepEqual(createScheduleBody(values), { machineId: MACHINE_1, title: 'Vệ sinh khay', intervalDays: 7, startDate: '2026-12-04' })
  const full = createScheduleBody({ ...values, assigneeId: STAFF, note: ' Lau khay ' })
  assert.deepEqual(Object.keys(full).sort(), ['assigneeId', 'intervalDays', 'machineId', 'note', 'startDate', 'title'])
  assert.equal(full.note, 'Lau khay')
  const errors = validateSchedule({ machineId: '', title: ' ', intervalDays: '400', startDate: '2026-02-30', assigneeId: 'x', note: 'a'.repeat(1001) })
  assert.deepEqual(Object.keys(errors).sort(), ['assigneeId', 'intervalDays', 'machineId', 'note', 'startDate', 'title'])
})

test('update body: only changed fields; removed assignee and cleared note are null; machine never sent; empty when unchanged', () => {
  const current = schedule({ assigneeId: STAFF, assigneeName: 'Nhân viên', note: 'Lau khay' })
  const values = scheduleValues(current)
  assert.deepEqual(updateScheduleBody(current, values), {})
  assert.deepEqual(updateScheduleBody(current, { ...values, intervalDays: '14', machineId: MACHINE_3 }), { intervalDays: 14 })
  assert.deepEqual(updateScheduleBody(current, { ...values, assigneeId: '', note: '  ' }), { assigneeId: null, note: null })
  assert.deepEqual(updateScheduleBody(current, { ...values, title: 'Vệ sinh khay nhả hàng', startDate: '2026-12-01' }), { title: 'Vệ sinh khay nhả hàng', startDate: '2026-12-01' })
})

test('errors: 404/405/501 mean "chưa có"; 409 explained per action; only pause/resume conflicts close the dialog', () => {
  for (const status of [404, 405, 501]) assert.equal(schedulesAvailability(new ApiError(status, 'x')), 'missing')
  assert.equal(schedulesAvailability(new ApiError(403, 'x')), 'forbidden')
  assert.equal(schedulesAvailability(new ApiError(401, 'x')), 'unauthorized')
  assert.match(scheduleActionError(new ApiError(404, 'No static resource found.'), 'create').message, /^Chưa có dữ liệu lịch bảo trì/)
  assert.match(scheduleActionError(new ApiError(409, 'An active schedule…'), 'create').message, /đã có một lịch đang chạy cùng tên/)
  assert.match(scheduleActionError(new ApiError(409, 'Schedule is already inactive'), 'deactivate').message, /đã được tạm dừng trước đó.*tải lại/)
  const other = new ApiError(400, 'x', { title: 'bad' })
  assert.equal(scheduleActionError(other, 'update'), other)
  assert.equal(isStaleSchedule(new ApiError(409, 'x'), 'activate'), true)
  assert.equal(isStaleSchedule(new ApiError(409, 'x'), 'create'), false)
})

// ---- mock of the draft contract

test('mock: own group; seed has a soon, an overdue (with its open ticket) and a paused schedule, soonest due first', async () => {
  assert.equal(groupOf('/maintenance-schedules'), 'maintenance-schedules')
  assert.equal(groupOf(`/maintenance-schedules/${S(1)}/activate`), 'maintenance-schedules')
  assert.deepEqual(parseSelection('maintenance-schedules').groups, ['maintenance-schedules'])
  const { state } = setup()
  await signIn(state, 'staff')
  const page = await maintenanceSchedulesApi.list({ page: 0, size: 20 })
  assert.deepEqual(page.content.map(row => row.id), [S(3), S(2), S(1), S(4)], 'nextDueAt asc, paused (null) last')
  const [overdue, soon, , paused] = page.content
  assert.equal(overdue.overdue, true)
  assert.equal(overdue.openTicketId, id('61000000', 5))
  assert.equal(overdue.openTicketStatus, 'ASSIGNED')
  assert.equal(dueInfo(soon, CLOCK).state, 'soon')
  assert.equal(paused.active, false)
  assert.equal(paused.nextDueAt, null)
  assert.deepEqual((await maintenanceSchedulesApi.list({ page: 0, size: 20, active: false })).content.map(row => row.id), [S(4)])
  assert.deepEqual((await maintenanceSchedulesApi.list({ page: 0, size: 20, machineId: MACHINE_1 })).content.map(row => row.id), [S(2), S(1)])
  // Staff read only.
  await rejects(maintenanceSchedulesApi.create({ machineId: MACHINE_1, title: 'X', intervalDays: 7, startDate: '2026-12-04' }), 403)
  await rejects(maintenanceSchedulesApi.deactivate(S(1)), 403)
  await rejects(maintenanceSchedulesApi.get(id('62000000', 99)), 404)
  await rejects(maintenanceSchedulesApi.list({ page: 0, size: 20, machineId: 'x' }), 400)
})

test('Tiêu chí xong (mock): created schedule answers with nextDueAt by the same rule as the preview; due today opens a ticket', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const values = { ...newScheduleValues(CLOCK), machineId: MACHINE_1, title: 'Thay lọc gió', intervalDays: '30', startDate: '2026-12-02' }
  const created = await maintenanceSchedulesApi.create(createScheduleBody(values))
  assert.equal(created.nextDueAt, dueInstant(previewNextDue(values, CLOCK).date))
  assert.equal(formatDate(created.nextDueAt), '01/01/2027')
  assert.equal(created.active, true)
  assert.equal(created.overdue, false)
  assert.equal(created.openTicketId, null)

  // Start 14 days ago with N = 14: due today, so the "daily job" opens a MAINTENANCE ticket given to the assignee.
  const due = await maintenanceSchedulesApi.create({ machineId: MACHINE_3, title: 'Kiểm tra cửa', intervalDays: 14, startDate: '2026-11-20', assigneeId: STAFF })
  assert.equal(formatDate(due.nextDueAt), '04/12/2026')
  assert.ok(due.openTicketId)
  const ticket = await ticketsApi.get(due.openTicketId)
  assert.equal(ticket.type, 'MAINTENANCE')
  assert.equal(ticket.status, 'ASSIGNED')
  assert.equal(ticket.assigneeId, STAFF)
  assert.equal(ticket.machineId, MACHINE_3)

  // The assignee completes it: the next cycle starts from the completion day.
  await signIn(state, 'staff')
  await ticketsApi.start(ticket.id)
  state.clock += 10 * 60_000
  await ticketsApi.complete(ticket.id, {})
  const moved = await maintenanceSchedulesApi.get(due.id)
  assert.equal(moved.openTicketId, null)
  assert.ok(moved.lastCompletedAt)
  assert.equal(formatDate(moved.nextDueAt), '18/12/2026')
})

test('mock: 400 on fields outside the draft and bad values; 409 on a duplicate title; PATCH only what is sent; pause and resume with 409', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  await rejects(maintenanceSchedulesApi.create({ machineId: MACHINE_1, title: 'X', intervalDays: 7, startDate: '2026-12-04', nextDueAt: '2026-12-10' }), 400, error => 'nextDueAt' in error.fieldErrors)
  await rejects(maintenanceSchedulesApi.create({ machineId: MACHINE_1, title: 'X', intervalDays: 0, startDate: '2026-02-30' }), 400, error => 'intervalDays' in error.fieldErrors && 'startDate' in error.fieldErrors)
  await rejects(maintenanceSchedulesApi.create({ machineId: MACHINE_1, title: 'vệ sinh khay nhả hàng', intervalDays: 7, startDate: '2026-12-04' }), 409)
  await rejects(maintenanceSchedulesApi.update(S(1), {}), 400)
  await rejects(maintenanceSchedulesApi.update(S(1), { machineId: MACHINE_3 }), 400, error => 'machineId' in error.fieldErrors)

  const changed = await maintenanceSchedulesApi.update(S(2), { intervalDays: 10, assigneeId: STAFF })
  assert.equal(changed.intervalDays, 10)
  assert.equal(changed.assigneeId, STAFF)
  assert.equal(changed.title, 'Kiểm tra cảm biến nhiệt độ và độ ẩm')
  // start 22/11 + 10 = 02/12 is past → 12/12.
  assert.equal(formatDate(changed.nextDueAt), '12/12/2026')
  const cleared = await maintenanceSchedulesApi.update(S(2), { assigneeId: null, note: null })
  assert.equal(cleared.assigneeId, null)
  assert.equal(cleared.note, null)

  const paused = await maintenanceSchedulesApi.deactivate(S(2))
  assert.equal(paused.active, false)
  assert.equal(paused.nextDueAt, null)
  assert.ok(paused.deactivatedAt && paused.deactivatedByName)
  await rejects(maintenanceSchedulesApi.deactivate(S(2)), 409)
  const resumed = await maintenanceSchedulesApi.activate(S(2))
  assert.equal(resumed.active, true)
  assert.equal(resumed.deactivatedAt, null)
  assert.equal(formatDate(resumed.nextDueAt), '12/12/2026')
  await rejects(maintenanceSchedulesApi.activate(S(2)), 409)
})
