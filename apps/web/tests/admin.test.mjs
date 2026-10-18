import test from 'node:test'
import assert from 'node:assert/strict'
import { canAccess, homeFor, matchRoute, navFor } from '../src/admin/routes.ts'
import { dateRangeToInstants, expiryState, formatDateTime, formatMoney, localDateTimeToInstant, parseDecimal, parseInteger, parsePrice } from '../src/lib/format.ts'
import { prettyPayload } from '../src/admin/payload.ts'

const labels = roles => navFor(roles).map(item => item.to.replace('/admin/', ''))

test('role matrix: STAFF cannot see users, payments or webhook logs', () => {
  assert.deepEqual(labels(['STAFF']), ['machines', 'products', 'batches', 'inventory', 'orders'])
  assert.deepEqual(labels(['ADMIN']), ['machines', 'products', 'batches', 'inventory', 'orders', 'payments', 'webhook-logs', 'users'])
  assert.equal(canAccess(['STAFF'], matchRoute('/admin/users').roles), false)
  assert.equal(canAccess(['STAFF'], matchRoute('/admin/payments/abc').roles), false)
  assert.equal(canAccess(['STAFF'], matchRoute('/admin/webhook-logs').roles), false)
  assert.equal(canAccess(['STAFF'], matchRoute('/admin/orders/abc').roles), true)
  assert.equal(canAccess(['STAFF', 'ADMIN'], matchRoute('/admin/users').roles), true)
  assert.equal(homeFor(['STAFF']), '/admin/machines')
})
test('routes extract ids and reject unknown paths', () => {
  assert.deepEqual(matchRoute('/admin/machines/m-1/'), { page: 'machine-detail', id: 'm-1', roles: ['ADMIN', 'STAFF'] })
  assert.equal(matchRoute('/admin/unknown'), undefined)
  assert.equal(matchRoute('/admin/machines/a/b'), undefined)
})

test('money is shown as VND and times in Asia/Ho_Chi_Minh', () => {
  assert.match(formatMoney(35000), /^35\.000\s₫$/)
  assert.equal(formatMoney(undefined), '—')
  assert.match(formatDateTime('2026-10-18T17:30:00Z'), /^00:30,? 19\/10\/2026$|^19\/10\/2026,? 00:30$/)
})
test('local date ranges become [from, to) UTC instants', () => {
  assert.deepEqual(dateRangeToInstants('2026-10-18', '2026-10-18'), { from: '2026-10-17T17:00:00.000Z', to: '2026-10-18T17:00:00.000Z' })
  assert.deepEqual(dateRangeToInstants('', ''), { from: undefined, to: undefined })
  assert.equal(localDateTimeToInstant('2026-10-18T07:00'), '2026-10-18T00:00:00.000Z')
  assert.equal(localDateTimeToInstant('bad'), undefined)
})
test('numeric inputs enforce contract limits', () => {
  assert.equal(parsePrice('35000.50'), 35000.5)
  for (const bad of ['0', '-1', '1.234', '', 'abc', '1,5']) assert.equal(parsePrice(bad), undefined)
  assert.equal(parseInteger('12'), 12)
  assert.equal(parseInteger('1.5'), undefined)
  assert.equal(parseDecimal('-2.5'), -2.5)
})
test('expiry is display-only: fresh, soon (within 2 days) or expired', () => {
  const now = Date.parse('2026-10-18T00:00:00Z')
  assert.equal(expiryState('2026-10-17T00:00:00Z', now), 'expired')
  assert.equal(expiryState('2026-10-19T12:00:00Z', now), 'soon')
  assert.equal(expiryState('2026-11-01T00:00:00Z', now), 'fresh')
  assert.equal(expiryState(undefined, now), undefined)
})
test('webhook payloads are shown as text, pretty-printed when JSON', () => {
  assert.equal(prettyPayload('{"a":1}', null).text, '{\n  "a": 1\n}')
  assert.deepEqual(prettyPayload('not json <script>', null), { kind: 'raw', text: 'not json <script>' })
  assert.deepEqual(prettyPayload(null, '<img onerror=x>'), { kind: 'raw', text: '<img onerror=x>' })
  assert.equal(prettyPayload(null, null).kind, 'none')
})
