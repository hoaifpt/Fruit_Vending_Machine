// Pieces shared by the work ticket screens (FE 7.1) and the alert detail ("Mở phiếu"): the next-step buttons, the
// create / assign / start / complete / cancel dialogs, and who did each step. No delete anywhere: a ticket only moves
// forward (OPEN → ASSIGNED → IN_PROGRESS → COMPLETED) or is cancelled with a reason.
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '../api/client.ts'
import { ticketsApi } from '../api/resources.ts'
import type { WorkTicket } from '../api/resources.ts'
import { Button } from '../components/ui/button.tsx'
import { FormField } from '../components/ui/form-field.tsx'
import { Input, NativeSelect, Textarea } from '../components/ui/input.tsx'
import { cn } from '../lib/cn.ts'
import { formatDateTime } from '../lib/format.ts'
import { ConfirmDialog, FormSheet, Link, useForm } from './kit.tsx'
import { useMachineOptions, useStaffOptions } from './options.ts'
import { restockPath } from './restock.ts'
import { useSession } from './useSession.ts'
import {
  CREATABLE_TICKET_TYPE_OPTIONS, NEW_TICKET, TICKETS_MISSING, TICKET_LIMITS, actionLabel, assigneeText, cancelBody, completeBody, createTicketBody, isStale,
  nextActions, ticketActionError, ticketSteps, ticketTypeLabel, ticketsAvailability, validateTicket,
} from './tickets.ts'
import type { TicketAction, TicketScreen, TicketValues, TicketViewer } from './tickets.ts'

const summary = (ticket: WorkTicket) => `${ticketTypeLabel(ticket.type)} · máy ${ticket.machineCode}`
const TOUCH = 'max-sm:h-11'

export interface TicketActionState { action: TicketAction; ticket: WorkTicket }

/**
 * Only the valid next step(s) for this viewer and status (nextActions), progress first; nothing when there is none.
 * The first button's `data-focus-key` names the ticket's next step, so after an action focus lands on the new next step
 * (Bắt đầu → Hoàn tất) instead of falling back to the page.
 */
export function TicketActionButtons({ ticket, viewer, open, where }: {
  ticket: WorkTicket; viewer: TicketViewer; open: (state: TicketActionState) => void; where: TicketScreen
}) {
  const actions = nextActions(ticket, viewer)
  if (!actions.length) return null
  return <span className="flex flex-wrap gap-1.5">
    {actions.map((action, index) => {
      const label = actionLabel(action, ticket)
      const primary = index === 0 && action !== 'cancel' && where === 'detail'
      // FE 7.2: a RESTOCK ticket with lines is started and completed on the restock screen (door, reconciliation).
      if (action === 'restock') return <Button key={index === 0 ? 'next' : action} asChild size={where === 'list' ? 'sm' : 'default'} className={TOUCH} variant={primary ? 'default' : 'outline'}>
        <Link to={restockPath(ticket.id)} label={where === 'list' ? `${label}: ${ticket.title}` : undefined}>{label}</Link>
      </Button>
      // The first button keeps its React key across steps, so the same element (and its focus) becomes the new next step.
      return <Button key={index === 0 ? 'next' : action} type="button" size={where === 'list' ? 'sm' : 'default'} className={TOUCH}
        variant={action === 'cancel' ? (where === 'list' ? 'ghost' : 'outline') : primary ? 'default' : 'outline'}
        data-focus-key={index === 0 ? `ticket-next-${ticket.id}` : `ticket-${action}-${ticket.id}`}
        aria-label={where === 'list' ? `${label}: ${ticket.title}` : undefined}
        onClick={() => open({ action, ticket })}>{label}</Button>
    })}
  </span>
}

interface ActionProps { ticket: WorkTicket; close: () => void; changed: () => void; screen: TicketScreen }

/**
 * Runs an action. A 409 (the ticket changed meanwhile) or a 403 on start/complete (no longer theirs): retrying cannot
 * help, so the dialog closes, the screen reloads and the explanation is an error toast; focus returns to the opener.
 * The error is still thrown so the dialog does not report success. Other errors stay in the dialog for a retry.
 */
async function act(props: ActionProps, action: TicketAction, call: () => Promise<unknown>) {
  try { await call() } catch (error) {
    const shown = ticketActionError(error, action, props.screen)
    if (isStale(error, action)) {
      props.close(); props.changed()
      toast.error(shown instanceof Error ? shown.message : 'Phiếu đã thay đổi.', { description: summary(props.ticket) })
    }
    throw shown
  }
  props.changed()
}

