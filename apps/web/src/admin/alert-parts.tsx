// Pieces shared by the alert list and detail screens (FE 6.3): acknowledge / close dialogs, who handled the alert, and
// the "Mở phiếu" button that stays disabled until work tickets exist (FM7). No delete anywhere: an alert only moves
// OPEN → ACKNOWLEDGED → RESOLVED (or straight to RESOLVED).
import { useId } from 'react'
import { toast } from 'sonner'
import { alertsApi } from '../api/resources.ts'
import type { Alert } from '../api/resources.ts'
import { Button } from '../components/ui/button.tsx'
import { FormField } from '../components/ui/form-field.tsx'
import { Textarea } from '../components/ui/input.tsx'
import { cn } from '../lib/cn.ts'
import { notifyAlertsChanged } from './alert-bell.ts'
import type { AlertAction, AlertScreen } from './alerts.ts'
import { RESOLUTION_NOTE_MAX, TICKETS_AVAILABLE, TICKET_PENDING_TEXT, alertActionError, alertTypeLabel, handlingSteps, isConflict, resolveBody } from './alerts.ts'
import { ConfirmDialog, FormSheet, useForm } from './kit.tsx'

const summary = (alert: Alert) => `${alertTypeLabel(alert.type)} · máy ${alert.machineCode}`

interface ActionProps { alert: Alert; close: () => void; changed: () => void; screen?: AlertScreen }

/**
 * Runs an action. A 409 means someone else changed the alert meanwhile: retrying cannot help, so the dialog closes, the
 * screen reloads and the explanation is shown as an error toast (read by screen readers); focus goes to the content.
 * The error is still thrown so the dialog does not report success. Other errors stay in the dialog for a retry.
 */
async function act(props: ActionProps, action: AlertAction, call: () => Promise<unknown>) {
  try { await call() } catch (error) {
    const shown = alertActionError(error, action, props.screen)
    if (isConflict(error)) {
      props.close(); props.changed(); notifyAlertsChanged()
      toast.error(shown instanceof Error ? shown.message : 'Cảnh báo đã thay đổi.', { description: summary(props.alert) })
      document.getElementById('admin-main')?.focus({ preventScroll: true })
    }
    throw shown
  }
  props.changed(); notifyAlertsChanged()
}

/** Confirms OPEN → ACKNOWLEDGED. `changed` reloads the screen (after success, and after a 409 to show the new state). */
export function AcknowledgeDialog(props: ActionProps) {
  const { alert, close } = props
  return <ConfirmDialog title="Xác nhận đã tiếp nhận cảnh báo?" confirmLabel="Xác nhận" close={close}
    successMessage="Đã xác nhận cảnh báo" successDescription={summary(alert)}
    message={<>
      <p><strong className="font-medium text-foreground">{summary(alert)}</strong>: {alert.title}</p>
      <p className="mt-2!">Hệ thống ghi tên bạn và thời điểm xác nhận để mọi người biết cảnh báo đã có người xử lý. Không hoàn tác được; khi xử lý xong hãy dùng “Đóng”.</p>
    </>}
    onConfirm={() => act(props, 'acknowledge', () => alertsApi.acknowledge(alert.id))} />
}

/** Closes an alert (OPEN or ACKNOWLEDGED → RESOLVED) with an optional note; 400 marks the note, 409 closes and reloads. */
export function ResolveSheet(props: ActionProps) {
  const { alert, close } = props
  const form = useForm({ note: '' })
  const note = form.values.note
  return <FormSheet title="Đóng cảnh báo" submitLabel="Đóng cảnh báo" close={close} onFieldErrors={form.setErrors}
    successMessage="Đã đóng cảnh báo" successDescription={summary(alert)}
    description="Chỉ đóng khi sự cố đã được xử lý xong. Hệ thống ghi tên bạn, thời điểm và ghi chú; cảnh báo đã đóng không mở lại được."
    onSubmit={async () => {
      if (note.trim().length > RESOLUTION_NOTE_MAX) form.fail({ note: `Tối đa ${RESOLUTION_NOTE_MAX} ký tự.` })
      await act(props, 'resolve', () => alertsApi.resolve(alert.id, resolveBody(note)))
    }}>
    <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">
      <dt className="text-muted-foreground">Cảnh báo</dt><dd>{alertTypeLabel(alert.type)}: {alert.title}</dd>
      <dt className="text-muted-foreground">Máy</dt><dd className="font-mono">{alert.machineCode}</dd>
      {alert.acknowledgedAt && <><dt className="text-muted-foreground">Đã xác nhận</dt><dd>{handlingSteps(alert).find(step => step.key === 'acknowledged')?.by}</dd></>}
    </dl>
    <FormField label="Ghi chú xử lý (không bắt buộc)" error={form.errors.note} hint={`Đã làm gì để xử lý, ví dụ “Đã rút hộp hết hạn ở ngăn B1”. ${note.trim().length}/${RESOLUTION_NOTE_MAX} ký tự.`} className="mb-2">
      <Textarea value={note} maxLength={RESOLUTION_NOTE_MAX} className="max-sm:text-base" onChange={event => form.set('note')(event.target.value)} />
    </FormField>
  </FormSheet>
}

/** Who acknowledged and who closed the alert, with times (and the note on the detail screen). */
export function HandledBy({ alert, withNote = false, className }: { alert: Alert; withNote?: boolean; className?: string }) {
  const steps = handlingSteps(alert).filter(step => step.key !== 'triggered')
  if (!steps.length) return <span className={cn('text-xs text-muted-foreground', className)}>Chưa có người tiếp nhận</span>
  return <ul className={cn('grid gap-0.5 text-xs text-muted-foreground', className)}>
    {steps.map(step => <li key={step.key}>
      <span className="font-medium text-foreground">{step.label}:</span> {step.by}, {step.at}
      {withNote && step.note && <><br /><span>Ghi chú: </span><span className="whitespace-pre-wrap text-foreground">{step.note}</span></>}
    </li>)}
  </ul>
}

/**
 * "Mở phiếu": work tickets are FM7 (FE 7.1, backend 4.3). Until then the button stays focusable but disabled
 * (aria-disabled) and the reason is shown next to it, so keyboard and screen-reader users learn why.
 */
export function OpenTicketButton() {
  const hintId = useId()
  if (TICKETS_AVAILABLE) return null
  return <div className="grid gap-1">
    <Button type="button" variant="outline" size="sm" aria-disabled="true" aria-describedby={hintId} className="w-fit cursor-not-allowed border-dashed text-muted-foreground hover:bg-card hover:text-muted-foreground max-sm:h-11"
      onClick={event => event.preventDefault()}>Mở phiếu</Button>
    <p id={hintId} className="max-w-[60ch] text-xs text-muted-foreground">{TICKET_PENDING_TEXT}</p>
  </div>
}
