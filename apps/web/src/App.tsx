import { lazy, Suspense, useEffect } from 'react'
import { useLocation } from './lib/router'
import LandingPage from './pages/LandingPage'
import { ROUTE_MESSAGE } from './lib/route-message'
import { resolvePage } from './routing'

const PurchasePage = lazy(() => import('./pages/PurchasePage'))
const AdminApp = lazy(() => import('./admin/AdminApp'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const IncidentReportPage = lazy(() => import('./pages/IncidentReportPage'))

function App() {
  const { pathname } = useLocation()
  const page = resolvePage(pathname)
  useEffect(() => {
    document.title = page === 'incident' ? 'Báo sự cố | Fruit Vending' : page === 'purchase' ? 'Chọn trái cây | Fruit Vending' : page === 'admin' ? 'Quản trị | Fruit Vending' : page === 'login' ? 'Đăng nhập | Fruit Vending' : page === 'home' ? 'Fruit Vending — Trái cây tươi. Gần bạn hơn.' : 'Không tìm thấy trang | Fruit Vending'
  }, [page])
  if (page === 'login') return <Suspense fallback={<main className={ROUTE_MESSAGE} role="status">Đang mở trang đăng nhập…</main>}><LoginPage /></Suspense>
  if (page === 'admin') return <Suspense fallback={<main className={ROUTE_MESSAGE} role="status">Đang mở khu quản trị…</main>}><AdminApp /></Suspense>
  if (page === 'incident') return <Suspense fallback={<main className={ROUTE_MESSAGE} role="status">Đang mở trang báo sự cố…</main>}><IncidentReportPage /></Suspense>
  if (page === 'purchase') return <Suspense fallback={<main className={ROUTE_MESSAGE} role="status">Đang mở máy bán trái cây…</main>}><PurchasePage /></Suspense>
  if (page === 'home') return <LandingPage />
  return <main className={ROUTE_MESSAGE}><p>404</p><h1 className="my-4!">Trang này không tồn tại.</h1><p>Hãy quay lại để khám phá Fruit Vending.</p><a href="/" className="inline-block py-4 text-[var(--brand)]">Về trang giới thiệu →</a></main>
}
export default App
