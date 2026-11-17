// Public customer report form (FE 8.2, screen P1 / K-09), opened from the machine's QR on the customer's phone:
// /report/{reportToken}[?order=ORD-…]. No account, mobile first. The token names the machine (GET
// /public/report-forms/{token}: machine, types, photo limits); a wrong or rotated token (404) shows how to get a working
// QR instead of the form. Rules and error mapping live in features/incident/incident.ts; contract in api.yaml
// (backend #74). Every accepted report answers the same receipt, whatever the order.
import { CircleAlert, CircleCheck, ImagePlus, Info, LoaderCircle, Moon, QrCode, RotateCw, Send, Sun, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { publicReportsApi } from '../api/resources'
import type { ReportForm, ReportSubmitted } from '../api/resources'
import { Button } from '../components/ui/button'
import { FormField } from '../components/ui/form-field'
import { Input, Textarea } from '../components/ui/input'
import {
  buildReportForm, CONTACT_NAME_MAX, describeIncidentError, DESCRIPTION_MAX, draftFromSearch, emptyDraft, firstErrorField, formLoadProblem, GONE_MESSAGE,
  limitsOf, megabytes, offeredTypes, photoError, PHOTO_TYPES, thankYouMessage, tokenFromPath, typeOption, validateIncident, waitText,
} from '../features/incident/incident'
import type { FormLoadProblem, IncidentDraft, IncidentFailure, IncidentField, IncidentFieldErrors, Photo, ReportType } from '../features/incident/incident'
import { useTheme } from '../lib/theme'

// Same ink and focus treatment as the login page (DESIGN.md); dark mode uses the shared --ui-* tokens.
const INK = 'text-[oklch(0.316_0.05_163)] dark:text-foreground'
const FIELD = 'gap-2 [&>label]:text-[15px] [&>label]:font-semibold'
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-primary'
const CONTROL = `h-12 rounded-lg px-4 text-base border-[oklch(0.66_0.035_157)] dark:border-[oklch(0.55_0.02_160)] hover:border-primary ${FOCUS}`
const ALERT = 'flex gap-3 rounded-lg border px-4 py-3.5 text-sm leading-normal'
const CARD = 'rounded-xl border bg-card px-5 py-6 shadow-xs'
const PRIMARY = `h-[54px] w-full gap-3 rounded-lg bg-[oklch(0.316_0.05_163)] text-base font-semibold text-white hover:bg-[oklch(0.44_0.081_154)] disabled:bg-[oklch(0.44_0.081_154)] disabled:opacity-100 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/85 dark:disabled:bg-primary/85 ${FOCUS}`

function ThemeToggle() {
  const { resolved, setTheme } = useTheme()
  const dark = resolved === 'dark'
  return <Button variant="ghost" size="icon" aria-label={dark ? 'Dùng giao diện sáng' : 'Dùng giao diện tối'} title={dark ? 'Giao diện sáng' : 'Giao diện tối'}
    onClick={() => setTheme(dark ? 'light' : 'dark')} className="size-11 text-muted-foreground hover:text-foreground">
    {dark ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
  </Button>
}

/** Wall clock for the Retry-After wait (read in event handlers and timers only). */
const clock = () => Date.now()

type Load = { kind: 'loading' } | { kind: 'ready'; form: ReportForm } | FormLoadProblem | { kind: 'missing' }

function IncidentReportPage() {
  const [token] = useState(() => tokenFromPath(window.location.pathname))
  const [load, setLoad] = useState<Load>(() => (token ? { kind: 'loading' } : { kind: 'missing' }))
  const [attemptLoad, setAttemptLoad] = useState(0)

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    publicReportsApi.form(token, controller.signal).then(
      form => { if (!controller.signal.aborted) setLoad({ kind: 'ready', form }) },
      error => { if (!controller.signal.aborted) setLoad(formLoadProblem(error)) },
    )
    return () => controller.abort()
  }, [token, attemptLoad])
  const retry = () => { setLoad({ kind: 'loading' }); setAttemptLoad(value => value + 1) }

  return (
    <main className={`min-h-svh bg-background ${INK}`}>
      <div className="mx-auto flex w-full max-w-[520px] items-center justify-between gap-4 px-4 pt-2">
        <span className="text-[19px] font-[720] tracking-[-0.5px] whitespace-nowrap">Fruit Vending<span className="text-primary" aria-hidden="true">.</span></span>
        <ThemeToggle />
      </div>
      <div className="mx-auto w-full max-w-[520px] px-4 pt-4 pb-12">
        {load.kind === 'ready' ? <ReportFormView token={token} form={load.form} onGone={() => setLoad({ kind: 'gone' })} />
          : load.kind === 'loading' ? <div role="status" className={`${CARD} flex items-center gap-3 text-[16px]`}><LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Đang mở trang báo sự cố của máy…</div>
          : <Problem load={load} retry={retry} />}
      </div>
    </main>
  )
}

