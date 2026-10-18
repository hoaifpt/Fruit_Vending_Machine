import { lazy, Suspense, useEffect } from 'react'
import type { ReactNode } from 'react'
import '@fontsource-variable/inter/wght.css'
import { loginPathFor, endSession } from '../api/session.ts'
import type { Role } from '../api/session.ts'
import { navigate, useLocation } from '../lib/router.ts'
import { Link, PageSkeleton } from './kit.tsx'
import { canAccess, homeFor, matchRoute, navFor } from './routes.ts'
import { AdminShell } from './shell/AdminShell.tsx'
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
  const roles = session?.user.roles ?? NO_ROLES
  const route = matchRoute(pathname)

  useEffect(() => {
    if (!session) navigate(loginPathFor(pathname, search), { replace: true })
    else if (pathname.replace(/\/+$/, '') === '/admin' || pathname === '/staff') navigate(homeFor(roles), { replace: true })
  }, [session, pathname, search, roles])
  // Move focus to the new screen after client-side navigation, like a full page load would.
  useEffect(() => { document.getElementById('admin-main')?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }) }, [pathname])

  if (!session) return <main className="route-message" role="status"><p>Đang chuyển đến trang đăng nhập…</p></main>

  let content: ReactNode
  if (!route) content = pathname.replace(/\/+$/, '') === '/admin' || pathname === '/staff' ? <PageSkeleton /> : <NotFound />
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

  return <AdminShell nav={navFor(roles)} route={route} email={session.user.email} roles={roles} onLogout={logout}>
    <Suspense fallback={<PageSkeleton />}>{content}</Suspense>
  </AdminShell>
}

function Forbidden() {
  return <section className="a-empty" role="alert"><h1>Không có quyền truy cập</h1><p>Tài khoản của bạn không được phép xem màn hình này.</p></section>
}
function NotFound() {
  return <section className="a-empty"><h1>Không tìm thấy màn hình</h1><p><Link to="/admin">Về trang quản trị</Link></p></section>
}

export default AdminApp
