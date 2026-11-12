// Kiosk /buy (FM5, screens K1–K8): catalog, machine states, QR payment, dispensing and the hidden incident button.
// The backend is the only source of order and payment state; this screen only maps GET /kiosk/orders/{id} to a view.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import QRCode from 'qrcode'
import { ApiError } from '../api/client'
import { Icon } from '../components/Icon'
import { configuredKioskKey, createKioskApi } from '../kiosk/api'
import type { KioskIdentity, KioskOrder, KioskProduct } from '../kiosk/api'
import {
  CATALOG_REFRESH_MS, COUNTDOWN_WARN_SECONDS, DISPENSE_FAILED_RETURN_MS, DISPENSE_SLOW_MS, DISPENSE_STUCK_MS, ENDED_RETURN_MS, MACHINE_STATE_COPY, PAID_RETURN_MS,
  SERVICE_RETRY_MS, chargeOutcome, clockOffset, configuredSeconds, formatCountdown, machineStateOf, pollDelay, secondsLeft, viewForOrder,
} from '../kiosk/flow'
import type { MachineState, OrderView } from '../kiosk/flow'
import { incidentReportConfig, incidentReportUrl } from '../kiosk/incident'
import { formatDateTime, formatMoney as money } from '../lib/format'
import orange from '../assets/orange-mark.webp'
import mix from '../assets/fruit-still-life.webp'
import './PurchasePage.css'

const env = import.meta.env
const IDLE_SECONDS = configuredSeconds(env.VITE_KIOSK_PAYMENT_IDLE_SECONDS, 120)
const fallbackImage = (index: number) => (index % 2 ? mix : orange)
/** Demo button for the local backend's MOCK provider. Dev server only: `vite build` drops it and its webhook secret. */
const BACKEND_MOCK_PAY = import.meta.env.DEV

type Screen =
  | { kind: 'booting' }
  | { kind: 'service'; state: MachineState }
  | { kind: 'catalog' }
  | { kind: 'creating'; product: KioskProduct }
  | { kind: 'order'; product: KioskProduct; order: KioskOrder; view: OrderView }
  | { kind: 'dispensing'; product: KioskProduct; order: KioskOrder; phase: 'sending' | 'dispensing' }
  | { kind: 'paid'; product: KioskProduct; order: KioskOrder }
  | { kind: 'ended'; reason: 'cancelled' | 'expired' | 'dispense-failed' | 'dispense-stuck'; product: KioskProduct; order: KioskOrder }

type PaymentProblem = '' | 'provider' | 'network' | 'conflict'

const isAuthError = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403)
const RETURN_MS = (screen: Screen) => screen.kind === 'paid' ? PAID_RETURN_MS : screen.kind === 'ended' ? (screen.reason === 'dispense-failed' || screen.reason === 'dispense-stuck' ? DISPENSE_FAILED_RETURN_MS : ENDED_RETURN_MS) : 0
const RETRYING: MachineState[] = ['offline', 'paused', 'sold-out', 'maintenance', 'inactive']

