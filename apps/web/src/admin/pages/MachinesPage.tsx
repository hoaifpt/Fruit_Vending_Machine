// C2 Máy bán hàng: list (server paging, sort, status/search filters in the URL) where each row says whether the kiosk
// takes orders and, if not, why — from the administrative status only, shown apart from the last contact time
// (connectivity). ADMIN registers a machine in a Sheet (it starts INACTIVE). No delete anywhere; the code of a row opens
// /admin/machines/:id where configuration, slots, kiosk keys and switching to ACTIVE live (FE 3.5).
// ADMIN: view, register (MACHINE_WRITE). STAFF: view only (MACHINE_READ, route guard).
import { Clock, Plus } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { machinesApi } from '../../api/resources.ts'
import type { Machine } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input } from '../../components/ui/input.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { cn } from '../../lib/cn.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import { DataTable, FormSheet, Link, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter, enumOptions, useDialog, useForm } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'
import {
  LIMITS, MACHINE_FILTER_KEYS, MACHINE_SORT, NEW_MACHINE, THRESHOLDS, createMachineBody, describeSaveError, lastContact,
  machineListQuery, machineValues, readMachineFilters, saleState, updateMachineBody, validateMachine,
} from '../machines.ts'
import type { MachineValues } from '../machines.ts'

function MachinesPage() {
  const { can } = useSession()
  const canManage = can('MACHINE_WRITE')
  const { params, update } = useQueryParams()
  const filters = readMachineFilters(params)
  const query = machineListQuery(filters, PAGE_SIZE)
  const state = useApi(signal => machinesApi.list(query, signal), `${query.status}|${query.search}|${query.sort}|${query.page}`)
  const dialog = useDialog()
  const filterCount = activeFilterCount([filters.status, filters.search])
  const data = state.data
  const pastEnd = !!data && data.content.length === 0 && data.totalElements > 0
  // The API refused the list (permissions changed after sign-in): only the explanation is shown, no actions or filters.
  const forbidden = state.error instanceof ApiError && state.error.status === 403
  const clearFilters = () => update(clearFiltersPatch(MACHINE_FILTER_KEYS))

  const columns: Column<Machine>[] = [
    { head: 'Mã máy', sortKey: 'code', nowrap: true, cell: machine => <Link to={`/admin/machines/${machine.id}`} className="font-mono text-[13px] font-medium">{machine.code}</Link> },
    { head: 'Tên máy', sortKey: 'name', cell: machine => <span className="font-medium">{machine.name}</span> },
    { head: 'Vị trí', sortKey: 'location', cell: machine => machine.location || <span className="text-muted-foreground">Chưa có vị trí</span> },
    { head: 'Bán hàng', sortKey: 'status', cell: machine => <SaleCell machine={machine} canManage={canManage} /> },
    { head: 'Liên lạc gần nhất', nowrap: true, cell: machine => <span className={cn('inline-flex items-center gap-1.5', !machine.lastSeenAt && 'text-muted-foreground')}>
      <Clock aria-hidden="true" className="size-3.5 shrink-0" />{lastContact(machine)}</span> },
  ]

  const empty = pastEnd
    ? <>Trang này không còn máy nào. <Button type="button" variant="link" className="h-auto p-0" onClick={() => update({ page: undefined })}>Về trang đầu</Button></>
    : filterCount
      ? <>Không có máy nào khớp bộ lọc. <Button type="button" variant="link" className="h-auto p-0" onClick={clearFilters}>Xóa bộ lọc</Button></>
      : canManage
        ? <>Chưa có máy nào. Bấm “Đăng ký máy” để thêm máy đầu tiên.</>
        : 'Chưa có máy nào. Quản trị viên sẽ đăng ký máy.'

  return <>
    <PageHead title="Máy bán hàng"
      subtitle={`Cột Bán hàng là trạng thái quản trị: chỉ máy Hoạt động mới nhận đơn trên kiosk. Liên lạc gần nhất chỉ cho biết lần cuối máy gửi tín hiệu, không làm máy ngừng bán.${canManage ? '' : ' Bạn chỉ xem; đăng ký và đổi trạng thái do Quản trị viên thực hiện.'}`}
      actions={canManage && !forbidden ? <Button type="button" data-focus-key="machines-create" onClick={() => dialog.open()}><Plus aria-hidden="true" />Đăng ký máy</Button> : undefined} />
    {!forbidden && <FilterBar activeCount={filterCount} onClear={clearFilters}>
      <SearchFilter label="Tìm theo mã, tên hoặc vị trí" value={filters.search} onCommit={value => update({ search: value || undefined, page: undefined })} />
      <SelectFilter label="Trạng thái" value={filters.status} onChange={value => update({ status: value || undefined, page: undefined })} options={enumOptions('machine')} />
    </FilterBar>}
    <DataTable state={state} rows={data?.content} rowKey={machine => machine.id} columns={columns} caption="Danh sách máy" empty={empty}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, MACHINE_SORT), page: undefined })} />
    {data && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} onPage={next => update({ page: next ? String(next) : undefined })} />}
    {dialog.value && <MachineSheet close={dialog.close} done={state.reload} />}
  </>
}

