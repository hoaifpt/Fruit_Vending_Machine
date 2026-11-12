// O5 Lịch bảo trì (FE 7.3): maintenance jobs that repeat every N days at a machine, soonest due first, server-side filters
// on the URL. Admins (MAINTENANCE_SCHEDULE_WRITE) create and change schedules in a sheet that previews "Đến hạn kế
// tiếp" with the server's rule while typing; after saving, the server's nextDueAt is shown at once. Schedules are
// paused and resumed (with a confirmation), never deleted. Staff read them to plan their visits.
// API: draft contract api-contract/drafts/maintenance-schedules.yaml (waiting for BE 4.5); on a backend without it
// (404/501) the screen says there is no data yet.
import { CalendarPlus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '../../api/client.ts'
import { maintenanceSchedulesApi } from '../../api/resources.ts'
import type { MaintenanceSchedule } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, NativeSelect, Textarea } from '../../components/ui/input.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDate, formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import { machinePath } from '../alerts.ts'
import { Badge, ConfirmDialog, DataTable, FormSheet, Link, PAGE_SIZE, PageHead, Pagination, SelectFilter, useDialog, useForm } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import {
  SCHEDULES_MISSING, SCHEDULE_ACTIVE_OPTIONS, SCHEDULE_FILTER_KEYS, SCHEDULE_LIMITS, SCHEDULE_SORT_RULE, addDays, createScheduleBody, dueInfo, dueLabel,
  intervalText, isStaleSchedule, newScheduleValues, parseInterval, previewNextDue, readScheduleFilters, scheduleActionError, scheduleListQuery,
  scheduleValues, schedulesAvailability, updateScheduleBody, validateSchedule, vietnamDate, vietnamDateOf,
} from '../maintenance-schedules.ts'
import type { DueInfo, DueState, ScheduleValues } from '../maintenance-schedules.ts'
import { useMachineOptions, useStaffOptions } from '../options.ts'
import { LINK } from '../payment-parts.tsx'
import { ticketPath } from '../tickets.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

const isMissing = (error: unknown) => schedulesAvailability(error) === 'missing'
const TOUCH = 'max-sm:h-11'
const PILL = 'w-fit rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'
const TONES: Record<DueState, string> = {
  overdue: 'bg-status-danger text-status-danger-foreground', today: 'bg-status-warning text-status-warning-foreground',
  soon: 'bg-status-warning text-status-warning-foreground', later: 'bg-status-success text-status-success-foreground',
  paused: 'bg-status-neutral text-status-neutral-foreground', none: 'bg-status-neutral text-status-neutral-foreground',
}

/** Due day with its state in words (Quá hạn / Đến hạn hôm nay / Sắp đến hạn / Còn N ngày / Tạm dừng). */
function DueCell({ schedule, now }: { schedule: MaintenanceSchedule; now: number }) {
  const info = dueInfo(schedule, now)
  if (info.state === 'paused') return <span className="grid gap-0.5">
    <span className={cn(PILL, TONES.paused)}>Tạm dừng</span>
    {schedule.deactivatedAt && <span className="text-xs text-muted-foreground">từ {formatDateTime(schedule.deactivatedAt)}{schedule.deactivatedByName ? ` · ${schedule.deactivatedByName}` : ''}</span>}
  </span>
  return <span className="grid gap-0.5">
    <span className="font-medium whitespace-nowrap">{formatDate(schedule.nextDueAt)}</span>
    <span className={cn(PILL, TONES[info.state])}>{dueLabel(info)}</span>
  </span>
}

type Saved = { schedule: MaintenanceSchedule; kind: 'created' | 'updated' }

