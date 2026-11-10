import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { CHECK_FIELDS, ValidationError, describeFormFailure } from '../src/admin/form-error.ts'
import { authApi, usersApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  ACTIVE_ADMIN_QUERY, EMAIL_TAKEN, LOCK_BLOCK_TEXT, STATUS_CONFLICT_TEXT, createUserBody, describeCreateError, describeStatusError, isSelf,
  lockBlockReason, lockBlocks, readUserFilters, statusAction, updateUserBody, userListQuery, validateCreateUser, validateUpdateUser,
} from '../src/admin/users.ts'

const ME = { id: '11000000-0000-0000-0000-000000000001', email: 'admin@freshvend.test' }
const user = (patch = {}) => ({ id: '10000000-0000-0000-0000-000000000009', email: 'x@freshvend.test', fullName: 'X', phone: null, status: 'ACTIVE', roles: ['STAFF'], createdAt: '', updatedAt: '', ...patch })

test('lock is refused on yourself, with the reason', () => {
  const self = user({ id: ME.id, email: ME.email, roles: ['ADMIN'] })
  assert.deepEqual(lockBlocks(self, ME, 3), ['self'])
  assert.equal(lockBlockReason(lockBlocks(self, ME, 3)), LOCK_BLOCK_TEXT.self)
  // The email is a fallback when the token subject is not the account id (case-insensitive, like the backend).
  assert.deepEqual(lockBlocks(user({ email: 'Admin@FreshVend.test' }), { email: 'admin@freshvend.test' }, 3), ['self'])
})

test('lock is refused on the last ACTIVE admin; both reasons when that admin is you', () => {
  const other = user({ roles: ['ADMIN'] })
  assert.deepEqual(lockBlocks(other, ME, 1), ['lastAdmin'])
  assert.equal(lockBlockReason(['lastAdmin']), 'Đây là Quản trị viên đang hoạt động cuối cùng.')
  assert.deepEqual(lockBlocks(other, ME, 2), [])
  const self = user({ id: ME.id, roles: ['ADMIN'] })
  assert.deepEqual(lockBlocks(self, ME, 1), ['self', 'lastAdmin'])
  assert.equal(lockBlockReason(lockBlocks(self, ME, 1)), 'Không thể khóa chính bạn. Đây là Quản trị viên đang hoạt động cuối cùng.')
  // JWT-style role names count as ADMIN too.
  assert.deepEqual(lockBlocks(user({ roles: ['ROLE_ADMIN'] }), ME, 1), ['lastAdmin'])
})

test('lock rule: staff, non-active accounts and an unknown admin count are not refused by the UI', () => {
  assert.deepEqual(lockBlocks(user(), ME, 1), [], 'a STAFF account is never the last admin')
  assert.deepEqual(lockBlocks(user({ roles: ['ADMIN', 'STAFF'], status: 'LOCKED' }), ME, 0), [], 'already locked: nothing to lock')
  assert.deepEqual(lockBlocks(user({ roles: ['ADMIN'] }), ME, undefined), [], 'count unknown: the backend 409 decides')
  assert.deepEqual(lockBlocks(user({ id: ME.id }), null, 1), [], 'no session, no self')
  assert.equal(isSelf(user(), ME), false)
})

test('row status action: lock an active account, reopen a locked or inactive one', () => {
  assert.deepEqual(statusAction('ACTIVE'), { kind: 'lock' })
  assert.deepEqual(statusAction('LOCKED'), { kind: 'activate', label: 'Mở khóa' })
  assert.deepEqual(statusAction('INACTIVE'), { kind: 'activate', label: 'Kích hoạt lại' })
})

test('create body has only the contract fields; phone left out when empty, password untouched', () => {
  const body = createUserBody({ email: '  new@freshvend.test ', password: '  spaced pass  ', fullName: ' Nguyễn Văn A ', phone: '' })
  assert.deepEqual(body, { email: 'new@freshvend.test', password: '  spaced pass  ', fullName: 'Nguyễn Văn A' })
  assert.deepEqual(Object.keys(createUserBody({ email: 'a@b.c', password: 'p', fullName: 'A', phone: ' 0901 ' })).sort(), ['email', 'fullName', 'password', 'phone'])
  assert.equal(createUserBody({ email: 'a@b.c', password: 'p', fullName: 'A', phone: ' 0901 ' }).phone, '0901')
})

test('update body is fullName + phone only; an empty phone is null (PUT replaces)', () => {
  assert.deepEqual(updateUserBody({ fullName: ' B ', phone: '  ' }), { fullName: 'B', phone: null })
  assert.deepEqual(updateUserBody({ fullName: 'B', phone: '0912' }), { fullName: 'B', phone: '0912' })
})

test('client checks follow the contract limits', () => {
  assert.deepEqual(Object.keys(validateCreateUser({ email: '', password: '', fullName: ' ', phone: '' })).sort(), ['email', 'fullName', 'password'])
  assert.ok(validateCreateUser({ email: 'not-an-email', password: 'x', fullName: 'A', phone: '' }).email)
  assert.ok(validateCreateUser({ email: 'a@b.c', password: '   ', fullName: 'A', phone: '' }).password)
  assert.ok(validateCreateUser({ email: 'a@b.c', password: 'ệ'.repeat(25), fullName: 'A', phone: '' }).password, '75 UTF-8 bytes > 72')
  assert.equal(validateCreateUser({ email: 'a@b.c', password: 'a'.repeat(72), fullName: 'A', phone: '' }).password, undefined)
  assert.ok(validateUpdateUser({ fullName: 'a'.repeat(201), phone: '' }).fullName)
  assert.ok(validateUpdateUser({ fullName: 'A', phone: '1'.repeat(33) }).phone)
  assert.deepEqual(validateUpdateUser({ fullName: 'A', phone: '' }), {})
})