/**
 * Administrative status badge, then in words whether the kiosk sells and, when it does not, why and what to do. The
 * badge's generic explanation is left out (the lines below say it for this machine); lines stay left-aligned in cards.
 */
function SaleCell({ machine, canManage }: { machine: Machine; canManage: boolean }) {
  const sale = saleState(machine, canManage)
  return <span className="grid justify-items-start gap-1 text-left">
    <StatusBadge domain="machine" value={machine.status} describe={false} />
    <span className={cn('text-xs', sale.selling ? 'text-muted-foreground' : 'font-medium text-foreground')}>{sale.summary}</span>
    {sale.next && <span className="text-xs text-muted-foreground">{sale.next}</span>}
  </span>
}

/**
 * Register a machine (no `machine`: the seven contract fields; the server sets status INACTIVE and lastSeenAt null) or
 * edit its configuration (name, location, thresholds; the code is fixed and the status has its own endpoint). Used by
 * the list (register) and by the detail page (edit).
 */
export function MachineSheet({ machine, close, done }: { machine?: Machine; close: () => void; done: () => void }) {
  const editing = !!machine
  const form = useForm<MachineValues>(machine ? machineValues(machine) : { ...NEW_MACHINE })
  const { values, errors } = form
  return <FormSheet title={editing ? 'Sửa cấu hình máy' : 'Đăng ký máy'} submitLabel={editing ? 'Lưu thay đổi' : 'Đăng ký máy'}
    successMessage={editing ? 'Đã lưu cấu hình máy' : 'Đã đăng ký máy'} close={close} onFieldErrors={form.setErrors}
    description={editing
      ? <>{machine.name}. Sửa tên, vị trí và ngưỡng môi trường; mã máy không đổi được. Trạng thái đổi ở thẻ Tổng quan.</>
      : 'Máy mới ở trạng thái Ngừng hoạt động và chưa bán cho tới khi quản trị viên thêm ngăn, cấp khóa kiosk và bật Hoạt động trong chi tiết máy.'}
    onSubmit={async () => {
      const mode = editing ? 'edit' : 'create'
      const problems = validateMachine(values, mode)
      if (Object.keys(problems).length) form.fail(problems)
      try {
        if (machine) await machinesApi.update(machine.id, updateMachineBody(values))
        else await machinesApi.create(createMachineBody(values))
      } catch (error) { throw describeSaveError(error, mode) }
      done()
    }}>
    {editing
      ? <FormField label="Mã máy" hint="Mã máy cố định sau khi đăng ký để đơn hàng, ngăn và khóa kiosk luôn trỏ đúng máy." className="mb-4">
        <Input value={machine.code} readOnly className="font-mono" /></FormField>
      : <FormField label="Mã máy" required error={errors.code} hint={`Mã duy nhất, tự chuyển thành chữ in hoa, ví dụ FV-HCM-001. Tối đa ${LIMITS.code} ký tự; không đổi được sau khi tạo.`} className="mb-4">
        <Input value={values.code} maxLength={LIMITS.code} autoComplete="off" spellCheck={false} autoCapitalize="characters" className="font-mono" onChange={event => form.set('code')(event.target.value)} /></FormField>}
    <FormField label="Tên máy" required error={errors.name} className="mb-4">
      <Input value={values.name} maxLength={LIMITS.name} autoComplete="off" onChange={event => form.set('name')(event.target.value)} /></FormField>
    <FormField label="Vị trí đặt máy" required error={errors.location} hint="Ví dụ: Tòa A, tầng trệt, cạnh thang máy." className="mb-4">
      <Input value={values.location} maxLength={LIMITS.location} autoComplete="off" onChange={event => form.set('location')(event.target.value)} /></FormField>
    <fieldset className="mb-2 rounded-lg border px-3.5 pt-2.5 pb-3.5">
      <legend className="px-1 text-[13px] font-medium">Ngưỡng môi trường</legend>
      <p className="mb-3! text-xs text-muted-foreground">Số thập phân tối đa 2 chữ số, ví dụ 2 hoặc 2,5. Tối thiểu phải nhỏ hơn tối đa.{editing ? '' : ' Sửa được sau trong chi tiết máy.'}</p>
      <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
        {THRESHOLDS.map(({ key, label }) => <FormField key={key} label={label} required error={errors[key]}>
          <Input value={values[key]} inputMode="decimal" autoComplete="off" onChange={event => form.set(key)(event.target.value)} /></FormField>)}
      </div>
    </fieldset>
  </FormSheet>
}

export default MachinesPage
