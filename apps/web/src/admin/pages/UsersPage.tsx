import { usersApi } from '../../api/resources.ts'
import type { User } from '../../api/resources.ts'
import { useQueryParams } from '../../lib/router.ts'
import { formatDateTime } from '../../lib/format.ts'
import { Badge, DataTable, Field, FormDialog, PAGE_SIZE, PageHead, Pagination, SelectFilter, STATUS_ACTIONS, StatusDialog, Toolbar, enumOptions, pageParam, useDialog, useForm } from '../kit.tsx'
import { useApi } from '../useApi.ts'

type Target = { kind: 'create' } | { kind: 'edit'; user: User } | { kind: 'status'; user: User }

function UsersPage() {
  const { params, update } = useQueryParams()
  const status = params.get('status') ?? '', role = params.get('role') ?? '', page = pageParam(params)
  const state = useApi(signal => usersApi.list({
    page, size: PAGE_SIZE, status: (status || undefined) as 'ACTIVE' | undefined, role: (role || undefined) as 'ADMIN' | undefined,
  }, signal), params.toString())
  const dialog = useDialog<Target>()
  const target = dialog.value
  const refresh = () => state.reload()

  return <>
    <PageHead title="Tài khoản" subtitle="Quản lý tài khoản nhân viên. Chỉ quản trị viên được truy cập." actions={<button type="button" className="a-primary" onClick={() => dialog.open({ kind: 'create' })}>Tạo tài khoản nhân viên</button>} />
    <Toolbar>
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ status: value })} options={enumOptions(STATUS_ACTIONS.USER)} />
      <SelectFilter label="Vai trò" value={role} onChange={value => update({ role: value })} options={enumOptions(['ADMIN', 'STAFF'])} />
    </Toolbar>
    <DataTable state={state} rows={state.data?.content} rowKey={user => user.id} columns={[
      { head: 'Họ tên', cell: user => user.fullName },
      { head: 'Email', cell: user => user.email },
      { head: 'Điện thoại', cell: user => user.phone || '—' },
      { head: 'Vai trò', cell: user => user.roles.map(item => <Badge key={item} value={item.replace(/^ROLE_/, '')} />) },
      { head: 'Trạng thái', cell: user => <Badge value={user.status} /> },
      { head: 'Tạo lúc', cell: user => formatDateTime(user.createdAt) },
      { head: 'Thao tác', cell: user => <div className="a-actions">
        <button type="button" onClick={() => dialog.open({ kind: 'edit', user })}>Sửa</button>
        <button type="button" onClick={() => dialog.open({ kind: 'status', user })}>Đổi trạng thái</button>
      </div> },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
    {target?.kind === 'create' && <CreateUserDialog close={dialog.close} done={refresh} />}
    {target?.kind === 'edit' && <EditUserDialog user={target.user} close={dialog.close} done={refresh} />}
    {target?.kind === 'status' && <StatusDialog title={`Trạng thái: ${target.user.fullName}`} current={target.user.status} options={STATUS_ACTIONS.USER} close={dialog.close}
      note="Hệ thống từ chối vô hiệu hóa quản trị viên đang hoạt động cuối cùng hoặc tự đổi trạng thái của chính bạn."
      onSubmit={async status => { await usersApi.setStatus(target.user.id, status as 'ACTIVE'); refresh() }} />}
  </>
}

function CreateUserDialog({ close, done }: { close: () => void; done: () => void }) {
  const form = useForm({ email: '', password: '', fullName: '', phone: '' })
  const { values, errors } = form
  return <FormDialog title="Tạo tài khoản nhân viên" submitLabel="Tạo tài khoản" close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    const problems: Record<string, string> = {}
    if (!values.email.trim()) problems.email = 'Vui lòng nhập email.'
    if (!values.password) problems.password = 'Vui lòng nhập mật khẩu.'
    if (!values.fullName.trim()) problems.fullName = 'Vui lòng nhập họ tên.'
    if (Object.keys(problems).length) return form.fail(problems)
    await usersApi.create({ email: values.email.trim(), password: values.password, fullName: values.fullName.trim(), phone: values.phone.trim() || null })
    done()
  }}>
    <Field label="Họ tên" error={errors.fullName}><input value={values.fullName} maxLength={150} onChange={event => form.set('fullName')(event.target.value)} /></Field>
    <Field label="Email" error={errors.email}><input type="email" autoComplete="off" value={values.email} onChange={event => form.set('email')(event.target.value)} /></Field>
    <Field label="Mật khẩu" error={errors.password} hint="Tối đa 72 ký tự."><input type="password" autoComplete="new-password" value={values.password} onChange={event => form.set('password')(event.target.value)} /></Field>
    <Field label="Điện thoại (không bắt buộc)" error={errors.phone}><input value={values.phone} onChange={event => form.set('phone')(event.target.value)} /></Field>
  </FormDialog>
}

function EditUserDialog({ user, close, done }: { user: User; close: () => void; done: () => void }) {
  const form = useForm({ fullName: user.fullName, phone: user.phone ?? '' })
  const { values, errors } = form
  return <FormDialog title="Sửa hồ sơ" close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    if (!values.fullName.trim()) return form.fail({ fullName: 'Vui lòng nhập họ tên.' })
    await usersApi.update(user.id, { fullName: values.fullName.trim(), phone: values.phone.trim() || null })
    done()
  }}>
    <Field label="Email"><input value={user.email} readOnly /></Field>
    <Field label="Họ tên" error={errors.fullName}><input value={values.fullName} maxLength={150} onChange={event => form.set('fullName')(event.target.value)} /></Field>
    <Field label="Điện thoại" error={errors.phone}><input value={values.phone} onChange={event => form.set('phone')(event.target.value)} /></Field>
  </FormDialog>
}

export default UsersPage