function MaintenanceSchedulesPage() {
  const { params, update } = useQueryParams()
  const filters = readScheduleFilters(params)
  const { can } = useSession()
  const canWrite = can('MAINTENANCE_SCHEDULE_WRITE'), canMachines = can('MACHINE_READ'), canTickets = can('TICKET_READ')
  const machines = useMachineOptions()
  const query = scheduleListQuery(filters, PAGE_SIZE)
  const state = useApi(signal => maintenanceSchedulesApi.list(query, signal), JSON.stringify(query), { stopOn: isMissing })
  const missing = !state.data && !!state.error && isMissing(state.error)
  const sheet = useDialog<MaintenanceSchedule | 'new'>()
  const toggle = useDialog<MaintenanceSchedule>()
  const [saved, setSaved] = useState<Saved | null>(null)
  const rows = state.data?.content
  const forbidden = state.error instanceof ApiError && state.error.status === 403 && !rows
  const filterCount = activeFilterCount(SCHEDULE_FILTER_KEYS.map(key => filters[key]))
  // Due states as of the last load (refreshed with the list).
  const now = state.updatedAt ?? 0

  const columns: Column<MaintenanceSchedule>[] = [
    { head: 'Lịch bảo trì', cell: schedule => <span className="grid max-w-[44ch] gap-0.5">
      <span className="font-medium text-foreground">{schedule.title}</span>
      {schedule.note && <span className="line-clamp-2 text-xs break-words whitespace-pre-wrap text-muted-foreground">{schedule.note}</span>}
      {saved?.schedule.id === schedule.id && <span className={cn(PILL, 'bg-status-info text-status-info-foreground')}>{saved.kind === 'created' ? 'Mới tạo' : 'Vừa cập nhật'}</span>}
    </span> },
    { head: 'Máy', nowrap: true, cell: schedule => canMachines && machinePath(schedule.machineId)
      ? <Link to={machinePath(schedule.machineId)} className={`${LINK} font-mono text-[13px]`} label={`Máy ${schedule.machineCode}, mở chi tiết máy`}>{schedule.machineCode}</Link>
      : <span className="font-mono text-[13px]">{schedule.machineCode}</span> },
    { head: 'Chu kỳ', nowrap: true, cell: schedule => intervalText(schedule.intervalDays) },
    { head: 'Đến hạn kế tiếp', sortKey: 'nextDueAt', firstDirection: 'asc', cell: schedule => <DueCell schedule={schedule} now={now} /> },
    { head: 'Hoàn tất gần nhất', secondary: true, cell: schedule => schedule.lastCompletedAt
      ? <span className="whitespace-nowrap">{formatDateTime(schedule.lastCompletedAt)}</span>
      : <span className="text-muted-foreground">Chưa có</span> },
    { head: 'Người phụ trách', cell: schedule => <span className={schedule.assigneeId ? '' : 'text-muted-foreground'}>{schedule.assigneeId ? schedule.assigneeName || 'Nhân viên' : 'Chưa chọn'}</span> },
    { head: 'Phiếu đang mở', cell: schedule => schedule.openTicketId
      ? <span className="grid gap-1">
        {schedule.openTicketStatus && <Badge domain="ticket" value={schedule.openTicketStatus} />}
        {canTickets && <Link to={ticketPath(schedule.openTicketId)} className={`${LINK} text-[13px]`} label={`Xem phiếu bảo trì của lịch ${schedule.title}`}>Xem phiếu</Link>}
      </span>
      : <span className="text-muted-foreground">Không có</span> },
    ...(canWrite ? [{ head: 'Thao tác', cell: (schedule: MaintenanceSchedule) => <span className="flex flex-wrap gap-1.5">
      <Button type="button" size="sm" variant="outline" className={TOUCH} data-focus-key={`schedule-edit-${schedule.id}`} aria-label={`Sửa lịch: ${schedule.title}`} onClick={() => sheet.open(schedule)}>Sửa</Button>
      <Button type="button" size="sm" variant="ghost" className={TOUCH} data-focus-key={`schedule-toggle-${schedule.id}`}
        aria-label={`${schedule.active ? 'Tạm dừng' : 'Bật lại'} lịch: ${schedule.title}`} onClick={() => toggle.open(schedule)}>{schedule.active ? 'Tạm dừng' : 'Bật lại'}</Button>
    </span> }] : []),
  ]

  const subtitle = canWrite
    ? 'Việc bảo trì lặp lại theo chu kỳ N ngày ở từng máy. Hệ thống tính ngày đến hạn kế tiếp và mở phiếu bảo trì khi đến hạn; hoàn tất phiếu thì chu kỳ mới bắt đầu. Lịch không xóa được, chỉ tạm dừng hoặc bật lại.'
    : 'Việc bảo trì lặp lại theo chu kỳ ở từng máy, sắp đến hạn trước. Khi đến hạn, hệ thống mở phiếu bảo trì và giao cho người phụ trách.'
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
      : 'Chưa có lịch bảo trì nào. Quản trị viên sẽ đặt lịch; khi đến hạn, phiếu bảo trì được giao cho người phụ trách.'

  return <>
    {head}
    {saved && <SavedNotice saved={saved} canTickets={canTickets} dismiss={() => setSaved(null)} />}
    {!forbidden && <FilterBar activeCount={filterCount} onClear={() => update(clearFiltersPatch(SCHEDULE_FILTER_KEYS))}>
      <SelectFilter label="Máy" value={filters.machineId} onChange={value => update({ machineId: value || undefined, page: undefined })} options={machines} />
      <SelectFilter label="Trạng thái" value={filters.active} onChange={value => update({ active: value || undefined, page: undefined })} options={SCHEDULE_ACTIVE_OPTIONS} />
    </FilterBar>}
    <DataTable state={state} rows={rows} rowKey={schedule => schedule.id} caption="Danh sách lịch bảo trì" empty={empty}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, SCHEDULE_SORT_RULE), page: undefined })} columns={columns} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: next ? String(next) : undefined })} />}
    {sheet.value && <ScheduleSheet schedule={sheet.value === 'new' ? undefined : sheet.value} close={sheet.close}
      saved={(schedule, kind) => { setSaved({ schedule, kind }); state.reload() }} />}
    {toggle.value && <ToggleDialog schedule={toggle.value} close={toggle.close} changed={state.reload} />}
  </>
}

