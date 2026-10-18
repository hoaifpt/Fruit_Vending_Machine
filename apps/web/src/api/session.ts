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
  return target === '/' || target.startsWith('/login') ? '/login' : `/login?next=${encodeURIComponent(target)}`
}
/** Only same-site absolute paths are valid post-login targets (blocks open redirects). */
export function safeNext(value: string | null): string {
  return value && /^\/(?![/\\])/.test(value) && !value.startsWith('/login') ? value : '/admin'
}

configureClient({
  getToken: () => getSession()?.token ?? null,
  onUnauthorized: () => {
    endSession()
    const { pathname, search } = window.location
    if (!pathname.startsWith('/login')) window.location.assign(loginPathFor(pathname, search))
  },
})