function TicketFacts({ ticket }: { ticket: WorkTicket }) {
  return <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">
    <dt className="text-muted-foreground">Phiếu</dt><dd className="min-w-0 break-words">{ticket.title}</dd>
    <dt className="text-muted-foreground">Máy</dt><dd className="font-mono">{ticket.machineCode}</dd>
    <dt className="text-muted-foreground">Phụ trách</dt><dd>{assigneeText(ticket)}</dd>
  </dl>
}

/** OPEN/ASSIGNED → ASSIGNED: pick an active staff account. */
export function AssignSheet(props: ActionProps) {
  const { ticket, close } = props
  const canUsers = useSession().can('USER_READ')
  const staff = useStaffOptions(canUsers)
  const form = useForm({ assigneeId: ticket.assigneeId ?? '' })
  const reassign = ticket.status === 'ASSIGNED'
  return <FormSheet title={reassign ? 'Đổi người phụ trách' : 'Phân công phiếu'} submitLabel={reassign ? 'Đổi người' : 'Phân công'} close={close} onFieldErrors={form.setErrors}
    successMessage={reassign ? 'Đã đổi người phụ trách' : 'Đã phân công phiếu'} successDescription={summary(ticket)}
    description="Nhân viên được chọn sẽ thấy phiếu trong mục Phiếu công việc của mình. Hệ thống ghi tên bạn và thời điểm phân công."
    onSubmit={async () => {
      if (!form.values.assigneeId) form.fail({ assigneeId: 'Chọn nhân viên phụ trách.' })
      await act(props, 'assign', () => ticketsApi.assign(ticket.id, { assigneeId: form.values.assigneeId }))
    }}>
    <TicketFacts ticket={ticket} />
    <FormField label="Nhân viên phụ trách" required error={form.errors.assigneeId} className="mb-2"
      hint={!canUsers ? 'Tài khoản này không có quyền xem danh sách nhân viên (Xem tài khoản) nên không phân công được. Nhờ quản trị viên cấp quyền.' : staff.error ? 'Không tải được danh sách nhân viên. Đóng rồi mở lại để thử lại.' : staff.loading ? 'Đang tải danh sách nhân viên…' : staff.options.length ? 'Chỉ tài khoản nhân viên đang hoạt động.' : 'Chưa có tài khoản nhân viên đang hoạt động. Tạo ở màn Tài khoản.'}>
      <NativeSelect value={form.values.assigneeId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('assigneeId')(event.target.value)}>
        <option value="">Chọn nhân viên…</option>
        {staff.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </FormField>
  </FormSheet>
}

/** ASSIGNED → IN_PROGRESS, by the assignee. */
export function StartDialog(props: ActionProps) {
  const { ticket, close } = props
  return <ConfirmDialog title="Bắt đầu làm phiếu này?" confirmLabel="Bắt đầu" close={close}
    successMessage="Đã bắt đầu phiếu" successDescription={summary(ticket)}
    message={<>
      <p><strong className="font-medium text-foreground">{summary(ticket)}</strong>: {ticket.title}</p>
      <p className="mt-2!">Hệ thống ghi tên bạn và thời điểm bắt đầu để quản trị viên biết phiếu đang được làm. Làm xong thì bấm “Hoàn tất”.</p>
    </>}
    onConfirm={() => act(props, 'start', () => ticketsApi.start(ticket.id))} />
}

/** IN_PROGRESS → COMPLETED, by the assignee, with an optional note. */
export function CompleteSheet(props: ActionProps) {
  const { ticket, close } = props
  const form = useForm({ note: '' })
  const note = form.values.note
  return <FormSheet title="Hoàn tất phiếu" submitLabel="Hoàn tất" close={close} onFieldErrors={form.setErrors}
    successMessage="Đã hoàn tất phiếu" successDescription={summary(ticket)}
    description="Chỉ hoàn tất khi việc tại máy đã xong. Hệ thống ghi tên bạn, thời điểm và ghi chú; phiếu đã hoàn tất không mở lại được."
    onSubmit={async () => {
      if (note.trim().length > TICKET_LIMITS.note) form.fail({ note: `Tối đa ${TICKET_LIMITS.note} ký tự.` })
      await act(props, 'complete', () => ticketsApi.complete(ticket.id, completeBody(note)))
    }}>
    <TicketFacts ticket={ticket} />
    <FormField label="Ghi chú (không bắt buộc)" error={form.errors.note} className="mb-2"
      hint={`Đã làm gì, ví dụ “Đã nạp 6 hộp vào ngăn A2”. ${note.trim().length}/${TICKET_LIMITS.note} ký tự.`}>
      <Textarea value={note} maxLength={TICKET_LIMITS.note} className="max-sm:text-base" onChange={event => form.set('note')(event.target.value)} />
    </FormField>
  </FormSheet>
}

/** Any state before COMPLETED → CANCELLED, admins only, with a mandatory reason. Asks first: it cannot be undone. */
export function CancelSheet(props: ActionProps) {
  const { ticket, close } = props
  const form = useForm({ reason: '' })
  const reason = form.values.reason
  return <FormSheet title="Hủy phiếu công việc?" submitLabel="Hủy phiếu" danger close={close} onFieldErrors={form.setErrors}
    successMessage="Đã hủy phiếu" successDescription={summary(ticket)}
    description={<>Phiếu bị hủy không làm tiếp và không mở lại được{ticket.assigneeId ? `; ${assigneeText(ticket)} sẽ thấy phiếu đã hủy cùng lý do` : ''}. Phiếu không bị xóa: hệ thống giữ lại cùng tên bạn, thời điểm và lý do.</>}
    onSubmit={async () => {
      const { body, error } = cancelBody(reason)
      if (!body) form.fail({ reason: error ?? 'Nhập lý do hủy.' })
      await act(props, 'cancel', () => ticketsApi.cancel(ticket.id, body!))
    }}>
    <TicketFacts ticket={ticket} />
    <FormField label="Lý do hủy" required error={form.errors.reason} className="mb-2"
      hint={`Ví dụ “Máy đã được thay, không cần bảo trì nữa”. ${reason.trim().length}/${TICKET_LIMITS.reason} ký tự.`}>
      <Textarea value={reason} maxLength={TICKET_LIMITS.reason} className="max-sm:text-base" onChange={event => form.set('reason')(event.target.value)} />
    </FormField>
  </FormSheet>
}

/** The dialog of the chosen action, if any. */
export function TicketActionDialog({ state, close, changed, screen }: { state: TicketActionState | null; close: () => void; changed: () => void; screen: TicketScreen }) {
  if (!state) return null
  const props = { ticket: state.ticket, close, changed, screen }
  switch (state.action) {
    case 'assign': return <AssignSheet {...props} />
    case 'start': return <StartDialog {...props} />
    case 'complete': return <CompleteSheet {...props} />
    case 'cancel': return <CancelSheet {...props} />
  }
}

/** Errors of POST /work-tickets the form explains itself: no endpoint yet, or the alert closed meanwhile. */
function createError(error: unknown): unknown {
  if (ticketsAvailability(error) === 'missing') return new ApiError(404, TICKETS_MISSING)
  if (error instanceof ApiError && error.status === 409) return new ApiError(409, 'Cảnh báo này vừa được đóng nên không mở phiếu từ nó được nữa. Hãy mở phiếu không gắn cảnh báo nếu vẫn cần làm việc tại máy.')
  return error
}

/**
 * Opens a ticket (TICKET_WRITE). `initial` pre-fills it, e.g. from an alert (ticketFromAlert): the machine is then
 * locked, since the alert belongs to it. Only fields of CreateWorkTicketRequest are sent, optional ones when filled in.
 */
export function CreateTicketSheet({ initial = NEW_TICKET, alertLabel, close, created }: {
  initial?: TicketValues; alertLabel?: string; close: () => void; created: (ticket: WorkTicket) => void
}) {
  const machines = useMachineOptions()
  const canUsers = useSession().can('USER_READ')
  const staff = useStaffOptions(canUsers)
  const form = useForm<TicketValues>({ ...initial })
  const { values, errors } = form
  const [now] = useState(() => Date.now())
  const fromAlert = !!initial.alertId
  return <FormSheet title="Tạo phiếu công việc" submitLabel="Tạo phiếu" close={close} onFieldErrors={form.setErrors}
    successMessage="Đã tạo phiếu công việc" successDescription={values.title.trim() || null}
    description="Phiếu giao một việc tại máy cho nhân viên. Chọn người phụ trách ngay hoặc phân công sau; phiếu không xóa được, chỉ hủy kèm lý do."
    onSubmit={async () => {
      const problems = validateTicket(values, Date.now())
      if (Object.keys(problems).length) form.fail(problems)
      let ticket: WorkTicket
      try { ticket = await ticketsApi.create(createTicketBody(values)) } catch (error) { throw createError(error) }
      created(ticket)
    }}>
    {fromAlert && <p className="mb-4! rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">
      <span className="text-muted-foreground">Mở từ cảnh báo: </span>{alertLabel ?? 'cảnh báo đã chọn'}. Phiếu ghi lại cảnh báo này để mọi người lần ra nguồn gốc.
    </p>}
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Loại phiếu" required error={errors.type} className="mb-4" hint="Nạp hàng: mang hộp tới ngăn. Bảo trì: sửa, vệ sinh, kiểm tra máy.">
        <NativeSelect value={values.type} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('type')(event.target.value)}>
          <option value="">Chọn loại…</option>
          {CREATABLE_TICKET_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Máy" required error={errors.machineId} className="mb-4" disabled={fromAlert}
        hint={fromAlert ? 'Máy của cảnh báo, không đổi được.' : machines.length ? undefined : 'Đang tải danh sách máy…'}>
        <NativeSelect value={values.machineId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('machineId')(event.target.value)}>
          <option value="">Chọn máy…</option>
          {machines.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
    </div>
    <FormField label="Tiêu đề" required error={errors.title} className="mb-4" hint={`Việc cần làm, ngắn gọn. Tối đa ${TICKET_LIMITS.title} ký tự.`}>
      <Input value={values.title} maxLength={TICKET_LIMITS.title} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('title')(event.target.value)} />
    </FormField>
    <FormField label="Mô tả (không bắt buộc)" error={errors.description} className="mb-4" hint={`Hướng dẫn cho người làm. ${values.description.trim().length}/${TICKET_LIMITS.description} ký tự.`}>
      <Textarea value={values.description} maxLength={TICKET_LIMITS.description} className="max-sm:text-base" onChange={event => form.set('description')(event.target.value)} />
    </FormField>
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Thời hạn (không bắt buộc)" error={errors.dueAt} className="mb-4" hint="Giờ Việt Nam; phải ở tương lai.">
        <Input type="datetime-local" value={values.dueAt} min={localMinute(now)} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('dueAt')(event.target.value)} />
      </FormField>
      <FormField label="Người phụ trách (không bắt buộc)" error={errors.assigneeId} className="mb-4"
        hint={!canUsers ? 'Tài khoản này không có quyền xem danh sách nhân viên; phiếu ở trạng thái Chưa phân công, phân công sau.' : staff.error ? 'Không tải được danh sách nhân viên; có thể phân công sau.' : staff.loading ? 'Đang tải danh sách nhân viên…' : 'Để trống thì phiếu ở trạng thái Chưa phân công.'}>
        <NativeSelect value={values.assigneeId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('assigneeId')(event.target.value)}>
          <option value="">Chưa phân công</option>
          {staff.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
    </div>
  </FormSheet>
}

/** `min` of the due time input: now, as Vietnam local `YYYY-MM-DDTHH:mm`. */
function localMinute(ms: number): string {
  return new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16)
}

