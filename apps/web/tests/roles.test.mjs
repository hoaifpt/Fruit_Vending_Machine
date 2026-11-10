// Screen A3 "Vai trò & quyền" (issue FE 3.2): pure rules (groups, diff, payload, lock, error wording), the mock of the
// backend #48 role/permission API (draft api-contract/drafts/roles-permissions.yaml) and the router's leave guard.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient, request } from '../src/api/client.ts'
import { authApi, productsApi, rolesApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS, SEED_PERMISSIONS, SEED_ROLE_IDS, SEED_STAFF_PERMISSIONS } from '../src/api/mock/seed.ts'
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/admin/permissions.ts'
import { canOpen, matchRoute, navFor } from '../src/admin/routes.ts'
import {
  ADMIN_REQUIRED, PERMISSION_GROUPS, ROLE_SAVE_TEXT, cellChange, changeCount, codesInFieldError, describeChange, describeChanges,
  describeSaveError, diffGrants, sameGrants, grantsOf, groupPermissions, hasGrant, lockReason, normalizeCodes, permissionLabel, replaceBody,
  roleLabel, sortRoles, staleRoles, toggleGrant,
} from '../src/admin/roles.ts'
import { confirmLeave, leavesScreen, navigate, setLeaveGuard } from '../src/lib/router.ts'

const ADMIN = SEED_ROLE_IDS.ADMIN
const STAFF = SEED_ROLE_IDS.STAFF
const ROLES = [
  { id: STAFF, name: 'STAFF', description: 'Machine operations and inventory staff', permissions: [...SEED_STAFF_PERMISSIONS] },
  { id: ADMIN, name: 'ADMIN', description: 'System administrator', permissions: SEED_PERMISSIONS.map(p => p.code) },
]

// ---- pure rules

test('codes of #48 match the web permission table (no rename needed) and every code has a group and a Vietnamese label', () => {
  assert.deepEqual(SEED_PERMISSIONS.map(p => p.code).sort(), [...PERMISSIONS].sort())
  assert.deepEqual([...SEED_STAFF_PERMISSIONS].sort(), [...ROLE_PERMISSIONS.STAFF].sort())
  const grouped = PERMISSION_GROUPS.flatMap(group => group.codes)
  assert.deepEqual([...grouped].sort(), [...PERMISSIONS].sort(), 'each code in exactly one group')
  for (const code of PERMISSIONS) assert.notEqual(permissionLabel(code, 'English'), 'English', code)
})

test('groupPermissions follows the #48 groups, keeps their order and places later codes by prefix', () => {
  const groups = groupPermissions([...SEED_PERMISSIONS, { code: 'PRODUCT_EXPORT', description: 'Export products' }, { code: 'REPORT_READ', description: 'Read reports' }, { code: 'USER_READ', description: 'dup' }, { code: '' }])
  assert.deepEqual(groups.map(group => group.label), ['Tài khoản & phân quyền', 'Sản phẩm', 'Máy, ngăn & khóa kiosk', 'Lô hàng', 'Tồn kho', 'Đơn hàng', 'Thanh toán', 'Nhóm REPORT'])
  assert.deepEqual(groups[0].permissions.map(p => p.code), ['USER_READ', 'USER_WRITE', 'PERMISSION_MANAGE'], 'duplicates and blanks dropped')
  assert.deepEqual(groups[1].permissions.map(p => p.code), ['PRODUCT_READ', 'PRODUCT_WRITE', 'PRODUCT_EXPORT'])
  assert.equal(groups[1].permissions[2].label, 'Export products', 'unknown code: backend description')
  assert.deepEqual(groups[3].permissions.map(p => p.code), ['BATCH_READ', 'BATCH_CREATE'])
  assert.deepEqual(groupPermissions([]), [])
})

test('roles are shown ADMIN, STAFF, then others; labels are Vietnamese', () => {
  assert.deepEqual(sortRoles([{ id: 'x', name: 'AUDITOR' }, ...ROLES]).map(role => role.name), ['ADMIN', 'STAFF', 'AUDITOR'])
  assert.equal(roleLabel('ADMIN'), 'Quản trị viên')
  assert.equal(roleLabel('ROLE_STAFF'), 'Nhân viên')
  assert.equal(roleLabel('AUDITOR'), 'AUDITOR')
})

