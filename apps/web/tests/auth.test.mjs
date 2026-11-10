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

test('a wrong password maps to one generic form-level message that does not reveal the account, focus on password', async () => {
  const { describeLoginError, LoginError } = await import('../src/features/auth/auth.ts')
  const wrong = describeLoginError(new ApiError(401, 'Invalid email or password'))
  assert.equal(wrong.focus, 'password')
  assert.deepEqual(wrong.fieldErrors, {})
  assert.match(wrong.message, /Email hoặc mật khẩu không đúng/)
  assert.doesNotMatch(wrong.message, /không tồn tại|chưa đăng ký|bị khóa/)
  // INACTIVE/LOCKED come back as the same 401 per contract; a 403 (if ever) reads the same.
  assert.deepEqual(describeLoginError(new ApiError(403, 'x')), wrong)

  configureClient({ baseUrl: '', fetcher: async () => jsonResponse(401, { message: 'Invalid email or password', status: 401 }) })
  const error = await login('a@b.test', 'wrong').catch(caught => caught)
  assert.ok(error instanceof LoginError)
  assert.deepEqual(error.failure, wrong)
  assert.equal(error.message, wrong.message)
})

test('400 fieldErrors land on the matching field in Vietnamese; unknown fields, network and 500 stay form-level', async () => {
  const { describeLoginError } = await import('../src/features/auth/auth.ts')
  const both = describeLoginError(new ApiError(400, 'Validation failed', { email: 'must be a well-formed email address', password: 'size must be between 1 and 72' }))
  assert.equal(both.message, '')
  assert.equal(both.focus, 'email')
  assert.match(both.fieldErrors.email, /Email chưa đúng định dạng/)
  assert.match(both.fieldErrors.password, /Mật khẩu/)
  assert.doesNotMatch(JSON.stringify(both), /well-formed|size must/)
  assert.equal(describeLoginError(new ApiError(400, 'x', { password: 'too long' })).focus, 'password')
  const unknown = describeLoginError(new ApiError(400, 'Malformed JSON request'))
  assert.equal(unknown.focus, 'form')
  assert.match(unknown.message, /không hợp lệ/)
  const offline = describeLoginError(new ApiError(0, 'Không thể kết nối đến hệ thống. Kiểm tra kết nối mạng và thử lại.'))
  assert.equal(offline.focus, 'form')
  assert.match(offline.message, /kết nối/)
  assert.match(describeLoginError(new ApiError(500, 'Hệ thống đang gặp sự cố. Vui lòng thử lại.')).message, /sự cố/)
  assert.equal(describeLoginError(new Error('Tài khoản chưa có thông tin hoặc quyền truy cập hợp lệ.')).focus, 'form')
})

test('client checks: required fields, email shape, password never trimmed and limited to 72 UTF-8 bytes', async () => {
  const { validateLogin } = await import('../src/features/auth/auth.ts')
  assert.deepEqual(validateLogin('', ''), { email: 'Vui lòng nhập email.', password: 'Vui lòng nhập mật khẩu.' })
  assert.deepEqual(validateLogin('   ', '   '), { email: 'Vui lòng nhập email.', password: 'Vui lòng nhập mật khẩu.' })
  assert.match(validateLogin('admin', 'x').email, /định dạng/)
  assert.deepEqual(validateLogin('  admin@freshvend.test ', ' pass with spaces '), {})
  assert.deepEqual(validateLogin('a@b.test', 'x'.repeat(72)), {})
  assert.match(validateLogin('a@b.test', 'x'.repeat(73)).password, /quá dài/)
  // 36 characters, 72 bytes is fine; one more accented letter crosses the byte limit.
  assert.deepEqual(validateLogin('a@b.test', 'ă'.repeat(36)), {})
  assert.match(validateLogin('a@b.test', 'ă'.repeat(37)).password, /quá dài/)
})

test('returnTarget reuses the 2.4 sanitising: only internal /admin paths count as a page to return to', async () => {
  const { returnTarget } = await import('../src/features/auth/auth.ts')
  assert.equal(returnTarget('?next=%2Fadmin%2Forders%3Fstatus%3DPAID'), '/admin/orders?status=PAID')
  assert.equal(returnTarget('?next=/admin'), '/admin')
  assert.equal(returnTarget(''), null)
  assert.equal(returnTarget('?scenario=401'), null)
  for (const bad of ['https://evil.test/admin', '//evil.test/admin', '/admin//x', '/admin\\evil.test', '/buy', 'javascript:alert(1)', '/admin%0a']) {
    assert.equal(returnTarget(`?next=${encodeURIComponent(bad)}`), null, bad)
  }
})