export default function PurchasePage() {
  const key = useMemo(configuredKioskKey, [])
  const api = useMemo(() => createKioskApi(key), [key])
  const incident = useMemo(() => incidentReportConfig(env, window.location.origin, new URLSearchParams(window.location.search).get('incident')), [])
  const [screen, setScreenState] = useState<Screen>(() => (key ? { kind: 'booting' } : { kind: 'service', state: 'unconfigured' }))
  const screenRef = useRef(screen)
  /** When the current screen kind was entered (client clock): drives the slow-dispense notice and the auto return. */
  const enteredAt = useRef(Date.now())
  const setScreen = useCallback((next: Screen) => {
    if (next.kind !== screenRef.current.kind) enteredAt.current = Date.now()
    screenRef.current = next; setScreenState(next)
  }, [])
  const [machine, setMachine] = useState<KioskIdentity | null>(null)
  const machineRef = useRef<KioskIdentity | null>(null)
  const [products, setProducts] = useState<KioskProduct[]>([])
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [paymentProblem, setPaymentProblem] = useState<PaymentProblem>('')
  const [creatingPayment, setCreatingPayment] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [dialog, setDialog] = useState<'help' | 'cancel' | 'incident' | null>(null)
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
  const rememberMachine = useCallback((identity: KioskIdentity) => { machineRef.current = identity; setMachine(identity) }, [])

  const loadCatalog = useCallback(async () => {
    try {
      const result = await api.catalog()
      remember(result.serverTime)
      setCheckedAt(new Date().toISOString())
      const list = result.data.products ?? []
      setProducts(list)
      let identity = machineRef.current
      // A refusal is explained by the machine status, which may have changed since start-up (for example MAINTENANCE).
      if (result.data.acceptingOrders === false) {
        try { const me = await api.me(); identity = me.data; rememberMachine(me.data) } catch { /* keep the last known status */ }
      }
      const state = machineStateOf(identity?.machineStatus, result.data.acceptingOrders, list.length)
      if (['booting', 'service', 'catalog'].includes(screenRef.current.kind)) setScreen(state ? { kind: 'service', state } : { kind: 'catalog' })
    } catch (error) {
      setCheckedAt(new Date().toISOString())
      if (isAuthError(error)) setScreen({ kind: 'service', state: 'unconfigured' })
      else if (['booting', 'service', 'catalog'].includes(screenRef.current.kind)) setScreen({ kind: 'service', state: 'offline' })
    }
  }, [api, rememberMachine, setScreen])

  const goHome = useCallback(() => {
    setDialog(null); setPaymentProblem(''); setCreatingPayment(false); setReconnecting(false); setPage(0)
    setScreen({ kind: 'catalog' })
    void loadCatalog()
  }, [loadCatalog, setScreen])

  /** Maps a polled/returned order onto a screen. The backend is the only source of payment state. */
  const applyOrder = useCallback((product: KioskProduct, order: KioskOrder) => {
    const view = viewForOrder(order, serverNow())
    if (view.kind === 'dispensing') { setDialog(current => (current === 'cancel' ? null : current)); setScreen({ kind: 'dispensing', product, order, phase: view.phase }); return }
    if (view.kind === 'paid') { setScreen({ kind: 'paid', product, order }); return }
    if (view.kind === 'dispense-failed') { setScreen({ kind: 'ended', reason: 'dispense-failed', product, order }); return }
    if (view.kind === 'cancelled' || view.kind === 'ended') { setDialog(current => (current === 'cancel' ? null : current)); setScreen({ kind: 'ended', reason: view.kind === 'cancelled' ? 'cancelled' : 'expired', product, order }); return }
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
      if (isAuthError(error)) { setScreen({ kind: 'service', state: 'unconfigured' }); return }
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
      if (isAuthError(error)) { setScreen({ kind: 'service', state: 'unconfigured' }); return }
      // Never retried automatically: after a timeout the order may already exist and hold a box; it expires by itself.
      setNotice(error instanceof ApiError && (error.status === 409 || error.status === 404)
        ? 'Sản phẩm này vừa hết. Vui lòng chọn sản phẩm khác. Bạn chưa bị trừ tiền.'
        : 'Chưa tạo được đơn hàng do lỗi kết nối. Bạn chưa bị trừ tiền, vui lòng chọn lại sau giây lát.')
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
      // Usually CANCELLED; an order already released by the reservation sweep reads as expired, a paid one as paid.
      const view = viewForOrder(result.data, serverNow())
      if (view.kind === 'cancelled') setScreen({ kind: 'ended', reason: 'cancelled', product: current.product, order: result.data })
      else applyOrder(current.product, result.data)
    } catch (error) {
      if (isAuthError(error)) setScreen({ kind: 'service', state: 'unconfigured' })
      else if (error instanceof ApiError && error.status === 409) {
        // Paid just in time: show what the backend says instead of cancelling.
        try { await refreshOrder(current.product, current.order.id) } catch { /* polling continues */ }
      } else if (!automatic) setNotice('Chưa hủy được đơn do lỗi kết nối. Vui lòng thử lại; đơn chưa thanh toán sẽ tự hủy khi hết giờ.')
    } finally { setCancelling(false); setDialog(current => (current === 'cancel' ? null : current)) }
  }

  // Startup: verify the key, then load the catalog.
  useEffect(() => {
    if (!key) return
    let active = true
    api.me().then(result => { if (active) { remember(result.serverTime); rememberMachine(result.data); void loadCatalog() } },
      error => { if (active) { setCheckedAt(new Date().toISOString()); setScreen({ kind: 'service', state: isAuthError(error) ? 'unconfigured' : 'offline' }) } })
    return () => { active = false }
  }, [api, key, loadCatalog, rememberMachine, setScreen])

  // Catalog refresh while idle; retry while offline / paused / sold out. An unconfigured key is not retried.
  const retrying = screen.kind === 'catalog' || (screen.kind === 'service' && RETRYING.includes(screen.state))
  useEffect(() => {
    if (!retrying || !key) return
    const timer = setInterval(() => {
      if (!machineRef.current) api.me().then(result => { rememberMachine(result.data); void loadCatalog() }, () => setCheckedAt(new Date().toISOString()))
      else void loadCatalog()
    }, screen.kind === 'catalog' ? CATALOG_REFRESH_MS : SERVICE_RETRY_MS)
    return () => clearInterval(timer)
  }, [retrying, screen.kind, key, api, loadCatalog, rememberMachine])

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
        // A response that lands after the customer cancelled (or the order ended) must not bring the old screen back.
        if (screenRef.current.kind !== 'order' && screenRef.current.kind !== 'dispensing') return
        applyOrder(product, result.data)
      } catch (error) {
        if (stopped) return
        if (isAuthError(error)) { setScreen({ kind: 'service', state: 'unconfigured' }); return }
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

  // Clock for countdowns, the idle timeout, the slow-dispense notice and the automatic return.
  const ticking = ['creating', 'order', 'dispensing', 'paid', 'ended'].includes(screen.kind)
  useEffect(() => {
    if (!ticking) return
    setClock(Date.now())
    const timer = setInterval(() => setClock(Date.now()), 500)
    return () => clearInterval(timer)
  }, [ticking])
  useEffect(() => {
    if (screen.kind !== 'order') return
    const touch = () => { lastInteraction.current = Date.now() }
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch) }
  }, [screen.kind])
  useEffect(() => {
    // While a live QR is shown the customer is paying on their phone and does not touch the kiosk: the reservation
    // deadline (countdown) ends that order, not the idle timer, so an untouched screen never cancels mid-transfer.
    if (screen.kind === 'order' && screen.view.kind !== 'qr' && clock - lastInteraction.current > IDLE_SECONDS * 1000) {
      lastInteraction.current = Date.now()
      void cancelOrder(true)
    }
  })

  // No result from the machine for too long (lost MQTT, no report): stop waiting, keep the order code on screen.
  useEffect(() => {
    if (screen.kind === 'dispensing' && clock - enteredAt.current >= DISPENSE_STUCK_MS) setScreen({ kind: 'ended', reason: 'dispense-stuck', product: screen.product, order: screen.order })
  }, [clock, screen, setScreen])

  // Final screens return to the catalog by themselves; the time left is shown on screen.
  const returnMs = RETURN_MS(screen)
  const returnLeft = returnMs ? Math.min(returnMs / 1000, Math.max(0, Math.ceil((enteredAt.current + returnMs - clock) / 1000))) : 0
  useEffect(() => {
    if (returnMs && clock - enteredAt.current >= returnMs) goHome()
  }, [clock, returnMs, goHome])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 10_000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0) }, [screen.kind])
  useEffect(() => { if (dialog) { if (!modal.current?.open) modal.current?.showModal() } else modal.current?.close() }, [dialog])

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
  const orderCode = 'order' in screen ? screen.order.orderCode : undefined
  const slowDispense = screen.kind === 'dispensing' && clock - enteredAt.current >= DISPENSE_SLOW_MS

  return <div className="buy-app buy-screen">
    <header className="buy-header">
      <div className="buy-brand"><Icon name="leaf" /><span>Fruit<span>Vending</span></span></div>
      <div className="buy-machine">{machine ? <><strong>Máy {machine.machineCode}</strong><span>{machine.machineName}</span></> : <strong>Fruit Vending</strong>}</div>
      <button className="buy-help" onClick={() => setDialog('help')}>Trợ giúp</button>
    </header>
    <main className="buy-main">
      {notice && <p role="alert" className="buy-error">{notice}</p>}

      {screen.kind === 'booting' && <StateScreen heading={heading} spinner title="Đang khởi động máy" text="Máy đang kết nối với hệ thống bán hàng." next="Vui lòng chờ trong giây lát." />}
      {screen.kind === 'service' && <StateScreen heading={heading} tone={screen.state === 'sold-out' ? 'calm' : 'warn'} spinner={screen.state === 'offline'} {...MACHINE_STATE_COPY[screen.state]}
        foot={<>{machine && <span>Máy {machine.machineCode}</span>}{screen.state !== 'unconfigured' && checkedAt && <span>Kiểm tra lần cuối {formatDateTime(checkedAt)}</span>}</>} />}

      {screen.kind === 'catalog' && <>
        <section className="buy-catalog-title"><h1 ref={heading} tabIndex={-1}>Chạm để chọn sản phẩm</h1><p>Mỗi đơn gồm 1 hộp. Giá trên thẻ là giá bạn thanh toán; mã QR hiện ngay sau khi chọn.</p></section>
        <div className="buy-products" key={currentPage} role="region" aria-label="Danh sách sản phẩm, vuốt trái hoặc phải để chuyển trang" tabIndex={0}
          onKeyDown={event => { suppressClick.current = false; if (event.key === 'ArrowRight') { event.preventDefault(); changePage(1) } if (event.key === 'ArrowLeft') { event.preventDefault(); changePage(-1) } }}
          onPointerDown={event => { if (event.button !== 0) return; suppressClick.current = false; swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId } }}
          onPointerMove={event => { const start = swipe.current; if (start && Math.abs(event.clientX - start.x) > 12) { suppressClick.current = true; event.currentTarget.setPointerCapture(event.pointerId) } }}
          onPointerUp={event => { const start = swipe.current; swipe.current = null; if (!start || start.id !== event.pointerId) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { suppressClick.current = true; changePage(dx < 0 ? 1 : -1) } }}
          onPointerCancel={() => { swipe.current = null }}
          onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false } }}>
          {products.slice(currentPage * 2, currentPage * 2 + 2).map(product => {
            const low = (product.availableQuantity ?? 0) <= 2
            return <button className="buy-product" key={product.productId} onClick={() => void selectProduct(product)}>
              <div className="buy-product-top"><span>1 hộp</span><small data-low={low || undefined}>{low ? 'Còn ít' : 'Còn hàng'}</small></div>
              <img src={imageOf(product)} alt="" draggable={false} />
              <div className="buy-product-info"><span className="buy-product-name">{product.name}</span><p>{product.description || 'Trái cây tươi'}</p><div><strong>{money(product.price)}</strong><span className="buy-product-cta">Chạm để mua <Icon name="arrow" /></span></div></div>
            </button>
          })}
        </div>
        {pageCount > 1 && <nav className="buy-pager" aria-label="Trang sản phẩm">
          <button aria-label="Trang sản phẩm trước" disabled={currentPage === 0} onClick={() => changePage(-1)}>←</button>
          <div><span role="status">Trang {currentPage + 1} / {pageCount}</span><small>Vuốt trái / phải · Tự chuyển sau 30 giây</small></div>
          <button aria-label="Trang sản phẩm sau" disabled={currentPage === pageCount - 1} onClick={() => changePage(1)}>→</button>
        </nav>}
      </>}

      {(screen.kind === 'creating' || screen.kind === 'order') && <section className="buy-pay" aria-label="Thanh toán đơn hàng">
        <div className="buy-pay-side">
          <div className="buy-pay-product">
            <img src={imageOf(screen.product)} alt="" />
            <div><p className="buy-kicker">Bạn đã chọn</p><h1 ref={heading} tabIndex={-1}>{screen.product.name}</h1><p className="buy-pay-qty">1 hộp</p></div>
          </div>
          <dl className="buy-pay-total">
            {/* Amount is always the server's order total; the kiosk never computes prices. */}
            <dt>Số tiền thanh toán</dt><dd>{screen.kind === 'order' ? money(screen.order.totalAmount) : '…'}</dd>
          </dl>
          <Countdown screen={screen} serverNow={clock + offset.current} />
          <button className="buy-cancel" disabled={screen.kind === 'creating' || cancelling} onClick={() => setDialog('cancel')}>Hủy đơn và chọn lại</button>
          {screen.kind === 'order' && screen.order.orderCode && <p className="buy-pay-code">Mã đơn <strong>{screen.order.orderCode}</strong></p>}
        </div>
        <div className="buy-pay-qr">
          <h2>Quét mã VietQR để thanh toán</h2>
          <p>Mở ứng dụng ngân hàng trên điện thoại và quét mã. Máy tự xác nhận khi nhận được tiền.</p>
          <PaymentPanel screen={screen} problem={paymentProblem} creating={creatingPayment} reconnecting={reconnecting} serverNow={clock + offset.current}
            onRenew={() => { if (screen.kind === 'order') void createPayment(screen.product, screen.order) }} />
        </div>
      </section>}

      {screen.kind === 'dispensing' && <section className="buy-result buy-result-success" aria-labelledby="buy-result-title">
        <div className="buy-result-icon" aria-hidden="true"><span className="buy-spinner" /></div>
        <p className="buy-kicker">Đã nhận thanh toán {money(screen.order.totalAmount)}</p>
        <h1 id="buy-result-title" ref={heading} tabIndex={-1}>{screen.phase === 'sending' ? 'Đang gửi lệnh nhả hàng' : 'Máy đang nhả hàng'}</h1>
        <div role="status" className="buy-result-description">
          <p>{screen.phase === 'sending' ? `Máy đang chuẩn bị nhả 1 hộp ${screen.product.name?.toLowerCase() ?? ''}.` : 'Hộp trái cây sẽ rơi xuống khay bên dưới.'} Vui lòng chờ, không rời máy và không thanh toán lại.</p>
          {reconnecting && <p className="buy-reconnect">Đang kết nối lại với hệ thống… Đơn của bạn đã được thanh toán.</p>}
        </div>
        {slowDispense && <div className="buy-slow" role="alert"><strong>Máy đang xử lý lâu hơn bình thường.</strong> Bạn đã thanh toán, không cần thanh toán lại. Nếu chưa nhận được hộp sau 2 phút, vui lòng báo nhân viên mã đơn bên dưới.</div>}
        <OrderCode code={screen.order.orderCode} large={slowDispense} />
      </section>}

      {screen.kind === 'paid' && <section className="buy-result buy-result-success" aria-labelledby="buy-result-title">
        <div className="buy-result-icon" aria-hidden="true"><Icon name="bag" /></div>
        <p className="buy-kicker">Cảm ơn bạn đã chọn Fruit Vending</p>
        <h1 id="buy-result-title" ref={heading} tabIndex={-1}>Mời bạn lấy trái cây</h1>
        <div role="status" className="buy-result-description"><p>Hộp <strong>{screen.product.name?.toLowerCase()}</strong> đã ở khay bên dưới. Chúc bạn ngon miệng!</p></div>
        <OrderCode code={screen.order.orderCode} />
        <div className="buy-result-actions"><button className="buy-primary" onClick={goHome}>Mua sản phẩm khác <Icon name="arrow" /></button><small>Tự về màn hình chính sau {returnLeft} giây</small></div>
      </section>}

      {screen.kind === 'ended' && (screen.reason === 'dispense-failed' || screen.reason === 'dispense-stuck') && <section className="buy-result buy-result-failed" aria-labelledby="buy-result-title">
        <div className="buy-result-icon" aria-hidden="true"><span>!</span></div>
        <p className="buy-kicker">Đã nhận thanh toán {money(screen.order.totalAmount)}</p>
        <h1 id="buy-result-title" ref={heading} tabIndex={-1}>{screen.reason === 'dispense-stuck' ? 'Máy chưa báo kết quả nhả hàng' : 'Máy chưa nhả được hàng'}</h1>
        <div role="alert" className="buy-result-description"><p>{screen.reason === 'dispense-stuck'
          ? 'Bạn đã thanh toán nhưng máy chưa xác nhận đã nhả hộp. Nếu chưa nhận được hộp trong khay, vui lòng chụp lại hoặc ghi mã đơn và báo nhân viên để được hỗ trợ hoặc hoàn tiền. Không thanh toán lại.'
          : 'Bạn đã thanh toán nhưng máy chưa nhả được hộp trái cây. Vui lòng chụp lại hoặc ghi mã đơn và báo nhân viên để được hỗ trợ hoặc hoàn tiền. Không thanh toán lại.'}</p></div>
        <OrderCode code={screen.order.orderCode} large machineCode={machine?.machineCode} />
        <div className="buy-result-actions"><button className="buy-primary" onClick={goHome}>Tôi đã ghi lại mã đơn</button><small>Tự về màn hình chính sau {returnLeft} giây</small></div>
      </section>}

      {screen.kind === 'ended' && (screen.reason === 'cancelled' || screen.reason === 'expired') && <EndedScreen heading={heading} reason={screen.reason} order={screen.order} returnLeft={returnLeft} onHome={goHome} />}
    </main>
    <footer className="buy-footer">{incident.enabled
      ? <button className="buy-incident" onClick={() => setDialog('incident')}><span aria-hidden="true">!</span> Báo sự cố</button>
      : <span><Icon name="leaf" /> Tươi ngon, gần bạn hơn.</span>}<span>1 hộp / đơn <b>·</b> Thanh toán VietQR</span></footer>
    <dialog className="buy-dialog" ref={modal} onCancel={() => setDialog(null)} onClose={() => setDialog(null)} aria-labelledby="buy-dialog-title">
      <header><h2 id="buy-dialog-title">{dialog === 'cancel' ? 'Hủy đơn hàng?' : dialog === 'incident' ? 'Báo sự cố với máy' : 'Bạn cần hỗ trợ?'}</h2><button aria-label="Đóng" onClick={() => setDialog(null)}><Icon name="close" /></button></header>
      {dialog === 'cancel' && <><p>Bạn chưa bị trừ tiền. Hộp trái cây đang giữ cho bạn sẽ được trả lại. Sau khi hủy, đừng chuyển tiền vào mã QR này.</p>
        <div className="buy-dialog-actions"><button className="buy-primary" onClick={() => setDialog(null)}>Tiếp tục thanh toán</button><button disabled={cancelling} onClick={() => void cancelOrder()}>{cancelling ? 'Đang hủy…' : 'Xác nhận hủy đơn'}</button></div></>}
      {dialog === 'help' && <><p>Chạm sản phẩm trên màn hình để chọn. Mỗi đơn gồm một hộp. Quét mã VietQR bằng ứng dụng ngân hàng; máy tự xác nhận khi nhận được tiền.</p>
        <h3>Đã thanh toán nhưng màn hình chưa xác nhận?</h3><p>Không thanh toán lại. Chờ thêm ít giây; nếu vẫn chưa xác nhận, hãy báo nhân viên mã đơn và mã máy.</p>
        {orderCode && <p><strong>Mã đơn {orderCode}</strong></p>}
        {machine && <p><strong>Máy {machine.machineCode}</strong> · {machine.machineName}</p>}</>}
      {dialog === 'incident' && <IncidentPanel url={incidentReportUrl(incident.baseUrl, machine?.machineCode)} machine={machine} />}
    </dialog>
  </div>
}