test('toggling builds a draft; the diff lists per role what is added and removed, only for changed roles', () => {
  const saved = grantsOf(ROLES)
  assert.deepEqual(saved[STAFF], [...SEED_STAFF_PERMISSIONS].sort())
  let draft = toggleGrant(saved, STAFF, 'PAYMENT_READ', true)
  draft = toggleGrant(draft, STAFF, 'ORDER_READ', false)
  draft = toggleGrant(draft, STAFF, 'PAYMENT_READ', true) // idempotent
  assert.equal(draft[ADMIN], saved[ADMIN], 'other roles keep their array')
  assert.equal(hasGrant(draft, STAFF, 'PAYMENT_READ'), true)
  const changes = diffGrants(sortRoles(ROLES), saved, draft)
  assert.deepEqual(changes, [{ roleId: STAFF, roleName: 'STAFF', added: ['PAYMENT_READ'], removed: ['ORDER_READ'] }])
  assert.equal(changeCount(changes), 2)
  assert.equal(cellChange(saved, draft, STAFF, 'PAYMENT_READ'), 'added')
  assert.equal(cellChange(saved, draft, STAFF, 'ORDER_READ'), 'removed')
  assert.equal(cellChange(saved, draft, ADMIN, 'ORDER_READ'), undefined)
  // Ticking back to the saved state is "no change".
  assert.deepEqual(diffGrants(ROLES, saved, toggleGrant(toggleGrant(draft, STAFF, 'PAYMENT_READ', false), STAFF, 'ORDER_READ', true)), [])
})

test('sameGrants ignores order and treats a missing role as empty', () => {
  assert.equal(sameGrants({ a: ['X', 'Y'] }, { a: ['Y', 'X'] }), true)
  assert.equal(sameGrants({ a: [] }, {}), true)
  assert.equal(sameGrants({ a: ['X'] }, { a: ['Y'] }), false)
})

test('the readable summary names role and permissions in Vietnamese', () => {
  const change = { roleId: STAFF, roleName: 'STAFF', added: ['PAYMENT_READ', 'PRODUCT_WRITE'], removed: ['ORDER_READ'] }
  assert.equal(describeChange(change), 'Nhân viên: thêm Xem thanh toán, Tạo, sửa, đổi trạng thái sản phẩm; bỏ Xem đơn hàng.')
  assert.equal(describeChange({ ...change, added: [] }), 'Nhân viên: bỏ Xem đơn hàng.')
  assert.equal(describeChanges([]), 'Không có quyền nào thay đổi.')
})

test('PUT body is the complete sorted set, only the contract field, no duplicates or blanks; an empty set is allowed', () => {
  assert.deepEqual(replaceBody(['ORDER_READ', 'BATCH_READ', 'ORDER_READ', ' ', 'MACHINE_READ ']), { permissions: ['BATCH_READ', 'MACHINE_READ', 'ORDER_READ'] })
  assert.deepEqual(Object.keys(replaceBody([])), ['permissions'])
  assert.deepEqual(replaceBody([]), { permissions: [] })
  assert.deepEqual(normalizeCodes(['B', 'A']), ['A', 'B'])
})

test('ADMIN keeps USER_WRITE and PERMISSION_MANAGE: those cells are locked with a reason; nothing else is', () => {
  assert.deepEqual([...ADMIN_REQUIRED].sort(), ['PERMISSION_MANAGE', 'USER_WRITE'])
  for (const code of ADMIN_REQUIRED) assert.match(lockReason('ADMIN', code, true), /Quản trị viên luôn giữ quyền này/)
  assert.equal(lockReason('ADMIN', 'USER_READ', true), undefined)
  assert.equal(lockReason('STAFF', 'USER_WRITE', true), undefined)
  assert.equal(lockReason('ADMIN', 'USER_WRITE', false), undefined, 'missing (should not happen): tickable to repair')
})

test('stale check: a changed role whose server set differs from what was loaded stops the save', () => {
  const saved = grantsOf(ROLES)
  const changes = [{ roleId: STAFF, roleName: 'STAFF', added: ['PAYMENT_READ'], removed: [] }]
  assert.deepEqual(staleRoles(changes, saved, ROLES), [])
  const elsewhere = ROLES.map(role => (role.id === STAFF ? { ...role, permissions: ['ORDER_READ'] } : role))
  assert.deepEqual(staleRoles(changes, saved, elsewhere).map(change => change.roleId), [STAFF])
  assert.equal(staleRoles(changes, saved, [ROLES[1]]).length, 1, 'role gone')
})

