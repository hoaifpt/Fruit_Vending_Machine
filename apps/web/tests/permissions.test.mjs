import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PERMISSIONS, ROLE_PERMISSIONS, can, permissionsOf, rolesWith } from '../src/admin/permissions.ts'
import { NAV, canOpen, homeFor, matchRoute, navFor } from '../src/admin/routes.ts'

const ADMIN_ONLY_ACTIONS = ['USER_READ', 'USER_WRITE', 'PERMISSION_MANAGE', 'PRODUCT_WRITE', 'MACHINE_WRITE', 'KIOSK_CREDENTIAL_MANAGE', 'PAYMENT_READ', 'PAYMENT_WEBHOOK_LOG_READ', 'PAYMENT_REFUND', 'REFUND_READ', 'REPORT_SALES_READ', 'WORK_ORDER_MANAGE', 'INVENTORY_LOAD_DIRECT']
const STAFF_ACTIONS = ['PRODUCT_READ', 'MACHINE_READ', 'BATCH_READ', 'BATCH_CREATE', 'INVENTORY_READ', 'INVENTORY_WRITE', 'ORDER_READ']

const MIGRATIONS = 'backend/src/main/resources/db/migration/'
const STAFF_ROLE_ID = '10000000-0000-0000-0000-000000000002'

/** Codes and STAFF grants of every backend migration (V13, V16–V25); null when the backend is not in the working tree. */
function backendSeed() {
  const dir = fileURLToPath(new URL('../../../', import.meta.url)) + MIGRATIONS
  if (!existsSync(dir)) return null
  const sql = readdirSync(dir).filter(name => /^V\d+__.*\.sql$/.test(name)).map(name => readFileSync(dir + name, 'utf8')).join('\n')
  const byId = new Map([...sql.matchAll(/'(2000[0-9-]+)',\s*'([A-Z_]+)'/g)].map(match => [match[1], match[2]]))
  const staff = new Set(sql.match(/WHERE code IN \(([^)]*)\)/)[1].match(/[A-Z_]+/g))
  for (const match of sql.matchAll(new RegExp(`'${STAFF_ROLE_ID}',\\s*'(2000[0-9-]+)'`, 'g'))) staff.add(byId.get(match[1]))
  return { codes: [...byId.values()], staff: [...staff] }
}

test('the codes are the UPPER_SNAKE permission codes of the backend migrations, STAFF grants included', () => {
  assert.equal(PERMISSIONS.length, 41)
  for (const code of PERMISSIONS) assert.match(code, /^[A-Z][A-Z0-9_]{2,63}$/)
  for (const code of [...ADMIN_ONLY_ACTIONS, ...STAFF_ACTIONS]) assert.ok(PERMISSIONS.includes(code), code)
  const seed = backendSeed()
  if (seed) {
    assert.deepEqual([...PERMISSIONS].sort(), [...seed.codes].sort())
    assert.deepEqual([...ROLE_PERMISSIONS.STAFF].sort(), [...seed.staff].sort())
  }
})
test('STAFF holds none of the ADMIN-only actions; ADMIN holds them all', () => {
  for (const action of ADMIN_ONLY_ACTIONS) {
    assert.equal(can(['STAFF'], action), false, `STAFF must not ${action}`)
    assert.equal(can(['ADMIN'], action), true, `ADMIN must ${action}`)
  }
})
test('STAFF reads products and machines, reads and creates batches, reads and changes inventory, reads orders', () => {
  for (const action of STAFF_ACTIONS) {
    assert.equal(can(['STAFF'], action), true, action)
    assert.equal(can(['ADMIN'], action), true, action)
  }
})
test('a write code does not imply its read code, and no role means no permission', () => {
  assert.equal(can({ roles: ['ADMIN'], permissions: ['PRODUCT_WRITE'] }, 'PRODUCT_READ'), false)
  assert.equal(can({ roles: ['ADMIN'], permissions: ['INVENTORY_WRITE'] }, 'INVENTORY_READ'), false)
  assert.equal(permissionsOf([]).size, 0)
  assert.equal(can([], 'ORDER_READ'), false)
})
test('explicit permissions (future GET /auth/me) replace the role table and ignore unknown or old-style names', () => {
  const subject = { roles: ['ADMIN'], permissions: ['ORDER_READ', 'REPORT_READ', 'orders:read', 'users:manage'] }
  assert.equal(can(subject, 'ORDER_READ'), true)
  assert.equal(can(subject, 'USER_READ'), false)
  assert.deepEqual([...permissionsOf(subject)], ['ORDER_READ'])
})
test('rolesWith lists roles in a stable order', () => {
  assert.deepEqual(rolesWith('ORDER_READ'), ['ADMIN', 'STAFF'])
  assert.deepEqual(rolesWith('PAYMENT_READ'), ['ADMIN'])
})
test('route guard: STAFF typing an ADMIN URL is refused before the screen (and its API call) mounts', () => {
  for (const path of ['/admin/users', '/admin/payments', '/admin/payments/p-1', '/admin/webhook-logs', '/admin/webhook-logs/w-1']) {
    const route = matchRoute(path)
    assert.equal(canOpen(['STAFF'], route), false, path)
    assert.equal(canOpen(['ADMIN'], route), true, path)
  }
  for (const path of ['/admin/machines', '/admin/machines/m-1', '/admin/products', '/admin/batches', '/admin/inventory', '/admin/inventory/history', '/admin/orders', '/admin/orders/o-1']) {
    assert.equal(canOpen(['STAFF'], matchRoute(path)), true, path)
  }
})
test('every nav item is governed by a held permission; nav and home follow the subject', () => {
  for (const item of NAV) assert.ok(rolesWith(item.permission).length > 0, item.to)
  assert.deepEqual(navFor({ roles: ['STAFF'], permissions: ['ORDER_READ'] }).map(item => item.to), ['/admin/orders'])
  assert.equal(homeFor({ roles: ['STAFF'], permissions: [] }), '/login')
  assert.equal(homeFor(['ADMIN']), '/admin/overview')
  // Without DASHBOARD_READ the overview is not offered: home is the first screen the account may open.
  assert.equal(homeFor({ roles: ['STAFF'], permissions: ['ORDER_READ'] }), '/admin/orders')
})

test('after sign-in, next is used only when the new account may open it', async () => {
  const { landingFor } = await import('../src/admin/routes.ts')
  assert.equal(landingFor(['ADMIN'], '/admin/payments?status=PAID'), '/admin/payments?status=PAID')
  // Someone else's ADMIN page left in next: a STAFF account lands on its own first screen, not on a 403.
  assert.equal(landingFor(['STAFF'], '/admin/payments?status=PAID'), '/admin/overview')
  assert.equal(landingFor(['STAFF'], '/admin/users'), '/admin/overview')
  assert.equal(landingFor(['STAFF'], '/admin/orders/o-1?tab=items'), '/admin/orders/o-1?tab=items')
  // No route to check (alias, home, unknown screen): kept, AdminApp redirects or explains.
  assert.equal(landingFor(['STAFF'], '/staff'), '/staff')
  assert.equal(landingFor(['STAFF'], '/admin'), '/admin')
  assert.equal(landingFor(['STAFF'], null), '/admin/overview')
  assert.equal(landingFor(['ADMIN'], null), '/admin/overview')
})
