// FE 7.3 Lịch bảo trì on the real API (/maintenance-plans of api.yaml, backend #70, docs/maintenance-plans.md): calendar
// days in Vietnam, due state of a row, URL filters, create/update bodies (version, clearDefaultAssignee, nextDueDate), error
// text, and the mock that plays the backend (work order created leadDays before the due day, next due day after DONE /
// CANCELLED, generate-now, activate / deactivate, STALE_VERSION).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, maintenancePlansApi, workOrdersApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { ROLE_PERMISSIONS } from '../src/admin/permissions.ts'
import { NAV, matchRoute } from '../src/admin/routes.ts'
import {
  PLAN_STALE, SCHEDULES_MISSING, SCHEDULES_PATH, addDays, createScheduleBody, daysBetween, dueInfo, dueInstant, dueLabel, formatDay, intervalText, isDateString,
  isStaleSchedule, leadText, newScheduleValues, previewFirstDue, readScheduleFilters, scheduleActionError, scheduleListQuery, scheduleValues, schedulesAvailability,
  updateScheduleBody, validateSchedule, vietnamDate, vietnamDateOf,
} from '../src/admin/maintenance-schedules.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const yaml = readFileSync(`${root}api-contract/api.yaml`, 'utf8').replace(/\r\n/g, '\n')
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_1 = id('20000000', 1)
const MACHINE_3 = id('20000000', 3)
const STAFF = id('11000000', 2)
const P = n => id('62000000', n)
const NOW = Date.parse('2026-12-04T03:00:00Z') // 10:00 on 04/12/2026 in Vietnam
const TODAY = '2026-12-04'

function setup() {
  const state = { token: null, clock: NOW }
  const fetcher = createMockFetcher(parseSelection('all'), { now: () => state.clock, getSearch: () => '' })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}
async function signIn(state, account) {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
async function rejects(promise, status, check) {
  await assert.rejects(promise, error => error instanceof ApiError && error.status === status && (!check || check(error)))
}
const plan = fields => ({ id: P(9), machineId: MACHINE_1, title: 'Vệ sinh', instructions: null, intervalDays: 7, leadDays: 1, dueTime: '17:00', priority: 'NORMAL', defaultAssignee: null, nextDueDate: '2026-12-10', active: true, overdue: false, version: 3, ...fields })

test('calendar days in Vietnam: midnight is 17:00 UTC; dates cross months, years and 29/02', () => {
  assert.equal(vietnamDate(Date.parse('2026-12-04T16:59:59Z')), '2026-12-04')
  assert.equal(vietnamDate(Date.parse('2026-12-04T17:00:00Z')), '2026-12-05')
  assert.equal(vietnamDateOf('2026-12-31T18:00:00Z'), '2027-01-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-12-30', 7), '2027-01-06')
  assert.equal(daysBetween('2026-12-04', '2026-12-01'), -3)
  assert.equal(dueInstant('2026-12-05'), '2026-12-04T17:00:00.000Z')
  assert.equal(isDateString('2026-02-31'), false)
  assert.equal(formatDay('2026-12-04'), '04/12/2026')
})

test('due state of a row from nextDueDate and overdue: overdue, working (past, work order open), today, soon, later, off', () => {
  const at = day => dueInfo(plan({ nextDueDate: day }), NOW)
  assert.deepEqual(dueInfo(plan({ nextDueDate: '2026-12-01', overdue: true }), NOW), { state: 'overdue', date: '2026-12-01', days: -3 })
  assert.equal(dueLabel(dueInfo(plan({ nextDueDate: '2026-12-01', overdue: true }), NOW)), 'Quá hạn 3 ngày, chưa có phiếu')
  assert.equal(dueLabel(at('2026-12-01')), 'Quá hạn 3 ngày · phiếu đang mở')
  assert.equal(dueLabel(at(TODAY)), 'Đến hạn hôm nay')
  assert.equal(dueLabel(at('2026-12-07')), 'Sắp đến hạn · còn 3 ngày')
  assert.equal(dueLabel(at('2026-12-08')), 'Còn 4 ngày')
  assert.equal(dueLabel(dueInfo(plan({ active: false }), NOW)), 'Đã tắt')
  assert.equal(intervalText(7), 'Mỗi 7 ngày')
  assert.equal(leadText(0), 'tạo phiếu đúng ngày đến hạn')
  assert.equal(leadText(2), 'tạo phiếu trước 2 ngày')
})