/** Right after saving: the server's nextDueAt (not the preview), and the ticket it opened when the schedule is due today. */
function SavedNotice({ saved, canTickets, dismiss }: { saved: Saved; canTickets: boolean; dismiss: () => void }) {
  const { schedule, kind } = saved
  const info = dueInfo(schedule, Date.parse(schedule.updatedAt) || 0)
  return <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-status-info-foreground/30 bg-status-info px-3.5 py-2.5 text-[14px] text-status-info-foreground">
    <p className="min-w-0">
      {kind === 'created' ? 'Đã tạo lịch' : 'Đã lưu lịch'} “{schedule.title}” cho máy {schedule.machineCode}.{' '}
      {schedule.active && schedule.nextDueAt
        ? <>Đến hạn kế tiếp: <strong className="font-semibold">{formatDate(schedule.nextDueAt)}</strong> ({dueLabel(info).toLowerCase()}).</>
        : <>Lịch đang tạm dừng nên chưa có ngày đến hạn; bật lại để tính.</>}
      {schedule.openTicketId && <> Lịch đã đến hạn nên hệ thống đã mở phiếu bảo trì.{' '}
        {canTickets && <Link to={ticketPath(schedule.openTicketId)} className="font-medium underline underline-offset-4">Xem phiếu</Link>}</>}
    </p>
    <Button type="button" variant="ghost" size="icon-sm" className="-my-1 shrink-0 text-current" aria-label="Đóng thông báo" onClick={dismiss}><X aria-hidden="true" /></Button>
  </div>
}

/** How the preview was obtained, in words: from the last completion, or start date + N (rolled forward when past). */
function previewReason(values: ScheduleValues, preview: DueInfo, lastCompletedAt: string | null | undefined, today: string): string {
  const interval = parseInterval(values.intervalDays) ?? 0
  const lastDone = vietnamDateOf(lastCompletedAt)
  if (lastDone) return `Tính từ lần hoàn tất gần nhất ${formatDate(lastDone)} cộng ${interval} ngày.`
  const first = addDays(values.startDate, interval)
  return first < today && preview.date !== first
    ? `${formatDate(values.startDate)} cộng ${interval} ngày đã qua nên hệ thống cộng tiếp từng chu kỳ đến ngày chưa qua.`
    : `${formatDate(values.startDate)} cộng ${interval} ngày.`
}