/** Who did each step and when, with the completion note or cancel reason (shown as text). */
export function TicketHistory({ ticket, className }: { ticket: WorkTicket; className?: string }) {
  return <ol className={cn('grid gap-3 text-[14px]', className)}>
    {ticketSteps(ticket).map(step => <li key={step.key} className="grid gap-0.5 border-l-2 border-border pl-3">
      <span><span className="font-medium text-foreground">{step.label}</span> <span className="text-muted-foreground">· {step.at}</span></span>
      <span className="text-[13px] text-muted-foreground">{step.by}</span>
      {step.note && <span className="text-[13px] whitespace-pre-wrap break-words text-foreground">{step.note}</span>}
    </li>)}
  </ol>
}

/** Due time with an "overdue" word (not colour alone) for active tickets past it. */
export function DueText({ ticket, overdue }: { ticket: WorkTicket; overdue: boolean }) {
  if (!ticket.dueAt) return <span className="text-muted-foreground">Không đặt hạn</span>
  return <span className="grid gap-0.5">
    <span className="whitespace-nowrap">{formatDateTime(ticket.dueAt)}</span>
    {overdue && <span className="w-fit rounded-full bg-status-danger px-2 py-0.5 text-xs font-medium text-status-danger-foreground">Quá hạn</span>}
  </span>
}