test('save errors get Vietnamese wording with the next step', () => {
  assert.equal(describeSaveError(new ApiError(409, 'The ADMIN role must keep USER_WRITE and PERMISSION_MANAGE; otherwise nobody could manage users or permissions'), 'ADMIN'), ROLE_SAVE_TEXT.adminRequired)
  const unknown = new ApiError(400, 'Unknown permission codes', { permissions: 'Unknown codes: ALSO_UNKNOWN, NOT_A_PERMISSION' })
  assert.equal(describeSaveError(unknown, 'STAFF'), `Nhân viên: ${ROLE_SAVE_TEXT.unknown(['ALSO_UNKNOWN', 'NOT_A_PERMISSION'])}`)
  assert.deepEqual(codesInFieldError('Unknown codes: ALSO_UNKNOWN, NOT_A_PERMISSION'), ['ALSO_UNKNOWN', 'NOT_A_PERMISSION'])
  assert.match(describeSaveError(new ApiError(400, 'Duplicate permission codes', { permissions: 'Duplicate codes: PRODUCT_READ' }), 'STAFF'), /bị trùng/)
  assert.match(describeSaveError(new ApiError(400, 'Validation Failed', { permissions: 'must not be null' }), 'STAFF'), /chưa hợp lệ/)
  assert.match(describeSaveError(new ApiError(404, 'x'), 'STAFF'), /không còn trên máy chủ/)
  assert.equal(describeSaveError(new ApiError(409, 'Some English conflict'), 'STAFF'), `Nhân viên: ${ROLE_SAVE_TEXT.conflict}`)
  assert.equal(describeSaveError(new ApiError(403, 'Bạn không có quyền thực hiện thao tác này.'), 'STAFF'), 'Bạn không có quyền thực hiện thao tác này.')
})

test('route and nav: /admin/roles needs PERMISSION_MANAGE, so STAFF is refused before the screen mounts', () => {
  const route = matchRoute('/admin/roles')
  assert.equal(route.page, 'roles')
  assert.equal(route.permission, 'PERMISSION_MANAGE')
  assert.deepEqual(route.roles, ['ADMIN'])
  assert.equal(canOpen(['STAFF'], route), false)
  assert.equal(canOpen(['ADMIN'], route), true)
  assert.ok(navFor(['ADMIN']).some(item => item.to === '/admin/roles'))
  assert.ok(!navFor(['STAFF']).some(item => item.to === '/admin/roles'))
})

test('leave guard: asked only when the path changes; cleared guard lets everything through', () => {
  assert.equal(leavesScreen('/admin/roles', '/admin/users'), true)
  assert.equal(leavesScreen('/admin/roles', '/admin/roles?x=1'), false)
  assert.equal(confirmLeave(), true)
  let asked = 0
  setLeaveGuard(() => { asked += 1; return false })
  assert.equal(confirmLeave(), false)
  assert.equal(asked, 1)
  setLeaveGuard(null)
  assert.equal(confirmLeave(), true)
})

test('leave guard remover only clears its own guard', () => {
  const first = () => false, second = () => false
  const removeFirst = setLeaveGuard(first)
  setLeaveGuard(second)
  removeFirst()
  assert.equal(confirmLeave(), false, 'a later guard survives the older remover')
  setLeaveGuard(null)
  assert.equal(confirmLeave(), true)
})

test('navigate: a refusing guard keeps the URL; force (session expiry, confirmed logout) skips the guard', () => {
  const location = { pathname: '/admin/roles', search: '' }
  const set = (_state, _title, to) => { const url = new URL(to, 'https://web.invalid'); location.pathname = url.pathname; location.search = url.search }
  globalThis.window = { location, history: { pushState: set, replaceState: set } }
  try {
    let asked = 0
    const remove = setLeaveGuard(() => { asked += 1; return false })
    navigate('/admin/users', { replace: true })
    assert.equal(location.pathname, '/admin/roles')
    assert.equal(asked, 1)
    navigate('/admin/roles?tab=x', { replace: true })
    assert.equal(location.search, '?tab=x', 'same screen: not asked')
    assert.equal(asked, 1)
    navigate('/login?next=%2Fadmin%2Froles', { replace: true, force: true })
    assert.equal(location.pathname, '/login')
    assert.equal(asked, 1, 'forced: guard not asked')
    remove()
  } finally { delete globalThis.window }
})

// ---- mock of the #48 API

function setup() {
  const state = { token: null }
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now() })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}
async function signIn(state, account) {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
const failsWith = (status, check = () => true) => error => error instanceof ApiError && error.status === status && check(error)

test('mock: GET /permissions and /roles follow #48 (15 codes sorted, ADMIN then STAFF with sorted codes)', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const catalog = await rolesApi.permissions()
  assert.equal(catalog.length, 15)
  assert.deepEqual(catalog.map(p => p.code), [...catalog.map(p => p.code)].sort())
  for (const item of catalog) assert.deepEqual(Object.keys(item).sort(), ['code', 'description'])
  const roles = await rolesApi.list()
  assert.deepEqual(roles.map(role => role.name), ['ADMIN', 'STAFF'])
  assert.deepEqual(roles[1].permissions, ['BATCH_CREATE', 'BATCH_READ', 'INVENTORY_READ', 'INVENTORY_WRITE', 'MACHINE_READ', 'ORDER_READ', 'PRODUCT_READ'])
  assert.deepEqual(Object.keys(roles[1]).sort(), ['description', 'id', 'name', 'permissions'])
  assert.equal((await rolesApi.get(STAFF)).id, STAFF)
  await assert.rejects(rolesApi.get('00000000-0000-0000-0000-00000000dead'), failsWith(404))
  await assert.rejects(rolesApi.get('not-a-uuid'), failsWith(400))
})

