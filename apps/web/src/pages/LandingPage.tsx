// Public landing page `/` (FE 9.3): approved direction A (docs/design/landing-directions-v1.png, docs/landing-page.md),
// moved to Tailwind v4 utilities, the shared Button and lucide icons. Content and section order are unchanged.
//
// Colours are the approved OKLCH tokens in index.css (--ink, --muted, --brand, --surface, --identity) plus two landing
// tokens declared on the root. The page stays light whatever the admin theme is (direction A has no dark variant), so
// it does not use the --ui-* tokens that flip under `.dark`.
// index.css resets margins on h1/h2/p outside any layer, so spacing on those elements uses padding (or `!`).
// Breakpoints follow the previous CSS: ≤640 phone (base), 641–960 tablet, 961–1180 small desktop, ≥1181 wide.
import { useEffect, useRef, useState } from 'react'
import { Apple, ArrowRight, ArrowUpRight, Leaf, Mail, Menu, Phone, Plus, QrCode, ShoppingBag, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../components/ui/button'
import { cn } from '../lib/cn'
import { getContactLinks } from '../features/landing/contact'
import heroImage from '../assets/landing-hero.webp'
import spaceImage from '../assets/partnership-space.webp'
import orangeImage from '../assets/orange-mark.webp'
import './LandingPage.css'

const sections = [['#giai-phap', 'Giải pháp'], ['#cach-hoat-dong', 'Cách hoạt động'], ['#hop-tac', 'Hợp tác']] as const
const steps: readonly { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Apple, title: 'Chọn trái cây', text: 'Tìm món yêu thích và lựa chọn ngay trên màn hình của máy.' },
  { icon: QrCode, title: 'Thanh toán QR', text: 'Quét mã thanh toán cho sản phẩm bạn vừa chọn.' },
  { icon: ShoppingBag, title: 'Nhận sản phẩm', text: 'Chờ máy nhả hàng, nhận sản phẩm tại khay bên dưới.' },
]
const questions = [
  ['Fruit Vending là gì?', 'Fruit Vending là dự án hệ thống máy bán trái cây tự động, kết hợp màn hình chọn hàng, thanh toán QR và công cụ quản lý tập trung. Giải pháp đang trong quá trình phát triển.'],
  ['Tôi có thể trao đổi về việc đặt máy ở đâu?', 'Bạn có thể đề xuất không gian như văn phòng, khu dân cư hoặc khuôn viên trường học. Vị trí và điều kiện lắp đặt cần được trao đổi cụ thể cho từng địa điểm.'],
  ['Ai sử dụng trang quản lý?', 'Trang quản lý dành cho admin và staff có tài khoản được cấp. Bạn có thể truy cập qua nút “Đăng nhập quản lý” trên đầu trang.'],
] as const

/** Approved landing tokens that index.css does not have: divider line and the deep green band (process strip, footer). */
const ROOT = 'landing scheme-light bg-(--surface) text-(--ink) [--landing-dark:oklch(0.29_0.048_160)] [--landing-line:oklch(0.885_0.025_155)]'
const SERIF = "font-['Source_Serif_4',Georgia,serif] font-semibold tracking-[-0.04em]"
const H2 = `${SERIF} text-[clamp(32px,3.2vw,48px)] leading-[1.15]`
const H3 = 'text-[21px] leading-[1.35] font-[650] tracking-[-0.02em]'
const TEXT = 'leading-[1.7]'
const SECTION = 'mx-auto w-[calc(100%-40px)] min-[641px]:w-[calc(100%-64px)] min-[961px]:w-[min(1200px,calc(100%-96px))]'
const SECTION_SPACE = 'py-[clamp(64px,7vw,104px)]'
const ANCHOR = 'scroll-mt-[90px] min-[641px]:scroll-mt-[110px]'
const TWO_COLUMNS = 'flex flex-col gap-8 min-[641px]:grid min-[641px]:grid-cols-2 min-[641px]:gap-10 min-[961px]:gap-14 min-[1181px]:gap-[100px]'
/** Visible focus on links and summaries: 3px brand ring, as before. On the dark band the ring is white (ON_DARK). */
const FOCUS = 'rounded-[3px] outline-none focus-visible:outline-3 focus-visible:outline-offset-[5px] focus-visible:outline-solid focus-visible:outline-(--brand)'
const ON_DARK = 'focus-visible:outline-white'
const LINK = 'transition-colors duration-180 ease-out hover:text-(--brand) motion-reduce:transition-none'
const TEXT_LINK = `group inline-flex min-h-11 items-center gap-2.5 text-sm font-semibold underline-offset-[5px] hover:underline ${FOCUS}`
/** Primary CTA: the shared Button rendered as a link, in the approved brand green (not --ui-primary, which flips in dark). */
const CTA = 'group h-auto min-h-[52px] gap-2.5 rounded-[6px] border border-(--brand) bg-(--brand) px-[18px] py-3.5 text-sm leading-[1.4] font-semibold text-(--surface) shadow-none transition-[background-color,border-color,transform] duration-200 hover:border-(--brand-hover) hover:bg-(--brand-hover) motion-reduce:transition-none min-[641px]:gap-4 min-[641px]:px-6 min-[641px]:text-[15px] focus-visible:ring-0 focus-visible:outline-3 focus-visible:outline-offset-[5px] focus-visible:outline-solid focus-visible:outline-(--brand)'
const CTA_ARROW = 'size-5 transition-transform duration-200 group-hover:translate-x-[3px] motion-reduce:transition-none'
const ARRIVE = 'motion-safe:animate-in motion-safe:ease-out'

