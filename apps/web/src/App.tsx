import { lazy, Suspense, useEffect } from 'react'
import LandingPage from './pages/LandingPage'
import { resolvePage } from './routing'

const AdminPage = lazy(() => import('./pages/AdminPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))

function App() {
  const page = resolvePage(window.location.pathname)
  useEffect(() => {
    document.title = page === 'admin' ? 'Quản trị | Fruit Vending' : page === 'login' ? 'Đăng nhập | Fruit Vending' : page === 'home' ? 'Fruit Vending — Trái cây tươi. Gần bạn hơn.' : 'Không tìm thấy trang | Fruit Vending'
  }, [page])
  if (page === 'login') return <Suspense fallback={<main className="route-message" role="status">Đang mở trang đăng nhập…</main>}><LoginPage /></Suspense>
  if (page === 'admin') return <Suspense fallback={<main className="route-message" role="status">Đang mở khu quản trị…</main>}><AdminPage /></Suspense>
  if (page === 'home') return <LandingPage />
  return <main className="route-message"><p>404</p><h1>Trang này không tồn tại.</h1><p>Hãy quay lại để khám phá Fruit Vending.</p><a href="/">Về trang giới thiệu →</a></main>
}
export default App

