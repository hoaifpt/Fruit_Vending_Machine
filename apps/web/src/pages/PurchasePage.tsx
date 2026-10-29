import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import QRCode from 'qrcode'
import { ApiError } from '../api/client'
import { Icon } from '../components/Icon'
import { configuredKioskKey, createKioskApi } from '../kiosk/api'
import type { KioskIdentity, KioskOrder, KioskProduct } from '../kiosk/api'
import { CATALOG_REFRESH_MS, ENDED_RETURN_MS, PAID_RETURN_MS, clockOffset, configuredSeconds, formatCountdown, pollDelay, secondsLeft, viewForOrder } from '../kiosk/flow'
import type { OrderView } from '../kiosk/flow'
import orange from '../assets/orange-mark.webp'
import mix from '../assets/fruit-still-life.webp'
import './PurchasePage.css'

const env = import.meta.env
const IDLE_SECONDS = configuredSeconds(env.VITE_KIOSK_PAYMENT_IDLE_SECONDS, 120)
const money = (value: number | undefined) => typeof value === 'number' ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value) : '—'
const fallbackImage = (index: number) => (index % 2 ? mix : orange)

type Screen =
  | { kind: 'booting' }
  | { kind: 'unconfigured' }
  | { kind: 'offline' }
  | { kind: 'out-of-service' }
  | { kind: 'catalog' }
  | { kind: 'creating'; product: KioskProduct }
  | { kind: 'order'; product: KioskProduct; order: KioskOrder; view: OrderView }
  | { kind: 'dispensing'; product: KioskProduct; order: KioskOrder }
  | { kind: 'paid'; product: KioskProduct; order: KioskOrder }
  | { kind: 'ended'; reason: 'cancelled' | 'expired' | 'dispense-failed'; product: KioskProduct; order: KioskOrder }

type PaymentProblem = '' | 'provider' | 'network' | 'conflict'

const isAuthError = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403)

