// O5 Lịch bảo trì (FE 7.3): maintenance plans that repeat every N days at a machine, next due first (server order), filters
// on the URL. Admins (MAINTENANCE_PLAN_MANAGE) create and change plans in a sheet, deactivate / activate them (never
// delete) and create the current occurrence's work order now; Staff (MAINTENANCE_PLAN_READ) read them to plan visits.
// API: /maintenance-plans of api-contract/api.yaml (backend #70). The server creates the MAINTENANCE work order
// `leadDays` before the due day and moves the due day after it is done; PATCH carries the version (stale → 409, reload).
import { CalendarPlus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '../../api/client.ts'
import { maintenancePlansApi } from '../../api/resources.ts'
import type { MaintenancePlan, WorkOrder } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, NativeSelect, Textarea } from '../../components/ui/input.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch } from '../../lib/table-query.ts'
import { machinePath } from '../alerts.ts'
import { Badge, ConfirmDialog, DataTable, FormSheet, Link, PAGE_SIZE, PageHead, Pagination, SelectFilter, useDialog, useForm } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import {
  PLAN_LIMITS, SCHEDULES_MISSING, SCHEDULE_ACTIVE_OPTIONS, SCHEDULE_FILTER_KEYS, createScheduleBody, dueInfo, dueLabel, formatDay, intervalText,
  isStaleSchedule, leadText, newScheduleValues, previewFirstDue, readScheduleFilters, scheduleActionError, scheduleListQuery, scheduleValues,
  schedulesAvailability, updateScheduleBody, validateSchedule, vietnamDate,
} from '../maintenance-schedules.ts'
import type { DueState, ScheduleValues } from '../maintenance-schedules.ts'
import { useMachineOptions, useStaffOptions } from '../options.ts'
import { LINK } from '../payment-parts.tsx'
import { PRIORITY_OPTIONS, priorityLabel, ticketPath } from '../tickets.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

const isMissing = (error: unknown) => schedulesAvailability(error) === 'missing'
const TOUCH = 'max-sm:h-11'
const PILL = 'w-fit rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'
const TONES: Record<DueState, string> = {
  overdue: 'bg-status-danger text-status-danger-foreground', working: 'bg-status-warning text-status-warning-foreground', today: 'bg-status-warning text-status-warning-foreground',
  soon: 'bg-status-warning text-status-warning-foreground', later: 'bg-status-success text-status-success-foreground',
  paused: 'bg-status-neutral text-status-neutral-foreground', none: 'bg-status-neutral text-status-neutral-foreground',
}

/** Due day with its state in words (Quá hạn / Đến hạn hôm nay / Sắp đến hạn / Còn N ngày / Đã tắt). */
function DueCell({ plan, now }: { plan: MaintenancePlan; now: number }) {
  const info = dueInfo(plan, now)
  return <span className="grid gap-0.5">
    {info.state !== 'paused' && <span className="font-medium whitespace-nowrap">{formatDay(plan.nextDueDate)}{plan.dueTime ? ` · ${plan.dueTime.slice(0, 5)}` : ''}</span>}
    <span className={cn(PILL, TONES[info.state])}>{dueLabel(info)}</span>
  </span>
}

type Saved = { plan: MaintenancePlan; kind: 'created' | 'updated' }

