// "Ghi nhận hoàn tiền" dialog of screen T3 / W-12 (FE 8.1). It reads the order itself (GET /orders/{id}: payments and,
// for REFUND_READ, the refunds already recorded), so it decides from fresh data whether the payment can be refunded and
// with which reasons (refundCase), and never offers a second refund: an already refunded payment shows when, which
// transfer and who instead of the form. The amount is always the payment's own (the API takes none). A 409 on submit
// stays in the dialog with the explanation (by the backend's code), the dialog and the screen reload. Focus returns to
// the opener.
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import { ordersApi, refundsApi } from '../api/resources.ts'
import type { RefundCandidate, RefundCandidateType, RefundReason } from '../api/resources.ts'
import { Button } from '../components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { FormField } from '../components/ui/form-field.tsx'
import { Input, Textarea } from '../components/ui/input.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { cn } from '../lib/cn.ts'
import { formatDateTime, formatMoney } from '../lib/format.ts'
import { CHECK_FIELDS, describeFormFailure } from './form-error.ts'
import { ErrorState, useForm } from './kit.tsx'
import { shortId } from './order-detail.ts'
import {
  NO_PAYER, REFUND_NOTE_MAX, REFUND_REASON_HELP, REFUND_REASON_LABELS, REFUND_SUCCESS_TITLE, TRANSFER_REF_MAX, blockedText, defaultReason, payerLines,
  refundActionError, refundBody, refundCase, refundOf, refundSuccessText, reloadsAfter, validateRefund,
} from './refunds.ts'
import { useApi } from './useApi.ts'
import { useReturnFocus } from './return-focus.ts'

export interface RefundTarget {
  orderId: string; paymentId: string; orderCode?: string
  /** From "Cần hoàn tiền": the case the server listed and the account to transfer to. */
  candidateType?: RefundCandidateType
  payer?: RefundCandidate['payer'] | null
  /** INCIDENT work order that receives a note about the refund (a candidate's relatedWorkOrder, or a deep link). */
  workOrder?: { id: string; code?: string }
}

const ERROR_BOX = 'rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-[14px] text-destructive'
const INFO_BOX = 'rounded-lg border border-primary/25 bg-primary/8 px-3.5 py-2.5 text-[14px]'
const DL = 'grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[14px] [&_dt]:text-muted-foreground'