export default function PurchasePage() {
  const key = useMemo(configuredKioskKey, [])
  const api = useMemo(() => createKioskApi(key), [key])
  const [screen, setScreenState] = useState<Screen>(() => (key ? { kind: 'booting' } : { kind: 'unconfigured' }))
  const screenRef = useRef(screen)
  const setScreen = useCallback((next: Screen) => { screenRef.current = next; setScreenState(next) }, [])
  const [machine, setMachine] = useState<KioskIdentity | null>(null)
  const [products, setProducts] = useState<KioskProduct[]>([])
  const [notice, setNotice] = useState('')
  const [paymentProblem, setPaymentProblem] = useState<PaymentProblem>('')
  const [creatingPayment, setCreatingPayment] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [dialog, setDialog] = useState<'help' | 'cancel' | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const offset = useRef(0)
  const lastInteraction = useRef(Date.now())
  const [page, setPage] = useState(0)
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null)
  const suppressClick = useRef(false)
  const modal = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  const serverNow = () => Date.now() + offset.current
  const remember = (serverTime: number | undefined) => { offset.current = clockOffset(serverTime, Date.now()) }

  const loadCatalog = useCallback(async () => {
    try {
      const result = await api.catalog()
      remember(result.serverTime)
      setProducts(result.data.products ?? [])
      const current = screenRef.current.kind
      if (['booting', 'offline', 'out-of-service', 'catalog'].includes(current)) setScreen(result.data.acceptingOrders ? { kind: 'catalog' } : { kind: 'out-of-service' })
    } catch (error) {
      if (isAuthError(error)) setScreen({ kind: 'unconfigured' })
      else if (['booting', 'catalog', 'out-of-service'].includes(screenRef.current.kind)) setScreen({ kind: 'offline' })
    }
  }, [api, setScreen])

  const goHome = useCallback(() => {
    setDialog(null); setPaymentProblem(''); setCreatingPayment(false); setReconnecting(false); setPage(0)
    setScreen({ kind: 'catalog' })
    void loadCatalog()
  }, [loadCatalog, setScreen])

  /** Maps a polled/returned order onto a screen. The backend is the only source of payment state. */
  const applyOrder = useCallback((product: KioskProduct, order: KioskOrder) => {
    const view = viewForOrder(order, serverNow())
    if (view.kind === 'dispensing') { setDialog(null); setScreen({ kind: 'dispensing', product, order }); return }
    if (view.kind === 'paid') { setDialog(null); setScreen({ kind: 'paid', product, order }); return }
    if (view.kind === 'dispense-failed') { setDialog(null); setScreen({ kind: 'ended', reason: 'dispense-failed', product, order }); return }
    if (view.kind === 'cancelled' || view.kind === 'ended') { setDialog(null); setScreen({ kind: 'ended', reason: view.kind === 'cancelled' ? 'cancelled' : 'expired', product, order }); return }
    if (view.kind === 'qr') setPaymentProblem('')
    setScreen({ kind: 'order', product, order, view })
  }, [setScreen])

  const refreshOrder = useCallback(async (product: KioskProduct, orderId: string) => {
    const result = await api.getOrder(orderId)
    remember(result.serverTime)
    if (screenRef.current.kind === 'order' || screenRef.current.kind === 'creating') applyOrder(product, result.data)
  }, [api, applyOrder])

  const createPayment = useCallback(async (product: KioskProduct, order: KioskOrder) => {
    if (!order.id) return
    setCreatingPayment(true); setPaymentProblem('')
    try {
      const result = await api.createPayment(order.id)
      remember(result.serverTime)
      // 201 new attempt or 200 reused attempt: both carry the QR to show.
      if (screenRef.current.kind === 'order') applyOrder(product, { ...order, currentPayment: result.data })
    } catch (error) {
      if (isAuthError(error)) { setScreen({ kind: 'unconfigured' }); return }
      if (error instanceof ApiError && error.status === 502) setPaymentProblem('provider')
      else if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        // Not payable / attempt in flight / limit reached: the order state decides what to show next.
        setPaymentProblem('conflict')
        try { await refreshOrder(product, order.id) } catch { /* polling keeps trying */ }
      } else setPaymentProblem('network')
    } finally { setCreatingPayment(false) }
  }, [api, applyOrder, refreshOrder, setScreen])

  async function selectProduct(product: KioskProduct) {
    if (screenRef.current.kind !== 'catalog' || !product.productId) return
    setNotice(''); setPaymentProblem(''); setScreen({ kind: 'creating', product })
    try {
      const result = await api.createOrder(product.productId)
      remember(result.serverTime)
      lastInteraction.current = Date.now()
      applyOrder(product, result.data)
    } catch (error) {
      if (isAuthError(error)) { setScreen({ kind: 'unconfigured' }); return }
      // Never retried automatically: after a timeout the order may already exist and hold a bowl; it expires by itself.
      setNotice(error instanceof ApiError && (error.status === 409 || error.status === 404)
        ? 'Sản phẩm này vừa hết. Vui lòng chọn sản phẩm khác.'
        : 'Chưa tạo được đơn hàng. Vui lòng thử lại sau giây lát.')
      setScreen({ kind: 'catalog' })
      void loadCatalog()
    }
  }

  async function cancelOrder(automatic = false) {
    const current = screenRef.current
    if (current.kind !== 'order' || !current.order.id || cancelling) return
    setCancelling(true)
    try {
      const result = await api.cancelOrder(current.order.id)
      setDialog(null)
      setScreen({ kind: 'ended', reason: 'cancelled', product: current.product, order: result.data })
    } catch (error) {
      if (isAuthError(error)) setScreen({ kind: 'unconfigured' })
      else if (error instanceof ApiError && error.status === 409) {
        // Paid just in time: show what the backend says instead of cancelling.
        try { await refreshOrder(current.product, current.order.id) } catch { /* polling continues */ }
      } else if (!automatic) setNotice('Chưa hủy được đơn. Vui lòng thử lại.')
    } finally { setCancelling(false); setDialog(null) }
  }

  // Startup: verify the key, then load the catalog.
  useEffect(() => {
    if (!key) return
    let active = true
    api.me().then(result => { if (active) { remember(result.serverTime); setMachine(result.data); void loadCatalog() } },
      error => { if (active) setScreen(isAuthError(error) ? { kind: 'unconfigured' } : { kind: 'offline' }) })
    return () => { active = false }
  }, [api, key, loadCatalog, setScreen])

  // Catalog refresh while idle; retry while offline / out of service.
  useEffect(() => {
    if (!['catalog', 'out-of-service', 'offline'].includes(screen.kind) || !key) return
    const timer = setInterval(() => {
      if (!machine) api.me().then(result => { setMachine(result.data); void loadCatalog() }, () => {})
      else void loadCatalog()
    }, screen.kind === 'catalog' ? CATALOG_REFRESH_MS : 15_000)
    return () => clearInterval(timer)
  }, [screen.kind, key, machine, api, loadCatalog])

  // Automatically create the first payment attempt when the order has none.
  const orderId = screen.kind === 'order' || screen.kind === 'dispensing' ? screen.order.id : undefined
  const polling = screen.kind === 'order' || screen.kind === 'dispensing'
  const needsPayment = screen.kind === 'order' && screen.view.kind === 'create-payment'
  useEffect(() => {
    const current = screenRef.current
    if (!needsPayment || creatingPayment || paymentProblem || current.kind !== 'order') return
    void createPayment(current.product, current.order)
  }, [needsPayment, orderId, creatingPayment, paymentProblem, createPayment])

  // Status polling: every 2.5 s, backing off to 10 s on network errors; stops on final states or leaving the screen.
  // It continues while the machine dispenses: the backend reports DISPENSING, then COMPLETED or DISPENSE_FAILED.
  useEffect(() => {
    if ((screen.kind !== 'order' && screen.kind !== 'dispensing') || !orderId) return
    const product = screen.product
    let failures = 0, timer: ReturnType<typeof setTimeout>, stopped = false
    const controller = new AbortController()
    const tick = async () => {
      try {
        const result = await api.getOrder(orderId, controller.signal)
        if (stopped) return
        remember(result.serverTime)
        failures = 0; setReconnecting(false)
        applyOrder(product, result.data)
      } catch (error) {
        if (stopped) return
        if (isAuthError(error)) { setScreen({ kind: 'unconfigured' }); return }
        if (error instanceof ApiError && error.status === 404) { goHome(); return }
        failures += 1; setReconnecting(true)
      }
      if (!stopped && (screenRef.current.kind === 'order' || screenRef.current.kind === 'dispensing')) timer = setTimeout(tick, pollDelay(failures))
    }
    timer = setTimeout(tick, pollDelay(0))
    return () => { stopped = true; controller.abort(); clearTimeout(timer) }
    // Restart only when the order changes, not on every poll result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, polling])

  // Clock for countdowns and the idle timeout on the payment screen.
  useEffect(() => {
    if (screen.kind !== 'order' && screen.kind !== 'creating') return
    const timer = setInterval(() => setClock(Date.now()), 500)
    return () => clearInterval(timer)
  }, [screen.kind])
  useEffect(() => {
    if (screen.kind !== 'order') return
    const touch = () => { lastInteraction.current = Date.now() }
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch) }
  }, [screen.kind])
  useEffect(() => {
    if (screen.kind === 'order' && clock - lastInteraction.current > IDLE_SECONDS * 1000) {
      lastInteraction.current = Date.now()
      void cancelOrder(true)
    }
  })

  // Final screens return to the catalog by themselves.
  useEffect(() => {
    if (screen.kind !== 'paid' && screen.kind !== 'ended') return
    // A failed dispense stays longer so the customer can note the order code for staff.
    const timer = setTimeout(goHome, screen.kind === 'paid' || (screen.kind === 'ended' && screen.reason === 'dispense-failed') ? PAID_RETURN_MS : ENDED_RETURN_MS)
    return () => clearTimeout(timer)
  }, [screen, goHome])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 8_000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0) }, [screen.kind])
  useEffect(() => { if (dialog) modal.current?.showModal(); else modal.current?.close() }, [dialog])

  // Catalog paging: 2 products per page, auto-advance every 30 s.
  const pageCount = Math.max(1, Math.ceil(products.length / 2))
  const currentPage = Math.min(page, pageCount - 1)
  const changePage = (delta: number) => setPage(Math.max(0, Math.min(pageCount - 1, currentPage + delta)))
  useEffect(() => {
    if (screen.kind !== 'catalog' || dialog || pageCount < 2) return
    const timer = setTimeout(() => setPage((currentPage + 1) % pageCount), 30_000)
    return () => clearTimeout(timer)
  }, [screen.kind, dialog, currentPage, pageCount])

  const productIndex = (product: KioskProduct) => Math.max(0, products.findIndex(item => item.productId === product.productId))
  const imageOf = (product: KioskProduct) => product.imageUrl || fallbackImage(productIndex(product))

  return <div className="buy-app buy-screen">
    <header className="buy-header">
      <div className="buy-brand"><Icon name="leaf" /><span>Fruit<span>Vending</span></span></div>
      <div className="buy-machine">{machine ? <><strong>{machine.machineCode}</strong><span>{machine.machineName}</span></> : <strong>Fruit Vending</strong>}</div>
      <button className="buy-help" onClick={() => setDialog('help')}>Trợ giúp <span aria-hidden="true">↗</span></button>
    </header>
    <main className="buy-main">
      {notice && <p role="alert" className="buy-error">{notice}</p>}

      {screen.kind === 'booting' && <ServiceScreen heading={heading} spinner title="Đang khởi động máy" text="Vui lòng chờ trong giây lát." />}
      {screen.kind === 'unconfigured' && <ServiceScreen heading={heading} title="Máy chưa được cấu hình" text="Máy tạm thời chưa thể bán hàng. Vui lòng liên hệ nhân viên vận hành." />}
      {screen.kind === 'offline' && <ServiceScreen heading={heading} spinner title="Đang kết nối lại" text="Máy đang mất kết nối với hệ thống. Vui lòng quay lại sau ít phút." />}
      {screen.kind === 'out-of-service' && <ServiceScreen heading={heading} title="Máy tạm ngừng phục vụ" text="Xin lỗi vì sự bất tiện. Vui lòng quay lại sau." />}

      {screen.kind === 'catalog' && <>
        <section className="buy-catalog-title"><h1 ref={heading} tabIndex={-1}>Chạm để chọn sản phẩm</h1><p>Mỗi đơn gồm 1 hộp. QR thanh toán sẽ xuất hiện ngay sau khi chọn.</p></section>
        {products.length === 0 ? <ServiceScreen title="Hiện chưa có sản phẩm" text="Máy đang được bổ sung hàng. Vui lòng quay lại sau." /> : <>
          <div className="buy-products" key={currentPage} role="region" aria-label="Danh sách sản phẩm, vuốt trái hoặc phải để chuyển trang" tabIndex={0}
            onKeyDown={event => { suppressClick.current = false; if (event.key === 'ArrowRight') { event.preventDefault(); changePage(1) } if (event.key === 'ArrowLeft') { event.preventDefault(); changePage(-1) } }}
            onPointerDown={event => { if (event.button !== 0) return; suppressClick.current = false; swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId } }}
            onPointerMove={event => { const start = swipe.current; if (start && Math.abs(event.clientX - start.x) > 12) { suppressClick.current = true; event.currentTarget.setPointerCapture(event.pointerId) } }}
            onPointerUp={event => { const start = swipe.current; swipe.current = null; if (!start || start.id !== event.pointerId) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { suppressClick.current = true; changePage(dx < 0 ? 1 : -1) } }}
            onPointerCancel={() => { swipe.current = null }}
            onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false } }}>
            {products.slice(currentPage * 2, currentPage * 2 + 2).map(product => <button className="buy-product" key={product.productId} onClick={() => void selectProduct(product)} aria-label={`${product.name}, ${money(product.price)}`}>
              <div className="buy-product-top"><span>1 hộp</span><small>{(product.availableQuantity ?? 0) <= 2 ? 'Còn ít' : 'Còn hàng'}</small></div>
              <img src={imageOf(product)} alt="" draggable={false} />
              <div className="buy-product-info"><h2>{product.name}</h2><p>{product.description || 'Trái cây tươi'}</p><div><strong>{money(product.price)}</strong><span aria-hidden="true">↗</span></div></div>
            </button>)}
          </div>
          <nav className="buy-pager" aria-label="Trang sản phẩm">
            <button aria-label="Trang sản phẩm trước" disabled={currentPage === 0} onClick={() => changePage(-1)}>←</button>
            <div><span role="status">Trang {currentPage + 1} / {pageCount}</span><small>Vuốt trái / phải · Tự chuyển sau 30 giây</small></div>
            <button aria-label="Trang sản phẩm sau" disabled={currentPage === pageCount - 1} onClick={() => changePage(1)}>→</button>
          </nav>
        </>}
      </>}

      {(screen.kind === 'creating' || screen.kind === 'order') && <section className="buy-kiosk-payment" aria-label="Chi tiết sản phẩm và thanh toán">
        <div className="buy-kiosk-detail">
          <img src={imageOf(screen.product)} alt={screen.product.name} />
          <div><p className="buy-kicker">Sản phẩm đã chọn</p><h1 ref={heading} tabIndex={-1}>{screen.product.name}</h1>
            <dl>
              <div><dt>Số lượng</dt><dd>1 hộp</dd></div>
              {/* Amount is always the server's order total; the kiosk never computes prices. */}
              <div><dt>Giá thanh toán</dt><dd className="buy-kiosk-price">{screen.kind === 'order' ? money(screen.order.totalAmount) : '…'}</dd></div>
            </dl>
            {screen.product.description && <p className="buy-kiosk-description">{screen.product.description}</p>}
          </div>
        </div>
        <div className="buy-kiosk-qr">
          <h2>Quét mã để thanh toán</h2><p>Dùng ứng dụng ngân hàng trên điện thoại quét mã VietQR bên dưới.</p>
          <PaymentPanel screen={screen} problem={paymentProblem} creating={creatingPayment} reconnecting={reconnecting} serverNow={clock + offset.current}
            onRenew={() => { if (screen.kind === 'order') void createPayment(screen.product, screen.order) }} />
        </div>
        <div className="buy-kiosk-payment-footer">
          <Countdown screen={screen} serverNow={clock + offset.current} />
          <button disabled={screen.kind === 'creating' || cancelling} onClick={() => setDialog('cancel')}>← Hủy và chọn lại</button>
        </div>
      </section>}

      {screen.kind === 'dispensing' && <section className="buy-result buy-result-success">
        <div className="buy-result-icon" aria-hidden="true"><span className="buy-spinner" /></div>
        <p className="buy-kicker">Đã xác nhận thanh toán</p>
        <h1 ref={heading} tabIndex={-1}>Máy đang nhả hàng</h1>
        <div role="status" className="buy-result-description"><p>Đã nhận {money(screen.order.totalAmount)} cho <strong>1 hộp {screen.product.name?.toLowerCase()}</strong>.<br />Vui lòng chờ trong giây lát, hộp trái cây sẽ rơi xuống khay bên dưới.</p></div>
        <div className="buy-receipt"><div><span>Mã đơn</span><strong>{screen.order.orderCode ?? '—'}</strong></div><div><span>Sản phẩm</span><strong>{screen.product.name} · 1 hộp</strong></div><div><span>Tổng tiền</span><strong>{money(screen.order.totalAmount)}</strong></div></div>
      </section>}

      {(screen.kind === 'paid' || screen.kind === 'ended') && <section className={`buy-result buy-result-${screen.kind === 'paid' ? 'success' : 'cancelled'}`}>
        <div className="buy-result-icon" aria-hidden="true">{screen.kind === 'paid' ? <Icon name="bag" /> : <span>!</span>}</div>
        <p className="buy-kicker">{screen.kind === 'paid' ? 'Cảm ơn bạn đã chọn Fruit Vending' : 'Fruit Vending'}</p>
        <h1 ref={heading} tabIndex={-1}>{screen.kind === 'paid' ? 'Mời bạn lấy trái cây' : screen.reason === 'dispense-failed' ? 'Máy chưa nhả được hàng' : screen.reason === 'cancelled' ? 'Đơn hàng đã hủy' : 'Đơn hàng đã hết hạn'}</h1>
        <div role="status" className="buy-result-description">
          {screen.kind === 'paid'
            ? <p>Hộp <strong>{screen.product.name?.toLowerCase()}</strong> đã ở khay bên dưới.<br />Chúc bạn ngon miệng!</p>
            : screen.reason === 'dispense-failed'
              ? <p>Bạn đã thanh toán thành công nhưng máy chưa nhả được hộp trái cây. Vui lòng liên hệ nhân viên kèm mã đơn bên dưới để được hỗ trợ hoặc hoàn tiền.</p>
              : <p>Không chuyển tiền vào mã QR cũ. Nếu đã bị trừ tiền, vui lòng liên hệ nhân viên kèm mã đơn bên dưới.</p>}
        </div>
        <div className="buy-receipt"><div><span>Mã đơn</span><strong>{screen.order.orderCode ?? '—'}</strong></div><div><span>Sản phẩm</span><strong>{screen.product.name} · 1 hộp</strong></div><div><span>Tổng tiền</span><strong>{money(screen.order.totalAmount)}</strong></div></div>
        <div className="buy-result-actions"><button className="buy-primary" onClick={goHome}>{screen.kind === 'paid' ? 'Mua sản phẩm khác' : 'Về danh sách sản phẩm'}<Icon name="arrow" /></button></div>
      </section>}
    </main>
    <footer className="buy-footer"><span><Icon name="leaf" /> Tươi ngon, gần bạn hơn.</span><span>1 sản phẩm / đơn <b>·</b> Thanh toán VietQR</span></footer>
    <dialog className="buy-dialog" ref={modal} onCancel={() => setDialog(null)} aria-labelledby="buy-dialog-title">
      <header><h2 id="buy-dialog-title">{dialog === 'cancel' ? 'Hủy đơn hàng?' : 'Bạn cần hỗ trợ?'}</h2><button aria-label="Đóng" onClick={() => setDialog(null)}><Icon name="close" /></button></header>
      {dialog === 'cancel' && <><p>Hộp trái cây đang giữ cho bạn sẽ được trả lại. Không chuyển tiền vào mã QR sau khi hủy.</p>
        <div className="buy-dialog-actions"><button onClick={() => setDialog(null)}>Tiếp tục thanh toán</button><button disabled={cancelling} onClick={() => void cancelOrder()}>{cancelling ? 'Đang hủy…' : 'Xác nhận hủy'}</button></div></>}
      {dialog === 'help' && <><p>Chạm sản phẩm trên màn hình để chọn. Mỗi đơn gồm một hộp. Quét mã VietQR bằng ứng dụng ngân hàng; máy tự xác nhận khi nhận được thanh toán.</p>
        <h3>Đã thanh toán nhưng màn hình chưa xác nhận?</h3><p>Không thanh toán lại. Chờ thêm ít giây; nếu vẫn chưa xác nhận, hãy báo nhân viên mã đơn và mã máy.</p>
        {(screen.kind === 'order' || screen.kind === 'paid' || screen.kind === 'ended') && screen.order.orderCode && <p><strong>Mã đơn {screen.order.orderCode}</strong></p>}
        {machine && <p><strong>Máy {machine.machineCode}</strong> · {machine.machineName}</p>}</>}
    </dialog>
  </div>
}

