// Pieces shared by the work order screens (FE 7.1): the next-step buttons, the create / edit / assign / unassign / start /
// note / complete / cancel dialogs, the history and the due time. No delete anywhere: a work order only moves forward
// (OPEN → ASSIGNED → IN_PROGRESS → DONE) or is cancelled with a reason. Edit, assign, unassign and cancel send the
// version last read; a stale one closes the dialog, reloads and says "Phiếu vừa bị người khác thay đổi, đã tải lại".
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '../api/client.ts'
import { restockApi, workOrdersApi } from '../api/resources.ts'
import type { SlotSuggestion, WorkOrder, WorkOrderEvent } from '../api/resources.ts'
import { Button } from '../components/ui/button.tsx'
import { FormField } from '../components/ui/form-field.tsx'
import { Input, NativeSelect, Textarea } from '../components/ui/input.tsx'
import { cn } from '../lib/cn.ts'
import { formatDateTime } from '../lib/format.ts'
import { ConfirmDialog, FormSheet, Link, useForm } from './kit.tsx'
import { useMachineOptions, useStaffOptions } from './options.ts'
import { restockPath, suggestionText } from './restock.ts'
import { errorMessage, useApi } from './useApi.ts'
import { useSession } from './useSession.ts'
import {
  CREATABLE_TICKET_TYPE_OPTIONS, NEW_TICKET, PRIORITY_OPTIONS, STALE_TEXT, TICKETS_MISSING, TICKET_LIMITS, actionLabel, assigneeText, cancelBody, completeBody,
  createTicketBody, editValues, errorCode, isStale, nextActions, noteText, priorityLabel, restockFromSuggestionsBody, ticketActionError, ticketSteps, ticketTypeLabel,
  ticketsAvailability, updateTicketBody, validateEdit, validateTicket,
} from './tickets.ts'
import type { EditValues, TicketAction, TicketScreen, TicketValues, TicketViewer } from './tickets.ts'

const summary = (ticket: WorkOrder) => `${ticket.code ?? ticketTypeLabel(ticket.type)} · máy ${ticket.machineCode}`
const TOUCH = 'max-sm:h-11'
const CHECK = 'mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export interface TicketActionState { action: TicketAction; ticket: WorkOrder }

/**
 * Only the valid next step(s) for this viewer and status (nextActions); nothing when there is none. The first button's
 * `data-focus-key` names the work order's next step, so after an action focus lands on the new next step.
 */
