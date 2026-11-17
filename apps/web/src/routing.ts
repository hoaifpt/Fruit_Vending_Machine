/**
 * Public customer report form opened by a machine's QR (FE 8.2, backend #74): `/report/{reportToken}`, the path
 * PUBLIC_REPORT_BASE_URL of the backend points to. `/report` alone and the former `/bao-su-co` open the same page,
 * which then explains that the machine's QR must be scanned (no token, no form).
 */
export const INCIDENT_PAGE_PATH = '/report'
const LEGACY_INCIDENT_PATH = '/bao-su-co'

export function resolvePage(pathname: string): 'home' | 'login' | 'admin' | 'purchase' | 'incident' | 'not-found' {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === INCIDENT_PAGE_PATH || path === LEGACY_INCIDENT_PATH || /^\/report\/[^/]+$/.test(path)) return 'incident'
  return path === '/buy' ? 'purchase' : path === '/' ? 'home' : path === '/login' ? 'login' : path === '/admin' || path.startsWith('/admin/') || path === '/staff' ? 'admin' : 'not-found'
}
