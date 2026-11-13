import { lazy, Suspense, useEffect } from 'react'
import type { ReactNode } from 'react'
import '@fontsource-variable/inter/wght.css'
import { endSession, expireSession, loginPathFor, setLoginRedirect } from '../api/session.ts'
import type { Role } from '../api/session.ts'
import { confirmLeave, navigate, useLocation } from '../lib/router.ts'
import { Forbidden, Link, PageSkeleton } from './kit.tsx'
import { can } from './permissions.ts'
import { canOpen, homeFor, matchRoute, navFor } from './routes.ts'
import { AdminShell } from './shell/AdminShell.tsx'
import { AlertBell } from './shell/AlertBell.tsx'
import { useSession } from './useSession.ts'
import './admin.css'

const OverviewPage = lazy(() => import('./pages/OverviewPage.tsx'))
const UsersPage = lazy(() => import('./pages/UsersPage.tsx'))
const RolesPage = lazy(() => import('./pages/RolesPage.tsx'))
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
const AlertsPage = lazy(() => import('./pages/AlertsPage.tsx'))
const AlertDetailPage = lazy(() => import('./pages/AlertDetailPage.tsx'))
const RefundsPage = lazy(() => import('./pages/RefundsPage.tsx'))
const TicketsPage = lazy(() => import('./pages/TicketsPage.tsx'))
const TicketDetailPage = lazy(() => import('./pages/TicketDetailPage.tsx'))
const TicketRestockPage = lazy(() => import('./pages/TicketRestockPage.tsx'))
const MaintenanceSchedulesPage = lazy(() => import('./pages/MaintenanceSchedulesPage.tsx'))
const RevenueReportPage = lazy(() => import('./pages/RevenueReportPage.tsx'))
// Component reference at /admin/_kit: the literal condition drops this chunk from production builds.
const KitPage = import.meta.env.DEV || import.meta.env.MODE === 'mock' ? lazy(() => import('./pages/KitPage.tsx')) : null

const NO_ROLES: Role[] = []
/** setTimeout cannot wait longer than ~24.8 days. */
const MAX_TIMER_MS = 2 ** 31 - 1

function AdminApp() {
  const { pathname, search } = useLocation()
  const { session } = useSession()
  const roles = session?.user.roles ?? NO_ROLES
  const route = matchRoute(pathname)

  // Session expiry (401 or token exp) goes through the SPA router: one redirect to /login?next=<this page>.
  useEffect(() => {
    // Forced: the session is gone, so a screen's unsaved-changes guard cannot keep the user here.
    setLoginRedirect(to => navigate(to, { replace: true, force: true }))
    return () => setLoginRedirect(null)
  }, [])
  const expiresAt = session?.expiresAt
  useEffect(() => {
    if (!expiresAt) return
    const timer = setTimeout(() => expireSession(), Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMER_MS))
    return () => clearTimeout(timer)
  }, [expiresAt])

  useEffect(() => {
    if (!session) navigate(loginPathFor(pathname, search), { replace: true, force: true })
    else if (pathname.replace(/\/+$/, '') === '/admin' || pathname === '/staff') navigate(homeFor(roles), { replace: true })
  }, [session, pathname, search, roles])
  // Move focus to the new screen after client-side navigation, like a full page load would.
  useEffect(() => { document.getElementById('admin-main')?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }) }, [pathname])

  if (!session) return <main className="route-message" role="status"><p>Đang chuyển đến trang đăng nhập…</p></main>

  let content: ReactNode
  if (KitPage && pathname.replace(/\/+$/, '') === '/admin/_kit') content = <KitPage />
  else if (!route) content = pathname.replace(/\/+$/, '') === '/admin' || pathname === '/staff' ? <PageSkeleton /> : <NotFound />
  else if (!canOpen(roles, route)) content = <Forbidden page permission={route.permission} />
  else {
    const id = route.id ?? ''
    content = {
      overview: <OverviewPage />,
      users: <UsersPage />,
      roles: <RolesPage />,
      products: <ProductsPage />,
      machines: <MachinesPage />,
      'machine-detail': <MachineDetailPage machineId={id} />,
      batches: <BatchesPage />,
      inventory: <InventoryPage />,
      'inventory-history': <InventoryHistoryPage />,
      orders: <OrdersPage />,
      'order-detail': <OrderDetailPage orderId={id} />,
      payments: <PaymentsPage />,
      // key: a new id is a new screen (state reset, no answer of the previous id shown under the new one).
      'payment-detail': <PaymentDetailPage key={id} paymentId={id} />,
      'webhook-logs': <WebhookLogsPage />,
      'webhook-log-detail': <WebhookLogDetailPage key={id} logId={id} />,
      alerts: <AlertsPage />,
      'alert-detail': <AlertDetailPage key={id} alertId={id} />,
      refunds: <RefundsPage />,
      tickets: <TicketsPage />,
      'ticket-detail': <TicketDetailPage key={id} ticketId={id} />,
      'ticket-restock': <TicketRestockPage key={id} ticketId={id} />,
      'maintenance-schedules': <MaintenanceSchedulesPage />,
      'revenue-report': <RevenueReportPage />,
    }[route.page]
  }

  function logout() {
    // Asked before the session ends: a screen with unsaved changes (A3) may keep the user here.
    if (!confirmLeave()) return
    endSession()
    navigate('/login', { replace: true, force: true })
  }

  return <AdminShell nav={navFor(roles)} route={route} email={session.user.email} roles={roles} onLogout={logout}
    bell={can(roles, 'ALERT_READ') ? <AlertBell key={session.user.email} /> : null}>
    <Suspense fallback={<PageSkeleton />}>{content}</Suspense>
  </AdminShell>
}

function NotFound() {
  return <section className="a-empty"><h1>Không tìm thấy màn hình</h1><p><Link to="/admin">Về trang quản trị</Link></p></section>
}

export default AdminApp