function StateScreen({ title, text, next, foot, spinner = false, tone = 'warn', heading }: {
  title: string; text: string; next: string; foot?: ReactNode; spinner?: boolean; tone?: 'warn' | 'calm'; heading?: RefObject<HTMLHeadingElement | null>
}) {
  return <section className={`buy-result buy-state buy-state-${tone}`} aria-labelledby="buy-state-title">
    <div className="buy-result-icon" aria-hidden="true">{spinner ? <span className="buy-spinner" /> : <span>{tone === 'calm' ? '…' : '!'}</span>}</div>
    <h1 id="buy-state-title" ref={heading} tabIndex={-1}>{title}</h1>
    <div role="status" className="buy-result-description"><p>{text}</p><p className="buy-state-next">{next}</p></div>
    {foot && <p className="buy-state-foot">{foot}</p>}
  </section>
}

function EndedScreen({ reason, order, returnLeft, onHome, heading }: {
  reason: 'cancelled' | 'expired'; order: KioskOrder; returnLeft: number; onHome: () => void; heading: RefObject<HTMLHeadingElement | null>
}) {
  const charged = chargeOutcome(order) === 'paid-late'
  return <section className="buy-result buy-result-cancelled" aria-labelledby="buy-result-title">
    <div className="buy-result-icon" aria-hidden="true"><span>!</span></div>
    <p className="buy-kicker">{reason === 'cancelled' ? 'Đơn đã hủy' : 'Hết thời gian thanh toán'}</p>
    <h1 id="buy-result-title" ref={heading} tabIndex={-1}>{reason === 'cancelled' ? 'Đơn hàng đã hủy' : 'Đơn hàng đã hết hạn'}</h1>
    <div role="status" className="buy-result-description">
      {charged
        ? <p>Hệ thống ghi nhận một khoản thanh toán đến sau khi đơn kết thúc. Vui lòng báo nhân viên mã đơn bên dưới để được hoàn tiền.</p>
        : <p><strong className="buy-not-charged">Bạn chưa bị trừ tiền.</strong> {reason === 'cancelled' ? 'Hộp trái cây đã được trả lại máy.' : 'Máy chưa nhận được thanh toán trong thời gian giữ hàng nên đã trả hộp lại.'} Đừng chuyển tiền vào mã QR cũ.</p>}
    </div>
    <OrderCode code={order.orderCode} large={charged} />
    <div className="buy-result-actions"><button className="buy-primary" onClick={onHome}>Về danh sách sản phẩm <Icon name="arrow" /></button><small>Tự về màn hình chính sau {returnLeft} giây</small></div>
  </section>
}

