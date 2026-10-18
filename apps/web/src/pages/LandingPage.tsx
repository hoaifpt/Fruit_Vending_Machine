import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { getContactLinks } from '../features/landing/contact'
import heroImage from '../assets/landing-hero.webp'
import spaceImage from '../assets/partnership-space.webp'
import orangeImage from '../assets/orange-mark.webp'
import './LandingPage.css'

const sections = [ ['#giai-phap', 'Giải pháp'], ['#cach-hoat-dong', 'Cách hoạt động'], ['#hop-tac', 'Hợp tác'] ] as const
const steps = [
  { icon: 'fruit', title: 'Chọn trái cây', text: 'Tìm món yêu thích và lựa chọn ngay trên màn hình của máy.' },
  { icon: 'qr', title: 'Thanh toán QR', text: 'Quét mã thanh toán cho sản phẩm bạn vừa chọn.' },
  { icon: 'bag', title: 'Nhận sản phẩm', text: 'Chờ máy nhả hàng, nhận sản phẩm tại khay bên dưới.' },
] as const
const questions = [
  ['Fruit Vending là gì?', 'Fruit Vending là dự án hệ thống máy bán trái cây tự động, kết hợp màn hình chọn hàng, thanh toán QR và công cụ quản lý tập trung. Giải pháp đang trong quá trình phát triển.'],
  ['Tôi có thể trao đổi về việc đặt máy ở đâu?', 'Bạn có thể đề xuất không gian như văn phòng, khu dân cư hoặc khuôn viên trường học. Vị trí và điều kiện lắp đặt cần được trao đổi cụ thể cho từng địa điểm.'],
  ['Ai sử dụng trang quản lý?', 'Trang quản lý dành cho admin và staff có tài khoản được cấp. Bạn có thể truy cập qua nút “Đăng nhập quản lý” trên đầu trang.'],
]

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const contact = getContactLinks(import.meta.env.VITE_PARTNERSHIP_EMAIL, import.meta.env.VITE_PARTNERSHIP_PHONE)
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButton.current?.focus() }
    }
    function closeOutside(event: PointerEvent) {
      if (menuOpen && event.target instanceof Node && !headerRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const desktop = window.matchMedia('(min-width: 961px)')
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false) }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOutside)
    desktop.addEventListener('change', closeOnDesktop)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOutside)
      desktop.removeEventListener('change', closeOnDesktop)
    }
  }, [menuOpen])

  return <div className="landing">
    <a className="skip-link" href="#noi-dung">Đến nội dung chính</a>
    <header className="site-header" ref={headerRef}>
      <div className="header-inner">
        <a className="site-brand" href="/" aria-label="Fruit Vending — Trang chủ"><Icon name="leaf" /><span>Fruit Vending</span></a>
        <nav className="desktop-nav" aria-label="Điều hướng chính">{sections.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav>
        <div className="header-actions">
          <a className="management-link" href="/login">Đăng nhập<span className="management-suffix"> quản lý</span></a>
          <a className="landing-button header-cta" href="#hop-tac">Hợp tác đặt máy <Icon name="arrow" /></a>
          <button className="menu-toggle" type="button" ref={menuButton} aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? 'close' : 'menu'} /></button>
        </div>
      </div>
      <nav className="mobile-nav" id="mobile-navigation" aria-label="Điều hướng điện thoại" hidden={!menuOpen}>
        {sections.map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}<Icon name="arrow" /></a>)}
      </nav>
    </header>

    <main id="noi-dung" tabIndex={-1}>
      <section className="landing-hero section-width" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="hero-intro"><span aria-hidden="true" /> Một lựa chọn tươi mới, mỗi ngày</p>
          <h1 id="hero-title">Trái cây tươi.<br /><span>Gần bạn hơn.</span></h1>
          <p className="hero-description">Giải pháp máy bán trái cây tự động cho không gian làm việc và sinh hoạt.</p>
          <div className="hero-actions"><a className="landing-button" href="#hop-tac">Hợp tác đặt máy <Icon name="arrow" /></a><a className="text-link" href="#giai-phap">Khám phá giải pháp <span aria-hidden="true">↗</span></a></div>
          <p className="hero-footnote">Một khoảng nghỉ nhỏ.<br />Một chút tươi mới cho ngày dài.</p>
        </div>
        <figure className="hero-art"><img src={heroImage} width="1254" height="1254" alt="Minh họa ý tưởng máy Fruit Vending bên cạnh đu đủ, dưa hấu, cam và kiwi." fetchPriority="high" /><figcaption>Hình ảnh minh họa ý tưởng sản phẩm</figcaption></figure>
      </section>

      <section className="purchase-section" id="cach-hoat-dong" aria-labelledby="purchase-title">
        <div className="section-width">
          <div className="purchase-heading"><h2 id="purchase-title">Từ lựa chọn<br className="mobile-only" /> đến nhận hàng.</h2><p>Một trải nghiệm mua hàng được thiết kế để thật đơn giản.</p></div>
          <ol className="purchase-steps">{steps.map((step, index) => <li key={step.title}><div className="step-top"><span className="step-number">0{index + 1}</span><span className="step-icon"><Icon name={step.icon} /></span></div><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol>
        </div>
      </section>

      <section className="solution-section section-width" id="giai-phap" aria-labelledby="solution-title">
        <div className="solution-lead"><span className="section-label">Giải pháp Fruit Vending</span><h2 id="solution-title">Tiện cho người mua.<br />Gọn cho người quản lý.</h2><p>Từ thao tác tại máy đến công việc vận hành, mọi phần được thiết kế để kết nối trong cùng một hệ thống.</p><span className="development-note">Giải pháp đang được phát triển</span></div>
        <div className="solution-details">
          <article><div><h3>Chọn hàng ngay tại máy</h3><p>Màn hình kiosk giúp người mua xem sản phẩm, lựa chọn và theo dõi các bước mua hàng.</p></div></article>
          <article><div><h3>Thanh toán, rồi nhận hàng</h3><p>Quy trình kết nối thanh toán QR với bộ điều khiển để nhả đúng sản phẩm đã chọn.</p></div></article>
          <article><div><h3>Một nơi để quản lý</h3><p>Web quản trị hướng tới quản lý máy, sản phẩm, tồn kho và giao dịch dành cho admin và staff.</p><a className="text-link" href="/login">Đến trang đăng nhập <Icon name="arrow" /></a></div></article>
        </div>
      </section>

      <section className="partnership-section" id="hop-tac" aria-labelledby="partnership-title">
        <div className="partnership-layout section-width">
          <div className="partnership-copy"><span className="section-label">Cùng đưa trái cây đến gần hơn</span><h2 id="partnership-title">Một góc nhỏ.<br />Thêm nhiều <br />tươi mới.</h2><p>Bạn có một không gian phù hợp? Cùng trao đổi về ý tưởng đặt máy tại nơi làm việc, khu dân cư hoặc khuôn viên của bạn.</p><a className="landing-button" href="#lien-he">Trao đổi hợp tác <Icon name="arrow" /></a><ul className="location-tags" aria-label="Không gian có thể đề xuất"><li>Văn phòng</li><li>Khu dân cư</li><li>Trường học</li></ul></div>
          <figure className="partnership-art"><img src={spaceImage} width="1448" height="1086" alt="Minh họa không gian sinh hoạt chung sáng thoáng với bàn ghế và cây xanh." loading="lazy" decoding="async" /><figcaption>Một ý tưởng cho không gian của bạn</figcaption></figure>
        </div>
      </section>

      <section className="contact-section section-width" id="lien-he" aria-labelledby="contact-title">
        <div><h2 id="contact-title">Bắt đầu từ<br />một cuộc trò chuyện.</h2><p>Chia sẻ địa điểm dự kiến và nhu cầu của bạn để cùng tìm hướng hợp tác phù hợp.</p></div>
        <div className="contact-panel">
          {contact.email || contact.phone ? <><h3>Liên hệ hợp tác</h3>{contact.email && <a className="contact-link" href={contact.email.href}><Icon name="mail" /><span>{contact.email.label}</span><Icon name="arrow" /></a>}{contact.phone && <a className="contact-link" href={contact.phone.href}><Icon name="phone" /><span>{contact.phone.label}</span><Icon name="arrow" /></a>}<p>Vui lòng cho biết tên liên hệ, địa điểm và cách liên lạc thuận tiện với bạn.</p></> : <><img src={orangeImage} width="88" height="66" alt="" loading="lazy" /><h3>Hẹn gặp bạn tại đây.</h3><p>Kênh liên hệ hợp tác đang được cập nhật. Thông tin sẽ được công bố ngay tại mục này.</p></>}
        </div>
      </section>

      <section className="faq-section section-width" aria-labelledby="faq-title"><h2 id="faq-title">Có thể bạn đang thắc mắc.</h2><div className="faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<Icon name="plus" /></summary><p>{answer}</p></details>)}</div></section>
    </main>

    <footer className="site-footer"><div className="footer-main section-width"><div><a className="site-brand" href="/"><Icon name="leaf" /><span>Fruit Vending</span></a><p>Trái cây tươi. Gần bạn hơn.</p></div><nav aria-label="Điều hướng cuối trang"><a href="#giai-phap">Giải pháp</a><a href="#hop-tac">Hợp tác đặt máy</a><a href="/login">Đăng nhập quản lý <Icon name="arrow" /></a></nav></div><div className="footer-bottom section-width"><span>© {new Date().getFullYear()} Fruit Vending</span><span>Hệ thống máy bán trái cây tự động</span></div></footer>
  </div>
}

