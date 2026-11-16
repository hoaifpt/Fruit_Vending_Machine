// Pieces shared by the alert list and detail screens (FE 6.3): acknowledge / close dialogs, who handled the alert, and
// "Mở phiếu", which opens a work order for the alert with POST /alerts/{alertId}/work-orders (WORK_ORDER_MANAGE). No
// delete anywhere: an alert only moves OPEN → ACKNOWLEDGED → RESOLVED (or straight to RESOLVED).
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { alertsApi } from '../api/resources.ts'
import type { Alert, WorkOrder } from '../api/resources.ts'
import { Button } from '../components/ui/button.tsx'
import { FormField } from '../components/ui/form-field.tsx'
import { Input, NativeSelect, Textarea } from '../components/ui/input.tsx'
import { cn } from '../lib/cn.ts'
import { notifyAlertsChanged } from './alert-bell.ts'
import type { AlertAction, AlertScreen, AlertWorkOrderValues } from './alerts.ts'
import {
  NEW_ALERT_WORK_ORDER, RESOLUTION_NOTE_MAX, TICKETS_AVAILABLE, TICKET_ADMIN_ONLY_TEXT, TICKET_PENDING_TEXT, WORK_ORDER_LIMITS, WORK_ORDER_PRIORITIES,
  WORK_ORDER_PRIORITY_LABELS, WORK_ORDER_TYPES, WORK_ORDER_TYPE_LABELS, alertActionError, alertTypeLabel, alertWorkOrderBody, handlingSteps, isConflict,
  resolveBody, validateAlertWorkOrder, workOrderDefaults, workOrderError, workOrderPath,
} from './alerts.ts'
import { ConfirmDialog, FormSheet, Link, useDialog, useForm } from './kit.tsx'
import { useStaffOptions } from './options.ts'
import { LINK } from './payment-parts.tsx'
import { useSession } from './useSession.ts'

const summary = (alert: Alert) => `${alertTypeLabel(alert.type)} · máy ${alert.machineCode}`

interface ActionProps { alert: Alert; close: () => void; changed: () => void; screen?: AlertScreen }

/**
 * Runs an action. A 409 means the alert was closed meanwhile: retrying cannot help, so the dialog closes, the screen
 * reloads and the explanation is shown as an error toast (read by screen readers); focus returns to the button that
 * opened the dialog, like any closed dialog. The error is still thrown so the dialog does not report success. Other
 * errors stay in the dialog for a retry.
 */
