// Public incident report form (FE 8.2, screen P1 / K-09), opened from the kiosk QR on the customer's phone. No account,
// mobile first. Rules and error mapping live in features/incident/incident.ts; contract in
// api-contract/drafts/incident-reports.yaml (mocked until backend 5.2).
import { CircleAlert, CircleCheck, ImagePlus, Info, LoaderCircle, Moon, Send, Sun, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { incidentReportsApi } from '../api/resources'
import { Button } from '../components/ui/button'
import { FormField } from '../components/ui/form-field'
import { Input, Textarea } from '../components/ui/input'
import {
  buildIncidentForm, describeIncidentError, DESCRIPTION_MAX, emptyDraft, firstErrorField, INCIDENT_TYPES, MACHINE_PARAM, machineFromSearch,
  photoError, PHOTO_TYPES, thankYouMessage, typeOption, validateIncident,
} from '../features/incident/incident'
import type { IncidentDraft, IncidentFailure, IncidentField, IncidentFieldErrors, IncidentReceipt, IncidentType } from '../features/incident/incident'
import { formatDateTime } from '../lib/format'
import { useTheme } from '../lib/theme'

// Same ink and focus treatment as the login page (DESIGN.md); dark mode uses the shared --ui-* tokens.
const INK = 'text-[oklch(0.316_0.05_163)] dark:text-foreground'
const FIELD = 'gap-2 [&>label]:text-[15px] [&>label]:font-semibold'
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-primary'
const CONTROL = `h-12 rounded-lg px-4 text-base border-[oklch(0.66_0.035_157)] dark:border-[oklch(0.55_0.02_160)] hover:border-primary ${FOCUS}`
const ALERT = 'flex gap-3 rounded-lg border px-4 py-3.5 text-sm leading-normal'

function ThemeToggle() {
  const { resolved, setTheme } = useTheme()
  const dark = resolved === 'dark'
  return <Button variant="ghost" size="icon" aria-label={dark ? 'Dùng giao diện sáng' : 'Dùng giao diện tối'} title={dark ? 'Giao diện sáng' : 'Giao diện tối'}
    onClick={() => setTheme(dark ? 'light' : 'dark')} className="size-11 text-muted-foreground hover:text-foreground">
    {dark ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
  </Button>
}

type Photo = NonNullable<IncidentDraft['photo']>

function IncidentReportPage() {
  const [fromQr] = useState(() => machineFromSearch(window.location.search))
  const [badParam] = useState(() => new URLSearchParams(window.location.search).has(MACHINE_PARAM) && !machineFromSearch(window.location.search))
  const [draft, setDraft] = useState<IncidentDraft>(() => emptyDraft(fromQr ?? ''))
  /** The machine code is shown as a fixed line when it came from the QR, until the customer chooses to change it. */
  const [editMachine, setEditMachine] = useState(!fromQr)
  const [errors, setErrors] = useState<IncidentFieldErrors>({})
  const [formError, setFormError] = useState('')
  const [rateLimited, setRateLimited] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [receipt, setReceipt] = useState<IncidentReceipt | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const refs = useRef<Partial<Record<IncidentField, HTMLElement | null>>>({})
  const feedbackRef = useRef<HTMLDivElement>(null)
  const successRef = useRef<HTMLHeadingElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const focusAfter = useRef<IncidentFailure['focus'] | null>(null)

  useEffect(() => () => requestRef.current?.abort(), [])
  useEffect(() => {
    const target = focusAfter.current
    if (!target) return
    focusAfter.current = null
    if (target === 'form') feedbackRef.current?.focus()
    else refs.current[target]?.focus()
  }, [attempt])
  useEffect(() => { if (receipt) successRef.current?.focus() }, [receipt])
  // The preview URL is made when a photo is chosen and released when it is replaced, removed or the page closes.
  const previewRef = useRef<string | null>(null)
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])
  function showPreview(photo: Photo | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = photo && !photoError(photo) ? URL.createObjectURL(photo) : null
    setPreview(previewRef.current)
  }

  const option = typeOption(draft.type)

  function update<K extends keyof IncidentDraft>(field: K, value: IncidentDraft[K]) {
    if (pending) return
    setDraft(previous => ({ ...previous, [field]: value }))
    setErrors(previous => (previous[field as IncidentField] ? { ...previous, [field]: undefined } : previous))
    if (!rateLimited) setFormError('')
  }

  function chooseType(type: IncidentType) {
    if (pending) return
    setDraft(previous => ({ ...previous, type }))
    // What is required changes with the type: old "required" messages no longer apply.
    setErrors(previous => ({ ...previous, type: undefined, orderCode: undefined, description: undefined }))
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    if (pending) return
    const file = (event.target.files?.[0] ?? null) as Photo | null
    update('photo', file)
    showPreview(file)
    const problem = photoError(file)
    if (problem) setErrors(previous => ({ ...previous, photo: problem }))
  }

  function removePhoto() {
    update('photo', null)
    showPreview(null)
    if (photoInputRef.current) { photoInputRef.current.value = ''; photoInputRef.current.focus() }
  }

  function fail(failure: IncidentFailure) {
    setErrors(failure.fieldErrors)
    setFormError(failure.message)
    setRateLimited(failure.rateLimited)
    if (failure.fieldErrors.machineCode) setEditMachine(true)
    focusAfter.current = failure.focus
    setAttempt(value => value + 1)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requestRef.current) return // one report at a time: a second tap while sending does nothing
    setFormError('')
    setRateLimited(false)
    const fieldErrors = validateIncident(draft)
    if (firstErrorField(fieldErrors)) { fail({ fieldErrors, message: '', focus: firstErrorField(fieldErrors)!, rateLimited: false }); return }
    setErrors({})
    const controller = new AbortController()
    requestRef.current = controller
    setPending(true)
    try {
      const result = await incidentReportsApi.create(buildIncidentForm(draft), controller.signal)
      if (controller.signal.aborted) return
      setReceipt(result)
    } catch (error) {
      // Whatever went wrong, everything typed (and the photo) stays in the form.
      if (!controller.signal.aborted) fail(describeIncidentError(error))
    } finally {
      requestRef.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  function startOver() {
    setReceipt(null)
    setDraft(emptyDraft(draft.machineCode))
    showPreview(null)
    setErrors({})
    setFormError('')
    setRateLimited(false)
  }

  const descriptionLength = draft.description.length
  const register = (field: IncidentField) => (element: HTMLElement | null) => { refs.current[field] = element }

  return (
    <main className={`min-h-svh bg-background ${INK}`}>
      <div className="mx-auto flex w-full max-w-[520px] items-center justify-between gap-4 px-4 pt-2">
        <span className="text-[19px] font-[720] tracking-[-0.5px] whitespace-nowrap">Fruit Vending<span className="text-primary" aria-hidden="true">.</span></span>
        <ThemeToggle />
      </div>

      <div className="mx-auto w-full max-w-[520px] px-4 pt-4 pb-12">
        {receipt ? (
          <section aria-labelledby="incident-done-title" className="rounded-xl border bg-card px-5 py-6 shadow-xs">
            <CircleCheck className="size-10 text-primary" aria-hidden="true" />
            <h1 id="incident-done-title" ref={successRef} tabIndex={-1} className={`rounded-sm pt-3 text-[28px] leading-tight font-bold tracking-[-0.5px] ${FOCUS}`}>Đã gửi báo cáo</h1>
            <p className="pt-3 text-[17px] leading-relaxed">
              {thankYouMessage(receipt.reportCode).split(receipt.reportCode)[0]}<strong className="font-mono font-semibold tracking-wide whitespace-nowrap">{receipt.reportCode}</strong>.
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
              <dt className="text-muted-foreground">Máy</dt><dd className="font-medium break-all">{draft.machineCode.trim().toUpperCase()}</dd>
              <dt className="text-muted-foreground">Gửi lúc</dt><dd className="font-medium">{formatDateTime(receipt.createdAt)}</dd>
            </dl>
            <p className="pt-4 text-[15px] leading-relaxed text-muted-foreground">
              Hãy ghi lại mã báo cáo để tra cứu khi liên hệ. Nhân viên vận hành sẽ kiểm tra; báo cáo không tự hoàn tiền hay thay đổi đơn hàng.
              {draft.contactPhone.trim() ? ' Chúng tôi sẽ gọi lại theo số điện thoại bạn để lại nếu cần thêm thông tin.' : ''}
            </p>
            <Button type="button" variant="outline" onClick={startOver} className={`mt-6 h-12 w-full rounded-lg text-base ${FOCUS}`}>Gửi báo cáo khác</Button>
          </section>
        ) : (
          <>
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.5px] min-[761px]:text-[32px]">Báo sự cố</h1>
            <p className="pt-2 text-[16px] leading-normal text-muted-foreground">Gặp vấn đề khi mua trái cây? Gửi báo cáo, không cần tài khoản. Trường có dấu <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only">sao</span> là bắt buộc.</p>

            <form onSubmit={handleSubmit} noValidate aria-busy={pending} aria-labelledby="incident-form-title" className="mt-6 flex flex-col gap-6">
              <h2 id="incident-form-title" className="sr-only">Thông tin sự cố</h2>

              {editMachine ? (
                <div className="flex flex-col gap-3">
                  {badParam && <div className={`${ALERT} border-transparent bg-status-info text-status-info-foreground`}>
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>Mã máy trong đường dẫn không đọc được. Nhập mã in trên nhãn ở thân máy.</span>
                  </div>}
                  <FormField label="Mã máy" required error={errors.machineCode} hint="In trên nhãn ở thân máy, ví dụ FV-HCM-001." className={FIELD}>
                    <Input ref={register('machineCode')} id="incident-machine" name="machineCode" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                      readOnly={pending} value={draft.machineCode} maxLength={64} className={`${CONTROL} uppercase`}
                      onChange={event => update('machineCode', event.target.value)} />
                  </FormField>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                  <p className="min-w-0 text-[15px]"><span className="text-muted-foreground">Máy: </span><strong className="font-semibold break-all">{draft.machineCode}</strong></p>
                  <Button type="button" variant="link" disabled={pending} onClick={() => { setEditMachine(true); setTimeout(() => refs.current.machineCode?.focus()) }}
                    className={`h-11 shrink-0 px-2 text-[15px] ${FOCUS}`} aria-label={`Đổi mã máy (đang là ${draft.machineCode})`}>Đổi mã máy</Button>
                </div>
              )}

              <fieldset aria-describedby={errors.type ? 'incident-type-message' : undefined} className="flex min-w-0 flex-col gap-2.5">
                <legend className="pb-2 text-[15px] font-semibold">Loại sự cố<span aria-hidden="true" className="text-destructive"> *</span></legend>
                {INCIDENT_TYPES.map((item, index) => (
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
                  readOnly={pending} value={draft.orderCode} maxLength={32} className={`${CONTROL} uppercase`}
                  onChange={event => update('orderCode', event.target.value)} />
              </FormField>

              <div className="flex flex-col gap-1">
                <FormField label={option?.descriptionRequired ? 'Mô tả' : 'Mô tả (không bắt buộc)'} required={!!option?.descriptionRequired} error={errors.description}
                  hint={`Điều gì đã xảy ra? Tối đa ${DESCRIPTION_MAX} ký tự.`} className={FIELD}>
                  <Textarea ref={register('description')} id="incident-description" name="description" rows={4} maxLength={DESCRIPTION_MAX}
                    readOnly={pending} value={draft.description}
                    className={`min-h-28 rounded-lg px-4 py-3 text-base border-[oklch(0.66_0.035_157)] dark:border-[oklch(0.55_0.02_160)] hover:border-primary ${FOCUS}`}
                    onChange={event => update('description', event.target.value)} />
                </FormField>
                <p className="self-end text-xs text-muted-foreground tabular-nums" aria-hidden="true">{descriptionLength}/{DESCRIPTION_MAX}</p>
                <span className="sr-only" aria-live="polite">{descriptionLength >= DESCRIPTION_MAX - 50 ? `Còn ${DESCRIPTION_MAX - descriptionLength} ký tự.` : ''}</span>
              </div>

              <FormField label="Số điện thoại (không bắt buộc)" error={errors.contactPhone} hint="Ví dụ 0912 345 678. Chỉ dùng để nhân viên gọi lại về báo cáo này." className={FIELD}>
                <Input ref={register('contactPhone')} id="incident-phone" name="contactPhone" type="tel" inputMode="tel" autoComplete="tel"
                  readOnly={pending} value={draft.contactPhone} maxLength={20} className={CONTROL}
                  onChange={event => update('contactPhone', event.target.value)} />
              </FormField>

              <div className="flex flex-col gap-3">
                {/* Native file input kept for keyboard and screen readers, visually replaced by a Vietnamese button
                    (the browser's own "Choose File" text follows the browser language, not the page). */}
                <div data-slot="form-field" className="flex min-w-0 flex-col gap-2">
                  <span id="incident-photo-label" className="text-[15px] font-semibold">Ảnh (không bắt buộc)</span>
                  <input ref={element => { photoInputRef.current = element; refs.current.photo = element }} id="incident-photo" name="photo" type="file"
                    accept={PHOTO_TYPES.join(',')} disabled={pending} onChange={choosePhoto} className="peer sr-only"
                    aria-labelledby="incident-photo-label incident-photo-button" aria-describedby="incident-photo-message" aria-invalid={errors.photo ? true : undefined} />
                  <label id="incident-photo-button" htmlFor="incident-photo"
                    className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[oklch(0.66_0.035_157)] bg-card px-4 text-base font-medium hover:border-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-solid peer-focus-visible:outline-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-aria-invalid:border-destructive dark:border-[oklch(0.55_0.02_160)]">
                    <ImagePlus className="size-5" aria-hidden="true" />{draft.photo ? 'Chọn ảnh khác' : 'Chọn hoặc chụp ảnh'}
                  </label>
                  <small id="incident-photo-message" className={errors.photo ? 'text-xs font-medium text-destructive' : 'text-xs font-normal text-muted-foreground'}>
                    {errors.photo ?? 'Một ảnh JPG, PNG hoặc WebP, tối đa 5 MB.'}
                  </small>
                </div>
                {draft.photo && (
                  <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
                    {preview
                      ? <img src={preview} alt={`Ảnh đã chọn: ${draft.photo.name ?? ''}`} className="size-24 shrink-0 rounded-md object-cover" />
                      : <span className="flex size-24 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImagePlus className="size-6" aria-hidden="true" /></span>}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-sm font-medium break-all">{draft.photo.name}</span>
                      <span className="text-xs text-muted-foreground">{(draft.photo.size / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB</span>
                      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={removePhoto} className={`mt-1 h-10 self-start ${FOCUS}`}>
                        <X aria-hidden="true" />Bỏ ảnh
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {formError && <div key={attempt} ref={feedbackRef} id="incident-form-error" tabIndex={-1} role="alert"
                className={`${ALERT} border-destructive bg-status-danger text-status-danger-foreground outline-none animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none ${FOCUS}`}>
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{formError}{rateLimited ? ' Thông tin bạn đã nhập vẫn được giữ.' : ''}</span>
              </div>}

              <Button type="submit" disabled={pending} aria-describedby={formError ? 'incident-form-error' : undefined}
                className={`h-[54px] w-full gap-3 rounded-lg bg-[oklch(0.316_0.05_163)] text-base font-semibold text-white hover:bg-[oklch(0.44_0.081_154)] disabled:bg-[oklch(0.44_0.081_154)] disabled:opacity-100 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/85 dark:disabled:bg-primary/85 ${FOCUS}`}>
                <span>{pending ? 'Đang gửi…' : 'Gửi báo cáo'}</span>
                {pending
                  ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <Send className="size-5" aria-hidden="true" />}
              </Button>
              <span className="sr-only" role="status">{pending ? 'Đang gửi báo cáo. Vui lòng chờ.' : ''}</span>
            </form>
            <p className="pt-6 text-[13px] leading-[1.6] text-muted-foreground">Báo cáo được gửi tới nhân viên vận hành Fruit Vending. Số điện thoại chỉ quản trị viên xem được.</p>
          </>
        )}
      </div>
    </main>
  )
}
export default IncidentReportPage