/** Create (no `schedule`) or edit. Only fields of the draft are sent: all required ones on create, the changed ones on edit. */
function ScheduleSheet({ schedule, close, saved }: { schedule?: MaintenanceSchedule; close: () => void; saved: (schedule: MaintenanceSchedule, kind: Saved['kind']) => void }) {
  const editing = !!schedule
  const [now] = useState(() => Date.now())
  const today = vietnamDate(now)
  const machines = useMachineOptions()
  const { can } = useSession()
  const canUsers = can('USER_READ')
  const staff = useStaffOptions(canUsers)
  const form = useForm<ScheduleValues>(schedule ? scheduleValues(schedule) : newScheduleValues(now))
  const { values, errors } = form
  const paused = editing && !schedule.active
  const preview = paused ? undefined : previewNextDue(values, now, schedule?.lastCompletedAt)
  return <FormSheet title={editing ? 'Sửa lịch bảo trì' : 'Tạo lịch bảo trì'} submitLabel={editing ? 'Lưu thay đổi' : 'Tạo lịch'} close={close} onFieldErrors={form.setErrors}
    successMessage={editing ? 'Đã lưu lịch bảo trì' : 'Đã tạo lịch bảo trì'} successDescription={values.title.trim() || null}
    description="Hệ thống tính ngày đến hạn kế tiếp theo chu kỳ, mở phiếu bảo trì vào ngày đến hạn và giao cho người phụ trách. Lịch không xóa được, chỉ tạm dừng."
    onSubmit={async () => {
      const problems = validateSchedule(values)
      if (Object.keys(problems).length) form.fail(problems)
      let result: MaintenanceSchedule
      try {
        if (schedule) {
          const body = updateScheduleBody(schedule, values)
          if (!Object.keys(body).length) throw new Error('Chưa có thay đổi nào để lưu. Sửa một ô rồi bấm “Lưu thay đổi”, hoặc bấm Hủy.')
          result = await maintenanceSchedulesApi.update(schedule.id, body)
        } else result = await maintenanceSchedulesApi.create(createScheduleBody(values))
      } catch (error) { throw scheduleActionError(error, editing ? 'update' : 'create') }
      saved(result, editing ? 'updated' : 'created')
    }}>
    <FormField label="Máy" required error={errors.machineId} className="mb-4" disabled={editing}
      hint={editing ? 'Không đổi được máy. Muốn chuyển sang máy khác, hãy tạm dừng lịch này và tạo lịch mới.' : machines.length ? undefined : 'Đang tải danh sách máy…'}>
      <NativeSelect value={values.machineId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('machineId')(event.target.value)}>
        <option value="">Chọn máy…</option>
        {machines.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </FormField>
    <FormField label="Tên công việc" required error={errors.title} className="mb-4" hint={`Việc lặp lại, ví dụ “Vệ sinh khay nhả hàng”. Tối đa ${SCHEDULE_LIMITS.title} ký tự.`}>
      <Input value={values.title} maxLength={SCHEDULE_LIMITS.title} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('title')(event.target.value)} />
    </FormField>
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Chu kỳ (số ngày)" required error={errors.intervalDays} className="mb-4" hint={`Số nguyên từ ${SCHEDULE_LIMITS.minInterval} đến ${SCHEDULE_LIMITS.maxInterval}.`}>
        <Input type="number" inputMode="numeric" min={SCHEDULE_LIMITS.minInterval} max={SCHEDULE_LIMITS.maxInterval} step={1} value={values.intervalDays}
          className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('intervalDays')(event.target.value)} />
      </FormField>
      <FormField label="Tính chu kỳ từ ngày" required error={errors.startDate} className="mb-4" hint="Thường là ngày bảo trì gần nhất. Giờ Việt Nam.">
        <Input type="date" value={values.startDate} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('startDate')(event.target.value)} />
      </FormField>
    </div>
    <div aria-live="polite" className="mb-4 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[14px]">
      {paused
        ? <p>Lịch đang tạm dừng: chưa có ngày đến hạn. Khi bật lại, hệ thống tính ngày đến hạn kế tiếp từ chu kỳ mới.</p>
        : preview?.date
          ? <>
            <p>Đến hạn kế tiếp: <strong className="font-semibold">{formatDate(preview.date)}</strong> ({dueLabel(preview).toLowerCase()})</p>
            <p className="mt-0.5! text-[13px] text-muted-foreground">{previewReason(values, preview, schedule?.lastCompletedAt, today)} Máy chủ tính lại khi lưu.</p>
          </>
          : <p className="text-muted-foreground">Nhập chu kỳ và ngày tính chu kỳ để xem ngày đến hạn kế tiếp.</p>}
    </div>
    <FormField label="Người phụ trách (không bắt buộc)" error={errors.assigneeId} className="mb-4"
      hint={!canUsers ? 'Tài khoản này không có quyền xem danh sách nhân viên nên không chọn được người phụ trách; quản trị viên phân công sau.' : staff.error ? 'Không tải được danh sách nhân viên; có thể chọn sau.' : staff.loading ? 'Đang tải danh sách nhân viên…' : 'Phiếu bảo trì mở từ lịch sẽ giao cho người này. Để trống thì quản trị viên phân công sau.'}>
      <NativeSelect value={values.assigneeId} className="max-sm:h-11 max-sm:text-base" onChange={event => form.set('assigneeId')(event.target.value)}>
        <option value="">Chưa chọn</option>
        {schedule?.assigneeId && !staff.options.some(option => option.value === schedule.assigneeId) && <option value={schedule.assigneeId}>{schedule.assigneeName || 'Người phụ trách hiện tại'}</option>}
        {staff.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </FormField>
    <FormField label="Ghi chú (không bắt buộc)" error={errors.note} className="mb-2" hint={`Hướng dẫn cho người làm. ${values.note.trim().length}/${SCHEDULE_LIMITS.note} ký tự.`}>
      <Textarea value={values.note} maxLength={SCHEDULE_LIMITS.note} className="max-sm:text-base" onChange={event => form.set('note')(event.target.value)} />
    </FormField>
  </FormSheet>
}

