import test from 'node:test'
import assert from 'node:assert/strict'
import { endSession, expireSession, getSession, loginPathFor, parseToken, safeNext, setLoginRedirect, startSession } from '../src/api/session.ts'
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
test('next only accepts internal /admin paths', () => {
  assert.equal(safeNext('/admin'), '/admin')
  assert.equal(safeNext('/admin/orders/o-1?tab=items#top'), '/admin/orders/o-1?tab=items#top')
  const bad = ['/buy', '/', '/administrator', '/admin//evil.test', '/admin/\\evil.test', '/admin/x\nLocation: evil', '/admin x', '/admin\tx',
    'https://evil.test/admin', '//evil.test/admin', 'http:/admin', ' /admin', '/%2F%2Fevil.test', '/admin/../buy']
  for (const value of bad) assert.equal(safeNext(value), '/admin', JSON.stringify(value))
  assert.equal(loginPathFor('/buy'), '/login')
  assert.equal(loginPathFor('/login', '?next=%2Fadmin'), '/login')
})
test('a burst of 401s ends the session and redirects once, back to the same page and query', () => {
  const redirects = []
  setLoginRedirect(to => redirects.push(to))
  startSession(makeToken({ roles: ['ROLE_STAFF'] }))
  const here = { pathname: '/admin/orders', search: '?status=PAID&page=2' }
  const expected = '/login?next=%2Fadmin%2Forders%3Fstatus%3DPAID%26page%3D2'
  assert.equal(expireSession(here), expected)
  assert.equal(expireSession(here), null)
  assert.equal(expireSession(here), null)
  assert.deepEqual(redirects, [expected])
  assert.equal(getSession(), null)
  // The login page reads `next` back to the exact page and query.
  assert.equal(safeNext(new URLSearchParams(expected.split('?')[1]).get('next')), '/admin/orders?status=PAID&page=2')
  // After signing in again, a later expiry redirects again.
  startSession(makeToken())
  assert.equal(expireSession({ pathname: '/admin/users', search: '' }), '/login?next=%2Fadmin%2Fusers')
  assert.equal(redirects.length, 2)
  // Already on the login page: the session is cleared but there is no redirect loop.
  startSession(makeToken())
  assert.equal(expireSession({ pathname: '/login', search: '?next=%2Fadmin' }), null)
  assert.equal(redirects.length, 2)
  setLoginRedirect(null)
  endSession()
})

test('a late 401 for an older token does not sign out the session started since', () => {
  const redirects = []
  setLoginRedirect(to => redirects.push(to))
  const here = { pathname: '/admin/orders', search: '' }
  const oldToken = makeToken({ roles: ['ROLE_STAFF'] })
  startSession(oldToken)
  // The old session expires, the user signs in again (a different token), then a slow request made with the old one answers 401.
  assert.equal(expireSession(here, oldToken), '/login?next=%2Fadmin%2Forders')
  const newToken = makeToken({ roles: ['ROLE_ADMIN'], iat: Math.floor(Date.now() / 1000) + 1 })
  assert.notEqual(newToken, oldToken)
  startSession(newToken)
  assert.equal(expireSession(here, oldToken), null)
  assert.equal(getSession()?.token, newToken)
  assert.equal(redirects.length, 1)
  // A 401 for the current token still ends it, and so does one sent without a token while signed out.
  assert.equal(expireSession(here, newToken), '/login?next=%2Fadmin%2Forders')
  assert.equal(getSession(), null)
  assert.equal(redirects.length, 2)
  setLoginRedirect(null)
  endSession()
})

test('the client reports the token a failed request sent, so the session can tell old 401s apart', async () => {
  const { configureClient, request } = await import('../src/api/client.ts')
  const seen = []
  let token = 'token-a'
  configureClient({ baseUrl: '', getToken: () => token, onUnauthorized: used => seen.push(used), fetcher: async () => { token = 'token-b'; return new Response('{}', { status: 401 }) } })
  await assert.rejects(request('GET', '/orders'))
  assert.deepEqual(seen, ['token-a'])
  await assert.rejects(request('POST', '/auth/login', { auth: false }))
  assert.deepEqual(seen, ['token-a'])
})

test('the /staff alias is a valid return target; look-alikes are not', () => {
  assert.equal(safeNext('/staff'), '/staff')
  assert.equal(safeNext('/staff?x=1'), '/staff?x=1')
  assert.equal(loginPathFor('/staff'), '/login?next=%2Fstaff')
  for (const bad of ['/staffx', '/staff/evil', '/staff//evil.test', '//staff']) assert.equal(safeNext(bad), '/admin', bad)
})
