export function makeToken(claims = {}, expOffsetSeconds = 3600) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = { sub: '11111111-1111-4111-8111-111111111111', email: 'user@example.test', roles: ['ROLE_ADMIN'], iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expOffsetSeconds, ...claims }
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}
export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