async function act(props: ActionProps, action: AlertAction, call: () => Promise<unknown>) {
  try { await call() } catch (error) {
    const shown = alertActionError(error, action, props.screen)
    if (isConflict(error)) {
      props.close(); props.changed(); notifyAlertsChanged()
      toast.error(shown instanceof Error ? shown.message : 'Cảnh báo đã thay đổi.', { description: summary(props.alert) })
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
      <p className="mt-2!">Hệ thống ghi tài khoản của bạn và thời điểm xác nhận để mọi người biết cảnh báo đã có người xử lý. Không hoàn tác được; khi xử lý xong hãy dùng “Đóng”.</p>
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
    description="Chỉ đóng khi sự cố đã được xử lý xong. Hệ thống ghi tài khoản của bạn, thời điểm và ghi chú; cảnh báo đã đóng không mở lại được. Nếu sự cố vẫn còn, lần kiểm tra kế tiếp sẽ tạo cảnh báo mới."
    onSubmit={async () => {
      if (note.trim().length > RESOLUTION_NOTE_MAX) form.fail({ note: `Tối đa ${RESOLUTION_NOTE_MAX} ký tự.` })
      await act(props, 'resolve', () => alertsApi.resolve(alert.id, resolveBody(note)))
    }}>
    <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">
      <dt className="text-muted-foreground">Cảnh báo</dt><dd>{alertTypeLabel(alert.type)}: {alert.title}</dd>
      <dt className="text-muted-foreground">Máy</dt><dd className="font-mono">{alert.machineCode}</dd>
      {alert.acknowledgedAt && <><dt className="text-muted-foreground">Đã xác nhận</dt><dd className="break-all">{handlingSteps(alert).find(step => step.key === 'acknowledged')?.by}</dd></>}
    </dl>
    <FormField label="Ghi chú xử lý (không bắt buộc)" error={form.errors.note} hint={`Đã làm gì để xử lý, ví dụ “Đã rút hộp hết hạn ở ngăn B”. ${note.trim().length}/${RESOLUTION_NOTE_MAX} ký tự.`} className="mb-2">
      <Textarea value={note} maxLength={RESOLUTION_NOTE_MAX} className="max-sm:text-base" onChange={event => form.set('note')(event.target.value)} />
    </FormField>
  </FormSheet>
}

/** Who acknowledged and who closed the alert, with times (and the note on the detail screen). */
export function HandledBy({ alert, withNote = false, className }: { alert: Alert; withNote?: boolean; className?: string }) {
  const steps = handlingSteps(alert).filter(step => step.key !== 'triggered')
  if (!steps.length) return <span className={cn('text-xs text-muted-foreground', className)}>Chưa có người tiếp nhận</span>
  return <ul className={cn('grid gap-0.5 text-xs text-muted-foreground', className)}>
    {steps.map(step => <li key={step.key} className="break-words">
      <span className="font-medium text-foreground">{step.label}:</span> {step.by}, {step.at}
      {withNote && step.note && <><br /><span>Ghi chú: </span><span className="whitespace-pre-wrap text-foreground">{step.note}</span></>}
    </li>)}
  </ul>
}

/** Link to the unfinished work order handling the alert (workOrderId / workOrderCode of the response), if any. */
export function AlertWorkOrderLink({ alert, className }: { alert: Alert; className?: string }) {
  const path = workOrderPath(alert.workOrderId)
  if (!path) return null
  const code = alert.workOrderCode || 'phiếu công việc'
  return <Link to={path} className={cn(LINK, className)} label={`Mở phiếu ${code} đang xử lý cảnh báo`}>Phiếu {code}</Link>
}

/** `min` of the due time input: now, as Vietnam local `YYYY-MM-DDTHH:mm`. */
const localMinute = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16)

/**
 * Form of POST /alerts/{alertId}/work-orders. Every field is optional: what is left empty the backend takes from the
 * alert (type from its type, title from its title, priority from its severity). The machine is always the alert's.
 */
function AlertWorkOrderSheet({ alert, close, created, changed }: { alert: Alert; close: () => void; created: (workOrder: WorkOrder) => void; changed?: () => void }) {
  const canUsers = useSession().can('USER_READ')
  const staff = useStaffOptions(canUsers)
  const form = useForm<AlertWorkOrderValues>({ ...NEW_ALERT_WORK_ORDER })
  const { values, errors } = form
  const [now] = useState(() => Date.now())
  const defaults = workOrderDefaults(alert)
  return <FormSheet title="Mở phiếu công việc từ cảnh báo" submitLabel="Mở phiếu" close={close} onFieldErrors={form.setErrors}
    successMessage="Đã mở phiếu công việc" successDescription={summary(alert)}
    description="Phiếu giao việc tại máy của cảnh báo cho nhân viên. Mọi ô đều không bắt buộc: để trống thì hệ thống lấy theo cảnh báo. Cảnh báo đang mở sẽ chuyển sang Đã tiếp nhận."
    onSubmit={async () => {
      const problems = validateAlertWorkOrder(values, Date.now())
      if (Object.keys(problems).length) form.fail(problems)
      let workOrder: WorkOrder
      try { workOrder = await alertsApi.createWorkOrder(alert.id, alertWorkOrderBody(values)) } catch (error) {
        const shown = workOrderError(error)
        if (isConflict(error)) {
          close(); changed?.(); notifyAlertsChanged()
          toast.error(shown instanceof Error ? shown.message : 'Cảnh báo đã thay đổi.', { description: summary(alert) })
        }
        throw shown
      }
      created(workOrder)
    }}>
    <p className="mb-4! rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">
      <span className="text-muted-foreground">Cảnh báo: </span>{summary(alert)}{alert.slotCode ? `, ngăn ${alert.slotCode}` : ''}: {alert.title}
    </p>
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Loại phiếu" error={errors.type} className="mb-4" hint="Nạp hàng: mang hộp tới ngăn. Bảo trì: sửa, vệ sinh, kiểm tra máy.">
        <NativeSelect value={values.type} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('type')(event.target.value)}>
          <option value="">Theo cảnh báo ({WORK_ORDER_TYPE_LABELS[defaults.type]})</option>
          {WORK_ORDER_TYPES.map(type => <option key={type} value={type}>{WORK_ORDER_TYPE_LABELS[type]}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Mức ưu tiên" error={errors.priority} className="mb-4">
        <NativeSelect value={values.priority} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('priority')(event.target.value)}>
          <option value="">Theo mức độ cảnh báo ({WORK_ORDER_PRIORITY_LABELS[defaults.priority]})</option>
          {WORK_ORDER_PRIORITIES.map(priority => <option key={priority} value={priority}>{WORK_ORDER_PRIORITY_LABELS[priority]}</option>)}
        </NativeSelect>
      </FormField>
    </div>
    <FormField label="Tiêu đề (không bắt buộc)" error={errors.title} className="mb-4" hint={`Để trống thì dùng tiêu đề cảnh báo. Tối đa ${WORK_ORDER_LIMITS.title} ký tự.`}>
      <Input value={values.title} maxLength={WORK_ORDER_LIMITS.title} placeholder={alert.title} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('title')(event.target.value)} />
    </FormField>
    <FormField label="Mô tả (không bắt buộc)" error={errors.description} className="mb-4" hint={`Hướng dẫn cho người làm. ${values.description.trim().length}/${WORK_ORDER_LIMITS.description} ký tự.`}>
      <Textarea value={values.description} maxLength={WORK_ORDER_LIMITS.description} className="max-sm:text-base" onChange={event => form.set('description')(event.target.value)} />
    </FormField>
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Thời hạn (không bắt buộc)" error={errors.dueAt} className="mb-4" hint="Giờ Việt Nam; phải ở tương lai.">
        <Input type="datetime-local" value={values.dueAt} min={localMinute(now)} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('dueAt')(event.target.value)} />
      </FormField>
      <FormField label="Người phụ trách (không bắt buộc)" error={errors.assigneeId} className="mb-4"
        hint={!canUsers ? 'Tài khoản này không xem được danh sách nhân viên; phân công sau.' : staff.error ? 'Không tải được danh sách nhân viên; có thể phân công sau.' : staff.loading ? 'Đang tải danh sách nhân viên…' : 'Để trống thì phiếu chờ phân công.'}>
        <NativeSelect value={values.assigneeId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('assigneeId')(event.target.value)}>
          <option value="">Chưa phân công</option>
          {staff.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
    </div>
  </FormSheet>
}

