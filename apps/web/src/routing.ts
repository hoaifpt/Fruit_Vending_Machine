/** Public incident report form opened by the kiosk QR (FE 8.2); same path as INCIDENT_REPORT_PATH of the kiosk (FE 5.4). */
export const INCIDENT_PAGE_PATH = '/bao-su-co'

export function resolvePage(pathname: string): 'home' | 'login' | 'admin' | 'purchase' | 'incident' | 'not-found' {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === INCIDENT_PAGE_PATH) return 'incident'
  return path === '/buy' ? 'purchase' : path === '/' ? 'home' : path === '/login' ? 'login' : path === '/admin' || path.startsWith('/admin/') || path === '/staff' ? 'admin' : 'not-found'
}
