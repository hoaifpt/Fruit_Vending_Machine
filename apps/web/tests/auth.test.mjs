import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { login, loginErrorMessage } from '../src/features/auth/auth.ts'
import { endSession, getSession } from '../src/api/session.ts'
import { makeToken, jsonResponse } from './helpers.mjs'

test('login stores the session from the JWT and sends only email and password without auth header', async () => {
  let seen
  configureClient({ baseUrl: '', fetcher: async (url, init) => { seen = { url, init }; return jsonResponse(200, { data: { accessToken: makeToken({ roles: ['ROLE_STAFF'] }), tokenType: 'Bearer', expiresIn: 3600 } }) } })
  const session = await login('  Staff@Example.test ', ' secret pass ')
  assert.equal(seen.url, '/api/v1/auth/login')
  assert.equal(seen.init.headers.Authorization, undefined)
  assert.deepEqual(JSON.parse(seen.init.body), { email: 'Staff@Example.test', password: ' secret pass ' })
  assert.deepEqual(session.user.roles, ['STAFF'])
  assert.equal(getSession()?.token, session.token)
  endSession()
  assert.equal(getSession(), null)
})

test('a 401 on login gives a generic message and does not trigger the session-expiry handler', async () => {
  let unauthorized = 0
  configureClient({ baseUrl: '', onUnauthorized: () => { unauthorized += 1 }, fetcher: async () => jsonResponse(401, { message: 'Invalid email or password', status: 401 }) })
  await assert.rejects(login('a@b.test', 'x'), /không đúng/)
  assert.equal(unauthorized, 0)
})

test('rejects tokens without a usable role', async () => {
  configureClient({ baseUrl: '', fetcher: async () => jsonResponse(200, { data: { accessToken: makeToken({ roles: [] }) } }) })
  await assert.rejects(login('a@b.test', 'x'), /quyền truy cập/)
  assert.equal(getSession(), null)
})

test('login error messages never expose raw bodies', () => {
  assert.match(loginErrorMessage(new ApiError(500, 'Hệ thống đang gặp sự cố. Vui lòng thử lại.')), /sự cố/)
  assert.match(loginErrorMessage(new ApiError(400, 'x', { email: 'must be a well-formed email address' })), /well-formed/)
  assert.match(loginErrorMessage(new ApiError(429, 'x')), /quá nhiều/)
})
