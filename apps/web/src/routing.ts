export function resolvePage(pathname: string): 'home' | 'login' | 'admin' | 'not-found' {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/' ? 'home' : path === '/login' ? 'login' : path === '/admin' || path.startsWith('/admin/') || path === '/staff' ? 'admin' : 'not-found'
}
