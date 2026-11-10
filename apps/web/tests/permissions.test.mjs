import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PERMISSIONS, ROLE_PERMISSIONS, can, permissionsOf, rolesWith } from '../src/admin/permissions.ts'
import { NAV, canOpen, homeFor, matchRoute, navFor } from '../src/admin/routes.ts'

const ADMIN_ONLY_ACTIONS = ['USER_READ', 'USER_WRITE', 'PERMISSION_MANAGE', 'PRODUCT_WRITE', 'MACHINE_WRITE', 'KIOSK_CREDENTIAL_MANAGE', 'PAYMENT_READ', 'PAYMENT_WEBHOOK_LOG_READ']
const STAFF_ACTIONS = ['PRODUCT_READ', 'MACHINE_READ', 'BATCH_READ', 'BATCH_CREATE', 'INVENTORY_READ', 'INVENTORY_WRITE', 'ORDER_READ']

const MIGRATION = 'backend/src/main/resources/db/migration/V13__create_permissions.sql'
/** Commit of backend #48 (not merged into dev yet); read with git when the migration is not in the working tree. */
const BE_48_COMMIT = 'b6b11f8'

/** Codes and the role grants of backend #48, from its migration; null when neither the file nor the commit is available. */
function backendSeed() {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  let sql = existsSync(root + MIGRATION) ? readFileSync(root + MIGRATION, 'utf8') : null
  if (!sql) {
    try { sql = execFileSync('git', ['show', `${BE_48_COMMIT}:${MIGRATION}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null }
  }
  const codes = [...sql.matchAll(/'2000[0-9-]+',\s*'([A-Z_]+)'/g)].map(match => match[1])
  const staff = sql.match(/WHERE code IN \(([^)]*)\)/)[1].match(/[A-Z_]+/g)
  return { codes, staff }
}

test('the codes are the 15 UPPER_SNAKE permission codes of backend #48', () => {
  assert.equal(PERMISSIONS.length, 15)
  for (const code of PERMISSIONS) assert.match(code, /^[A-Z][A-Z0-9_]{2,63}$/)
  assert.deepEqual([...PERMISSIONS].sort(), [...ADMIN_ONLY_ACTIONS, ...STAFF_ACTIONS].sort())
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
  const subject = { roles: ['ADMIN'], permissions: ['ORDER_READ', 'REPORT_EXPORT', 'orders:read', 'users:manage'] }
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
  assert.equal(homeFor(['ADMIN']), '/admin/machines')
})

test('after sign-in, next is used only when the new account may open it', async () => {
  const { landingFor } = await import('../src/admin/routes.ts')
  assert.equal(landingFor(['ADMIN'], '/admin/payments?status=PAID'), '/admin/payments?status=PAID')
  // Someone else's ADMIN page left in next: a STAFF account lands on its own first screen, not on a 403.
  assert.equal(landingFor(['STAFF'], '/admin/payments?status=PAID'), '/admin/machines')
  assert.equal(landingFor(['STAFF'], '/admin/users'), '/admin/machines')
  assert.equal(landingFor(['STAFF'], '/admin/orders/o-1?tab=items'), '/admin/orders/o-1?tab=items')
  // No route to check (alias, home, unknown screen): kept, AdminApp redirects or explains.
  assert.equal(landingFor(['STAFF'], '/staff'), '/staff')
  assert.equal(landingFor(['STAFF'], '/admin'), '/admin')
  assert.equal(landingFor(['STAFF'], null), '/admin/machines')
  assert.equal(landingFor(['ADMIN'], null), '/admin/machines')
})
