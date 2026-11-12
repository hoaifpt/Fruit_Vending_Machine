// "Ghi nhận hoàn tiền" dialog of screen T3 / W-12 (FE 8.1). It reads the order itself (GET /orders/{id}) and the refunds
// already recorded for it (GET /refunds?orderId=, draft), so it decides from fresh data which payment can be refunded
// (refundCase) and never offers a second refund: an already refunded payment shows when, which transfer and who
// instead of the form. A 409 on submit (someone refunded it meanwhile) stays in the dialog with the explanation, the
// dialog and the screen reload, and the dialog then shows why nothing more can be recorded. Focus returns to the opener.
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import { ordersApi, refundsApi } from '../api/resources.ts'
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
  REFUND_NOTE_MAX, REFUND_SUCCESS_TITLE, TRANSFER_REF_MAX, blockedText, isRefundConflict, refundActionError, refundBody, refundCase,
  refundOf, refundReasonLabel, refundSuccessText, refundsMissing, validateRefund,
} from './refunds.ts'
import { useApi } from './useApi.ts'
import { useReturnFocus } from './return-focus.ts'

export interface RefundTarget { orderId: string; paymentId?: string; orderCode?: string }

const ERROR_BOX = 'rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-[14px] text-destructive'
const INFO_BOX = 'rounded-lg border border-primary/25 bg-primary/8 px-3.5 py-2.5 text-[14px]'