function ServiceScreen({ title, text, spinner = false, heading }: { title: string; text: string; spinner?: boolean; heading?: RefObject<HTMLHeadingElement | null> }) {
  return <section className="buy-result buy-result-offline">
    <div className="buy-result-icon" aria-hidden="true">{spinner ? <span className="buy-spinner" /> : <span>!</span>}</div>
    <h1 ref={heading} tabIndex={-1}>{title}</h1>
    <div role="status" className="buy-result-description"><p>{text}</p></div>
  </section>
}

async function simulateMockPayment(qrCode: string, orderCode?: string, column: number = 1) {
  const parts = qrCode.split('|')
  if (parts.length < 3) return false
  const paymentReference = parts[1]
  const amount = Number(parts[2])
  const transactionId = 'MOCK-TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase()
  const rawBody = `{"paymentReference":"${paymentReference}","transactionId":"${transactionId}","amount":${amount},"status":"SUCCESS"}`

  const secret = 'fvm_mock_webhook_secret_key_2026'
  const enc = new TextEncoder()
  const key = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuffer = await window.crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  const signature = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  try {
    await fetch('/api/v1/webhooks/payments/mock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mock-Signature': signature
      },
      body: rawBody
    })
  } catch (e) {
    console.error('Webhook error:', e)
  }

  // Trigger hardware bridge on port 5001 to move ESP32 servos over COM4
  try {
    const cmdId = orderCode || ('CMD-' + Math.random().toString(36).substring(2, 8).toUpperCase())
    await fetch('/bridge/dispense', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: cmdId, column })
    }).catch(() => fetch('http://127.0.0.1:5001/dispense', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: cmdId, column })
    }))
  } catch (err) {
    console.warn('Hardware bridge not reachable:', err)
  }
}