test('URL filters keep only contract values; the list query sends page, size, status and role only', () => {
  const filters = readUserFilters(new URLSearchParams('status=LOCKED&role=ROOT&page=2&sort=email,asc'))
  assert.deepEqual(filters, { status: 'LOCKED', role: '', page: 2 })
  assert.deepEqual(userListQuery(filters, 20), { page: 2, size: 20, status: 'LOCKED', role: undefined })
  assert.deepEqual(readUserFilters(new URLSearchParams('page=-1')).page, 0)
  assert.deepEqual(ACTIVE_ADMIN_QUERY, { page: 0, size: 1, status: 'ACTIVE', role: 'ADMIN' })
})

test('409s are explained in Vietnamese; other conflicts keep their message', () => {
  assert.equal(describeStatusError(new ApiError(409, 'You cannot disable or lock your own account')).message, STATUS_CONFLICT_TEXT.self)
  assert.equal(describeStatusError(new ApiError(409, 'The last active administrator cannot be disabled')).message, STATUS_CONFLICT_TEXT.lastAdmin)
  assert.equal(describeStatusError(new ApiError(409, 'Không thể vô hiệu hóa ADMIN đang hoạt động cuối cùng.')).message, STATUS_CONFLICT_TEXT.lastAdmin)
  assert.equal(describeStatusError(new ApiError(409, 'Thao tác xung đột.')).message, 'Thao tác xung đột.')
  // "last" alone is not the last-admin rule.
  assert.equal(describeStatusError(new ApiError(409, 'Account was changed at the last moment')).message, 'Account was changed at the last moment')
  assert.equal(describeStatusError(new ApiError(409, 'Cannot disable the last active admin')).message, STATUS_CONFLICT_TEXT.lastAdmin)
  const notConflict = new ApiError(403, 'x')
  assert.equal(describeStatusError(notConflict), notConflict)
  // Duplicate email: said once, under the field; the form-level line is the generic one (not the same sentence twice).
  const duplicate = describeCreateError(new ApiError(409, 'Email is already in use'))
  assert.ok(duplicate instanceof ValidationError)
  assert.deepEqual(describeFormFailure(duplicate), { message: CHECK_FIELDS, fieldErrors: { email: EMAIL_TAKEN } })
  // Two simultaneous creates hit the database constraint: the backend's generic English sentence is still a taken email.
  for (const message of ['Request conflicts with existing data', 'Thao tác xung đột.']) {
    assert.deepEqual(describeFormFailure(describeCreateError(new ApiError(409, message))), { message: CHECK_FIELDS, fieldErrors: { email: EMAIL_TAKEN } })
  }
  const notConflictCreate = new ApiError(400, 'Validation failed')
  assert.equal(describeCreateError(notConflictCreate), notConflictCreate)
})

/** Real client against a fresh mock store, signed in as the documented mock admin. */
async function mockAdmin() {
  const state = { token: null }
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now(), realFetch: async () => { throw new Error('no network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin })).accessToken
}
const conflict = error => error instanceof ApiError && error.status === 409

test('mock seed exercises both reasons: two active admins, one locked admin, several staff', async () => {
  await mockAdmin()
  const all = (await usersApi.list({ size: 100 })).content
  const admins = all.filter(row => row.roles.includes('ADMIN'))
  assert.equal(admins.filter(row => row.status === 'ACTIVE').length, 2)
  assert.ok(admins.some(row => row.status === 'LOCKED'))
  assert.ok(all.filter(row => row.roles.includes('STAFF')).length >= 3)
  assert.equal((await usersApi.list(ACTIVE_ADMIN_QUERY)).totalElements, 2)
  await assert.rejects(usersApi.list({ role: 'ROOT' }), error => error instanceof ApiError && error.status === 400)
})

test('mock status rules match the backend: self is 409, also once the actor is the last active admin', async () => {
  await mockAdmin()
  const me = '11000000-0000-0000-0000-000000000001', second = '11000000-0000-0000-0000-000000000005'
  await assert.rejects(usersApi.setStatus(me, 'LOCKED'), conflict)
  await usersApi.setStatus(second, 'LOCKED')
  assert.equal((await usersApi.list(ACTIVE_ADMIN_QUERY)).totalElements, 1)
  await assert.rejects(usersApi.setStatus(me, 'INACTIVE'), conflict)
  const reopened = await usersApi.setStatus(second, 'ACTIVE')
  assert.equal(reopened.status, 'ACTIVE')
})

test('mock create/update reject fields outside the contract and enforce its limits', async () => {
  await mockAdmin()
  await assert.rejects(usersApi.create({ email: 'z@freshvend.test', password: 'long-enough-password', fullName: 'Z', role: 'ADMIN' }), error => error.status === 400 && !!error.fieldErrors.role)
  await assert.rejects(usersApi.create({ email: 'z@freshvend.test', password: 'long-enough-password', fullName: 'a'.repeat(201) }), error => error.status === 400 && !!error.fieldErrors.fullName)
  await assert.rejects(usersApi.create({ email: MOCK_ACCOUNTS.staff, password: 'long-enough-password', fullName: 'Dup' }), conflict)
  const created = await usersApi.create(createUserBody({ email: 'z@freshvend.test', password: 'long-enough-password', fullName: 'Z', phone: '' }))
  assert.deepEqual([created.status, created.roles, created.phone], ['ACTIVE', ['STAFF'], null])
  await assert.rejects(usersApi.update(created.id, { fullName: 'Z', email: 'other@freshvend.test' }), error => error.status === 400 && !!error.fieldErrors.email)
  assert.equal((await usersApi.update(created.id, updateUserBody({ fullName: 'Zed', phone: '0901' }))).fullName, 'Zed')
})