test('contract: plan paths, PATCH with version and clearDefaultAssignee, no delete; permissions READ both roles, MANAGE admin; route kept', () => {
  for (const path of ['/maintenance-plans', '/maintenance-plans/upcoming', '/maintenance-plans/{id}', '/maintenance-plans/{id}/activate', '/maintenance-plans/{id}/deactivate', '/maintenance-plans/{id}/generate-now', '/maintenance-plans/{id}/work-orders']) {
    assert.ok(yaml.includes(`"/api/v1${path}":`), path)
  }
  assert.ok(yaml.includes('"clearDefaultAssignee"'))
  assert.ok(ROLE_PERMISSIONS.STAFF.includes('MAINTENANCE_PLAN_READ') && !ROLE_PERMISSIONS.STAFF.includes('MAINTENANCE_PLAN_MANAGE'))
  assert.equal(matchRoute(SCHEDULES_PATH)?.page, 'maintenance-schedules')
  assert.equal(NAV.find(item => item.to === SCHEDULES_PATH)?.permission, 'MAINTENANCE_PLAN_READ')
  assert.equal(groupOf('/maintenance-plans'), 'maintenance-schedules')
})

test('URL filters keep contract values only and become the list query (no sort parameter)', () => {
  const filters = readScheduleFilters(new URLSearchParams(`machineId=${MACHINE_1}&active=false&page=2&sort=createdAt,desc`))
  assert.deepEqual(scheduleListQuery(filters, 20), { page: 2, size: 20, machineId: MACHINE_1, active: false })
  assert.deepEqual(scheduleListQuery(readScheduleFilters(new URLSearchParams('machineId=x&active=maybe')), 20), { page: 0, size: 20, machineId: undefined, active: undefined })
})

test('form checks: interval 1..365, lead 0..30 and below the interval, time HH:mm, due day from today (an unchanged past one is fine)', () => {
  const values = { ...newScheduleValues(), machineId: MACHINE_1, title: 'Vệ sinh', intervalDays: '7' }
  assert.deepEqual(validateSchedule(values, NOW), {})
  assert.ok(validateSchedule({ ...values, intervalDays: '0' }, NOW).intervalDays)
  assert.ok(validateSchedule({ ...values, leadDays: '7' }, NOW).leadDays)
  assert.ok(validateSchedule({ ...values, leadDays: '31', intervalDays: '60' }, NOW).leadDays)
  assert.ok(validateSchedule({ ...values, dueTime: '25:00' }, NOW).dueTime)
  assert.ok(validateSchedule({ ...values, dueDate: '2026-12-03' }, NOW).dueDate)
  const current = plan({ nextDueDate: '2026-12-01' })
  assert.deepEqual(validateSchedule(scheduleValues(current), NOW, current), {}, 'an overdue plan can still be edited')
  assert.ok(validateSchedule({ ...scheduleValues(current), dueDate: '' }, NOW, current).dueDate)
})

test('create body: required fields and the filled optional ones; preview of the first due day and the day its work order appears', () => {
  const values = { ...newScheduleValues(), machineId: MACHINE_1, title: ' Vệ sinh khay ', intervalDays: '7', defaultAssigneeId: STAFF, instructions: '  ' }
  assert.deepEqual(createScheduleBody(values), { machineId: MACHINE_1, title: 'Vệ sinh khay', intervalDays: 7, leadDays: 1, dueTime: '17:00', priority: 'NORMAL', defaultAssigneeId: STAFF })
  assert.deepEqual(createScheduleBody({ ...values, dueDate: '2026-12-20' }).firstDueDate, '2026-12-20')
  assert.deepEqual(previewFirstDue(values, NOW), { due: '2026-12-11', createdOn: '2026-12-10', days: 7 })
  assert.deepEqual(previewFirstDue({ ...values, dueDate: TODAY }, NOW), { due: TODAY, createdOn: TODAY, days: 0 })
  assert.equal(previewFirstDue({ ...values, intervalDays: '' }, NOW), undefined)
})

