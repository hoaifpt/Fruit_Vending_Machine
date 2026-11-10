// Access-token session: memory + sessionStorage only. The token is never logged or put in a URL.
// The login response carries no user object, so roles are read from the JWT claims for UI hints only;
// the backend remains the authority and every call must still handle 403.
import { configureClient } from './client.ts'

export type Role = 'ADMIN' | 'STAFF'
export interface SessionUser { id: string; email: string; roles: Role[] }
export interface Session { token: string; expiresAt: number; user: SessionUser }

const STORAGE_KEY = 'fruit-vending-session-v1'

function decodeBase64Url(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function parseToken(token: string, now = Date.now()): Session | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const claims = JSON.parse(decodeBase64Url(payload)) as { sub?: unknown; email?: unknown; roles?: unknown; exp?: unknown }
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null
    const rawRoles = Array.isArray(claims.roles) ? claims.roles : typeof claims.roles === 'string' ? claims.roles.split(',') : []
    const roles = [...new Set(rawRoles.map(role => String(role).trim().replace(/^ROLE_/, '')))].filter((role): role is Role => role === 'ADMIN' || role === 'STAFF')
    const expiresAt = claims.exp * 1000
    if (expiresAt <= now || !roles.length) return null
    return { token, expiresAt, user: { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : '', roles } }
  } catch { return null }
}

let current: Session | null = null
let loaded = false
/** Set once the session-expiry redirect has started, so a burst of 401s redirects only once. */
let expiryHandled = false
const listeners = new Set<() => void>()

function readStored() {
  try {
    const token = sessionStorage.getItem(STORAGE_KEY)
    return token ? parseToken(token) : null
  } catch { return null }
}
function persist(token: string | null) {
  try { if (token) sessionStorage.setItem(STORAGE_KEY, token); else sessionStorage.removeItem(STORAGE_KEY) } catch { /* storage unavailable: memory only */ }
}
function emit() { listeners.forEach(listener => listener()) }

export function getSession(now = Date.now()): Session | null {
  if (!loaded) { current = readStored(); loaded = true }
  if (current && current.expiresAt <= now) { current = null; persist(null) }
  return current
}
export function startSession(token: string): Session {
  const session = parseToken(token)
  if (!session) throw new Error('Tài khoản chưa có thông tin hoặc quyền truy cập hợp lệ.')
  current = session; loaded = true
  expiryHandled = false
  persist(token)
  emit()
  return session
}
export function endSession() {
  current = null; loaded = true
  persist(null)
  emit()
}
export function subscribeSession(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function hasRole(session: Session | null, role: Role) { return !!session?.user.roles.includes(role) }

export function loginPathFor(pathname: string, search = ''): string {
  const target = pathname + search
  return isReturnTarget(target) ? `/login?next=${encodeURIComponent(target)}` : '/login'
}

/** /admin and its screens, or the /staff alias that AdminApp sends to the account's first screen. */
const ADMIN_PATH = /^\/(?:admin(?:[/?#]|$)|staff\/?(?:[?#]|$))/
/** Backslash, whitespace and control characters (browsers strip or reinterpret them in URLs). */
const UNSAFE_CHARS = new RegExp('[\\\\\\s\\u0000-\\u001f\\u007f]')
/** Internal management path only: /admin… or /staff, no scheme, no `//` or `\`, no control characters or spaces. */
function isReturnTarget(value: string): boolean {
  if (!ADMIN_PATH.test(value) || UNSAFE_CHARS.test(value) || value.includes('//')) return false
  try {
    const url = new URL(value, 'https://web.invalid')
    return url.origin === 'https://web.invalid' && ADMIN_PATH.test(url.pathname)
  } catch { return false }
}
/** Only same-site /admin paths are valid post-login targets (blocks open redirects); anything else gives /admin. */
export function safeNext(value: string | null): string {
  return value && isReturnTarget(value) ? value : '/admin'
}

type Redirect = (to: string) => void
let redirect: Redirect = to => window.location.assign(to)
/** The admin app plugs in its client-side router so expiry keeps the in-memory state (and the mock store). */
export function setLoginRedirect(next: Redirect | null) {
  redirect = next ?? (to => window.location.assign(to))
}

/**
 * Session expired or rejected (401, or the token's exp passed): clears the session and sends the user to login with
 * the current page as `next`. Runs once per session however many requests fail together. Returns the target, or
 * null when nothing was done (already handled, already on the login page, or a 401 for an older token).
 * `rejectedToken`: the token the failed request sent. When it is not the current session's token, the 401 belongs to a
 * session that has already ended (a slow request answered after signing in again) and is ignored.
 */
export function expireSession(location: { pathname: string; search: string } = window.location, rejectedToken?: string | null): string | null {
  // Compared with the stored token even if it has just expired (getSession would already have dropped it).
  if (!loaded) { current = readStored(); loaded = true }
  if (rejectedToken !== undefined && rejectedToken !== (current?.token ?? null)) return null
  if (expiryHandled) return null
  expiryHandled = true
  const target = loginPathFor(location.pathname, location.search)
  endSession()
  if (location.pathname.startsWith('/login')) return null
  redirect(target)
  return target
}

configureClient({
  getToken: () => getSession()?.token ?? null,
  onUnauthorized: token => { expireSession(window.location, token) },
})
