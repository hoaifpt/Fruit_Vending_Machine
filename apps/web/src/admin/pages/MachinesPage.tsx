import { machinesApi } from '../../api/resources.ts'
import type { Machine } from '../../api/resources.ts'
import { formatDateTime, parseDecimal } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { Badge, DataTable, Field, FormDialog, Link, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter, STATUS_ACTIONS, Toolbar, enumOptions, pageParam, useDialog, useForm } from '../kit.tsx'
import { useApi } from '../useApi.ts'

const SORTS = [
  { value: 'name,asc', label: 'Tên A → Z' }, { value: 'code,asc', label: 'Mã máy A → Z' },
  { value: 'createdAt,desc', label: 'Mới tạo' }, { value: 'status,asc', label: 'Trạng thái' },
]

export const lastSeen = (machine: Machine) => machine.lastSeenAt ? formatDateTime(machine.lastSeenAt) : 'Chưa từng kết nối'

function MachinesPage({ isAdmin }: { isAdmin: boolean }) {
  const { params, update } = useQueryParams()
  const status = params.get('status') ?? '', search = params.get('search') ?? '', sort = params.get('sort') ?? 'name,asc', page = pageParam(params)
  const state = useApi(signal => machinesApi.list({ page, size: PAGE_SIZE, status: (status || undefined) as 'ACTIVE' | undefined, search: search || undefined, sort }, signal), params.toString())
  const dialog = useDialog()

  return <>
    <PageHead title="Máy bán hàng" subtitle="Trạng thái ở đây là trạng thái quản trị, không phải trạng thái trực tuyến của máy."
      actions={isAdmin ? <button type="button" className="a-primary" onClick={() => dialog.open()}>Đăng ký máy</button> : undefined} />
    <Toolbar>
      <SearchFilter label="Tìm theo mã, tên hoặc vị trí" value={search} onCommit={value => update({ search: value })} />
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ status: value })} options={enumOptions(STATUS_ACTIONS.MACHINE)} />
      <SelectFilter label="Sắp xếp" value={sort} onChange={value => update({ sort: value })} options={SORTS} empty="Mặc định" />
    </Toolbar>
    <DataTable state={state} rows={state.data?.content} rowKey={machine => machine.id} columns={[
      { head: 'Mã máy', cell: machine => <Link to={`/admin/machines/${machine.id}`}>{machine.code}</Link> },
      { head: 'Tên', cell: machine => machine.name },
      { head: 'Vị trí', cell: machine => machine.location || '—' },
      { head: 'Trạng thái', cell: machine => <Badge value={machine.status} /> },
      { head: 'Lần cuối thấy máy', cell: lastSeen },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
    {dialog.value && <MachineDialog close={dialog.close} done={state.reload} />}
  </>
}

const THRESHOLDS = [['minTemperature', 'Nhiệt độ tối thiểu (°C)'], ['maxTemperature', 'Nhiệt độ tối đa (°C)'], ['minHumidity', 'Độ ẩm tối thiểu (%)'], ['maxHumidity', 'Độ ẩm tối đa (%)']] as const

/** Register (no `machine`) or edit configuration. The machine code is immutable and status has its own endpoint. */
export function MachineDialog({ machine, close, done }: { machine?: Machine; close: () => void; done: () => void }) {
  const form = useForm({
    code: machine?.code ?? '', name: machine?.name ?? '', location: machine?.location ?? '',
    minTemperature: String(machine?.minTemperature ?? 2), maxTemperature: String(machine?.maxTemperature ?? 8),
    minHumidity: String(machine?.minHumidity ?? 30), maxHumidity: String(machine?.maxHumidity ?? 80),
  })
  const { values, errors } = form
  return <FormDialog title={machine ? 'Cấu hình máy' : 'Đăng ký máy'} submitLabel={machine ? 'Lưu' : 'Đăng ký'} close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    const problems: Record<string, string> = {}
    if (!machine && !values.code.trim()) problems.code = 'Vui lòng nhập mã máy.'
    if (!values.name.trim()) problems.name = 'Vui lòng nhập tên máy.'
    if (!values.location.trim()) problems.location = 'Vui lòng nhập vị trí.'
    const numbers: Record<string, number> = {}
    for (const [key] of THRESHOLDS) {
      const parsed = parseDecimal(values[key])
      if (parsed === undefined) problems[key] = 'Nhập một số hợp lệ.'; else numbers[key] = parsed
    }
    if (Object.keys(problems).length) return form.fail(problems)
    const body = { name: values.name.trim(), location: values.location.trim(), minTemperature: numbers.minTemperature, maxTemperature: numbers.maxTemperature, minHumidity: numbers.minHumidity, maxHumidity: numbers.maxHumidity }
    if (machine) await machinesApi.update(machine.id, body)
    else await machinesApi.create({ code: values.code.trim(), ...body })
    done()
  }}>
    <Field label="Mã máy" error={errors.code} hint={machine ? 'Mã máy không thể thay đổi.' : 'Máy mới bắt đầu ở trạng thái Ngừng hoạt động.'}><input value={values.code} readOnly={!!machine} onChange={event => form.set('code')(event.target.value)} /></Field>
    <Field label="Tên máy" error={errors.name}><input value={values.name} onChange={event => form.set('name')(event.target.value)} /></Field>
    <Field label="Vị trí" error={errors.location}><input value={values.location} onChange={event => form.set('location')(event.target.value)} /></Field>
    <div className="a-field-row">
      {THRESHOLDS.map(([key, label]) => <Field key={key} label={label} error={errors[key]}><input inputMode="decimal" value={values[key]} onChange={event => form.set(key)(event.target.value)} /></Field>)}
    </div>
  </FormDialog>
}

export default MachinesPage