function MaintenanceSchedulesPage() {
  const { params, update } = useQueryParams()
  const filters = readScheduleFilters(params)
  const { can } = useSession()
  const canWrite = can('MAINTENANCE_PLAN_MANAGE'), canMachines = can('MACHINE_READ'), canTickets = can('WORK_ORDER_READ_ASSIGNED')
  const machines = useMachineOptions()
  const query = scheduleListQuery(filters, PAGE_SIZE)
  const state = useApi(signal => maintenancePlansApi.list(query, signal), JSON.stringify(query), { stopOn: isMissing })
  const missing = !state.data && !!state.error && isMissing(state.error)
  const sheet = useDialog<MaintenancePlan | 'new'>()
  const toggle = useDialog<MaintenancePlan>()
  const generate = useDialog<MaintenancePlan>()
  const [saved, setSaved] = useState<Saved | null>(null)
  const [opened, setOpened] = useState<WorkOrder | null>(null)
  const rows = state.data?.content
  const forbidden = state.error instanceof ApiError && state.error.status === 403 && !rows
  const filterCount = activeFilterCount(SCHEDULE_FILTER_KEYS.map(key => filters[key]))
  // Due states as of the last load (refreshed with the list).
  const now = state.updatedAt ?? 0

  const columns: Column<MaintenancePlan>[] = [
    { head: 'Lịch bảo trì', cell: plan => <span className="grid max-w-[44ch] gap-0.5">
      <span className="font-medium text-foreground">{plan.title}</span>
      {plan.instructions && <span className="line-clamp-2 text-xs break-words whitespace-pre-wrap text-muted-foreground">{plan.instructions}</span>}
      {saved?.plan.id === plan.id && <span className={cn(PILL, 'bg-status-info text-status-info-foreground')}>{saved?.kind === 'created' ? 'Mới tạo' : 'Vừa cập nhật'}</span>}
    </span> },
    { head: 'Máy', nowrap: true, cell: plan => canMachines && machinePath(plan.machineId)
      ? <Link to={machinePath(plan.machineId)} className={`${LINK} font-mono text-[13px]`} label={`Máy ${plan.machineCode}, mở chi tiết máy`}>{plan.machineCode}</Link>
      : <span className="font-mono text-[13px]">{plan.machineCode}</span> },
    { head: 'Chu kỳ', cell: plan => <span className="grid gap-0.5"><span className="whitespace-nowrap">{intervalText(plan.intervalDays)}</span>
      <span className="text-xs text-muted-foreground">{leadText(plan.leadDays)} · {priorityLabel(plan.priority).toLowerCase()}</span></span> },
    { head: 'Đến hạn kế tiếp', cell: plan => <DueCell plan={plan} now={now} /> },
    { head: 'Hoàn tất gần nhất', secondary: true, cell: plan => plan.lastCompletedAt
      ? <span className="whitespace-nowrap">{formatDateTime(plan.lastCompletedAt)}</span>
      : <span className="text-muted-foreground">Chưa có</span> },
    { head: 'Người nhận mặc định', cell: plan => <span className={plan.defaultAssignee?.id ? '' : 'text-muted-foreground'}>{plan.defaultAssignee?.id ? plan.defaultAssignee.fullName || 'Nhân viên' : 'Chưa chọn'}</span> },
    { head: 'Phiếu hiện tại', cell: plan => plan.currentWorkOrder?.id
      ? <span className="grid gap-1">
        {plan.currentWorkOrder.status && <Badge domain="ticket" value={plan.currentWorkOrder.status} />}
        {canTickets && <Link to={ticketPath(plan.currentWorkOrder.id)} className={`${LINK} text-[13px]`} label={`Xem phiếu ${plan.currentWorkOrder.code ?? ''} của lịch ${plan.title}`}>{plan.currentWorkOrder.code ?? 'Xem phiếu'}</Link>}
      </span>
      : <span className="text-muted-foreground">Không có</span> },
    ...(canWrite ? [{ head: 'Thao tác', cell: (plan: MaintenancePlan) => <span className="flex flex-wrap gap-1.5">
      <Button type="button" size="sm" variant="outline" className={TOUCH} data-focus-key={`schedule-edit-${plan.id}`} aria-label={`Sửa lịch: ${plan.title}`} onClick={() => sheet.open(plan)}>Sửa</Button>
      {plan.active && !plan.currentWorkOrder?.id && <Button type="button" size="sm" variant="outline" className={TOUCH} data-focus-key={`schedule-generate-${plan.id}`}
        aria-label={`Tạo phiếu ngay cho lịch: ${plan.title}`} onClick={() => generate.open(plan)}>Tạo phiếu ngay</Button>}
      <Button type="button" size="sm" variant="ghost" className={TOUCH} data-focus-key={`schedule-toggle-${plan.id}`}
        aria-label={`${plan.active ? 'Tắt' : 'Bật lại'} lịch: ${plan.title}`} onClick={() => toggle.open(plan)}>{plan.active ? 'Tắt lịch' : 'Bật lại'}</Button>
    </span> }] : []),
  ]

  const subtitle = canWrite
    ? 'Việc bảo trì lặp lại theo chu kỳ N ngày ở từng máy. Hệ thống tạo phiếu bảo trì trước ngày đến hạn và giao cho người nhận mặc định; hoàn tất phiếu thì hạn kế tiếp tính từ ngày hoàn tất. Lịch không xóa được, chỉ tắt hoặc bật lại.'
    : 'Việc bảo trì lặp lại theo chu kỳ ở từng máy, sắp đến hạn trước. Hệ thống tạo phiếu bảo trì trước ngày đến hạn và giao cho người nhận.'
  const head = <PageHead title="Lịch bảo trì" subtitle={subtitle}
    actions={canWrite && !forbidden && !missing ? <Button type="button" data-focus-key="schedules-create" onClick={() => sheet.open('new')}><CalendarPlus aria-hidden="true" />Tạo lịch</Button> : undefined} />

  if (missing) return <>
    {head}
    <p role="status" className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-muted-foreground">{SCHEDULES_MISSING}</p>
  </>

  const empty = filterCount
    ? <>Không có lịch khớp bộ lọc. <Button type="button" variant="link" className="h-auto p-0" onClick={() => update(clearFiltersPatch(SCHEDULE_FILTER_KEYS))}>Xóa bộ lọc</Button></>
    : canWrite
      ? 'Chưa có lịch bảo trì nào. Bấm “Tạo lịch” để đặt việc bảo trì lặp lại cho một máy, ví dụ vệ sinh khay nhả hàng mỗi 7 ngày.'
      : 'Chưa có lịch bảo trì nào. Quản trị viên sẽ đặt lịch; khi đến hạn, phiếu bảo trì được giao cho người nhận.'

  return <>
    {head}
    {saved && <SavedNotice saved={saved} canTickets={canTickets} dismiss={() => setSaved(null)} />}
    {opened && <OpenedNotice order={opened} canTickets={canTickets} dismiss={() => setOpened(null)} />}
    {!forbidden && <FilterBar activeCount={filterCount} onClear={() => update(clearFiltersPatch(SCHEDULE_FILTER_KEYS))}>
      <SelectFilter label="Máy" value={filters.machineId} onChange={value => update({ machineId: value || undefined, page: undefined })} options={machines} />
      <SelectFilter label="Trạng thái" value={filters.active} onChange={value => update({ active: value || undefined, page: undefined })} options={SCHEDULE_ACTIVE_OPTIONS} />
    </FilterBar>}
    <DataTable state={state} rows={rows} rowKey={plan => plan.id ?? ''} caption="Danh sách lịch bảo trì, sắp đến hạn trước" empty={empty} columns={columns} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: next ? String(next) : undefined })} />}
    {sheet.value && <ScheduleSheet plan={sheet.value === 'new' ? undefined : sheet.value} close={sheet.close} reload={state.reload}
      saved={(plan, kind) => { setSaved({ plan, kind }); state.reload() }} />}
    {toggle.value && <ToggleDialog plan={toggle.value} close={toggle.close} changed={state.reload} />}
    {generate.value && <GenerateDialog plan={generate.value} close={generate.close} changed={state.reload} opened={setOpened} />}
  </>
}