/**
 * "Mở phiếu": opens the work-order form of the alert for accounts with WORK_ORDER_MANAGE; others read who opens
 * tickets. An alert already handled by an unfinished work order shows the link to it instead. After creating, a link to
 * the new work order stays in place and `changed` reloads the alert (it is now ACKNOWLEDGED and linked).
 * With TICKETS_AVAILABLE off the button stays focusable but disabled (aria-disabled) with the reason next to it.
 */
export function OpenTicketButton({ alert, changed }: { alert: Alert; changed?: () => void }) {
  const hintId = useId()
  const { can } = useSession()
  const sheet = useDialog()
  const [opened, setOpened] = useState<WorkOrder | null>(null)
  if (opened) {
    const openedPath = workOrderPath(opened.id)
    return <p role="status" tabIndex={-1} data-focus-key={`alert-ticket-${alert.id}`} className="text-[13px] focus-visible:outline-2 focus-visible:outline-ring">
      Đã mở phiếu {opened.code ?? ''} “{opened.title}”. {openedPath && <Link to={openedPath} className={LINK}>Xem phiếu</Link>}</p>
  }
  if (alert.workOrderId) return <p className="text-[13px]">Cảnh báo đang được xử lý bằng <AlertWorkOrderLink alert={alert} />.</p>
  if (TICKETS_AVAILABLE) {
    if (!can('WORK_ORDER_MANAGE')) return <p className="max-w-[60ch] text-xs text-muted-foreground">{TICKET_ADMIN_ONLY_TEXT}</p>
    return <div className="grid gap-2">
      <Button type="button" variant="outline" size="sm" className="w-fit max-sm:h-11" data-focus-key={`alert-ticket-${alert.id}`} onClick={() => sheet.open()}>Mở phiếu</Button>
      {sheet.value && <AlertWorkOrderSheet alert={alert} close={sheet.close} changed={changed}
        created={workOrder => { setOpened(workOrder); notifyAlertsChanged(); changed?.() }} />}
    </div>
  }
  return <div className="grid gap-1">
    <Button type="button" variant="outline" size="sm" aria-disabled="true" aria-describedby={hintId} className="w-fit cursor-not-allowed border-dashed text-muted-foreground hover:bg-card hover:text-muted-foreground max-sm:h-11"
      onClick={event => event.preventDefault()}>Mở phiếu</Button>
    <p id={hintId} className="max-w-[60ch] text-xs text-muted-foreground">{TICKET_PENDING_TEXT}</p>
  </div>
}