test('mock: PUT replaces the set, applies to the next STAFF request, and an empty set is allowed', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const updated = await rolesApi.replacePermissions(STAFF, { permissions: ['MACHINE_READ', 'INVENTORY_WRITE', 'INVENTORY_READ'] })
  assert.deepEqual(updated.permissions, ['INVENTORY_READ', 'INVENTORY_WRITE', 'MACHINE_READ'])
  assert.deepEqual((await rolesApi.get(STAFF)).permissions, ['INVENTORY_READ', 'INVENTORY_WRITE', 'MACHINE_READ'])
  assert.deepEqual((await rolesApi.replacePermissions(STAFF, { permissions: [] })).permissions, [])
})

test('mock: 400 for unknown, duplicate, missing and extra fields, listing the codes; nothing changes', async () => {
  const state = setup()
  await signIn(state, 'admin')
  await assert.rejects(rolesApi.replacePermissions(STAFF, { permissions: ['PRODUCT_READ', 'NOT_A_PERMISSION', 'ALSO_UNKNOWN'] }),
    failsWith(400, error => error.fieldErrors.permissions === 'Unknown codes: ALSO_UNKNOWN, NOT_A_PERMISSION'))
  await assert.rejects(rolesApi.replacePermissions(STAFF, { permissions: ['PRODUCT_READ', 'PRODUCT_READ'] }), failsWith(400, error => error.fieldErrors.permissions.includes('PRODUCT_READ')))
  await assert.rejects(request('PUT', `/roles/${STAFF}/permissions`, { body: {} }), failsWith(400, error => !!error.fieldErrors.permissions))
  await assert.rejects(request('PUT', `/roles/${STAFF}/permissions`, { body: { permissions: ['PRODUCT_READ'], name: 'X' } }), failsWith(400))
  await assert.rejects(request('PUT', `/roles/${STAFF}/permissions`, { body: { permissions: [' '] } }), failsWith(400))
  await assert.rejects(rolesApi.replacePermissions('00000000-0000-0000-0000-00000000dead', { permissions: ['PRODUCT_READ'] }), failsWith(404))
  assert.deepEqual((await rolesApi.get(STAFF)).permissions, [...SEED_STAFF_PERMISSIONS].sort())
})

test('mock: ADMIN cannot lose USER_WRITE or PERMISSION_MANAGE (409); keeping both alone is fine', async () => {
  const state = setup()
  await signIn(state, 'admin')
  const all = SEED_PERMISSIONS.map(p => p.code)
  for (const required of ADMIN_REQUIRED) await assert.rejects(rolesApi.replacePermissions(ADMIN, { permissions: all.filter(code => code !== required) }), failsWith(409, error => error.message === 'The ADMIN role must keep PERMISSION_MANAGE and USER_WRITE; otherwise nobody could manage users or permissions'))
  await assert.rejects(rolesApi.replacePermissions(ADMIN, { permissions: [] }), failsWith(409))
  assert.deepEqual((await rolesApi.replacePermissions(ADMIN, { permissions: ['USER_WRITE', 'PERMISSION_MANAGE'] })).permissions, ['PERMISSION_MANAGE', 'USER_WRITE'])
  await assert.doesNotReject(rolesApi.list())
})

test('mock: only PERMISSION_MANAGE holders may call the role APIs (STAFF 403 even with a bad body, no token 401); granting it lets STAFF in', async () => {
  const state = setup()
  await signIn(state, 'staff')
  await assert.rejects(rolesApi.list(), failsWith(403))
  await assert.rejects(rolesApi.permissions(), failsWith(403))
  await assert.rejects(rolesApi.get(STAFF), failsWith(403))
  await assert.rejects(request('PUT', `/roles/${STAFF}/permissions`, { body: {} }), failsWith(403))
  const staffToken = state.token
  state.token = null
  await assert.rejects(rolesApi.list(), failsWith(401))
  await signIn(state, 'admin')
  await rolesApi.replacePermissions(STAFF, { permissions: [...SEED_STAFF_PERMISSIONS, 'PERMISSION_MANAGE'] })
  state.token = staffToken
  await assert.doesNotReject(rolesApi.list(), 'same token, next request')
  await assert.doesNotReject(productsApi.list({}))
  assert.equal(groupOf('/roles/x/permissions'), 'roles')
  assert.equal(groupOf('/permissions'), 'roles')
})