test('update body: version plus only what changed; cleared instructions "", removed assignee clearDefaultAssignee; undefined when unchanged', () => {
  const current = plan({ instructions: 'Lau khay', defaultAssignee: { id: STAFF, fullName: 'Nhân viên vận hành' } })
  assert.equal(updateScheduleBody(current, scheduleValues(current)), undefined)
  assert.deepEqual(updateScheduleBody(current, { ...scheduleValues(current), instructions: '', defaultAssigneeId: '', intervalDays: '14', dueDate: '2026-12-12' }),
    { version: 3, instructions: '', intervalDays: 14, clearDefaultAssignee: true, nextDueDate: '2026-12-12' })
  assert.deepEqual(updateScheduleBody(plan(), { ...scheduleValues(plan()), defaultAssigneeId: STAFF, dueTime: '08:30' }), { version: 3, dueTime: '08:30', defaultAssigneeId: STAFF })
})

test('errors: 404/405/501 mean "chưa có"; STALE_VERSION and generate-now codes explained; which ones close the dialog', () => {
  assert.equal(schedulesAvailability(new ApiError(404, 'x')), 'missing')
  assert.equal(scheduleActionError(new ApiError(501, 'x'), 'create').message, SCHEDULES_MISSING)
  assert.equal(scheduleActionError(new ApiError(409, 'STALE_VERSION: x'), 'update').message, PLAN_STALE)
  assert.match(scheduleActionError(new ApiError(409, 'PLAN_HAS_OPEN_WORK_ORDER: x'), 'generate').message, /chưa xong/)
  assert.match(scheduleActionError(new ApiError(409, 'MACHINE_INACTIVE: x'), 'create').message, /Ngừng hoạt động/)
  assert.equal(isStaleSchedule(new ApiError(409, 'STALE_VERSION: x'), 'update'), true)
  assert.equal(isStaleSchedule(new ApiError(409, 'MACHINE_INACTIVE: x'), 'create'), false)
  assert.equal(isStaleSchedule(new ApiError(409, 'x'), 'activate'), true)
  assert.equal(isStaleSchedule(new ApiError(400, 'x'), 'update'), false)
})

test('mock: seed plans by next due day; overdue only without an open work order; upcoming within N days; staff read only', async () => {
  const state = setup()
  await signIn(state, 'staff')
  const page = await maintenancePlansApi.list({ page: 0, size: 20 })
  assert.equal(page.totalElements, 4)
  assert.deepEqual(page.content.map(row => row.id), [P(3), P(2), P(1), P(4)])
  const [late, soon] = page.content
  assert.deepEqual([late.nextDueDate, late.overdue, late.currentWorkOrder.id], [addDays(TODAY, -3), false, id('61000000', 5)])
  assert.deepEqual([soon.nextDueDate, soon.currentWorkOrder], [addDays(TODAY, 2), null])
  assert.equal(page.content.find(row => row.id === P(1)).lastCompletedAt !== null, true)
  assert.deepEqual((await maintenancePlansApi.list({ active: false, page: 0, size: 20 })).content.map(row => row.id), [P(4)])
  assert.deepEqual((await maintenancePlansApi.upcoming({ days: 3 })).map(row => row.id), [P(3), P(2)])
  await rejects(maintenancePlansApi.upcoming({ days: 91 }), 400)
  await rejects(maintenancePlansApi.create({ machineId: MACHINE_1, title: 'x', intervalDays: 7 }), 403)
  assert.equal((await workOrdersApi.mine({ page: 0, size: 20 })).totalElements, 3, 'reading plans created no work order on the seed')
})