function OrderCode({ code, large = false, machineCode }: { code: string | undefined; large?: boolean; machineCode?: string }) {
  return <div className={`buy-order-code${large ? ' buy-order-code-large' : ''}`}>
    <span>Mã đơn</span><strong>{code ?? '—'}</strong>{machineCode && <small>Máy {machineCode}</small>}
  </div>
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
    <span>Bạn chưa bị trừ tiền. Hộp vẫn được giữ cho bạn.</span>
    <button className="buy-primary" disabled={creating} onClick={onRenew}>{creating ? 'Đang thử lại…' : 'Thử lại'}</button>
  </div>
  if (problem === 'conflict' && view.kind !== 'qr') return <div className="buy-qr-sample" role="alert">
    <strong>Không tạo thêm được mã QR cho đơn này</strong>
    <span>Bạn chưa bị trừ tiền. Vui lòng hủy đơn và chọn lại.</span>
  </div>
  if (view.kind === 'qr-expired') return <div className="buy-qr-sample" role="alert">
    <strong>Mã QR đã hết hạn</strong><span>Bạn chưa bị trừ tiền. Đừng chuyển tiền vào mã cũ.</span>
    {view.canRenew ? <button className="buy-primary" disabled={creating} onClick={onRenew}>{creating ? 'Đang tạo…' : 'Tạo mã QR mới'}</button> : <span>Hết thời gian giữ hàng, đơn sẽ tự hủy.</span>}
  </div>
  if (view.kind !== 'qr') return waiting('Đang tạo mã thanh toán…')
  const left = secondsLeft(view.deadline, serverNow)
  const backendMock = BACKEND_MOCK_PAY && view.qrCode.startsWith('MOCK-QR|')
  return <>
    <QrImage text={view.qrCode} alt={`Mã QR thanh toán ${money(view.amount)}`} label="Mã QR thanh toán" />
    <p className="buy-qr-amount">Số tiền: <strong>{money(view.amount)}</strong></p>
    {backendMock && <>
      <button type="button" className="buy-mock-pay" disabled={mockPaying} onClick={async () => {
        setMockPaying(true)
        try {
          const isCol2 = screen.product?.sku === 'DEV-WATERMELON' || screen.product?.productId === '40000000-0000-0000-0000-000000000002' || /watermelon|dưa/i.test(screen.product?.name ?? '')
          const { simulateMockPayment } = await import('../kiosk/mock-pay')
          await simulateMockPayment(view.qrCode, screen.order.orderCode, isCol2 ? 2 : 1)
        } finally { setTimeout(() => setMockPaying(false), 2000) }
      }}>{mockPaying ? 'Đang xác nhận thanh toán…' : 'Giả lập thanh toán thành công (Mock Pay)'}</button>
      <small>Mã thử nghiệm (MOCK): ứng dụng ngân hàng không thanh toán được.</small>
    </>}
    <p className="buy-wait" role="status"><span /> {reconnecting ? 'Đang kết nối lại… Nếu bạn đã chuyển tiền, đừng chuyển lại.' : left === 0 ? 'Đang kiểm tra kết quả thanh toán…' : 'Đang chờ xác nhận thanh toán'}</p>
  </>
}