function Problem({ load, retry }: { load: Exclude<Load, { kind: 'loading' } | { kind: 'ready' }>; retry: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.focus() }, [load.kind])
  const title = load.kind === 'missing' ? 'Hãy quét mã QR trên máy' : load.kind === 'gone' ? 'Mã QR không còn dùng được' : load.kind === 'busy' ? 'Hệ thống đang bận' : 'Chưa mở được trang báo sự cố'
  const text = load.kind === 'missing'
    ? 'Trang báo sự cố mở từ mã QR dán trên máy bán trái cây (hoặc nút “Báo sự cố” trên màn hình máy), để báo cáo đến đúng máy. Hãy quét lại mã QR đó bằng camera điện thoại.'
    : load.kind === 'gone' ? GONE_MESSAGE
    : load.kind === 'busy' ? waitText(load.retryAfterSeconds)
    : `${load.message} Kiểm tra kết nối mạng rồi thử lại.`
  return <section aria-labelledby="incident-problem" className={CARD} role="alert">
    <QrCode className="size-10 text-primary" aria-hidden="true" />
    <h1 id="incident-problem" ref={headingRef} tabIndex={-1} className={`rounded-sm pt-3 text-[26px] leading-tight font-bold tracking-[-0.5px] ${FOCUS}`}>{title}</h1>
    <p className="pt-3 text-[16px] leading-relaxed">{text}</p>
    {(load.kind === 'busy' || load.kind === 'failed') && <Button type="button" variant="outline" onClick={retry} className={`mt-6 h-12 w-full rounded-lg text-base ${FOCUS}`}><RotateCw aria-hidden="true" />Thử lại</Button>}
  </section>
}