export function TicketActionButtons({ ticket, viewer, open, where }: {
  ticket: WorkOrder; viewer: TicketViewer; open: (state: TicketActionState) => void; where: TicketScreen
}) {
  const actions = nextActions(ticket, viewer)
  if (!actions.length) return null
  return <span className="flex flex-wrap gap-1.5">
    {actions.map((action, index) => {
      const label = actionLabel(action, ticket)
      const primary = index === 0 && action !== 'cancel' && where === 'detail'
      // FE 7.2: a RESTOCK work order is started and completed on the restock screen (old bowls, loads, gates, variances).
      if (action === 'restock') return <Button key={index === 0 ? 'next' : action} asChild size={where === 'list' ? 'sm' : 'default'} className={TOUCH} variant={primary ? 'default' : 'outline'}>
        <Link to={restockPath(ticket.id!)} label={where === 'list' ? `${label}: ${ticket.title}` : undefined}>{label}</Link>
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

interface ActionProps { ticket: WorkOrder; close: () => void; changed: () => void; screen: TicketScreen }

/**
 * Runs an action. A stale version or another state change (409), or a work order no longer the caller's: retrying cannot
 * help, so the dialog closes, the screen reloads and the explanation is an error toast; focus returns to the opener.
 * The error is still thrown so the dialog does not report success. Other errors stay in the dialog for a retry.
 */
async function act(props: ActionProps, action: TicketAction, call: () => Promise<unknown>) {
  try { await call() } catch (error) {
    const shown = ticketActionError(error, action, props.screen)
    if (isStale(error, action)) {
      props.close(); props.changed()
      toast.error(errorCode(error) === 'STALE_VERSION' ? STALE_TEXT : shown instanceof Error ? shown.message : STALE_TEXT, { description: summary(props.ticket) })
    }
    throw shown
  }
  props.changed()
}

function TicketFacts({ ticket }: { ticket: WorkOrder }) {
  return <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">
    <dt className="text-muted-foreground">Phiếu</dt><dd className="min-w-0 break-words">{ticket.code ? <span className="font-mono">{ticket.code}</span> : null} {ticket.title}</dd>
    <dt className="text-muted-foreground">Máy</dt><dd className="font-mono">{ticket.machineCode}</dd>
    <dt className="text-muted-foreground">Phụ trách</dt><dd>{assigneeText(ticket)}</dd>
  </dl>
}

function staffHint(canUsers: boolean, staff: ReturnType<typeof useStaffOptions>, empty: string): string {
  if (!canUsers) return 'Tài khoản này không có quyền xem danh sách nhân viên (Xem tài khoản) nên không chọn được người. Nhờ quản trị viên cấp quyền.'
  if (staff.error) return 'Không tải được danh sách nhân viên. Đóng rồi mở lại để thử lại.'
  if (staff.loading) return 'Đang tải danh sách nhân viên…'
  return staff.options.length ? 'Chỉ tài khoản nhân viên đang hoạt động, có quyền thực hiện phiếu.' : empty
}

/** OPEN/ASSIGNED/IN_PROGRESS → ASSIGNED (IN_PROGRESS keeps its status): pick an active staff account. */
export function AssignSheet(props: ActionProps) {
  const { ticket, close } = props
  const canUsers = useSession().can('USER_READ')
  const staff = useStaffOptions(canUsers)
  const form = useForm({ assigneeId: ticket.assignee?.id ?? '' })
  const reassign = ticket.status !== 'OPEN'
  return <FormSheet title={reassign ? 'Đổi người phụ trách' : 'Phân công phiếu'} submitLabel={reassign ? 'Đổi người' : 'Phân công'} close={close} onFieldErrors={form.setErrors}
    successMessage={reassign ? 'Đã đổi người phụ trách' : 'Đã phân công phiếu'} successDescription={summary(ticket)}
    description={`Nhân viên được chọn nhận thông báo và thấy phiếu trong “Phiếu công việc” của mình.${ticket.status === 'IN_PROGRESS' ? ' Phiếu đang thực hiện vẫn giữ trạng thái, người mới làm tiếp.' : ''}`}
    onSubmit={async () => {
      if (!form.values.assigneeId) form.fail({ assigneeId: 'Chọn nhân viên phụ trách.' })
      if (form.values.assigneeId === ticket.assignee?.id) form.fail({ assigneeId: 'Đây đã là người phụ trách hiện tại. Chọn người khác.' })
      await act(props, 'assign', () => workOrdersApi.assign(ticket.id!, { assigneeId: form.values.assigneeId, version: ticket.version ?? 0 }))
    }}>
    <TicketFacts ticket={ticket} />
    <FormField label="Nhân viên phụ trách" required error={form.errors.assigneeId} className="mb-2"
      hint={staffHint(canUsers, staff, 'Chưa có tài khoản nhân viên đang hoạt động. Tạo ở màn Tài khoản.')}>
      <NativeSelect value={form.values.assigneeId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('assigneeId')(event.target.value)}>
        <option value="">Chọn nhân viên…</option>
        {ticket.assignee?.id && !staff.options.some(option => option.value === ticket.assignee?.id) && <option value={ticket.assignee.id}>{assigneeText(ticket)}</option>}
        {staff.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </FormField>
  </FormSheet>
}

/** ASSIGNED → OPEN, after a confirmation. */
export function UnassignDialog(props: ActionProps) {
  const { ticket, close } = props
  return <ConfirmDialog title="Bỏ phân công phiếu này?" confirmLabel="Bỏ phân công" close={close}
    successMessage="Đã bỏ phân công" successDescription={summary(ticket)}
    message={<p><strong className="font-medium text-foreground">{summary(ticket)}</strong>: phiếu về trạng thái Chưa phân công; {assigneeText(ticket)} không còn thấy phiếu trong danh sách của mình.</p>}
    onConfirm={() => act(props, 'unassign', () => workOrdersApi.unassign(ticket.id!, ticket.version ?? 0))} />
}

/** ASSIGNED → IN_PROGRESS by the assignee (or a manager). RESTOCK/MAINTENANCE stop the machine; INCIDENT only when asked. */
export function StartDialog(props: ActionProps) {
  const { ticket, close } = props
  const incident = ticket.type === 'INCIDENT'
  const [stop, setStop] = useState(false)
  return <ConfirmDialog title="Bắt đầu làm phiếu này?" confirmLabel="Bắt đầu" close={close}
    successMessage="Đã bắt đầu phiếu" successDescription={summary(ticket)}
    message={<>
      <p><strong className="font-medium text-foreground">{summary(ticket)}</strong>: {ticket.title}</p>
      {incident
        ? <label className="mt-3 flex items-start gap-2 text-foreground">
          <input type="checkbox" className={CHECK} checked={stop} onChange={event => setStop(event.target.checked)} />
          <span>Chuyển máy sang Bảo trì (kiosk ngừng bán) trong lúc xử lý. Bỏ chọn nếu sự cố chỉ cần hoàn tiền.</span>
        </label>
        : <p className="mt-2!">Máy <strong className="font-medium text-foreground">{ticket.machineCode}</strong> chuyển sang Bảo trì, kiosk ngừng bán cho tới khi quản trị viên bật lại. Nếu máy còn đơn đang thanh toán, hãy chờ vài phút rồi thử lại.</p>}
      <p className="mt-2!">Hệ thống ghi tên bạn và thời điểm bắt đầu. Làm xong thì bấm “Hoàn tất” và ghi kết quả.</p>
    </>}
    onConfirm={() => act(props, 'start', () => workOrdersApi.start(ticket.id!, incident && stop ? { stopMachine: true } : undefined))} />
}

/** IN_PROGRESS → DONE with a mandatory result note; linked alerts are resolved unless unticked. */
export function CompleteSheet(props: ActionProps) {
  const { ticket, close } = props
  const form = useForm({ note: '' })
  const openAlerts = (ticket.linkedAlerts ?? []).filter(alert => alert.status !== 'RESOLVED')
  const [resolve, setResolve] = useState(true)
  const note = form.values.note
  return <FormSheet title="Hoàn tất phiếu" submitLabel="Hoàn tất" close={close} onFieldErrors={form.setErrors}
    successMessage="Đã hoàn tất phiếu" successDescription={summary(ticket)}
    description="Chỉ hoàn tất khi việc tại máy đã xong. Hệ thống ghi tên bạn, thời điểm và kết quả; phiếu đã hoàn tất không mở lại được. Máy vẫn ở Bảo trì cho tới khi quản trị viên bật lại."
    onSubmit={async () => {
      const { body, error } = completeBody(note)
      if (!body) form.fail({ resultNote: error ?? '' })
      await act(props, 'complete', () => workOrdersApi.complete(ticket.id!, resolve ? body! : { ...body!, resolveLinkedAlerts: false }))
    }}>
    <TicketFacts ticket={ticket} />
    <FormField label="Kết quả" required error={form.errors.resultNote} className="mb-3"
      hint={`Đã làm gì, ví dụ “Thay servo cột A, thử nhả 2 hộp”. ${note.trim().length}/${TICKET_LIMITS.note} ký tự.`}>
      <Textarea value={note} maxLength={TICKET_LIMITS.note} className="max-sm:text-base" onChange={event => form.set('note')(event.target.value)} />
    </FormField>
    {openAlerts.length > 0 && <label className="flex items-start gap-2 text-[14px]">
      <input type="checkbox" className={CHECK} checked={resolve} onChange={event => setResolve(event.target.checked)} />
      <span>Đóng {openAlerts.length} cảnh báo gắn với phiếu ({openAlerts.map(alert => alert.title).filter(Boolean).join('; ')}). Cảnh báo mà điều kiện vẫn còn sẽ tự mở lại ở lần kiểm tra sau.</span>
    </label>}
  </FormSheet>
}

/** Any unfinished state → CANCELLED, managers only, with a mandatory reason. Asks first: it cannot be undone. */
export function CancelSheet(props: ActionProps) {
  const { ticket, close } = props
  const form = useForm({ reason: '' })
  const reason = form.values.reason
  return <FormSheet title="Hủy phiếu công việc?" submitLabel="Hủy phiếu" danger close={close} onFieldErrors={form.setErrors}
    successMessage="Đã hủy phiếu" successDescription={summary(ticket)}
    description={<>Phiếu bị hủy không làm tiếp và không mở lại được{ticket.assignee?.id ? `; ${assigneeText(ticket)} sẽ nhận thông báo cùng lý do` : ''}. Trạng thái máy không đổi. Phiếu không bị xóa: hệ thống giữ lại cùng tên bạn, thời điểm và lý do.</>}
    onSubmit={async () => {
      const { body, error } = cancelBody(reason, ticket.version)
      if (!body) form.fail({ reason: error ?? 'Nhập lý do hủy.' })
      await act(props, 'cancel', () => workOrdersApi.cancel(ticket.id!, body!))
    }}>
    <TicketFacts ticket={ticket} />
    <FormField label="Lý do hủy" required error={form.errors.reason} className="mb-2"
      hint={`Ví dụ “Máy đã được thay, không cần bảo trì nữa”. ${reason.trim().length}/${TICKET_LIMITS.reason} ký tự.`}>
      <Textarea value={reason} maxLength={TICKET_LIMITS.reason} className="max-sm:text-base" onChange={event => form.set('reason')(event.target.value)} />
    </FormField>
  </FormSheet>
}

/** Edit title, description, priority and due time of an unfinished work order (managers). Only changed fields are sent. */
export function EditSheet(props: ActionProps) {
  const { ticket, close } = props
  const form = useForm<EditValues>(editValues(ticket))
  const { values, errors } = form
  const [now] = useState(() => Date.now())
  return <FormSheet title="Sửa phiếu công việc" submitLabel="Lưu thay đổi" close={close} onFieldErrors={form.setErrors}
    successMessage="Đã lưu phiếu" successDescription={summary(ticket)}
    description="Đổi thời hạn thì nhắc quá hạn được bật lại. Máy và loại phiếu không đổi được."
    onSubmit={async () => {
      const problems = validateEdit(values, Date.now(), ticket.dueAt)
      if (Object.keys(problems).length) form.fail(problems)
      const body = updateTicketBody(ticket, values)
      if (!body) throw new Error('Chưa có thay đổi nào để lưu. Sửa một ô rồi bấm “Lưu thay đổi”, hoặc bấm Hủy.')
      await act(props, 'edit', () => workOrdersApi.update(ticket.id!, body))
    }}>
    <TicketFacts ticket={ticket} />
    <FormField label="Tiêu đề" required error={errors.title} className="mb-4">
      <Input value={values.title} maxLength={TICKET_LIMITS.title} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('title')(event.target.value)} />
    </FormField>
    <FormField label="Mô tả" error={errors.description} className="mb-4" hint={`Để trống để xóa mô tả. ${values.description.trim().length}/${TICKET_LIMITS.description} ký tự.`}>
      <Textarea value={values.description} maxLength={TICKET_LIMITS.description} className="max-sm:text-base" onChange={event => form.set('description')(event.target.value)} />
    </FormField>
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Mức ưu tiên" error={errors.priority} className="mb-4">
        <NativeSelect value={values.priority} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('priority')(event.target.value)}>
          {PRIORITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Thời hạn" error={errors.dueAt} className="mb-4" hint="Giờ Việt Nam; hạn mới phải ở tương lai.">
        <Input type="datetime-local" value={values.dueAt} min={localMinute(now)} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('dueAt')(event.target.value)} />
      </FormField>
    </div>
  </FormSheet>
}

/** A note on an unfinished work order (assignee or manager); it goes to the history. */
export function NoteSheet(props: ActionProps) {
  const { ticket, close } = props
  const form = useForm({ note: '' })
  return <FormSheet title="Thêm ghi chú" submitLabel="Lưu ghi chú" close={close} onFieldErrors={form.setErrors}
    successMessage="Đã thêm ghi chú" successDescription={summary(ticket)}
    description="Ghi chú vào lịch sử phiếu, ví dụ đã kiểm tra gì, còn thiếu gì. Không sửa hay xóa được sau khi lưu."
    onSubmit={async () => {
      const { note, error } = noteText(form.values.note)
      if (!note) form.fail({ note: error ?? '' })
      await act(props, 'note', () => workOrdersApi.note(ticket.id!, note!))
    }}>
    <TicketFacts ticket={ticket} />
    <FormField label="Ghi chú" required error={form.errors.note} className="mb-2" hint={`${form.values.note.trim().length}/${TICKET_LIMITS.note} ký tự.`}>
      <Textarea value={form.values.note} maxLength={TICKET_LIMITS.note} className="max-sm:text-base" onChange={event => form.set('note')(event.target.value)} />
    </FormField>
  </FormSheet>
}

/** The dialog of the chosen action, if any. */
export function TicketActionDialog({ state, close, changed, screen }: { state: TicketActionState | null; close: () => void; changed: () => void; screen: TicketScreen }) {
  if (!state) return null
  const props = { ticket: state.ticket, close, changed, screen }
  switch (state.action) {
    case 'assign': return <AssignSheet {...props} />
    case 'unassign': return <UnassignDialog {...props} />
    case 'start': return <StartDialog {...props} />
    case 'complete': return <CompleteSheet {...props} />
    case 'cancel': return <CancelSheet {...props} />
    case 'edit': return <EditSheet {...props} />
    case 'note': return <NoteSheet {...props} />
  }
}

/** Errors of creating a work order the form explains itself. */
function createError(error: unknown): unknown {
  if (ticketsAvailability(error) === 'missing' && error instanceof ApiError && error.status !== 404) return new ApiError(error.status, TICKETS_MISSING)
  const code = errorCode(error)
  if (code === 'MACHINE_INACTIVE') return new ApiError(409, 'Máy đang Ngừng hoạt động nên không tạo phiếu được. Bật máy (Hoạt động hoặc Bảo trì) trước.')
  if (code === 'NOTHING_TO_RESTOCK') return new ApiError(409, 'Máy không có ngăn nào cần nạp theo gợi ý (các ngăn còn đủ hàng hoặc chưa biết sản phẩm). Không có phiếu nào được tạo.')
  if (error instanceof ApiError && error.status === 400 && !Object.keys(error.fieldErrors).length && /assignee/i.test(error.message)) {
    return new ApiError(400, 'Người được chọn không nhận phiếu được (không hoạt động hoặc thiếu quyền thực hiện phiếu). Chọn người khác.')
  }
  return error
}

/** What the restock suggestions would plan for a machine (RESTOCK_PLAN), shown before creating from them. */
function SuggestionPreview({ machineId }: { machineId: string }) {
  const state = useApi(signal => machineId ? restockApi.suggestions(machineId, signal) : Promise.resolve(undefined), `suggestions|${machineId}`)
  if (!machineId) return <p className="mb-4 text-[13px] text-muted-foreground">Chọn máy để xem gợi ý nạp hàng.</p>
  if (state.error && !state.data) return <p role="alert" className="mb-4 text-[13px] text-destructive">Không tải được gợi ý nạp hàng: {errorMessage(state.error)}</p>
  if (!state.data) return <p role="status" className="mb-4 text-[13px] text-muted-foreground">Đang tính gợi ý nạp hàng…</p>
  const planned = (state.data.slots ?? []).filter((slot: SlotSuggestion) => slot.suggestedAction && slot.suggestedAction !== 'NONE' && slot.currentProduct?.id)
  return <div className="mb-4 grid gap-1.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]" role="status">
    <p className="font-medium">Gợi ý nạp hàng của máy {state.data.machineCode}</p>
    {planned.length
      ? <ul className="grid gap-1">{planned.map(slot => <li key={slot.slotId}>{suggestionText(slot)}</li>)}</ul>
      : <p className="text-muted-foreground">Không có ngăn nào cần nạp: các ngăn còn trên {state.data.lowStockThreshold ?? 2} hộp bán được, đã đầy, hoặc chưa biết sản phẩm. Tạo phiếu sẽ bị từ chối.</p>}
    <p className="text-muted-foreground">Phiếu được tạo với một dòng cho mỗi ngăn trên, số hộp theo gợi ý; cảnh báo hết hàng / hết hạn của các ngăn đó được gắn vào phiếu.</p>
  </div>
}

/**
 * Creates a work order (WORK_ORDER_MANAGE). A RESTOCK made by someone who may plan restocks (RESTOCK_PLAN) comes from the
 * machine's suggestions (POST /machines/{id}/restock-work-orders), so it has lines and can be started. Only fields of the
 * contract are sent, optional ones when filled in.
 */
export function CreateTicketSheet({ initial = NEW_TICKET, close, created }: {
  initial?: TicketValues; close: () => void; created: (ticket: WorkOrder) => void
}) {
  const machines = useMachineOptions()
  const { can } = useSession()
  const canUsers = can('USER_READ'), canPlan = can('RESTOCK_PLAN')
  const staff = useStaffOptions(canUsers)
  const form = useForm<TicketValues>({ ...initial })
  const { values, errors } = form
  const [now] = useState(() => Date.now())
  const fromSuggestions = values.type === 'RESTOCK' && canPlan
  return <FormSheet title="Tạo phiếu công việc" submitLabel="Tạo phiếu" close={close} onFieldErrors={form.setErrors}
    successMessage="Đã tạo phiếu công việc" successDescription={values.title.trim() || null}
    description="Phiếu giao một việc tại máy cho nhân viên. Chọn người phụ trách ngay hoặc phân công sau; phiếu không xóa được, chỉ hủy kèm lý do."
    onSubmit={async () => {
      const problems = validateTicket(values, Date.now(), fromSuggestions)
      if (Object.keys(problems).length) form.fail(problems)
      let ticket: WorkOrder
      try {
        ticket = fromSuggestions ? await restockApi.createFromSuggestions(values.machineId, restockFromSuggestionsBody(values)) : await workOrdersApi.create(createTicketBody(values))
      } catch (error) { throw createError(error) }
      created(ticket)
    }}>
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Loại phiếu" required error={errors.type} className="mb-4" hint="Nạp hàng: mang hộp tới ngăn. Bảo trì: sửa, vệ sinh, kiểm tra máy. Sự cố: xử lý phản ánh, lỗi.">
        <NativeSelect value={values.type} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('type')(event.target.value)}>
          <option value="">Chọn loại…</option>
          {CREATABLE_TICKET_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Máy" required error={errors.machineId} className="mb-4" hint={machines.length ? undefined : 'Đang tải danh sách máy…'}>
        <NativeSelect value={values.machineId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('machineId')(event.target.value)}>
          <option value="">Chọn máy…</option>
          {machines.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
    </div>
    {fromSuggestions && <SuggestionPreview machineId={values.machineId} />}
    {values.type === 'RESTOCK' && !canPlan && <p className="mb-4 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">Tài khoản này không lập được kế hoạch nạp (thiếu quyền Lập kế hoạch nạp hàng): phiếu được tạo chưa có dòng nạp và chưa bắt đầu được cho tới khi quản trị viên thêm dòng.</p>}
    <FormField label={fromSuggestions ? 'Tiêu đề (không bắt buộc)' : 'Tiêu đề'} required={!fromSuggestions} error={errors.title} className="mb-4"
      hint={fromSuggestions ? 'Để trống: “Nạp hàng máy <mã máy>”.' : `Việc cần làm, ngắn gọn. Tối đa ${TICKET_LIMITS.title} ký tự.`}>
      <Input value={values.title} maxLength={TICKET_LIMITS.title} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('title')(event.target.value)} />
    </FormField>
    {!fromSuggestions && <FormField label="Mô tả (không bắt buộc)" error={errors.description} className="mb-4" hint={`Hướng dẫn cho người làm. ${values.description.trim().length}/${TICKET_LIMITS.description} ký tự.`}>
      <Textarea value={values.description} maxLength={TICKET_LIMITS.description} className="max-sm:text-base" onChange={event => form.set('description')(event.target.value)} />
    </FormField>}
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Mức ưu tiên" error={errors.priority} className="mb-4">
        <NativeSelect value={values.priority} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('priority')(event.target.value)}>
          {PRIORITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Thời hạn (không bắt buộc)" error={errors.dueAt} className="mb-4" hint="Giờ Việt Nam; phải ở tương lai.">
        <Input type="datetime-local" value={values.dueAt} min={localMinute(now)} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('dueAt')(event.target.value)} />
      </FormField>
    </div>
    <FormField label="Người phụ trách (không bắt buộc)" error={errors.assigneeId} className="mb-4"
      hint={!canUsers ? 'Tài khoản này không có quyền xem danh sách nhân viên; phiếu ở trạng thái Chưa phân công, phân công sau.' : staff.error ? 'Không tải được danh sách nhân viên; có thể phân công sau.' : staff.loading ? 'Đang tải danh sách nhân viên…' : 'Để trống thì phiếu ở trạng thái Chưa phân công.'}>
      <NativeSelect value={values.assigneeId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('assigneeId')(event.target.value)}>
        <option value="">Chưa phân công</option>
        {staff.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </FormField>
  </FormSheet>
}

/** `min` of the due time input: now, as Vietnam local `YYYY-MM-DDTHH:mm`. */
function localMinute(ms: number): string {
  return new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16)
}

/** Who did each step and when, with notes, result or cancel reason (shown as text). */
export function TicketHistory({ events, className }: { events: readonly WorkOrderEvent[]; className?: string }) {
  if (!events.length) return <p className="text-[13px] text-muted-foreground">Chưa có sự kiện nào.</p>
  return <ol className={cn('grid gap-3 text-[14px]', className)}>
    {ticketSteps(events).map(step => <li key={step.key} className="grid gap-0.5 border-l-2 border-border pl-3">
      <span><span className="font-medium text-foreground">{step.label}</span> <span className="text-muted-foreground">· {step.at}</span></span>
      <span className="text-[13px] text-muted-foreground">{step.by}</span>
      {step.note && <span className="text-[13px] whitespace-pre-wrap break-words text-foreground">{step.note}</span>}
    </li>)}
  </ol>
}

/** Due time with an "overdue" word (not colour alone), as the server flags it. */
export function DueText({ ticket, overdue }: { ticket: WorkOrder; overdue: boolean }) {
  if (!ticket.dueAt) return <span className="text-muted-foreground">Không đặt hạn</span>
  return <span className="grid gap-0.5">
    <span className="whitespace-nowrap">{formatDateTime(ticket.dueAt)}</span>
    {overdue && <span className="w-fit rounded-full bg-status-danger px-2 py-0.5 text-xs font-medium text-status-danger-foreground">Quá hạn</span>}
  </span>
}

/** Priority in words; URGENT and HIGH stand out (never by colour alone). */
export function PriorityText({ priority }: { priority: WorkOrder['priority'] }) {
  const loud = priority === 'URGENT' || priority === 'HIGH'
  return <span className={cn('w-fit rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', priority === 'URGENT' ? 'bg-status-danger text-status-danger-foreground' : loud ? 'bg-status-warning text-status-warning-foreground' : 'bg-status-neutral text-status-neutral-foreground')}>
    {priorityLabel(priority)}
  </span>
}
