import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { login } from '../features/auth/auth'
import { getSession, safeNext } from '../api/session'
import { homeFor } from '../admin/routes'
import { navigate } from '../lib/router'
import fruitStillLife from '../assets/fruit-still-life.webp'
import orangeMark from '../assets/orange-mark.webp'
import '../App.css'

function EyeIcon({ visible }: { visible: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
    {visible && <path d="m3 3 18 18" />}
  </svg>
}

function nextTarget(roles: Parameters<typeof homeFor>[0]) {
  const next = new URLSearchParams(window.location.search).get('next')
  return next ? safeNext(next) : homeFor(roles)
}

function LoginPage() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [errors, setErrors] = useState({ identifier: '', password: '' })
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  useEffect(() => () => requestRef.current?.abort(), [])
  useEffect(() => { if (message) feedbackRef.current?.focus() }, [message])
  useEffect(() => {
    const session = getSession()
    if (session) navigate(nextTarget(session.user.roles), { replace: true })
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requestRef.current) return
    const nextErrors = {
      identifier: identifier.trim() ? '' : 'Vui lòng nhập email.',
      password: password ? '' : 'Vui lòng nhập mật khẩu.',
    }
    setErrors(nextErrors)
    setMessage('')
    if (nextErrors.identifier || nextErrors.password) {
      (nextErrors.identifier ? identifierRef : passwordRef).current?.focus()
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    setPending(true)
    try {
      const session = await login(identifier, password, controller.signal)
      if (!controller.signal.aborted) { setPassword(''); setVisible(false); navigate(nextTarget(session.user.roles), { replace: true }) }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Không thể đăng nhập. Vui lòng thử lại.')
    } finally {
      requestRef.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <main className="login-page">
      <a className="login-back" href="/">← Về trang giới thiệu</a>
      <section className="identity-panel" aria-label="Fruit Vending">
        <span className="wordmark">Fruit Vending<span className="brand-dot" aria-hidden="true">.</span></span>
        <div className="identity-copy">
          <h2>Vận hành<br />gọn gàng.</h2>
          <p>Quản lý máy, hàng hóa và giao dịch<br className="desktop-break" /> trong một không gian.</p>
        </div>
        <img className="fruit-illustration" src={fruitStillLife} alt="" fetchPriority="high" />
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <header className="mobile-brand">
          <span className="wordmark">Fruit Vending<span className="brand-dot" aria-hidden="true">.</span></span>
          <img src={orangeMark} width="100" height="90" alt="" />
        </header>
        <div className="login-content">
          <>
            <div className="form-heading"><h1 id="login-title">Đăng nhập</h1><p>Dành cho admin và staff</p></div>
            <form onSubmit={handleSubmit} noValidate aria-busy={pending}>
              <div className="form-field">
                <label htmlFor="identifier">Email</label>
                <input ref={identifierRef} id="identifier" name="username" type="email" autoComplete="username"
                  autoCapitalize="none" spellCheck={false} required readOnly={pending}
                  placeholder="Nhập email" value={identifier}
                  aria-invalid={!!errors.identifier} aria-describedby={errors.identifier ? 'identifier-error' : undefined}
                  onChange={event => { setIdentifier(event.target.value); setErrors(previous => ({ ...previous, identifier: '' })); setMessage('') }}
                  onBlur={() => { if (!identifier.trim()) setErrors(previous => ({ ...previous, identifier: 'Vui lòng nhập email.' })) }} />
                <p className="field-error" id="identifier-error">{errors.identifier}</p>
              </div>
              <div className="form-field">
                <label htmlFor="password">Mật khẩu</label>
                <div className="password-control">
                  <input ref={passwordRef} id="password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password"
                    required readOnly={pending} placeholder="Nhập mật khẩu" value={password}
                    aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined}
                    onChange={event => { setPassword(event.target.value); setErrors(previous => ({ ...previous, password: '' })); setMessage('') }}
                    onBlur={() => { if (!password) setErrors(previous => ({ ...previous, password: 'Vui lòng nhập mật khẩu.' })) }} />
                  <button className="password-toggle" type="button" aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    aria-pressed={visible} aria-controls="password" onClick={() => setVisible(previous => !previous)}><EyeIcon visible={visible} /></button>
                </div>
                <p className="field-error" id="password-error">{errors.password}</p>
              </div>
              {message && <div className="form-feedback" ref={feedbackRef} tabIndex={-1} role="alert">{message}</div>}
              <button className="submit-button" type="submit" disabled={pending}>
                <span>{pending ? 'Đang đăng nhập…' : 'Đăng nhập'}</span>
                {pending ? <span className="loading-indicator" aria-hidden="true" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>}
              </button>
              <span className="sr-only" role="status">{pending ? 'Đang xác thực tài khoản. Vui lòng chờ.' : ''}</span>
            </form>
            <p className="login-note">Sử dụng tài khoản được cấp để truy cập hệ thống.</p>
          </>
        </div>
      </section>
    </main>
  )
}
export default LoginPage