function ReportFormView({ token, form, onGone }: { token: string; form: ReportForm; onGone: () => void }) {
  const limits = limitsOf(form)
  const types = offeredTypes(form)
  const [draft, setDraft] = useState<IncidentDraft>(() => {
    const initial = draftFromSearch(window.location.search)
    return initial.type && !types.some(option => option.value === initial.type) ? { ...initial, type: '' } : initial
  })
  const [errors, setErrors] = useState<IncidentFieldErrors>({})
  const [formError, setFormError] = useState('')
  const [waitUntil, setWaitUntil] = useState(0)
  const [now, setNow] = useState(clock)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [receipt, setReceipt] = useState<ReportSubmitted | null>(null)
  const [previews, setPreviews] = useState<string[]>([])
  const consentId = useId()

  const refs = useRef<Partial<Record<IncidentField, HTMLElement | null>>>({})
  const feedbackRef = useRef<HTMLDivElement>(null)
  const successRef = useRef<HTMLHeadingElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const focusAfter = useRef<IncidentFailure['focus'] | null>(null)
  const previewsRef = useRef<string[]>([])

  useEffect(() => () => requestRef.current?.abort(), [])
  useEffect(() => {
    const target = focusAfter.current
    if (!target) return
    focusAfter.current = null
    if (target === 'form') feedbackRef.current?.focus()
    else refs.current[target]?.focus()
  }, [attempt])
  useEffect(() => { if (receipt) successRef.current?.focus() }, [receipt])
  // 429: the button waits for Retry-After; one tick a second only while waiting.
  const waiting = waitUntil > now
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setNow(clock()), 1000)
    return () => clearInterval(timer)
  }, [waiting])
  // Preview URLs are made when photos are chosen and released when they change or the page closes.
  useEffect(() => () => previewsRef.current.forEach(url => URL.revokeObjectURL(url)), [])
  function showPreviews(photos: Photo[]) {
    previewsRef.current.forEach(url => URL.revokeObjectURL(url))
    previewsRef.current = photos.map(photo => (photoError(photo, limits.maxPhotoBytes) ? '' : URL.createObjectURL(photo)))
    setPreviews(previewsRef.current)
  }

  const option = typeOption(draft.type)

  function update<K extends keyof IncidentDraft>(field: K, value: IncidentDraft[K]) {
    if (pending) return
    setDraft(previous => ({ ...previous, [field]: value }))
    const key = field === 'contactEmail' ? 'contactPhone' : field
    setErrors(previous => (previous[key as IncidentField] || previous[field as IncidentField] ? { ...previous, [field]: undefined, [key]: undefined } : previous))
    if (!waiting) setFormError('')
  }

  function chooseType(type: ReportType) {
    if (pending) return
    setDraft(previous => ({ ...previous, type }))
    // What is required changes with the type: old "required" messages no longer apply.
    setErrors(previous => ({ ...previous, type: undefined, orderCode: undefined, description: undefined, contactPhone: undefined }))
  }

  function choosePhotos(event: ChangeEvent<HTMLInputElement>) {
    if (pending) return
    const chosen = [...(event.target.files ?? [])] as Photo[]
    event.target.value = ''
    if (!chosen.length) return
    const photos = [...draft.photos, ...chosen]
    const kept = photos.slice(0, limits.maxPhotos)
    update('photos', kept)
    showPreviews(kept)
    const problem = photos.length > limits.maxPhotos ? `Tối đa ${limits.maxPhotos} ảnh; đã bỏ ${photos.length - limits.maxPhotos} ảnh thừa.` : kept.map(photo => photoError(photo, limits.maxPhotoBytes)).find(Boolean)
    if (problem) setErrors(previous => ({ ...previous, photos: problem }))
  }

  function removePhoto(index: number) {
    const photos = draft.photos.filter((_, position) => position !== index)
    update('photos', photos)
    showPreviews(photos)
    const problem = photos.map(photo => photoError(photo, limits.maxPhotoBytes)).find(Boolean)
    setErrors(previous => ({ ...previous, photos: problem }))
    photoInputRef.current?.focus()
  }

  function fail(failure: IncidentFailure) {
    setErrors(failure.fieldErrors)
    setFormError(failure.message)
    if (failure.rateLimited) { const at = clock(); setNow(at); setWaitUntil(at + (failure.retryAfterSeconds ?? 60) * 1000) }
    focusAfter.current = failure.focus
    setAttempt(value => value + 1)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requestRef.current || waiting) return // one report at a time; never before Retry-After
    setFormError('')
    const fieldErrors = validateIncident(draft, limits)
    if (firstErrorField(fieldErrors)) { fail({ fieldErrors, message: '', focus: firstErrorField(fieldErrors)!, rateLimited: false }); return }
    setErrors({})
    const controller = new AbortController()
    requestRef.current = controller
    setPending(true)
    try {
      const result = await publicReportsApi.submit(token, buildReportForm(draft), controller.signal)
      if (controller.signal.aborted) return
      setReceipt(result)
    } catch (error) {
      if (controller.signal.aborted) return
      // Whatever went wrong, everything typed (and the photos) stays in the form; a rotated QR leaves the form.
      const failure = describeIncidentError(error)
      if (failure.gone) onGone(); else fail(failure)
    } finally {
      requestRef.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  function startOver() {
    setReceipt(null)
    setDraft(emptyDraft())
    showPreviews([])
    setErrors({})
    setFormError('')
  }

  const register = (field: IncidentField) => (element: HTMLElement | null) => { refs.current[field] = element }
  const machine = `${form.machineName ?? ''}${form.machineCode ? ` (${form.machineCode})` : ''}`.trim()

  if (receipt) return (
    <section aria-labelledby="incident-done-title" className={CARD}>
      <CircleCheck className="size-10 text-primary" aria-hidden="true" />
      <h1 id="incident-done-title" ref={successRef} tabIndex={-1} className={`rounded-sm pt-3 text-[28px] leading-tight font-bold tracking-[-0.5px] ${FOCUS}`}>Đã gửi báo cáo</h1>
      {receipt.reportCode && <p className="pt-3 text-[17px] leading-relaxed">
        {thankYouMessage(receipt.reportCode).split(receipt.reportCode)[0]}<strong className="font-mono font-semibold tracking-wide whitespace-nowrap">{receipt.reportCode}</strong>.
      </p>}
      {machine && <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]"><dt className="text-muted-foreground">Máy</dt><dd className="font-medium break-words">{machine}</dd></dl>}
      <p className="pt-4 text-[15px] leading-relaxed text-muted-foreground">
        Hãy ghi lại mã báo cáo để tra cứu khi liên hệ. Nhân viên vận hành sẽ kiểm tra; báo cáo không tự hoàn tiền hay thay đổi đơn hàng.
        {draft.contactPhone.trim() || draft.contactEmail.trim() ? ' Chúng tôi sẽ liên hệ theo thông tin bạn để lại nếu cần thêm thông tin.' : ''}
      </p>
      <Button type="button" variant="outline" onClick={startOver} className={`mt-6 h-12 w-full rounded-lg text-base ${FOCUS}`}>Gửi báo cáo khác</Button>
    </section>
  )

  const descriptionLength = draft.description.length
  const secondsLeft = Math.max(0, Math.ceil((waitUntil - now) / 1000))
  return <>
    <h1 className="text-[28px] leading-tight font-bold tracking-[-0.5px] min-[761px]:text-[32px]">Báo sự cố</h1>
    <p className="pt-2 text-[16px] leading-normal text-muted-foreground">Gặp vấn đề khi mua trái cây? Gửi báo cáo, không cần tài khoản. Trường có dấu <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only">sao</span> là bắt buộc.</p>
    {machine && <p className="mt-4 rounded-lg border bg-card px-4 py-3 text-[15px]"><span className="text-muted-foreground">Máy: </span><strong className="font-semibold break-words">{machine}</strong></p>}

    <form onSubmit={handleSubmit} noValidate aria-busy={pending} aria-labelledby="incident-form-title" className="relative mt-6 flex flex-col gap-6">
      <h2 id="incident-form-title" className="sr-only">Thông tin sự cố</h2>

      <fieldset aria-describedby={errors.type ? 'incident-type-message' : undefined} className="flex min-w-0 flex-col gap-2.5">
        <legend className="pb-2 text-[15px] font-semibold">Loại sự cố<span aria-hidden="true" className="text-destructive"> *</span></legend>
        {types.map((item, index) => (
          <label key={item.value} className="flex cursor-pointer gap-3 rounded-lg border border-[oklch(0.66_0.035_157)] bg-card px-4 py-3 transition-colors duration-150 hover:border-primary has-checked:border-primary has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-solid has-focus-visible:outline-primary motion-reduce:transition-none dark:border-[oklch(0.55_0.02_160)]">
            <input type="radio" name="type" value={item.value} checked={draft.type === item.value} onChange={() => chooseType(item.value)}
              ref={index === 0 ? register('type') : undefined} aria-invalid={errors.type ? true : undefined} required
              aria-describedby={`incident-type-${item.value}-help`} className="mt-1 size-5 shrink-0 accent-primary outline-none" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[16px] font-medium">{item.label}</span>
              <span id={`incident-type-${item.value}-help`} className="text-[14px] leading-snug text-muted-foreground">{item.help}</span>
            </span>
          </label>
        ))}
        {errors.type && <small id="incident-type-message" className="text-xs font-medium text-destructive">{errors.type}</small>}
      </fieldset>

      <FormField label={option?.orderRequired ? 'Mã đơn' : 'Mã đơn (không bắt buộc)'} required={!!option?.orderRequired} error={errors.orderCode}
        hint="Hiện trên màn hình máy sau khi thanh toán, dạng ORD-20261109-AB12CD34." className={FIELD}>
        <Input ref={register('orderCode')} id="incident-order" name="orderCode" autoComplete="off" autoCapitalize="characters" spellCheck={false}
          readOnly={pending} value={draft.orderCode} maxLength={32} className={`${CONTROL} uppercase`} onChange={event => update('orderCode', event.target.value)} />
      </FormField>

      <div className="flex flex-col gap-1">
        <FormField label={option && !option.descriptionRequired ? 'Mô tả (không bắt buộc)' : 'Mô tả'} required={!option || option.descriptionRequired} error={errors.description}
          hint={`Điều gì đã xảy ra? Tối đa ${DESCRIPTION_MAX} ký tự.`} className={FIELD}>
          <Textarea ref={register('description')} id="incident-description" name="description" rows={4} maxLength={DESCRIPTION_MAX} readOnly={pending} value={draft.description}
            className={`min-h-28 rounded-lg px-4 py-3 text-base border-[oklch(0.66_0.035_157)] dark:border-[oklch(0.55_0.02_160)] hover:border-primary ${FOCUS}`}
            onChange={event => update('description', event.target.value)} />
        </FormField>
        <p className="self-end text-xs text-muted-foreground tabular-nums" aria-hidden="true">{descriptionLength}/{DESCRIPTION_MAX}</p>
        <span className="sr-only" aria-live="polite">{descriptionLength >= DESCRIPTION_MAX - 50 ? `Còn ${DESCRIPTION_MAX - descriptionLength} ký tự.` : ''}</span>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="pb-1 text-[15px] font-semibold">Liên hệ{option?.contactRequired ? <span aria-hidden="true" className="text-destructive"> *</span> : ' (không bắt buộc)'}</legend>
        <p className="-mt-2 text-[14px] text-muted-foreground">{option?.contactRequired ? 'Cần số điện thoại hoặc email để nhân viên liên hệ về khoản tiền hoặc hộp trái cây.' : 'Để lại nếu bạn muốn nhân viên liên hệ lại.'}</p>
        <FormField label="Tên (không bắt buộc)" error={errors.contactName} className={FIELD}>
          <Input ref={register('contactName')} id="incident-name" name="contactName" autoComplete="name" readOnly={pending} value={draft.contactName} maxLength={CONTACT_NAME_MAX}
            className={CONTROL} onChange={event => update('contactName', event.target.value)} />
        </FormField>
        <FormField label="Số điện thoại" error={errors.contactPhone} hint="Ví dụ 0912 345 678 hoặc +84 912 345 678." className={FIELD}>
          <Input ref={register('contactPhone')} id="incident-phone" name="contactPhone" type="tel" inputMode="tel" autoComplete="tel" readOnly={pending} value={draft.contactPhone}
            maxLength={20} className={CONTROL} onChange={event => update('contactPhone', event.target.value)} />
        </FormField>
        <FormField label="Email" error={errors.contactEmail} className={FIELD}>
          <Input ref={register('contactEmail')} id="incident-email" name="contactEmail" type="email" inputMode="email" autoComplete="email" readOnly={pending} value={draft.contactEmail}
            maxLength={254} className={CONTROL} onChange={event => update('contactEmail', event.target.value)} />
        </FormField>
      </fieldset>

      <div className="flex flex-col gap-3">
        {/* Native file input kept for keyboard and screen readers, visually replaced by a Vietnamese button
            (the browser's own "Choose File" text follows the browser language, not the page). */}
        <div data-slot="form-field" className="flex min-w-0 flex-col gap-2">
          <span id="incident-photo-label" className="text-[15px] font-semibold">Ảnh (không bắt buộc)</span>
          <input ref={element => { photoInputRef.current = element; refs.current.photos = element }} id="incident-photo" name="photos" type="file" multiple
            accept={PHOTO_TYPES.join(',')} disabled={pending || draft.photos.length >= limits.maxPhotos} onChange={choosePhotos} className="peer sr-only"
            aria-labelledby="incident-photo-label incident-photo-button" aria-describedby="incident-photo-message" aria-invalid={errors.photos ? true : undefined} />
          <label id="incident-photo-button" htmlFor="incident-photo"
            className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[oklch(0.66_0.035_157)] bg-card px-4 text-base font-medium hover:border-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-solid peer-focus-visible:outline-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-aria-invalid:border-destructive dark:border-[oklch(0.55_0.02_160)]">
            <ImagePlus className="size-5" aria-hidden="true" />{draft.photos.length >= limits.maxPhotos ? `Đã chọn đủ ${limits.maxPhotos} ảnh` : draft.photos.length ? 'Thêm ảnh' : 'Chọn hoặc chụp ảnh'}
          </label>
          <small id="incident-photo-message" className={errors.photos ? 'text-xs font-medium text-destructive' : 'text-xs font-normal text-muted-foreground'}>
            {errors.photos ?? `Tối đa ${limits.maxPhotos} ảnh JPG hoặc PNG, mỗi ảnh tối đa ${megabytes(limits.maxPhotoBytes)}. Ảnh được xóa thông tin vị trí trước khi lưu.`}
          </small>
        </div>
        {draft.photos.length > 0 && <ul className="grid gap-2" aria-label="Ảnh đã chọn">
          {draft.photos.map((photo, index) => <li key={`${photo.name ?? 'photo'}-${index}`} className="flex items-start gap-3 rounded-lg border bg-card p-3">
            {previews[index]
              ? <img src={previews[index]} alt={`Ảnh đã chọn ${index + 1}: ${photo.name ?? ''}`} className="size-20 shrink-0 rounded-md object-cover" />
              : <span className="flex size-20 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImagePlus className="size-6" aria-hidden="true" /></span>}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm font-medium break-all">{photo.name}</span>
              <span className="text-xs text-muted-foreground">{megabytes(photo.size)}</span>
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => removePhoto(index)} className={`mt-1 h-10 self-start ${FOCUS}`}
                aria-label={`Bỏ ảnh ${index + 1}${photo.name ? ` (${photo.name})` : ''}`}><X aria-hidden="true" />Bỏ ảnh</Button>
            </div>
          </li>)}
        </ul>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={consentId} className="flex cursor-pointer gap-3 rounded-lg border border-[oklch(0.66_0.035_157)] bg-card px-4 py-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-solid has-focus-visible:outline-primary dark:border-[oklch(0.55_0.02_160)]">
          <input ref={register('consent')} id={consentId} type="checkbox" checked={draft.consent} disabled={pending} onChange={event => update('consent', event.target.checked)}
            aria-invalid={errors.consent ? true : undefined} aria-describedby="incident-consent-message" className="mt-1 size-5 shrink-0 accent-primary outline-none" />
          <span className="text-[15px] leading-snug">Tôi đồng ý để Fruit Vending dùng thông tin liên hệ và ảnh trong báo cáo này chỉ để xử lý phản ánh.<span aria-hidden="true" className="text-destructive"> *</span></span>
        </label>
        <small id="incident-consent-message" className={errors.consent ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}>
          {errors.consent ?? 'Thông tin liên hệ chỉ quản trị viên xem được; không hiện trên phiếu công việc của nhân viên.'}
        </small>
      </div>

      {/* Honeypot: invisible and unreachable for people; a bot filling it is accepted and dropped by the server. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="incident-website">Website</label>
        <input id="incident-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={draft.website} onChange={event => update('website', event.target.value)} />
      </div>

      {formError && <div key={attempt} ref={feedbackRef} id="incident-form-error" tabIndex={-1} role="alert"
        className={`${ALERT} border-destructive bg-status-danger text-status-danger-foreground outline-none animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none ${FOCUS}`}>
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{formError}{waiting ? ' Thông tin bạn đã nhập vẫn được giữ.' : ''}</span>
      </div>}

      <Button type="submit" disabled={pending || waiting} aria-describedby={formError ? 'incident-form-error' : undefined} className={PRIMARY}>
        <span>{pending ? 'Đang gửi…' : waiting ? `Gửi lại sau ${secondsLeft} giây` : 'Gửi báo cáo'}</span>
        {pending ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="size-5" aria-hidden="true" />}
      </Button>
      <span className="sr-only" role="status">{pending ? 'Đang gửi báo cáo. Vui lòng chờ.' : ''}</span>
    </form>
    <p className="flex gap-2 pt-6 text-[13px] leading-[1.6] text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Báo cáo được gửi tới nhân viên vận hành Fruit Vending. Ảnh được lưu lại không kèm thông tin vị trí.</p>
  </>
}

export default IncidentReportPage
