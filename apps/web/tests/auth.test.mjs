import test from 'node:test'
import assert from 'node:assert/strict'
import { login } from '../src/features/auth/auth.ts'

const credentials = { identifier: 'staff.name', password: ' fake password ' }
const endpoint = '/api/auth/login'
test('does not send credentials when API is not configured', async () => {
  let called = false
  await assert.rejects(login(credentials, { fetcher: async () => { called = true; return new Response() } }), /chưa được kết nối/)
  assert.equal(called, false)
})
for (const identifier of ['staff.name', 'staff@example.test']) {
  test(`accepts identifier ${identifier}, preserves password and sends cookie credentials`, async () => {
    const user = { id: '1', displayName: 'Test Staff', role: 'STAFF' }
    const result = await login({ ...credentials, identifier }, { endpoint, fetcher: async (url, options) => {
      assert.equal(url, endpoint)
      assert.equal(options.credentials, 'include')
      assert.equal(options.method, 'POST')
      assert.equal(options.cache, 'no-store')
      assert.deepEqual(JSON.parse(options.body), { identifier, password: ' fake password ' })
      return Response.json({ user })
    } })
    assert.deepEqual(result, user)
  })
}
for (const [status, message] of [[401, /không đúng/], [403, /không đúng/], [429, /quá nhiều lần/], [500, /chưa thể xử lý/]]) {
  test(`handles HTTP ${status} without exposing server response`, async () => {
    await assert.rejects(login(credentials, { endpoint, fetcher: async () => new Response('Internal stack trace', { status }) }), message)
  })
}
test('handles offline failures', async () => {
  await assert.rejects(login(credentials, { endpoint, fetcher: async () => { throw new TypeError('Network error') } }), /Không thể kết nối/)
})
for (const data of [{}, { user: { id: '1', displayName: 'Visitor', role: 'SUPERUSER' } }, { user: { id: '', displayName: 'Staff', role: 'STAFF' } }]) {
  test(`rejects invalid successful response ${JSON.stringify(data)}`, async () => {
    await assert.rejects(login(credentials, { endpoint, fetcher: async () => Response.json(data) }))
  })
}
test('rejects HTML instead of treating a Vite fallback page as successful login', async () => {
  await assert.rejects(login(credentials, { endpoint, fetcher: async () => new Response('<html></html>') }), /không hợp lệ/)
})
test('accepts admin returned by backend', async () => {
  const user = { id: '2', displayName: 'Admin', role: 'ADMIN' }
  assert.deepEqual(await login(credentials, { endpoint, fetcher: async () => Response.json({ user }) }), user)
})