export function RefundDialog({ target, close, changed }: { target: RefundTarget; close: () => void; changed: () => void }) {
  const order = useApi(signal => ordersApi.get(target.orderId, signal), `order|${target.orderId}`)
  const form = useForm({ reason: '', transferReference: '', note: '' })
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [failures, setFailures] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const messageRef = useRef<HTMLParagraphElement>(null)
  const descriptionId = useId()
  const reasonId = useId()
  const { onCloseAutoFocus } = useReturnFocus()

  // After a failed submit has rendered, focus the first marked field, else the message (keyboard and screen readers).
  useEffect(() => {
    if (!failures) return
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (invalid) invalid.focus(); else messageRef.current?.focus()
  }, [failures])

  const data = order.data
  const found = data ? refundCase(data, target.paymentId) : undefined
  const ready = found?.kind === 'ready' ? found : undefined
  const orderCode = data?.orderCode ?? target.orderCode
  const refund = found ? refundOf(data?.refunds, found.paymentId) : undefined
  // The reason starts on the candidate's case (or the usual one) once the order is known, and follows a reload.
  const reason = ready && ready.reasons.includes(form.values.reason as RefundReason) ? form.values.reason : ready ? defaultReason(ready.reasons, target.candidateType) : ''
  const values = { ...form.values, reason }
  const payer = payerLines(target.payer)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !ready) return
    const errors = validateRefund(values, ready.reasons)
    if (Object.keys(errors).length) { form.setErrors(errors); setMessage(CHECK_FIELDS); setFailures(count => count + 1); return }
    setPending(true); setMessage('')
    try {
      await refundsApi.record(ready.paymentId, refundBody(values, target.workOrder?.id))
      close(); changed()
      toast.success(REFUND_SUCCESS_TITLE, { description: refundSuccessText(orderCode) })
    } catch (error) {
      const failure = describeFormFailure(refundActionError(error))
      if (failure.fieldErrors) form.setErrors(failure.fieldErrors)
      setMessage(failure.message)
      // Someone else recorded it, or the order moved on: show the new state here and on the screen behind.
      if (reloadsAfter(error)) { order.reload(); changed() }
      setPending(false); setFailures(count => count + 1)
    }
  }

  let body
  if (order.error && !data) body = <ErrorState error={order.error} retry={order.reload} />
  else if (!data || !found) body = <div role="status" aria-label="Đang tải thông tin đơn" className="grid gap-2.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-9 w-full" /></div>
  else body = <>
    <dl className={cn(DL, 'mb-4')}>
      <dt>Đơn</dt><dd className="font-mono text-[13px] break-all">{orderCode ?? shortId(target.orderId)}</dd>
      <dt>Máy</dt><dd>{data.machineCode ?? '—'}</dd>
      {found.payment && <><dt>Khoản thanh toán</dt><dd>{found.payment.provider ?? 'Thanh toán'} {shortId(found.payment.id)}{found.payment.paidAt ? `, nhận lúc ${formatDateTime(found.payment.paidAt)}` : ''}</dd></>}
      {found.payment && <><dt>{ready ? 'Số tiền cần hoàn' : 'Số tiền'}</dt><dd className={cn(ready && 'text-base font-semibold')}>{formatMoney(found.payment.amount)}</dd></>}
      {target.workOrder && <><dt>Phiếu sự cố</dt><dd>{target.workOrder.code ?? shortId(target.workOrder.id)} <span className="text-muted-foreground">(ghi chú hoàn tiền vào phiếu)</span></dd></>}
    </dl>
    {ready
      ? <>
        <section aria-label="Tài khoản nhận tiền hoàn" className="mb-4">
          <h3 className="mb-1.5! text-[13px] font-medium">Chuyển khoản tới</h3>
          {payer
            ? <dl className={DL}><dt>Chủ tài khoản</dt><dd className="break-words">{payer.name}</dd><dt>Số tài khoản</dt><dd className="font-mono text-[13px] break-all">{payer.account}</dd><dt>Ngân hàng</dt><dd>{payer.bank}</dd></dl>
            : <p className="text-[13px] text-muted-foreground">{target.payer === undefined ? 'Tài khoản người trả hiện trong danh sách “Cần hoàn tiền”.' : NO_PAYER}</p>}
        </section>
        <fieldset className="mb-3 min-w-0" aria-describedby={form.errors.reason ? `${reasonId}-message` : undefined}>
          <legend className="mb-1.5 text-[13px] font-medium">Lý do hoàn tiền<span aria-hidden="true" className="text-destructive"> *</span></legend>
          <div className="grid gap-2">
            {ready.reasons.map(option => <label key={option} className="flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 text-[14px] has-checked:border-primary has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
              <input type="radio" name={reasonId} value={option} checked={reason === option} disabled={pending} aria-invalid={form.errors.reason ? true : undefined}
                onChange={() => form.set('reason')(option)} className="mt-0.5 size-4 shrink-0 accent-primary outline-none" />
              <span className="grid gap-0.5"><span className="font-medium">{REFUND_REASON_LABELS[option]}</span><span className="text-[13px] text-muted-foreground">{REFUND_REASON_HELP[option]}</span></span>
            </label>)}
          </div>
          {form.errors.reason && <small id={`${reasonId}-message`} className="mt-1 block text-xs font-medium text-destructive">{form.errors.reason}</small>}
        </fieldset>
        <FormField label="Mã giao dịch chuyển khoản" required error={form.errors.transferReference} className="mb-3"
          hint={`Mã trên biên lai chuyển khoản trả tiền cho khách, ví dụ FT26317123456789. 4–${TRANSFER_REF_MAX} ký tự: chữ không dấu, số và . _ / -.`}>
          <Input value={values.transferReference} maxLength={TRANSFER_REF_MAX} autoComplete="off" spellCheck={false} className="font-mono max-sm:h-11 max-sm:text-base"
            onChange={event => form.set('transferReference')(event.target.value)} />
        </FormField>
        <FormField label={reason === 'OTHER' ? 'Ghi chú' : 'Ghi chú (không bắt buộc)'} required={reason === 'OTHER'} error={form.errors.note}
          hint={`${reason === 'OTHER' ? 'Bắt buộc với lý do khác: ghi rõ vì sao hoàn.' : 'Ví dụ ngân hàng, tên chủ tài khoản nhận.'} ${values.note.trim().length}/${REFUND_NOTE_MAX} ký tự.`}>
          <Textarea value={values.note} maxLength={REFUND_NOTE_MAX} className="min-h-20 max-sm:text-base" onChange={event => form.set('note')(event.target.value)} />
        </FormField>
      </>
      : found.kind === 'blocked' && <p role="status" data-refund-blocked={found.why} className={INFO_BOX}>{blockedText(found, refund)}</p>}
  </>

  return <Dialog open onOpenChange={open => { if (!open && !pending) close() }}>
    <DialogContent aria-busy={pending} aria-describedby={descriptionId} onEscapeKeyDown={event => { if (pending) event.preventDefault() }}
      onInteractOutside={event => event.preventDefault()} onCloseAutoFocus={onCloseAutoFocus}
      className="top-1/2 flex max-h-[calc(100dvh-2rem)] max-w-xl -translate-y-1/2 flex-col p-0 motion-reduce:animate-none!">
      <form ref={formRef} onSubmit={submit} noValidate className="flex min-h-0 flex-col">
        <header className="border-b px-5 py-4 pr-12 max-[680px]:px-4">
          <DialogTitle className="text-lg font-semibold">Ghi nhận hoàn tiền</DialogTitle>
          <DialogDescription id={descriptionId} className="mt-1 text-[13px] text-muted-foreground">
            Chỉ ghi nhận sau khi đã chuyển khoản trả toàn bộ số tiền cho khách. Hệ thống đánh dấu khoản thanh toán là đã hoàn tiền, ghi tên bạn và thời điểm; không hoàn tác được.
          </DialogDescription>
          <Button type="button" variant="ghost" size="icon-sm" className="absolute top-3 right-3 text-xl font-normal text-muted-foreground" aria-label="Đóng" disabled={pending} onClick={close}>×</Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-[680px]:px-4">
          {message && <p ref={messageRef} tabIndex={-1} role="alert" className={cn(ERROR_BOX, 'mb-3!')}>{message}</p>}
          {body}
        </div>
        <footer className="flex justify-end gap-2 border-t bg-muted/50 px-5 py-3.5 max-[680px]:px-4">
          <Button type="button" variant="outline" className="max-sm:h-11" disabled={pending} onClick={close}>{ready ? 'Hủy' : 'Đóng'}</Button>
          {ready && <Button type="submit" className="max-sm:h-11" disabled={pending}>{pending ? 'Đang ghi nhận…' : 'Ghi nhận hoàn tiền'}</Button>}
        </footer>
      </form>
    </DialogContent>
  </Dialog>
}
