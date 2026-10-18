import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { fresh, restore, transition } from '../features/purchase/machine'
import type { Event } from '../features/purchase/machine'
import orange from '../assets/orange-mark.webp'
import mix from '../assets/fruit-still-life.webp'
import './PurchasePage.css'
const KEY = 'fruit-vending-purchase-demo-v1'
const money = (v: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(v)
const pictures = { orange, mix }
const titles = { creating: 'Đang chuẩn bị thanh toán', paid: 'Đã nhận thanh toán', dispensing: 'Đang đưa trái cây đến bạn', success: 'Trái cây đã sẵn sàng!', expired: 'Mã thanh toán đã hết hạn', cancelled: 'Đã hủy đơn hàng', payment_error: 'Chưa tạo được thanh toán', dispense_error: 'Chưa xác nhận nhận hàng', offline: 'Kết nối đang gián đoạn', checking: 'Đang đối chiếu thanh toán' }
export default function PurchasePage() {
  const [session, setSession] = useState(() => { try { return restore(sessionStorage.getItem(KEY)) } catch { return fresh() } })
  const [clock, setClock] = useState(() => Date.now()), [error, setError] = useState(''), [storageError, setStorageError] = useState(''), [code, setCode] = useState('')
  const [dialog, setDialog] = useState<'code'|'help'|'cancel'|null>(null), [demo, setDemo] = useState(false), [copyText, setCopyText] = useState('Sao chép mã đơn')
  const ref = useRef(session), modal = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null)
  const [page, setPage] = useState(0)
  const swipe = useRef<{x:number;y:number;id:number}|null>(null)
  const suppressClick = useRef(false)
  const items = [...session.items].sort((a,b)=>Number(a.slot)-Number(b.slot))
  const pageCount = Math.ceil(items.length / 2)
  const currentPage = Math.min(page, Math.max(0,pageCount-1))
  const changePage = (delta:number) => setPage(Math.max(0,Math.min(pageCount-1,currentPage+delta)))
  const { stage, order } = session
  useEffect(() => {
    if (stage !== 'catalog' || dialog || demo || pageCount < 2) return
    const timer = setTimeout(() => setPage((currentPage + 1) % pageCount), 30000)
    return () => clearTimeout(timer)
  }, [stage, dialog, demo, currentPage, pageCount])
  const remaining = Math.max(0, Math.ceil(((order?.expiresAt || 0) - clock) / 1000))
  function publish(next: typeof session) {
    ref.current = next; setSession(next); setError(''); setClock(Date.now()); setCopyText('Sao chép mã đơn')
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); setStorageError('') }
    catch { setStorageError('Trình duyệt không lưu được phiên mẫu. Không tải lại trang khi đang thử thanh toán.') }
  }
  function send(event: Event) {
    try { const next = transition(ref.current, event); publish(next) }
    catch (e) { setError(e instanceof Error ? e.message : 'Vui lòng thử lại.') }
  }
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 500); return () => clearInterval(timer) }, [])
  useEffect(() => { if (stage === 'qr' && remaining === 0) send({ type: 'expire' }) }, [stage, remaining])
  useEffect(() => {
    if (stage !== 'expired') return
    setDialog(null); setCode(''); setPage(0); setDemo(false)
    send({ type: 'home' })
  }, [stage])
  useEffect(() => {
    const event = stage === 'creating' ? 'ready' : stage === 'paid' ? 'dispense' : stage === 'dispensing' ? 'finish' : null
    if (!event) return
    const timer = setTimeout(() => send({ type: event }), stage === 'creating' ? 800 : stage === 'paid' ? 1500 : 3500)
    return () => clearTimeout(timer)
  }, [stage])
  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0) }, [stage])
  useEffect(() => { if (dialog) modal.current?.showModal(); else modal.current?.close() }, [dialog])
  function handleSelect(slot: string, now: number) { try { const next = transition(ref.current, { type: 'select', slot, id: 'DEMO-' + crypto.randomUUID().slice(0,8).toUpperCase(), now }); publish(next); setDialog(null) } catch (e) { setError((e as Error).message) } }
  function create() { send({ type: 'create', id: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, now: Date.now() }) }
  function submitCode(e: FormEvent, now: number) { e.preventDefault(); handleSelect(code.trim(), now) }
  const summary = order && <div className="buy-receipt"><div><span>Mã đơn mẫu</span><strong>{order.id}</strong></div><div><span>Sản phẩm</span><strong>{order.product.name} · 1 hộp</strong></div><div><span>Ngăn máy</span><strong>{order.product.slot}</strong></div><div><span>Tổng tiền</span><strong>{money(order.product.price)}</strong></div></div>
  return <div className="buy-app buy-screen">
    <div className="buy-demo-banner"><span><strong>Bản mô phỏng</strong> · Không thu tiền, không điều khiển máy thật.</span><button onClick={() => setDemo(!demo)} aria-expanded={demo}>Thử tình huống {demo ? '−' : '+'}</button></div>
    <header className="buy-header"><div className="buy-brand"><Icon name="leaf"/><span>Fruit<span>Vending</span></span></div><div className="buy-machine"><strong>FVM-001</strong><span>Văn phòng An Phú · Máy mẫu</span></div><button className="buy-help" onClick={() => setDialog('help')}>Trợ giúp <span aria-hidden="true">↗</span></button></header>
    <main className="buy-main">
      {storageError && <p role="alert" className="buy-error">{storageError}</p>}
      {error && !dialog && <p role="alert" className="buy-error">{error}</p>}
      {demo && <aside className="buy-demo-controls" aria-label="Điều khiển mô phỏng"><strong>Thử luồng khi chưa có BE</strong><p>Chạm sản phẩm trên kiosk để tạo phiên thanh toán, sau đó thử phản hồi tại đây.</p><div>
        <button disabled={stage!=='qr'} onClick={() => send({type:'paid'})}>Mô phỏng đã thanh toán</button>
        <button disabled={!['qr','creating'].includes(stage)} onClick={() => send({type:'payment-error'})}>Lỗi tạo thanh toán</button>
        <button disabled={!['catalog','qr'].includes(stage)} onClick={() => send({type:'offline'})}>Mất kết nối</button>
        <label><input type="checkbox" checked={session.failDispense} disabled={['paid','dispensing','success','dispense_error'].includes(stage)} onChange={e=>send({type:'fail-dispense',value:e.target.checked})}/> Nhả hàng thất bại sau thanh toán</label>
        <p>QR hết hạn sau 90 giây thực. Trạng thái thành công chỉ xuất hiện sau phản hồi thanh toán mô phỏng.</p>
      </div></aside>}
      {stage==='catalog' && <>
<section className="buy-catalog-title"><h1 ref={heading} tabIndex={-1}>Chạm để chọn sản phẩm</h1><p>Chọn trực tiếp trên màn hình máy. QR thanh toán sẽ xuất hiện cùng chi tiết sản phẩm.</p></section>
        <div className="buy-catalog-head"><button className="buy-code-button" onClick={()=>{setCode('');setError('');setDialog('code')}}><Icon name="qr"/> Nhập mã ngăn</button></div>
        <div className="buy-products" key={currentPage} role="region" aria-label="Danh sách sản phẩm, vuốt trái hoặc phải để chuyển trang" tabIndex={0}
          onKeyDown={e=>{suppressClick.current=false;if(e.key==='ArrowRight'){e.preventDefault();changePage(1)}if(e.key==='ArrowLeft'){e.preventDefault();changePage(-1)}}}
          onPointerDown={e=>{if(e.button!==0)return;suppressClick.current=false;swipe.current={x:e.clientX,y:e.clientY,id:e.pointerId}}}
          onPointerMove={e=>{const start=swipe.current;if(start&&Math.abs(e.clientX-start.x)>12){suppressClick.current=true;e.currentTarget.setPointerCapture(e.pointerId)}}}
          onPointerUp={e=>{const start=swipe.current;swipe.current=null;if(!start||start.id!==e.pointerId)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.3){suppressClick.current=true;changePage(dx<0?1:-1)}}}
          onPointerCancel={()=>{swipe.current=null}}
          onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();suppressClick.current=false}}}
        >{items.slice(currentPage*2,currentPage*2+2).map(p=><button className="buy-product" key={p.slot} disabled={!p.stock} onClick={()=>handleSelect(p.slot, Date.now())} aria-label={`Ngăn ${p.slot}, ${p.name}, ${p.size}, ${money(p.price)}${!p.stock?', hết hàng':''}`}><div className="buy-product-top"><span>Ngăn <b>{p.slot}</b></span><small>{p.stock===0?'Hết hàng':p.stock<=2?'Còn ít':'Còn hàng'}</small></div><img src={pictures[p.image]} alt="" draggable={false}/><div className="buy-product-info"><h2>{p.name}</h2><p>{p.size} · Ảnh minh họa</p><div><strong>{money(p.price)}</strong><span aria-hidden="true">{p.stock?'↗':'—'}</span></div></div></button>)}</div><nav className="buy-pager" aria-label="Trang sản phẩm"><button aria-label="Trang sản phẩm trước" disabled={currentPage===0} onClick={()=>changePage(-1)}>←</button><div><span role="status">Trang {currentPage+1} / {pageCount}</span><small>Vuốt trái / phải · Tự chuyển sau 30 giây</small></div><button aria-label="Trang sản phẩm sau" disabled={currentPage===pageCount-1} onClick={()=>changePage(1)}>→</button></nav>
      </>}
      {['creating','qr'].includes(stage) && order && <section className="buy-kiosk-payment" aria-label="Chi tiết sản phẩm và thanh toán">
        <div className="buy-kiosk-detail">
          <img src={pictures[order.product.image]} alt={'Minh họa ' + order.product.name}/>
          <div><p className="buy-kicker">Sản phẩm đã chọn</p><h1 ref={heading} tabIndex={-1}>{order.product.name}</h1>
            <dl><div><dt>Mã ngăn</dt><dd>{order.product.slot}</dd></div><div><dt>Quy cách</dt><dd>{order.product.size} · 1 hộp</dd></div><div><dt>Giá thanh toán</dt><dd className="buy-kiosk-price">{money(order.product.price)}</dd></div></dl>
            <p className="buy-kiosk-description">{order.product.description}</p>
          </div>
        </div>
        <div className="buy-kiosk-qr">
          <h2>Quét mã để thanh toán</h2><p>Dùng ứng dụng ngân hàng trên điện thoại quét mã QR hiển thị tại máy.</p>
          {stage==='creating'?<div className="buy-qr-sample" role="status"><span className="buy-spinner"/><strong>Đang tạo mã thanh toán…</strong></div>:<>
            <div className="buy-qr-sample" aria-label="Vị trí QR thanh toán mẫu, không thể chuyển tiền"><Icon name="qr"/><strong>QR THANH TOÁN MẪU</strong><span>Chưa kết nối BE · Không chuyển tiền</span></div>
            <p className="buy-wait" role="status"><span/> Đang chờ xác nhận thanh toán</p>
          </>}
          <small>Mã đơn: <strong>{order.id}</strong></small>
        </div>
        <div className="buy-kiosk-payment-footer"><div className="buy-countdown" role="timer" aria-label={'Còn ' + remaining + ' giây'}><span>Tự về danh sách sau</span><strong>{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</strong></div><button disabled={stage==='creating'} onClick={()=>setDialog('cancel')}>← Quay lại chọn hàng</button></div>
        <p className="buy-kiosk-demo-note">Bản thử nghiệm chưa có QR thật. Mở “Thử tình huống” phía trên để mô phỏng thanh toán.</p>
      </section>}
      {!['catalog','creating','qr'].includes(stage) && <section className={`buy-result buy-result-${stage}`}>
        <div className="buy-result-icon" aria-hidden="true">{['creating','paid','dispensing','checking'].includes(stage)?<span className="buy-spinner"/>:stage==='success'?<Icon name="bag"/>:stage==='offline'?<Icon name="transactions"/>:<span>!</span>}</div>
        <p className="buy-kicker">{stage==='success'?'Cảm ơn bạn đã chọn Fruit Vending':order?.paid?'Đơn đã thanh toán (mô phỏng)':'Fruit Vending'}</p>
        <h1 ref={heading} tabIndex={-1}>{titles[stage as keyof typeof titles]}</h1>
        <div role="status" className="buy-result-description">
          {stage==='paid'&&<p>Đã xác nhận {money(order?.product.price||0)}. Máy đang chuẩn bị nhả sản phẩm.</p>}
          {stage==='dispensing'&&<p>Vui lòng chờ trước máy, không thanh toán thêm.<br/>Nhận sản phẩm tại khay bên dưới khi máy hoàn tất.</p>}
          {stage==='success'&&<p>Lấy <strong>1 hộp {order?.product.name.toLowerCase()}</strong> tại khay nhận hàng bên dưới.<br/>Chúc bạn có một ngày thật tươi!</p>}
          {stage==='expired'&&<p>Phiên thanh toán 90 giây đã kết thúc. Không chuyển tiền vào mã cũ. Nếu đã bị trừ tiền, hãy kiểm tra trạng thái trước khi mua lại.</p>}
          {stage==='cancelled'&&<p>Phiên mẫu đã được hủy. Nếu bạn đã chuyển tiền trước khi hủy, hãy kiểm tra thanh toán để tránh trả tiền hai lần.</p>}
          {stage==='payment_error'&&<p>Không tạo được phiên thanh toán mẫu. Chưa ghi nhận thanh toán; bạn có thể thử lại.</p>}
          {stage==='dispense_error'&&<p>Đơn đã có xác nhận thanh toán nhưng chưa xác nhận sản phẩm ra khỏi máy. Không thanh toán lại. Giữ mã đơn dưới đây để được hỗ trợ; hoàn tiền chưa được thực hiện.</p>}
          {stage==='offline'&&<p>{order?'Đang giữ thông tin đơn. Chưa thể xác định kết quả thanh toán; không chuyển tiền thêm hoặc tạo đơn mới.':'Máy tạm thời chưa thể phục vụ. Vui lòng kết nối lại trước khi chọn sản phẩm.'}</p>}
          {stage==='checking'&&<p>Chưa kết nối BE để tra cứu kết quả. Chọn phản hồi mô phỏng bên dưới để tiếp tục; giao diện thật sẽ chờ kết quả từ hệ thống.</p>}
        </div>
        {stage==='dispensing'&&<div className="buy-dispenser" aria-hidden="true"><span/><div/></div>}
        {!['creating','paid','dispensing'].includes(stage)&&summary}
        <div className="buy-result-actions">
          {['success','expired','cancelled','payment_error','dispense_error'].includes(stage)&&<button className="buy-primary" onClick={()=>send({type:'home'})}>{stage==='success'?'Mua sản phẩm khác':'Về danh sách sản phẩm'}<Icon name="arrow"/></button>}
          {stage==='payment_error'&&<button onClick={create}>Thử tạo thanh toán lại</button>}
          {['expired','cancelled'].includes(stage)&&<button onClick={()=>send({type:'check'})}>Đã trừ tiền? Kiểm tra thanh toán</button>}
          {stage==='offline'&&<button className="buy-primary" onClick={()=>send({type:'check'})}>Mô phỏng kết nối lại</button>}
          {stage==='checking'&&<><button className="buy-primary" onClick={()=>send({type:'paid'})}>Mô phỏng: đã thanh toán</button><button onClick={()=>send({type:'unpaid'})}>Mô phỏng: chưa thanh toán</button></>}
          {stage==='dispense_error'&&<><button onClick={()=>setDialog('help')}>Xem hướng dẫn hỗ trợ</button><button onClick={async()=>{try{await navigator.clipboard.writeText(order?.id||'');setCopyText('Đã sao chép')}catch{setCopyText('Hãy ghi lại mã đơn hiển thị ở trên')}}}>{copyText}</button></>}
        </div>
      </section>}
    </main>
    <footer className="buy-footer"><span><Icon name="leaf"/> Tươi ngon, gần bạn hơn.</span><span>1 sản phẩm / đơn <b>·</b> Thanh toán QR</span></footer>
    <dialog className="buy-dialog" ref={modal} onCancel={()=>{setDialog(null);setError('')}} aria-labelledby="buy-dialog-title"><header><h2 id="buy-dialog-title">{dialog==='code'?'Nhập mã ngăn':dialog==='cancel'?'Hủy phiên thanh toán?':'Bạn cần hỗ trợ?'}</h2><button aria-label="Đóng" onClick={()=>{setDialog(null);setError('')}}><Icon name="close"/></button></header>
      {dialog==='code'&&<form onSubmit={e=>submitCode(e, Date.now())}><label htmlFor="slot-code">Mã ngăn trên sản phẩm</label><input id="slot-code" autoFocus inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} placeholder="Ví dụ: 1"/><div className="buy-keypad">{['1','2','3','4','5','6','7','8','9','Xóa','0','⌫'].map(n=><button type="button" key={n} aria-label={n==='⌫'?'Xóa một số':n} onClick={()=>{setError('');setCode(n==='Xóa'?'':n==='⌫'?code.slice(0,-1):(code+n).slice(0,3))}}>{n}</button>)}</div>{error&&<p className="buy-error" role="alert">{error}</p>}<button className="buy-primary" disabled={!code.length} type="submit">Chọn sản phẩm</button></form>}
      {dialog==='cancel'&&<><p>Bạn có muốn hủy phiên của ngăn {order?.product.slot}? Không chuyển tiền vào mã cũ sau khi hủy.</p><div className="buy-dialog-actions"><button onClick={()=>setDialog(null)}>Tiếp tục thanh toán</button><button onClick={()=>{send({type:'cancel'});setDialog(null)}}>Xác nhận hủy</button></div></>}
      {dialog==='help'&&<><p>Chạm sản phẩm trực tiếp trên màn hình kiosk hoặc nhập mã ngăn. Chi tiết và QR thanh toán xuất hiện trên cùng màn hình; điện thoại chỉ dùng quét QR để trả tiền. Mỗi đơn gồm một hộp. Sau khi thanh toán được xác nhận, chờ máy nhả hàng tại khay bên dưới.</p><h3>Đã thanh toán nhưng chưa nhận được hàng?</h3><p>Không thanh toán lại. Lưu mã đơn và mã máy để cung cấp cho nhân viên tại địa điểm đặt máy.</p>{order&&<p><strong>{order.id}</strong> · Ngăn {order.product.slot}</p>}<p><strong>Máy FVM-001</strong> · Văn phòng An Phú (mẫu)</p><small>Thông tin liên hệ thật chưa được cấu hình. Bản thử nghiệm không gửi yêu cầu hỗ trợ hoặc hoàn tiền.</small></>}
    </dialog>
  </div>
}
