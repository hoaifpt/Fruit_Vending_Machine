import test from 'node:test'
import assert from 'node:assert/strict'
import { can, permissionsOf, rolesWith } from '../src/admin/permissions.ts'
import { NAV, canOpen, homeFor, matchRoute, navFor } from '../src/admin/routes.ts'

const ADMIN_ONLY_ACTIONS = ['users:manage', 'products:manage', 'machines:manage', 'slots:manage', 'kiosk-credentials:manage', 'payments:read', 'webhook-logs:read']

test('STAFF holds none of the ADMIN-only actions; ADMIN holds them all', () => {
  for (const action of ADMIN_ONLY_ACTIONS) {
    assert.equal(can(['STAFF'], action), false, `STAFF must not ${action}`)
    assert.equal(can(['ADMIN'], action), true, `ADMIN must ${action}`)
  }
})
test('STAFF reads products, machines and slots, writes batches and inventory, reads orders', () => {
  for (const action of ['products:read', 'machines:read', 'slots:read', 'batches:write', 'inventory:write', 'orders:read']) assert.equal(can(['STAFF'], action), true, action)
})
test(':manage implies :read, and no role means no permission', () => {
  assert.equal(can(['ADMIN'], 'products:read'), true)
  assert.equal(can(['ADMIN'], 'slots:read'), true)
  assert.equal(permissionsOf([]).size, 0)
  assert.equal(can([], 'orders:read'), false)
})
test('explicit permissions (future GET /auth/me) replace the role table and ignore unknown names', () => {
  const subject = { roles: ['ADMIN'], permissions: ['orders:read', 'reports:export'] }
  assert.equal(can(subject, 'orders:read'), true)
  assert.equal(can(subject, 'users:manage'), false)
  assert.deepEqual([...permissionsOf(subject)], ['orders:read'])
  assert.equal(can({ roles: ['STAFF'], permissions: ['products:manage'] }, 'products:read'), true)
})
test('rolesWith lists roles in a stable order', () => {
  assert.deepEqual(rolesWith('orders:read'), ['ADMIN', 'STAFF'])
  assert.deepEqual(rolesWith('payments:read'), ['ADMIN'])
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
  assert.deepEqual(navFor({ roles: ['STAFF'], permissions: ['orders:read'] }).map(item => item.to), ['/admin/orders'])
  assert.equal(homeFor({ roles: ['STAFF'], permissions: [] }), '/login')
  assert.equal(homeFor(['ADMIN']), '/admin/machines')
})