function PaymentPanel({ screen, problem, creating, reconnecting, serverNow, onRenew }: {
  screen: Screen; problem: PaymentProblem; creating: boolean; reconnecting: boolean; serverNow: number; onRenew: () => void
}) {
  const [mockPaying, setMockPaying] = useState(false)
  const waiting = (label: string) => <div className="buy-qr-sample" role="status"><span className="buy-spinner" /><strong>{label}</strong></div>
  if (screen.kind === 'creating') return waiting('Đang giữ hàng cho bạn…')
  if (screen.kind !== 'order') return null
  const view = screen.view
  if (problem === 'provider' || problem === 'network') return <div className="buy-qr-sample" role="alert">
    <strong>{problem === 'provider' ? 'Cổng thanh toán đang bận' : 'Chưa tạo được mã thanh toán'}</strong>
    <span>Chưa có khoản tiền nào được ghi nhận.</span>
    <button className="buy-primary" disabled={creating} onClick={onRenew}>{creating ? 'Đang thử lại…' : 'Thử lại'}</button>
  </div>
  if (view.kind === 'qr-expired') return <div className="buy-qr-sample" role="alert">
    <strong>Mã QR đã hết hạn</strong><span>Không chuyển tiền vào mã cũ.</span>
    {view.canRenew ? <button className="buy-primary" disabled={creating} onClick={onRenew}>{creating ? 'Đang tạo…' : 'Tạo mã QR mới'}</button> : <span>Đơn hàng sắp kết thúc.</span>}
  </div>
  if (view.kind !== 'qr') return waiting('Đang tạo mã thanh toán…')
  const left = secondsLeft(view.deadline, serverNow)
  return <>
    <QrImage text={view.qrCode} />
    <p className="buy-qr-amount">Số tiền: <strong>{money(view.amount)}</strong></p>
    {view.qrCode.startsWith('MOCK-QR|') && (
      <div style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
        <button
          type="button"
          disabled={mockPaying}
          onClick={async () => {
            setMockPaying(true)
            try {
              const isCol2 = screen.product?.sku === 'DEV-WATERMELON' ||
                screen.product?.productId === '40000000-0000-0000-0000-000000000002' ||
                /watermelon|dưa/i.test(screen.product?.name ?? '')
              const col = isCol2 ? 2 : 1
              await simulateMockPayment(view.qrCode, screen.order.orderCode, col)
            } finally {
              setTimeout(() => setMockPaying(false), 2000)
            }
          }}
          style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#ffffff',
            padding: '12px 26px',
            borderRadius: '9999px',
            fontWeight: 700,
            fontSize: '1.05rem',
            border: 'none',
            boxShadow: '0 4px 15px rgba(16, 185, 129, 0.45)',
            cursor: mockPaying ? 'wait' : 'pointer',
            transition: 'all 0.2s ease',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {mockPaying ? '⏳ Đang xác nhận thanh toán…' : '⚡ Giả lập thanh toán thành công (Mock Pay)'}
        </button>
      </div>
    )}
    {view.qrCode.startsWith('MOCK-QR|') && <small>Mã thử nghiệm (MOCK): ứng dụng ngân hàng không thanh toán được.</small>}
    <p className="buy-wait" role="status"><span /> {reconnecting ? 'Đang kết nối lại…' : left === 0 ? 'Đang kiểm tra kết quả thanh toán…' : 'Đang chờ xác nhận thanh toán'}</p>
  </>
}

function Countdown({ screen, serverNow }: { screen: Screen; serverNow: number }) {
  if (screen.kind !== 'order') return <div className="buy-countdown" />
  const deadline = screen.view.kind === 'qr' ? screen.view.deadline : (screen.order.expiresAt ? Date.parse(screen.order.expiresAt) : undefined)
  const left = secondsLeft(deadline, serverNow)
  if (left === undefined) return <div className="buy-countdown" />
  return <div className="buy-countdown" role="timer" aria-label={`Còn ${left} giây`}><span>Mã thanh toán còn</span><strong>{formatCountdown(left)}</strong></div>
}

/** Renders the VietQR text payload as a QR image on the client. */
function QrImage({ text }: { text: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 360 }).then(url => { if (active) setSrc(url) }, () => { if (active) setSrc('') })
    return () => { active = false }
  }, [text])
  return src ? <img className="buy-qr-image" src={src} alt="Mã QR thanh toán" width={300} height={300} /> : <div className="buy-qr-sample" role="status"><span className="buy-spinner" /></div>
}
