import { lazy, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { loginPathFor, endSession } from '../api/session.ts'
import type { Role } from '../api/session.ts'
import { Icon } from '../components/Icon'
import { navigate, useLocation } from '../lib/router.ts'
import { Link, Loading } from './kit.tsx'
import { canAccess, homeFor, matchRoute, navFor } from './routes.ts'
import { useSession } from './useSession.ts'
import './admin.css'

const UsersPage = lazy(() => import('./pages/UsersPage.tsx'))
const ProductsPage = lazy(() => import('./pages/ProductsPage.tsx'))
const MachinesPage = lazy(() => import('./pages/MachinesPage.tsx'))
const MachineDetailPage = lazy(() => import('./pages/MachineDetailPage.tsx'))
const BatchesPage = lazy(() => import('./pages/BatchesPage.tsx'))
const InventoryPage = lazy(() => import('./pages/InventoryPage.tsx'))
const InventoryHistoryPage = lazy(() => import('./pages/InventoryHistoryPage.tsx'))
const OrdersPage = lazy(() => import('./pages/OrdersPage.tsx'))
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage.tsx'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage.tsx'))
const PaymentDetailPage = lazy(() => import('./pages/PaymentDetailPage.tsx'))
const WebhookLogsPage = lazy(() => import('./pages/WebhookLogsPage.tsx'))
const WebhookLogDetailPage = lazy(() => import('./pages/WebhookLogDetailPage.tsx'))

const NO_ROLES: Role[] = []

function AdminApp() {
  const { pathname, search } = useLocation()
  const { session, isAdmin } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const roles = session?.user.roles ?? NO_ROLES
  const route = matchRoute(pathname)

  useEffect(() => {
    if (!session) navigate(loginPathFor(pathname, search), { replace: true })
    else if (pathname.replace(/\/+$/, '') === '/admin' || pathname === '/staff') navigate(homeFor(roles), { replace: true })
  }, [session, pathname, search, roles])
  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menuOpen])

  if (!session) return <main className="route-message" role="status"><p>Đang chuyển đến trang đăng nhập…</p></main>

  const nav = navFor(roles)
  let content: ReactNode
  if (!route) content = pathname.replace(/\/+$/, '') === '/admin' || pathname === '/staff' ? <Loading /> : <NotFound />
  else if (!canAccess(roles, route.roles)) content = <Forbidden />
  else {
    const id = route.id ?? ''
    content = {
      users: <UsersPage />,
      products: <ProductsPage isAdmin={isAdmin} />,
      machines: <MachinesPage isAdmin={isAdmin} />,
      'machine-detail': <MachineDetailPage machineId={id} isAdmin={isAdmin} />,
      batches: <BatchesPage />,
      inventory: <InventoryPage />,
      'inventory-history': <InventoryHistoryPage />,
      orders: <OrdersPage />,
      'order-detail': <OrderDetailPage orderId={id} />,
      payments: <PaymentsPage />,
      'payment-detail': <PaymentDetailPage paymentId={id} />,
      'webhook-logs': <WebhookLogsPage />,
      'webhook-log-detail': <WebhookLogDetailPage logId={id} />,
    }[route.page]
  }

  function logout() {
    endSession()
    navigate('/login', { replace: true })
  }

  return <div className="admin-app a-shell">
    <a className="a-skip" href="#admin-main">Đến nội dung</a>
    <aside className={`a-sidebar ${menuOpen ? 'is-open' : ''}`}>
      <a className="a-brand" href="/">Fruit<span>Vending</span><i>●</i></a>
      <p className="a-workspace">Không gian quản trị</p>
      <nav aria-label="Quản trị">
        {nav.map(item => {
          const current = !!route && item.match.includes(route.page)
          return <Link key={item.to} to={item.to} className={current ? 'is-current' : ''}>
            <Icon name={item.icon} /><span aria-current={current ? 'page' : undefined}>{item.label}</span>
          </Link>
        })}
      </nav>
      <div className="a-sidebar-bottom">
        <div className="a-avatar" aria-hidden="true">{(session.user.email[0] ?? '?').toUpperCase()}</div>
        <div>{session.user.email || 'Tài khoản'}<small>{roles.map(role => (role === 'ADMIN' ? 'Quản trị viên' : 'Nhân viên')).join(' · ')}</small></div>
        <button type="button" onClick={logout}>Đăng xuất</button>
      </div>
    </aside>
    {menuOpen && <button type="button" className="a-scrim" aria-label="Đóng điều hướng" onClick={() => setMenuOpen(false)} />}
    <div className="a-workarea" inert={menuOpen}>
      <main id="admin-main">
        <button type="button" className="a-menu" aria-label="Mở điều hướng" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><Icon name="menu" /></button>
        <Suspense fallback={<Loading label="Đang mở màn hình…" />}>{content}</Suspense>
      </main>
    </div>
  </div>
}

function Forbidden() {
  return <section className="a-empty" role="alert"><h1>Không có quyền truy cập</h1><p>Tài khoản của bạn không được phép xem màn hình này.</p></section>
}
function NotFound() {
  return <section className="a-empty"><h1>Không tìm thấy màn hình</h1><p><Link to="/admin">Về trang quản trị</Link></p></section>
}

export default AdminApp
