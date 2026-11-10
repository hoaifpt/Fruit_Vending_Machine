import { ArrowRight, CircleAlert, Info, LoaderCircle, Moon, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { describeLoginError, login, LoginError, returnTarget, validateLogin } from '../features/auth/auth'
import type { LoginFailure, LoginFieldErrors } from '../features/auth/auth'
import { getSession } from '../api/session'
import { homeFor } from '../admin/routes'
import { navigate } from '../lib/router'
import { useTheme } from '../lib/theme'
import { Button } from '../components/ui/button'
import { FormField } from '../components/ui/form-field'
import { Input } from '../components/ui/input'
import { PasswordInput } from '../components/ui/password-input'
import fruitStillLife from '../assets/fruit-still-life.webp'
import orangeMark from '../assets/orange-mark.webp'

// Approved palette (docs/login-brief.md): ink #19392B and the pale green identity panel in light mode;
// dark mode falls back to the shared --ui-* tokens. Breakpoints follow DESIGN.md (one column at 760px and below).
// index.css resets margins on h1/h2/p outside any layer, so spacing on those elements uses padding.
const INK = 'text-[oklch(0.316_0.05_163)] dark:text-foreground'
const IDENTITY_BG = 'bg-[oklch(0.964_0.012_155)]'
const FIELD = 'gap-2.5 [&>label]:text-[15px] [&>label]:font-semibold'
const CONTROL = 'h-[54px] rounded-lg px-4 text-base border-[oklch(0.66_0.035_157)] dark:border-[oklch(0.55_0.02_160)] hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-primary'

function Wordmark({ className }: { className?: string }) {
  return <span className={`font-[720] tracking-[-1px] whitespace-nowrap ${className ?? ''}`}>Fruit Vending<span className="text-primary" aria-hidden="true">.</span></span>
}

function ThemeToggle() {
  const { resolved, setTheme } = useTheme()
  const dark = resolved === 'dark'
  return <Button variant="ghost" size="icon" aria-label={dark ? 'Dùng giao diện sáng' : 'Dùng giao diện tối'} title={dark ? 'Giao diện sáng' : 'Giao diện tối'}
    onClick={() => setTheme(dark ? 'light' : 'dark')} className="size-11 text-muted-foreground hover:text-foreground">
    {dark ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
  </Button>
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<LoginFieldErrors>({})
  const [formError, setFormError] = useState('')
  /** Bumped on every failed attempt: re-mounts the alert so an identical message is announced again, and moves focus. */
  const [attempt, setAttempt] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [returnTo] = useState(() => returnTarget(window.location.search))
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const focusAfter = useRef<LoginFailure['focus'] | null>(null)

  useEffect(() => () => requestRef.current?.abort(), [])
  useEffect(() => {
    const session = getSession()
    if (session) navigate(returnTo ?? homeFor(session.user.roles), { replace: true })
    else emailRef.current?.focus({ preventScroll: true })
  }, [returnTo])
  useEffect(() => {
    const target = focusAfter.current
    if (!target) return
    focusAfter.current = null
    if (target === 'form') { feedbackRef.current?.focus(); return }
    const input = (target === 'email' ? emailRef : passwordRef).current
    input?.focus()
    input?.select()
  }, [attempt])

  function fail(failure: LoginFailure) {
    setErrors(failure.fieldErrors)
    setFormError(failure.message)
    focusAfter.current = failure.focus
    setAttempt(value => value + 1)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requestRef.current) return
    setSubmitted(true)
    setFormError('')
    const fieldErrors = validateLogin(email, password)
    if (fieldErrors.email || fieldErrors.password) { fail({ message: '', fieldErrors, focus: fieldErrors.email ? 'email' : 'password' }); return }
    setErrors({})
    const controller = new AbortController()
    requestRef.current = controller
    setPending(true)
    try {
      const session = await login(email, password, controller.signal)
      if (controller.signal.aborted) return
      setPassword('')
      navigate(returnTo ?? homeFor(session.user.roles), { replace: true })
    } catch (error) {
      if (!controller.signal.aborted) fail(error instanceof LoginError ? error.failure : describeLoginError(error))
    } finally {
      requestRef.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  /** After the first submit, leaving a field re-checks it; before that, tabbing through never raises errors. */
  function recheck(field: 'email' | 'password') {
    if (!submitted) return
    const message = validateLogin(email, password)[field]
    setErrors(previous => (previous[field] === message ? previous : { ...previous, [field]: message }))
  }

  return (
    <main className={`relative min-h-svh bg-card min-[761px]:grid min-[761px]:grid-cols-[45%_55%] ${INK}`}>
      <div className="flex items-center justify-between gap-4 px-4 pt-2 min-[761px]:absolute min-[761px]:inset-x-0 min-[761px]:top-0 min-[761px]:z-10 min-[761px]:px-6 min-[761px]:pt-2">
        <a href="/" className="inline-flex min-h-11 items-center rounded-sm px-2 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-primary">
          <span aria-hidden="true">←&nbsp;</span>Về trang giới thiệu
        </a>
        <ThemeToggle />
      </div>

      <section aria-label="Fruit Vending" className={`relative hidden flex-col overflow-hidden px-8 pt-14 min-[761px]:flex min-[1101px]:px-14 min-[1600px]:px-20 ${IDENTITY_BG} dark:bg-accent`}>
        <Wordmark className="text-[25px]" />
        <div className="relative z-1 mt-[90px] min-[1101px]:mt-[100px] min-[1600px]:mt-[120px]">
          <h2 className="text-[46px] leading-[1.12] font-bold tracking-[-2px] text-balance min-[1101px]:text-[56px]">Vận hành<br />gọn gàng.</h2>
          <p className="max-w-[38ch] pt-6 text-[17px] leading-[1.6] text-muted-foreground min-[1101px]:text-[19px]">
            Quản lý máy, hàng hóa và giao dịch<br className="hidden min-[1101px]:inline" /> trong một không gian.
          </p>
        </div>
        {/* The illustration has a white background: multiply blends it into its own pale plate (isolated), which is
            the panel colour in light mode and a rounded card in dark mode. */}
        <div className={`isolate mt-auto w-[calc(100%+80px)] max-w-[620px] self-center pt-6 min-[1600px]:max-w-[700px] ${IDENTITY_BG} dark:mb-10 dark:w-full dark:rounded-2xl dark:px-4 dark:pb-4`}>
          <img className="block aspect-[1.28] h-auto w-full object-contain mix-blend-multiply" src={fruitStillLife} alt="" fetchPriority="high" />
        </div>
      </section>

      <section aria-labelledby="login-title" className="px-6 pt-4 pb-10 min-[761px]:flex min-[761px]:items-center min-[761px]:justify-center min-[761px]:px-8 min-[761px]:py-16 min-[1101px]:px-12">
        <header className="mx-auto mb-10 flex min-h-20 w-full max-w-[440px] items-center justify-between gap-4 min-[761px]:hidden">
          <Wordmark className="text-[21px] min-[371px]:text-[23px]" />
          <span className="isolate shrink-0 rounded-2xl dark:bg-[oklch(0.964_0.012_155)] dark:p-1.5">
            <img src={orangeMark} width="100" height="90" alt="" className="block h-[76px] w-[76px] object-contain mix-blend-multiply min-[371px]:h-[90px] min-[371px]:w-[100px]" />
          </span>
        </header>
        <div className="mx-auto w-full max-w-[440px] min-[761px]:max-w-[400px]">
          <div className="mb-[34px] min-[761px]:mb-[38px]">
            <h1 id="login-title" className="text-[32px] leading-[1.2] font-bold tracking-[-1px] min-[761px]:text-[36px]">Đăng nhập</h1>
            <p className="pt-2.5 text-[17px] leading-normal text-muted-foreground min-[761px]:text-lg">Dành cho admin và staff</p>
          </div>

          {returnTo && <div className="mb-6 flex gap-3 rounded-lg bg-status-info px-4 py-3 text-sm leading-normal text-status-info-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Phiên đăng nhập đã hết hạn hoặc bạn chưa đăng nhập. Đăng nhập lại để quay về trang đang xem.</span>
          </div>}

          <form onSubmit={handleSubmit} noValidate aria-busy={pending} className="flex flex-col gap-5">
            <FormField label="Email" error={errors.email} className={FIELD}>
              <Input ref={emailRef} id="login-email" name="username" type="email" inputMode="email" autoComplete="username"
                autoCapitalize="none" spellCheck={false} readOnly={pending} placeholder="Nhập email" value={email} className={CONTROL}
                onChange={event => { setEmail(event.target.value); setErrors(previous => ({ ...previous, email: undefined })); setFormError('') }}
                onBlur={() => recheck('email')} />
            </FormField>
            <FormField label="Mật khẩu" error={errors.password} className={FIELD}>
              <PasswordInput ref={passwordRef} id="login-password" name="password" autoComplete="current-password"
                readOnly={pending} placeholder="Nhập mật khẩu" value={password} className={CONTROL}
                aria-describedby={formError ? 'login-form-error' : undefined}
                onChange={event => { setPassword(event.target.value); setErrors(previous => ({ ...previous, password: undefined })); setFormError('') }}
                onBlur={() => recheck('password')} />
            </FormField>

            {formError && <div key={attempt} ref={feedbackRef} id="login-form-error" tabIndex={-1} role="alert"
              className="flex gap-3 rounded-lg border border-destructive bg-status-danger px-4 py-3.5 text-sm leading-normal text-status-danger-foreground animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>}

            <Button type="submit" disabled={pending}
              className="group mt-1 h-[54px] w-full gap-3.5 rounded-lg bg-[oklch(0.316_0.05_163)] text-base font-semibold text-white hover:bg-[oklch(0.44_0.081_154)] disabled:bg-[oklch(0.44_0.081_154)] disabled:opacity-100 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/85 dark:disabled:bg-primary/85">
              <span>{pending ? 'Đang đăng nhập…' : 'Đăng nhập'}</span>
              {pending
                ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : <ArrowRight className="size-5 transition-transform duration-150 group-hover:translate-x-[3px] motion-reduce:transition-none" aria-hidden="true" />}
            </Button>
            <span className="sr-only" role="status">{pending ? 'Đang xác thực tài khoản. Vui lòng chờ.' : ''}</span>
          </form>
          <p className="pt-6 text-[13px] leading-[1.6] text-muted-foreground">Sử dụng tài khoản được cấp để truy cập hệ thống.</p>
        </div>
      </section>
    </main>
  )
}
export default LoginPage