function Countdown({ screen, serverNow }: { screen: Screen; serverNow: number }) {
  if (screen.kind !== 'order') return <div className="buy-countdown" aria-hidden="true"><span>Thời gian giữ hàng</span><strong>…</strong></div>
  const deadline = screen.view.kind === 'qr' ? screen.view.deadline : (screen.order.expiresAt ? Date.parse(screen.order.expiresAt) : undefined)
  const left = secondsLeft(deadline, serverNow)
  if (left === undefined) return <div className="buy-countdown" />
  const minutes = Math.floor(left / 60), seconds = left % 60
  return <div className="buy-countdown" data-warn={left <= COUNTDOWN_WARN_SECONDS || undefined} role="timer" aria-label={`Còn ${minutes} phút ${seconds} giây để thanh toán`}>
    <span>{left === 0 ? 'Đã hết thời gian thanh toán' : 'Thời gian còn lại'}</span><strong>{formatCountdown(left)}</strong>
  </div>
}

function IncidentPanel({ url, machine }: { url: string; machine: KioskIdentity | null }) {
  return <div className="buy-incident-panel">
    <p>Quét mã bằng điện thoại để báo sự cố{machine ? <> với máy <strong>{machine.machineCode}</strong></> : null}: máy không nhả hàng, đã trừ tiền nhưng không nhận hàng, hàng hư hỏng…</p>
    <QrImage text={url} alt="Mã QR mở trang báo sự cố của máy này" label="Mã QR báo sự cố" />
    <p className="buy-incident-url">{url}</p>
  </div>
}

/** Renders a QR payload (VietQR text or a link) as an image on the client. */
function QrImage({ text, alt, label }: { text: string; alt: string; label: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 480 }).then(url => { if (active) setSrc(url) }, () => { if (active) setSrc('') })
    return () => { active = false }
  }, [text])
  return src ? <img className="buy-qr-image" src={src} alt={alt} title={label} width={360} height={360} /> : <div className="buy-qr-sample" role="status" aria-label={`Đang tạo ${label.toLowerCase()}`}><span className="buy-spinner" /></div>
}
