export function resolvePage(pathname: string): 'home' | 'login' | 'admin' | 'purchase' | 'not-found' {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/buy' ? 'purchase' : path === '/' ? 'home' : path === '/login' ? 'login' : path === '/admin' || path.startsWith('/admin/') || path === '/staff' ? 'admin' : 'not-found'
}