test('Tiêu chí xong (mock): a plan due within its lead days gets its work order at once; DONE moves the due day to completion + N', async () => {
  const state = setup()
  await signIn(state, 'admin')
  await rejects(maintenancePlansApi.create({ machineId: MACHINE_1, title: 'x', intervalDays: 7, leadDays: 7 }), 400, error => !!error.fieldErrors.leadDays)
  await rejects(maintenancePlansApi.create({ machineId: MACHINE_1, title: 'x', intervalDays: 7, firstDueDate: '2026-12-01' }), 400, error => !!error.fieldErrors.firstDueDate)
  await rejects(maintenancePlansApi.create({ machineId: MACHINE_3, title: 'x', intervalDays: 7 }), 409, error => error.message.startsWith('MACHINE_INACTIVE'))
  const created = await maintenancePlansApi.create({ machineId: MACHINE_1, title: 'Kiểm tra gioăng', intervalDays: 7, leadDays: 1, firstDueDate: addDays(TODAY, 1), defaultAssigneeId: STAFF })
  assert.equal(created.nextDueDate, addDays(TODAY, 1))
  const current = created.currentWorkOrder
  assert.equal(current.status, 'ASSIGNED', 'due tomorrow with 1 lead day: generated now and given to the default assignee')
  const order = await workOrdersApi.get(current.id)
  assert.deepEqual([order.type, order.source, order.maintenancePlan.id, order.scheduledFor, order.dueAt], ['MAINTENANCE', 'SCHEDULE', created.id, addDays(TODAY, 1), `${addDays(TODAY, 1)}T10:00:00.000Z`])
  await rejects(maintenancePlansApi.generateNow(created.id), 409, error => error.message.startsWith('PLAN_HAS_OPEN_WORK_ORDER'))
  await workOrdersApi.start(order.id)
  await workOrdersApi.complete(order.id, { resultNote: 'Đã kiểm tra' })
  const after = await maintenancePlansApi.get(created.id)
  assert.deepEqual([after.nextDueDate, after.currentWorkOrder, !!after.lastCompletedAt], [addDays(TODAY, 7), null, true])
  assert.deepEqual((await maintenancePlansApi.workOrders(created.id)).map(row => [row.code, row.status]), [[order.code, 'DONE']])
})

test('mock: PATCH needs the current version (STALE_VERSION), clears the default assignee; generate-now, deactivate and activate', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const soon = await maintenancePlansApi.get(P(2))
  await rejects(maintenancePlansApi.update(P(2), { version: soon.version + 1, title: 'x' }), 409, error => error.message.startsWith('STALE_VERSION'))
  await rejects(maintenancePlansApi.update(P(2), { title: 'x' }), 400, error => !!error.fieldErrors.version)
  const changed = await maintenancePlansApi.update(P(2), { version: soon.version, title: 'Kiểm tra cảm biến', defaultAssigneeId: STAFF })
  assert.deepEqual([changed.title, changed.defaultAssignee.id, changed.version], ['Kiểm tra cảm biến', STAFF, soon.version + 1])
  const cleared = await maintenancePlansApi.update(P(2), { version: changed.version, clearDefaultAssignee: true })
  assert.equal(cleared.defaultAssignee, null)
  const generated = await maintenancePlansApi.generateNow(P(2))
  assert.deepEqual([generated.source, generated.status, generated.scheduledFor], ['SCHEDULE', 'OPEN', addDays(TODAY, 2)])
  await workOrdersApi.cancel(generated.id, { reason: 'Bỏ lần này', version: generated.version })
  assert.equal((await maintenancePlansApi.get(P(2))).nextDueDate, addDays(TODAY, 16), 'cancelled: scheduled day + interval')
  const off = await maintenancePlansApi.deactivate(P(2))
  assert.equal(off.active, false)
  await rejects(maintenancePlansApi.generateNow(P(2)), 409, error => error.message.startsWith('MAINTENANCE_PLAN_INACTIVE'))
  assert.equal((await maintenancePlansApi.activate(P(2))).active, true)
})