/** Right after saving: the server's next due day, and its work order when the plan was already due. */
function SavedNotice({ saved, canTickets, dismiss }: { saved: Saved; canTickets: boolean; dismiss: () => void }) {
  const { plan, kind } = saved
  const info = dueInfo(plan, Date.parse(plan.updatedAt ?? '') || 0)
  return <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-status-info-foreground/30 bg-status-info px-3.5 py-2.5 text-[14px] text-status-info-foreground">
    <p className="min-w-0">
      {kind === 'created' ? 'Đã tạo lịch' : 'Đã lưu lịch'} “{plan.title}” cho máy {plan.machineCode}.{' '}
      {plan.active
        ? <>Đến hạn kế tiếp: <strong className="font-semibold">{formatDay(plan.nextDueDate)}</strong> ({dueLabel(info).toLowerCase()}).</>
        : <>Lịch đang tắt nên hệ thống không tạo phiếu; bật lại khi cần.</>}
      {plan.currentWorkOrder?.id && <> Lịch đã tới ngày tạo phiếu nên hệ thống đã tạo phiếu {plan.currentWorkOrder.code}.{' '}
        {canTickets && <Link to={ticketPath(plan.currentWorkOrder.id)} className="font-medium underline underline-offset-4">Xem phiếu</Link>}</>}
    </p>
    <Button type="button" variant="ghost" size="icon-sm" className="-my-1 shrink-0 text-current" aria-label="Đóng thông báo" onClick={dismiss}><X aria-hidden="true" /></Button>
  </div>
}
function OpenedNotice({ order, canTickets, dismiss }: { order: WorkOrder; canTickets: boolean; dismiss: () => void }) {
  return <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-status-info-foreground/30 bg-status-info px-3.5 py-2.5 text-[14px] text-status-info-foreground">
    <p className="min-w-0">Đã tạo phiếu bảo trì {order.code} “{order.title}”{order.assignee?.fullName ? `, giao cho ${order.assignee.fullName}` : ', chưa có người nhận'}.{' '}
      {canTickets && order.id && <Link to={ticketPath(order.id)} className="font-medium underline underline-offset-4">Xem phiếu</Link>}</p>
    <Button type="button" variant="ghost" size="icon-sm" className="-my-1 shrink-0 text-current" aria-label="Đóng thông báo" onClick={dismiss}><X aria-hidden="true" /></Button>
  </div>
}