/**
 * Pause or resume, after a confirmation. A 409 (someone changed it meanwhile): retrying cannot help, so the dialog
 * closes, the list reloads and the explanation is an error toast.
 */
function ToggleDialog({ schedule, close, changed }: { schedule: MaintenanceSchedule; close: () => void; changed: () => void }) {
  const action = schedule.active ? 'deactivate' : 'activate'
  const summary = `${schedule.title} · máy ${schedule.machineCode}`
  return <ConfirmDialog title={schedule.active ? 'Tạm dừng lịch bảo trì?' : 'Bật lại lịch bảo trì?'} confirmLabel={schedule.active ? 'Tạm dừng' : 'Bật lại'} close={close}
    successMessage={schedule.active ? 'Đã tạm dừng lịch' : 'Đã bật lại lịch'} successDescription={summary}
    message={<>
      <p><strong className="font-medium text-foreground">{summary}</strong> · {intervalText(schedule.intervalDays).toLowerCase()}</p>
      <p className="mt-2!">{schedule.active
        ? <>Khi tạm dừng, lịch không còn ngày đến hạn và hệ thống không mở phiếu bảo trì mới.{schedule.openTicketId ? ' Phiếu đang mở của lịch vẫn giữ nguyên.' : ''} Lịch không bị xóa; bật lại bất cứ lúc nào.</>
        : <>Khi bật lại, hệ thống tính ngày đến hạn kế tiếp theo chu kỳ (không sớm hơn hôm nay) và mở phiếu khi đến hạn.</>}</p>
    </>}
    onConfirm={async () => {
      try { await (schedule.active ? maintenanceSchedulesApi.deactivate(schedule.id) : maintenanceSchedulesApi.activate(schedule.id)) } catch (error) {
        const shown = scheduleActionError(error, action)
        if (isStaleSchedule(error, action)) {
          close(); changed()
          toast.error(shown instanceof Error ? shown.message : 'Lịch đã thay đổi.', { description: summary })
        }
        throw shown
      }
      changed()
    }} />
}

export default MaintenanceSchedulesPage