function Brand({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return <a className={cn('inline-flex shrink-0 items-center gap-1 text-[21px] font-[750] tracking-[-1px] whitespace-nowrap max-[359px]:text-[19px] min-[641px]:gap-2 min-[641px]:text-[25px]', FOCUS, className)} href="/" aria-label="Fruit Vending — Trang chủ">
    <Leaf className={cn('size-[25px] max-[359px]:size-[22px] min-[641px]:size-[30px]', iconClassName)} strokeWidth={1.6} aria-hidden="true" /><span>Fruit Vending</span>
  </a>
}

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

  return <div className={ROOT}>
    <a className="fixed top-2 left-4 z-30 -translate-y-[150%] bg-(--ink) p-3.5 text-white outline-none focus:translate-y-0 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-(--brand)" href="#noi-dung">Đến nội dung chính</a>
    <header className="sticky top-0 z-20 border-b border-[oklch(0.95_0.008_155)] bg-(--surface)" ref={headerRef}>
      <div className="mx-auto flex min-h-[72px] w-[calc(100%-32px)] items-center justify-between gap-2 max-[359px]:w-[calc(100%-24px)] min-[641px]:min-h-[76px] min-[641px]:w-[calc(100%-48px)] min-[641px]:gap-6 min-[961px]:min-h-[88px] min-[961px]:justify-start min-[1181px]:w-[min(1320px,calc(100%-80px))] min-[1181px]:gap-10">
        <Brand iconClassName="text-(--brand)" />
        <nav className="ml-auto hidden gap-[18px] min-[961px]:flex min-[1181px]:gap-7" aria-label="Điều hướng chính">
          {sections.map(([href, label]) => <a key={href} className={cn('inline-flex min-h-11 items-center text-sm font-[550]', LINK, FOCUS)} href={href}>{label}</a>)}
        </nav>
        <div className="flex items-center gap-1 min-[641px]:gap-5 min-[961px]:gap-[18px] min-[1181px]:gap-6">
          <a className={cn('inline-flex min-h-11 items-center px-1.5 text-xs font-[550] max-[359px]:px-[3px] max-[359px]:text-[11px] min-[641px]:px-0 min-[641px]:text-sm', LINK, FOCUS)} href="/login">Đăng nhập<span className="hidden min-[641px]:inline">&nbsp;quản lý</span></a>
          <Button asChild className={cn(CTA, 'hidden min-h-11 px-4 py-[11px] text-[13px] min-[641px]:px-4 min-[641px]:text-[13px] min-[961px]:inline-flex')}>
            <a href="#hop-tac">Hợp tác đặt máy <ArrowRight className="size-[17px] max-[1180px]:hidden" strokeWidth={1.6} aria-hidden="true" /></a>
          </Button>
          <Button variant="ghost" size="icon" type="button" ref={menuButton} className="size-11 rounded-[5px] text-(--ink) hover:bg-(--identity) hover:text-(--ink) min-[961px]:hidden"
            aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="size-6" strokeWidth={1.6} aria-hidden="true" /> : <Menu className="size-6" strokeWidth={1.6} aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <nav className="border-t border-(--landing-line) px-6 pt-3 pb-5 min-[961px]:hidden" id="mobile-navigation" aria-label="Điều hướng điện thoại" hidden={!menuOpen}>
        {sections.map(([href, label]) => <a key={href} className={cn('flex items-center justify-between py-3.5 text-[17px]', LINK, FOCUS)} href={href} onClick={() => setMenuOpen(false)}>{label}<ArrowRight className="size-6" strokeWidth={1.6} aria-hidden="true" /></a>)}
      </nav>
    </header>

    <main id="noi-dung" tabIndex={-1}>
      <section className={cn(SECTION, 'relative flex flex-col items-stretch pt-6 pb-5 min-[641px]:grid min-[641px]:min-h-[570px] min-[641px]:grid-cols-[49%_51%] min-[641px]:items-center min-[641px]:py-7 min-[961px]:min-h-[590px] min-[961px]:grid-cols-[46%_54%] min-[961px]:pt-10 min-[961px]:pb-8 min-[1181px]:min-h-[690px]')} aria-labelledby="hero-title">
        <div className={cn('relative z-1 pt-4 min-[641px]:py-6', ARRIVE, 'motion-safe:slide-in-from-bottom-2 motion-safe:duration-[450ms]')}>
          <p className={cn('flex items-center gap-2.5 pb-[22px] text-xs text-(--muted) max-[359px]:text-[11px] min-[961px]:pb-[26px] min-[961px]:text-[13px]', TEXT)}><span className="size-[7px] rounded-full bg-(--brand)" aria-hidden="true" /> Một lựa chọn tươi mới, mỗi ngày</p>
          <h1 id="hero-title" className={cn(SERIF, 'text-[clamp(43px,10.2vw,62px)] leading-[1.08] min-[641px]:text-[clamp(44px,6vw,60px)] min-[961px]:text-[clamp(48px,5.3vw,76px)]')}>Trái cây tươi.<br /><span className="text-(--brand)">Gần bạn hơn.</span></h1>
          <p className={cn('max-w-[36ch] pt-[22px] text-base text-(--muted) min-[641px]:pt-7 min-[641px]:text-[17px] min-[961px]:text-[19px]', TEXT)}>Giải pháp máy bán trái cây tự động cho không gian làm việc và sinh hoạt.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3 max-[359px]:flex-col max-[359px]:items-start max-[359px]:gap-2 min-[641px]:mt-[30px] min-[641px]:flex-col min-[641px]:items-start min-[641px]:gap-2 min-[961px]:flex-row min-[961px]:items-center min-[961px]:gap-3 min-[1181px]:gap-5">
            <Button asChild className={CTA}><a href="#hop-tac">Hợp tác đặt máy <ArrowRight className={CTA_ARROW} strokeWidth={1.6} aria-hidden="true" /></a></Button>
            <a className={cn(TEXT_LINK, 'text-[13px] min-[641px]:text-sm')} href="#giai-phap">Khám phá giải pháp <ArrowUpRight className="size-[18px]" strokeWidth={1.6} aria-hidden="true" /></a>
          </div>
          <p className={cn(SERIF, 'hidden pt-7 text-base font-normal tracking-normal text-(--muted) italic min-[641px]:block min-[961px]:pt-12 min-[961px]:text-lg', TEXT)}>Một khoảng nghỉ nhỏ.<br />Một chút tươi mới cho ngày dài.</p>
        </div>
        <figure className={cn('mt-3 w-[min(420px,100%)] self-center min-[641px]:mt-0 min-[641px]:-mr-4 min-[641px]:w-auto min-[641px]:self-auto min-[961px]:-mr-3 min-[961px]:-ml-3 min-[1181px]:-mr-6', ARRIVE, 'motion-safe:slide-in-from-bottom-3 motion-safe:duration-[650ms]')}>
          <img className="block h-auto max-h-[390px] w-full object-contain min-[641px]:max-h-none" src={heroImage} width="1254" height="1254" alt="Minh họa ý tưởng máy Fruit Vending bên cạnh đu đủ, dưa hấu, cam và kiwi." fetchPriority="high" />
          <figcaption className="text-center text-[11px] text-(--muted) min-[641px]:text-right min-[641px]:text-[10px] min-[961px]:pr-5 min-[961px]:text-[11px]">Hình ảnh minh họa ý tưởng sản phẩm</figcaption>
        </figure>
      </section>

      <section className={cn('bg-(--landing-dark) py-12 text-(--surface) min-[641px]:pt-16 min-[641px]:pb-[72px]', ANCHOR)} id="cach-hoat-dong" aria-labelledby="purchase-title">
        <div className={SECTION}>
          <div className="text-left min-[641px]:text-center">
            <h2 id="purchase-title" className={H2}>Từ lựa chọn<br className="min-[641px]:hidden" /> đến nhận hàng.</h2>
            <p className={cn('pt-4 text-[15px] text-[oklch(0.86_0.023_153)] min-[641px]:text-base', TEXT)}>Một trải nghiệm mua hàng được thiết kế để thật đơn giản.</p>
          </div>
          <ol className="mt-8 flex list-none flex-col gap-7 p-0 min-[641px]:mt-11 min-[641px]:flex-row min-[641px]:gap-6 min-[961px]:gap-16">
            {steps.map((step, index) => <li key={step.title} className="relative grid grid-cols-[70px_1fr] gap-x-[18px] text-left min-[641px]:block min-[641px]:flex-1 min-[641px]:text-center min-[641px]:not-last:after:absolute min-[641px]:not-last:after:top-8 min-[641px]:not-last:after:left-[calc(50%+80px)] min-[641px]:not-last:after:h-px min-[641px]:not-last:after:w-[calc(100%-115px)] min-[641px]:not-last:after:bg-[oklch(0.7_0.07_153/0.5)] min-[641px]:not-last:after:content-[''] min-[961px]:not-last:after:w-[calc(100%-90px)]">
              <div className="row-span-2 flex flex-col-reverse justify-end gap-2 min-[641px]:mb-[22px] min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-center min-[641px]:gap-[18px]">
                <span className="text-[11px] text-[oklch(0.83_0.075_150)] tabular-nums min-[641px]:text-[13px]">0{index + 1}</span>
                <span className="grid size-14 place-items-center rounded-full bg-(--identity) text-(--ink) min-[641px]:size-16"><step.icon className="size-7" strokeWidth={1.6} aria-hidden="true" /></span>
              </div>
              <h3 className={cn(SERIF, 'pt-1 text-2xl leading-[1.35] tracking-[-0.02em] min-[641px]:pt-0 min-[641px]:text-[25px]')}>{step.title}</h3>
              <p className={cn('max-w-[32ch] pt-2 text-[15px] text-[oklch(0.9_0.013_153)] min-[641px]:mx-auto! min-[641px]:max-w-[29ch] min-[641px]:pt-3 min-[641px]:text-sm min-[961px]:text-[15px]', TEXT)}>{step.text}</p>
            </li>)}
          </ol>
        </div>
      </section>

      <section className={cn(SECTION, SECTION_SPACE, TWO_COLUMNS, ANCHOR)} id="giai-phap" aria-labelledby="solution-title">
        <div>
          <span className="mb-[22px] block text-sm font-semibold text-(--brand)">Giải pháp Fruit Vending</span>
          <h2 id="solution-title" className={H2}>Tiện cho người mua.<br />Gọn cho người quản lý.</h2>
          <p className={cn('max-w-[42ch] pt-6 text-base text-(--muted) min-[641px]:text-[17px]', TEXT)}>Từ thao tác tại máy đến công việc vận hành, mọi phần được thiết kế để kết nối trong cùng một hệ thống.</p>
          <span className="mt-7 inline-block rounded-[20px] border border-(--landing-line) px-3 py-1.5 text-xs text-(--muted)">Giải pháp đang được phát triển</span>
        </div>
        <div>
          {[
            ['Chọn hàng ngay tại máy', 'Màn hình kiosk giúp người mua xem sản phẩm, lựa chọn và theo dõi các bước mua hàng.'],
            ['Thanh toán, rồi nhận hàng', 'Quy trình kết nối thanh toán QR với bộ điều khiển để nhả đúng sản phẩm đã chọn.'],
            ['Một nơi để quản lý', 'Web quản trị hướng tới quản lý máy, sản phẩm, tồn kho và giao dịch dành cho admin và staff.'],
          ].map(([title, text], index, all) => <article key={title} className="flex gap-[22px] border-b border-(--landing-line) py-[22px] first:pt-2 last:border-b-0 last:pb-0 min-[641px]:py-[26px] min-[641px]:first:pt-0 min-[641px]:last:pb-0">
            <div>
              <h3 className={cn(H3, 'text-xl min-[641px]:text-[19px] min-[961px]:text-[21px]')}>{title}</h3>
              <p className={cn('max-w-[48ch] pt-2.5 text-[15px] text-(--muted)', TEXT)}>{text}</p>
              {index === all.length - 1 && <a className={cn(TEXT_LINK, 'mt-2.5 text-(--brand)')} href="/login">Đến trang đăng nhập <ArrowRight className="size-[18px]" strokeWidth={1.6} aria-hidden="true" /></a>}
            </div>
          </article>)}
        </div>
      </section>

      <section className={cn('bg-(--identity) py-11 min-[641px]:py-[68px]', ANCHOR)} id="hop-tac" aria-labelledby="partnership-title">
        <div className={cn(SECTION, 'flex flex-col items-stretch gap-8 min-[641px]:grid min-[641px]:grid-cols-[44%_minmax(0,1fr)] min-[641px]:items-center min-[641px]:gap-8 min-[1181px]:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] min-[1181px]:gap-12')}>
          <div className="py-4">
            <span className="mb-[22px] block text-sm font-semibold text-(--brand)">Cùng đưa trái cây đến gần hơn</span>
            <h2 id="partnership-title" className={cn(SERIF, 'text-[44px] leading-[1.15] min-[641px]:text-[clamp(42px,4.4vw,64px)]')}>Một góc nhỏ.<br />Thêm nhiều <br className="max-[640px]:hidden" />tươi mới.</h2>
            <p className={cn('max-w-[40ch] pt-6 pb-7 text-base text-(--muted) min-[641px]:text-[17px]', TEXT)}>Bạn có một không gian phù hợp? Cùng trao đổi về ý tưởng đặt máy tại nơi làm việc, khu dân cư hoặc khuôn viên của bạn.</p>
            <Button asChild className={CTA}><a href="#lien-he">Trao đổi hợp tác <ArrowRight className={CTA_ARROW} strokeWidth={1.6} aria-hidden="true" /></a></Button>
            <ul className="mt-8 flex list-none flex-wrap gap-2 p-0" aria-label="Không gian có thể đề xuất">
              {['Văn phòng', 'Khu dân cư', 'Trường học'].map(place => <li key={place} className="rounded-[20px] border border-[oklch(0.8_0.03_155)] px-3 py-[7px] text-xs text-(--muted)">{place}</li>)}
            </ul>
          </div>
          <figure className="relative min-w-0">
            <img className="block aspect-[1.2] h-auto max-h-[420px] w-full rounded-[48%_48%_6px_6px] object-cover min-[641px]:aspect-[1.12] min-[641px]:max-h-none" src={spaceImage} width="1448" height="1086" alt="Minh họa không gian sinh hoạt chung sáng thoáng với bàn ghế và cây xanh." loading="lazy" decoding="async" />
            <figcaption className="mt-3.5 text-right text-xs text-(--muted)">Một ý tưởng cho không gian của bạn</figcaption>
          </figure>
        </div>
      </section>

      <section className={cn(SECTION, SECTION_SPACE, TWO_COLUMNS, 'items-stretch min-[641px]:items-center', ANCHOR)} id="lien-he" aria-labelledby="contact-title">
        <div>
          <h2 id="contact-title" className={H2}>Bắt đầu từ<br />một cuộc trò chuyện.</h2>
          <p className={cn('max-w-[40ch] pt-5 text-base text-(--muted) min-[641px]:text-[17px]', TEXT)}>Chia sẻ địa điểm dự kiến và nhu cầu của bạn để cùng tìm hướng hợp tác phù hợp.</p>
        </div>
        <div className="border-t border-(--landing-line) pt-6 min-[641px]:border-t-0 min-[641px]:border-l min-[641px]:py-7 min-[641px]:pl-10">
          {contact.email || contact.phone
            ? <>
              <h3 className={H3}>Liên hệ hợp tác</h3>
              {contact.email && <a className={cn('mt-[18px] flex min-h-[54px] items-center gap-3.5 border-b border-(--landing-line) py-3.5', LINK, FOCUS)} href={contact.email.href}><Mail className="size-5 shrink-0" strokeWidth={1.6} aria-hidden="true" /><span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{contact.email.label}</span><ArrowRight className="size-5 shrink-0" strokeWidth={1.6} aria-hidden="true" /></a>}
              {contact.phone && <a className={cn('flex min-h-[54px] items-center gap-3.5 border-b border-(--landing-line) py-3.5', !contact.email && 'mt-[18px]', LINK, FOCUS)} href={contact.phone.href}><Phone className="size-5 shrink-0" strokeWidth={1.6} aria-hidden="true" /><span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{contact.phone.label}</span><ArrowRight className="size-5 shrink-0" strokeWidth={1.6} aria-hidden="true" /></a>}
              <p className={cn('pt-4 text-[15px] text-(--muted)', TEXT)}>Vui lòng cho biết tên liên hệ, địa điểm và cách liên lạc thuận tiện với bạn.</p>
            </>
            : <>
              <img className="mb-4 block object-contain" src={orangeImage} width="88" height="66" alt="" loading="lazy" />
              <h3 className={H3}>Hẹn gặp bạn tại đây.</h3>
              <p className={cn('pt-2 text-[15px] text-(--muted)', TEXT)}>Kênh liên hệ hợp tác đang được cập nhật. Thông tin sẽ được công bố ngay tại mục này.</p>
            </>}
        </div>
      </section>

      <section className={cn(SECTION, TWO_COLUMNS, 'pb-[clamp(64px,7vw,104px)]')} aria-labelledby="faq-title">
        <h2 id="faq-title" className={cn(SERIF, 'text-[32px] leading-[1.15] min-[641px]:max-w-[14ch] min-[641px]:text-4xl')}>Có thể bạn đang thắc mắc.</h2>
        <div>
          {questions.map(([question, answer]) => <details key={question} className="group border-b border-(--landing-line) first:border-t">
            <summary className={cn('flex min-h-[70px] cursor-pointer list-none items-center justify-between gap-6 py-5 text-[15px] font-semibold min-[641px]:text-base [&::-webkit-details-marker]:hidden', FOCUS)}>
              {question}<Plus className="size-5 shrink-0 transition-transform duration-200 ease-out group-open:rotate-45 motion-reduce:transition-none" strokeWidth={1.6} aria-hidden="true" />
            </summary>
            <p className={cn('max-w-[55ch] pb-6 text-[15px] text-(--muted)', TEXT, 'group-open:motion-safe:animate-in group-open:motion-safe:slide-in-from-bottom-2 group-open:motion-safe:duration-180 group-open:motion-safe:ease-out')}>{answer}</p>
          </details>)}
        </div>
      </section>
    </main>

    <footer className="bg-(--landing-dark) text-(--surface)">
      <div className={cn(SECTION, 'flex flex-col items-start gap-7 py-12 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between min-[641px]:gap-12')}>
        <div>
          <Brand className={ON_DARK} iconClassName="text-[oklch(0.85_0.06_150)]" />
          <p className={cn('pt-3.5 text-sm text-[oklch(0.87_0.02_153)]', TEXT)}>Trái cây tươi. Gần bạn hơn.</p>
        </div>
        <nav className="flex flex-col gap-1 min-[641px]:flex-row min-[641px]:gap-5 min-[961px]:gap-8" aria-label="Điều hướng cuối trang">
          {[['#giai-phap', 'Giải pháp'], ['#hop-tac', 'Hợp tác đặt máy'], ['/login', 'Đăng nhập quản lý']].map(([href, label]) => <a key={href} className={cn('inline-flex min-h-11 items-center gap-3 text-sm transition-colors duration-180 ease-out hover:text-[oklch(0.85_0.06_150)] motion-reduce:transition-none', FOCUS, ON_DARK)} href={href}>
            {label}{href === '/login' && <ArrowRight className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />}
          </a>)}
        </nav>
      </div>
      <div className={cn(SECTION, 'flex flex-col gap-2 border-t border-[oklch(0.45_0.045_155)] py-[22px] text-xs text-[oklch(0.83_0.025_153)] min-[641px]:flex-row min-[641px]:justify-between min-[641px]:gap-5')}>
        <span>© {new Date().getFullYear()} Fruit Vending</span><span>Hệ thống máy bán trái cây tự động</span>
      </div>
    </footer>
  </div>
}