/** Create (no `plan`) or edit. Only contract fields are sent: required ones on create, the changed ones (with the version) on edit. */
function ScheduleSheet({ plan, close, saved, reload }: { plan?: MaintenancePlan; close: () => void; saved: (plan: MaintenancePlan, kind: Saved['kind']) => void; reload: () => void }) {
  const editing = !!plan
  const [now] = useState(() => Date.now())
  const today = vietnamDate(now)
  const machines = useMachineOptions()
  const { can } = useSession()
  const canUsers = can('USER_READ')
  const staff = useStaffOptions(canUsers)
  const form = useForm<ScheduleValues>(plan ? scheduleValues(plan) : newScheduleValues())
  const { values, errors } = form
  const preview = editing ? undefined : previewFirstDue(values, now)
  return <FormSheet title={editing ? 'Sửa lịch bảo trì' : 'Tạo lịch bảo trì'} submitLabel={editing ? 'Lưu thay đổi' : 'Tạo lịch'} close={close} onFieldErrors={form.setErrors}
    successMessage={editing ? 'Đã lưu lịch bảo trì' : 'Đã tạo lịch bảo trì'} successDescription={values.title.trim() || null}
    description="Hệ thống tạo phiếu bảo trì trước ngày đến hạn theo số ngày bạn chọn và giao cho người nhận mặc định. Ngày giờ theo giờ Việt Nam. Lịch không xóa được, chỉ tắt."
    onSubmit={async () => {
      const problems = validateSchedule(values, Date.now(), plan)
      if (Object.keys(problems).length) form.fail(problems)
      let result: MaintenancePlan
      try {
        if (plan) {
          const body = updateScheduleBody(plan, values)
          if (!body) throw new Error('Chưa có thay đổi nào để lưu. Sửa một ô rồi bấm “Lưu thay đổi”, hoặc bấm Hủy.')
          result = await maintenancePlansApi.update(plan.id!, body)
        } else result = await maintenancePlansApi.create(createScheduleBody(values))
      } catch (error) {
        const action = editing ? 'update' : 'create'
        if (isStaleSchedule(error, action)) { reload(); close(); toast.error(errorText(scheduleActionError(error, action)), { description: values.title.trim() }) }
        throw scheduleActionError(error, action)
      }
      saved(result, editing ? 'updated' : 'created')
    }}>
    <FormField label="Máy" required error={errors.machineId} className="mb-4" disabled={editing}
      hint={editing ? 'Không đổi được máy. Muốn chuyển sang máy khác, hãy tắt lịch này và tạo lịch mới.' : machines.length ? undefined : 'Đang tải danh sách máy…'}>
      <NativeSelect value={values.machineId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('machineId')(event.target.value)}>
        <option value="">Chọn máy…</option>
        {editing && plan.machineId && !machines.some(option => option.value === plan.machineId) && <option value={plan.machineId}>{plan.machineCode}</option>}
        {machines.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </FormField>
    <FormField label="Tên công việc" required error={errors.title} className="mb-4" hint={`Việc lặp lại, ví dụ “Vệ sinh khay nhả hàng”. Tối đa ${PLAN_LIMITS.title} ký tự.`}>
      <Input value={values.title} maxLength={PLAN_LIMITS.title} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('title')(event.target.value)} />
    </FormField>
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Chu kỳ (số ngày)" required error={errors.intervalDays} className="mb-4" hint={`Số nguyên từ ${PLAN_LIMITS.minInterval} đến ${PLAN_LIMITS.maxInterval}.`}>
        <Input type="number" inputMode="numeric" min={PLAN_LIMITS.minInterval} max={PLAN_LIMITS.maxInterval} step={1} value={values.intervalDays}
          className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('intervalDays')(event.target.value)} />
      </FormField>
      <FormField label="Tạo phiếu trước (ngày)" required error={errors.leadDays} className="mb-4" hint={`0 đến ${PLAN_LIMITS.maxLead}, nhỏ hơn chu kỳ. 0 là tạo đúng ngày.`}>
        <Input type="number" inputMode="numeric" min={0} max={PLAN_LIMITS.maxLead} step={1} value={values.leadDays}
          className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('leadDays')(event.target.value)} />
      </FormField>
      <FormField label={editing ? 'Đến hạn kế tiếp' : 'Đến hạn lần đầu (không bắt buộc)'} required={editing} error={errors.dueDate} className="mb-4"
        hint={editing ? 'Dời ngày đến hạn kế tiếp nếu cần. Đổi chu kỳ không dời ngày này.' : 'Để trống: hôm nay cộng chu kỳ.'}>
        <Input type="date" min={today} value={values.dueDate} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('dueDate')(event.target.value)} />
      </FormField>
      <FormField label="Giờ hạn" required error={errors.dueTime} className="mb-4" hint="Hạn của phiếu trong ngày đến hạn.">
        <Input type="time" value={values.dueTime} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('dueTime')(event.target.value)} />
      </FormField>
    </div>
    {!editing && <div aria-live="polite" className="mb-4 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[14px]">
      {preview
        ? <p>Đến hạn lần đầu: <strong className="font-semibold">{formatDay(preview.due)}</strong>{preview.days ? ` (còn ${preview.days} ngày)` : ' (hôm nay)'}. Phiếu bảo trì được tạo ngày {formatDay(preview.createdOn)}.</p>
        : <p className="text-muted-foreground">Nhập chu kỳ để xem ngày đến hạn lần đầu.</p>}
    </div>}
    <FormField label="Ưu tiên của phiếu" error={errors.priority} className="mb-4">
      <NativeSelect value={values.priority} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('priority')(event.target.value)}>
        {PRIORITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </FormField>
    <FormField label="Người nhận mặc định (không bắt buộc)" error={errors.defaultAssigneeId} className="mb-4"
      hint={!canUsers ? 'Tài khoản này không xem được danh sách nhân viên; quản trị viên phân công sau.' : staff.error ? 'Không tải được danh sách nhân viên; có thể chọn sau.' : staff.loading ? 'Đang tải danh sách nhân viên…' : 'Phiếu tạo từ lịch sẽ giao cho người này. Để trống thì quản trị viên phân công.'}>
      <NativeSelect value={values.defaultAssigneeId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('defaultAssigneeId')(event.target.value)}>
        <option value="">Chưa chọn</option>
        {plan?.defaultAssignee?.id && !staff.options.some(option => option.value === plan.defaultAssignee?.id) && <option value={plan.defaultAssignee.id}>{plan.defaultAssignee.fullName || 'Người nhận hiện tại'}</option>}
        {staff.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </FormField>
    <FormField label="Hướng dẫn (không bắt buộc)" error={errors.instructions} className="mb-2" hint={`Cho người làm. ${values.instructions.trim().length}/${PLAN_LIMITS.instructions} ký tự.`}>
      <Textarea value={values.instructions} maxLength={PLAN_LIMITS.instructions} className="max-sm:text-base" onChange={event => form.set('instructions')(event.target.value)} />
    </FormField>
  </FormSheet>
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Lịch đã thay đổi.')

/** Deactivate or activate, after a confirmation. A 409: retrying cannot help, so the dialog closes and the list reloads. */
function ToggleDialog({ plan, close, changed }: { plan: MaintenancePlan; close: () => void; changed: () => void }) {
  const action = plan.active ? 'deactivate' : 'activate'
  const summary = `${plan.title} · máy ${plan.machineCode}`
  return <ConfirmDialog title={plan.active ? 'Tắt lịch bảo trì?' : 'Bật lại lịch bảo trì?'} confirmLabel={plan.active ? 'Tắt lịch' : 'Bật lại'} close={close}
    successMessage={plan.active ? 'Đã tắt lịch' : 'Đã bật lại lịch'} successDescription={summary}
    message={<>
      <p><strong className="font-medium text-foreground">{summary}</strong> · {intervalText(plan.intervalDays).toLowerCase()}</p>
      <p className="mt-2!">{plan.active
        ? <>Khi tắt, hệ thống không tạo phiếu bảo trì mới cho lịch này.{plan.currentWorkOrder?.id ? ` Phiếu ${plan.currentWorkOrder.code ?? ''} đang mở vẫn giữ nguyên.` : ''} Lịch không bị xóa; bật lại bất cứ lúc nào.</>
        : <>Khi bật lại, hệ thống tạo phiếu theo ngày đến hạn kế tiếp ({formatDay(plan.nextDueDate)}).</>}</p>
    </>}
    onConfirm={async () => {
      try { await (plan.active ? maintenancePlansApi.deactivate(plan.id!) : maintenancePlansApi.activate(plan.id!)) } catch (error) {
        const shown = scheduleActionError(error, action)
        if (isStaleSchedule(error, action)) { close(); changed(); toast.error(errorText(shown), { description: summary }) }
        throw shown
      }
      changed()
    }} />
}

/** POST /generate-now: the work order of the current occurrence now, whatever the lead days. */
function GenerateDialog({ plan, close, changed, opened }: { plan: MaintenancePlan; close: () => void; changed: () => void; opened: (order: WorkOrder) => void }) {
  const summary = `${plan.title} · máy ${plan.machineCode}`
  return <ConfirmDialog title="Tạo phiếu bảo trì ngay?" confirmLabel="Tạo phiếu" close={close} successMessage="Đã tạo phiếu bảo trì" successDescription={summary}
    message={<p>Phiếu bảo trì cho lần đến hạn {formatDay(plan.nextDueDate)} được tạo ngay bây giờ{plan.defaultAssignee?.fullName ? ` và giao cho ${plan.defaultAssignee.fullName}` : ''}, không chờ tới ngày tạo phiếu. Hạn kế tiếp tính lại khi phiếu xong.</p>}
    onConfirm={async () => {
      let order: WorkOrder
      try { order = await maintenancePlansApi.generateNow(plan.id!) } catch (error) {
        const shown = scheduleActionError(error, 'generate')
        if (isStaleSchedule(error, 'generate')) { close(); changed(); toast.error(errorText(shown), { description: summary }) }
        throw shown
      }
      opened(order); changed()
    }} />
}

export default MaintenanceSchedulesPage