export function RefundDialog({ target, close, changed }: { target: RefundTarget; close: () => void; changed: () => void }) {
  const order = useApi(signal => ordersApi.get(target.orderId, signal), `order|${target.orderId}`)
  const refunds = useApi(signal => refundsApi.list({ orderId: target.orderId, page: 0, size: 20, sort: 'refundedAt,desc' }, signal), `refunds|${target.orderId}`)
  const form = useForm({ transferRef: '', note: '' })
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [failures, setFailures] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const messageRef = useRef<HTMLParagraphElement>(null)
  const descriptionId = useId()
  const { onCloseAutoFocus } = useReturnFocus()

  // After a failed submit has rendered, focus the first marked field, else the message (keyboard and screen readers).
  useEffect(() => {
    if (!failures) return
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (invalid) invalid.focus(); else messageRef.current?.focus()
  }, [failures])

  const data = order.data
  const found = data ? refundCase(data, target.paymentId) : undefined
  const orderCode = data?.orderCode ?? target.orderCode
  const refundList = refunds.data?.content
  const refund = found ? refundOf(refundList, found.paymentId) : undefined

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || found?.kind !== 'ready') return
    const errors = validateRefund(form.values)
    if (Object.keys(errors).length) { form.setErrors(errors); setMessage(CHECK_FIELDS); setFailures(count => count + 1); return }
    setPending(true); setMessage('')
    try {
      await refundsApi.record(target.orderId, refundBody(form.values, found.paymentId))
      close(); changed()
      toast.success(REFUND_SUCCESS_TITLE, { description: refundSuccessText(orderCode) })
    } catch (error) {
      const failure = describeFormFailure(refundActionError(error))
      if (failure.fieldErrors) form.setErrors(failure.fieldErrors)
      setMessage(failure.message)
      // Someone else recorded it (or the case changed): show the new state here and on the screen behind.
      if (isRefundConflict(error)) { order.reload(); refunds.reload(); changed() }
      setPending(false); setFailures(count => count + 1)
    }
  }

  const ready = found?.kind === 'ready' ? found : undefined
  const ref = form.values.transferRef, note = form.values.note
  let body
  if (order.error && !data) body = <ErrorState error={order.error} retry={order.reload} />
  else if (!data || !found) body = <div role="status" aria-label="Đang tải thông tin đơn" className="grid gap-2.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-9 w-full" /></div>
  else body = <>
    <dl className="mb-4 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[14px] [&_dt]:text-muted-foreground">
      <dt>Đơn</dt><dd className="font-mono text-[13px] break-all">{orderCode ?? shortId(target.orderId)}</dd>
      <dt>Máy</dt><dd>{data.machineCode ?? '—'}</dd>
      {ready && <><dt>Trường hợp</dt><dd>{refundReasonLabel(ready.reason)}</dd></>}
      {found.payment && <><dt>Khoản thanh toán</dt><dd>{found.payment.provider ?? 'Thanh toán'} {shortId(found.payment.id)}{found.payment.paidAt ? `, nhận lúc ${formatDateTime(found.payment.paidAt)}` : ''}</dd></>}
      {found.payment && <><dt>{ready ? 'Số tiền cần hoàn' : 'Số tiền'}</dt><dd className={cn(ready && 'text-base font-semibold')}>{formatMoney(found.payment.amount)}</dd></>}
    </dl>
    {found.kind === 'ready'
      ? <>
        <p className="mb-4! text-[13px] text-muted-foreground">
          {found.reason === 'DISPENSE_FAILED' ? 'Sau khi ghi nhận, khoản thanh toán và đơn chuyển sang “Đã hoàn tiền”.' : 'Sau khi ghi nhận, khoản thanh toán chuyển sang “Đã hoàn tiền”; trạng thái đơn giữ nguyên.'}
        </p>
        <FormField label="Mã giao dịch chuyển khoản" required error={form.errors.transferRef} className="mb-3"
          hint={`Mã trên biên lai chuyển khoản trả tiền cho khách, ví dụ FT26316123456789. 3–${TRANSFER_REF_MAX} ký tự: chữ không dấu, số và . _ / -.`}>
          <Input value={ref} maxLength={TRANSFER_REF_MAX} autoComplete="off" spellCheck={false} className="font-mono max-sm:h-11 max-sm:text-base"
            onChange={event => form.set('transferRef')(event.target.value)} />
        </FormField>
        <FormField label="Ghi chú (không bắt buộc)" error={form.errors.note} hint={`Ví dụ ngân hàng, tên chủ tài khoản nhận. ${note.trim().length}/${REFUND_NOTE_MAX} ký tự.`}>
          <Textarea value={note} maxLength={REFUND_NOTE_MAX} className="min-h-20 max-sm:text-base" onChange={event => form.set('note')(event.target.value)} />
        </FormField>
      </>
      : <p role="status" data-refund-blocked={found.why} className={INFO_BOX}>{blockedText(found, refund)}</p>}
    {refunds.error && !refundsMissing(refunds.error) && found.kind === 'blocked' && found.why === 'refunded' && !refund
      && <p className="mt-2! text-[13px] text-muted-foreground">Chưa đọc được thông tin lần hoàn tiền (mã chuyển khoản, người ghi nhận).</p>}
  </>

  return <Dialog open onOpenChange={open => { if (!open && !pending) close() }}>
    <DialogContent aria-busy={pending} aria-describedby={descriptionId} onEscapeKeyDown={event => { if (pending) event.preventDefault() }}
      onInteractOutside={event => event.preventDefault()} onCloseAutoFocus={onCloseAutoFocus}
      className="top-1/2 flex max-h-[calc(100dvh-2rem)] max-w-xl -translate-y-1/2 flex-col p-0 motion-reduce:animate-none!">
      <form ref={formRef} onSubmit={submit} noValidate className="flex min-h-0 flex-col">
        <header className="border-b px-5 py-4 pr-12 max-[680px]:px-4">
          <DialogTitle className="text-lg font-semibold">Ghi nhận hoàn tiền</DialogTitle>
          <DialogDescription id={descriptionId} className="mt-1 text-[13px] text-muted-foreground">
            Chỉ ghi nhận sau khi đã chuyển khoản trả tiền cho khách. Hệ thống đánh dấu khoản thanh toán là đã hoàn tiền, ghi tên bạn và thời điểm; không hoàn tác được.
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
