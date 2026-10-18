import test from 'node:test'
import assert from 'node:assert/strict'
import { loginPathFor, parseToken, safeNext } from '../src/api/session.ts'
import { makeToken } from './helpers.mjs'

test('reads roles from JWT claims, normalising the ROLE_ prefix and ignoring unknown roles', () => {
  const session = parseToken(makeToken({ roles: ['ROLE_ADMIN', 'ROLE_STAFF', 'ROLE_X', 'ADMIN'] }))
  assert.deepEqual(session.user.roles, ['ADMIN', 'STAFF'])
  assert.equal(session.user.email, 'user@example.test')
})
test('rejects expired, malformed or role-less tokens', () => {
  assert.equal(parseToken(makeToken({}, -10)), null)
  assert.equal(parseToken('not-a-jwt'), null)
  assert.equal(parseToken(makeToken({ roles: [] })), null)
  assert.equal(parseToken(makeToken({ sub: undefined })), null)
})
test('login redirect preserves the intended URL and blocks open redirects', () => {
  assert.equal(loginPathFor('/admin/orders', '?status=PAID'), '/login?next=%2Fadmin%2Forders%3Fstatus%3DPAID')
  assert.equal(safeNext('/admin/orders?status=PAID'), '/admin/orders?status=PAID')
  for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/login', null, '']) assert.equal(safeNext(bad), '/admin')
})
