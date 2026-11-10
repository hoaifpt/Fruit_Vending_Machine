// A2 Tài khoản: list (server paging + status/role filters in the URL), create STAFF and edit profile in a Sheet,
// lock/unlock through PATCH /users/{id}/status with a confirmation. No delete. ADMIN only (route guard: USER_READ).
import { useId, useState } from 'react'
import { Lock, LockOpen, Pencil, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '../../api/client.ts'
import { usersApi } from '../../api/resources.ts'
import type { User } from '../../api/resources.ts'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '../../components/ui/alert-dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input } from '../../components/ui/input.tsx'
import { PasswordInput } from '../../components/ui/password-input.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { statusMeta } from '../../lib/status.ts'
import { activeFilterCount, clearFiltersPatch } from '../../lib/table-query.ts'
import { Badge, ConfirmDialog, DataTable, FormSheet, LABELS, PAGE_SIZE, PageHead, Pagination, SelectFilter, enumOptions, useDialog, useForm } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { errorMessage, useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'
import { useReturnFocus } from '../return-focus.ts'
import {
  ACTIVE_ADMIN_QUERY, LIMITS, USER_FILTER_KEYS, USER_ROLES, createUserBody, describeCreateError, describeStatusError, hasRole, isSelf,
  lockBlockReason, lockBlocks, readUserFilters, statusAction, updateUserBody, userListQuery, validateCreateUser, validateUpdateUser,
} from '../users.ts'
import type { Actor, LockBlock } from '../users.ts'

const ROLE_OPTIONS = USER_ROLES.map(value => ({ value, label: LABELS[value] }))

type Target = { kind: 'create' } | { kind: 'edit'; user: User } | { kind: 'lock'; user: User } | { kind: 'activate'; user: User; label: string }

function UsersPage() {
  const { session, can } = useSession()
  const canWrite = can('USER_WRITE')
  const actor: Actor | null = session ? { id: session.user.id, email: session.user.email } : null
  const { params, update } = useQueryParams()
  const filters = readUserFilters(params)
  const state = useApi(signal => usersApi.list(userListQuery(filters, PAGE_SIZE), signal), `${filters.status}|${filters.role}|${filters.page}`)
  // How many ACTIVE admins exist overall (not just on this page): the lock rule needs the whole count.
  const admins = useApi(signal => canWrite ? usersApi.list(ACTIVE_ADMIN_QUERY, signal).then(page => page.totalElements) : Promise.resolve(undefined), `active-admins|${canWrite}`)
  const activeAdminCount = admins.error ? undefined : admins.data
  const dialog = useDialog<Target>()
  const target = dialog.value
  const refresh = () => { state.reload(); admins.reload() }
  const filterCount = activeFilterCount([filters.status, filters.role])
  const data = state.data
  const pastEnd = !!data && data.content.length === 0 && data.totalElements > 0
  // The API refused the list (permissions changed after sign-in): only the explanation is shown, no actions or filters.
  const forbidden = state.error instanceof ApiError && state.error.status === 403

  const columns: Column<User>[] = [
    { head: 'Họ tên', cell: user => <span className="font-medium">{user.fullName}{isSelf(user, actor) && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(Bạn)</span>}</span> },
    // Tablet width (table 681–1023px): a long email may break anywhere and the two action buttons may stack, so the
    // table fits its frame and the Thao tác column (with the reason a lock is refused) is never cut off (UX FM3 V1).
    { head: 'Email', cell: user => <span className="@min-[681px]:@max-[1023px]:wrap-anywhere">{emailParts(user.email)}</span> },
    { head: 'Điện thoại', secondary: true, cell: user => user.phone || '—' },
    { head: 'Vai trò', cell: user => <span className="inline-flex flex-wrap gap-1">{user.roles.length ? user.roles.map(role => <Badge key={role} value={role.replace(/^ROLE_/, '')} />) : '—'}</span> },
    { head: 'Trạng thái', cell: user => <Badge domain="user" value={user.status} /> },
    { head: 'Tạo lúc', secondary: true, nowrap: true, cell: user => formatDateTime(user.createdAt) },
    ...(canWrite ? [{ head: 'Thao tác', cell: (user: User) => <RowActions user={user} blocks={lockBlocks(user, actor, activeAdminCount)}
      onEdit={() => dialog.open({ kind: 'edit', user })}
      onLock={() => dialog.open({ kind: 'lock', user })}
      onActivate={label => dialog.open({ kind: 'activate', user, label })} /> }] : []),
  ]

  const empty = pastEnd
    ? <>Trang này không còn tài khoản nào. <Button type="button" variant="link" className="h-auto p-0" onClick={() => update({ page: undefined })}>Về trang đầu</Button></>
    : filterCount
      ? <>Không có tài khoản nào khớp bộ lọc. <Button type="button" variant="link" className="h-auto p-0" onClick={() => update(clearFiltersPatch(USER_FILTER_KEYS))}>Xóa bộ lọc</Button></>
      : 'Chưa có tài khoản nào.'

  return <>
    <PageHead title="Tài khoản" subtitle="Tài khoản quản trị viên và nhân viên đăng nhập trang quản lý. Tài khoản tạo mới là Nhân viên; khóa tài khoản thay cho xóa."
      actions={canWrite && !forbidden ? <Button type="button" data-focus-key="users-create" onClick={() => dialog.open({ kind: 'create' })}><UserPlus aria-hidden="true" />Tạo tài khoản nhân viên</Button> : undefined} />
    {!forbidden && <FilterBar activeCount={filterCount} onClear={() => update(clearFiltersPatch(USER_FILTER_KEYS))}>
      <SelectFilter label="Trạng thái" value={filters.status} onChange={value => update({ status: value })} options={enumOptions('user')} />
      <SelectFilter label="Vai trò" value={filters.role} onChange={value => update({ role: value })} options={ROLE_OPTIONS} />
    </FilterBar>}
    {canWrite && !forbidden && admins.error && !(admins.error instanceof ApiError && (admins.error.status === 401 || admins.error.status === 403)) && <p role="status" className="mb-3! text-[13px] text-muted-foreground">
      Chưa kiểm tra được số Quản trị viên đang hoạt động. Hệ thống vẫn từ chối khóa Quản trị viên cuối cùng.{' '}
      <Button type="button" variant="link" className="h-auto p-0 text-[13px]" onClick={admins.reload}>Kiểm tra lại</Button>
    </p>}
    <DataTable state={state} rows={data?.content} rowKey={user => user.id} columns={columns} caption="Danh sách tài khoản" empty={empty} />
    {data && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} onPage={next => update({ page: next ? String(next) : undefined })} />}
    {target?.kind === 'create' && <CreateUserSheet close={dialog.close} done={refresh} />}
    {target?.kind === 'edit' && <EditUserSheet user={target.user} self={isSelf(target.user, actor)} close={dialog.close} done={refresh} />}
    {target?.kind === 'lock' && <LockDialog user={target.user} close={dialog.close} done={refresh} />}
    {target?.kind === 'activate' && <ConfirmDialog title={`${target.label} tài khoản?`} confirmLabel={target.label} close={dialog.close}
      message={<><strong className="font-medium text-foreground">{target.user.fullName}</strong> ({target.user.email}) sẽ đăng nhập lại được ngay với mật khẩu hiện có.</>}
      onConfirm={async () => {
        try { await usersApi.setStatus(target.user.id, 'ACTIVE') } catch (error) { if (error instanceof ApiError && error.status === 409) refresh(); throw describeStatusError(error) }
        refresh()
      }} />}
  </>
}

/** An email with a preferred line break before "@", so a narrow column breaks there rather than mid-name. */
function emailParts(email: string) {
  const at = email.lastIndexOf('@')
  return at > 0 ? <>{email.slice(0, at)}<wbr />{email.slice(at)}</> : email
}

/** Edit plus one status action. A refused "Khóa" stays focusable (aria-disabled) and says why, as visible text linked to the button. */
function RowActions({ user, blocks, onEdit, onLock, onActivate }: {
  user: User; blocks: LockBlock[]; onEdit: () => void; onLock: () => void; onActivate: (label: string) => void
}) {
  const reasonId = useId()
  const action = statusAction(user.status)
  const blocked = blocks.length > 0
  return <div className="flex flex-col items-end gap-1 @min-[681px]:items-start">
    <div className="flex flex-wrap justify-end gap-1.5 @min-[681px]:justify-start @min-[1024px]:flex-nowrap">
      <Button type="button" size="sm" variant="outline" data-focus-key={`user-edit-${user.id}`} aria-label={`Sửa ${user.fullName}`} onClick={onEdit}><Pencil aria-hidden="true" />Sửa</Button>
      {action.kind === 'lock'
        ? <Button type="button" size="sm" variant="outline" data-focus-key={`user-status-${user.id}`} aria-label={`Khóa ${user.fullName}`}
          aria-disabled={blocked || undefined} aria-describedby={blocked ? reasonId : undefined}
          className={cn(blocked ? 'cursor-not-allowed text-muted-foreground hover:bg-card hover:text-muted-foreground active:translate-y-0' : 'text-destructive hover:text-destructive')}
          onClick={() => { if (!blocked) onLock() }}><Lock aria-hidden="true" />Khóa</Button>
        : <Button type="button" size="sm" variant="outline" data-focus-key={`user-status-${user.id}`} aria-label={`${action.label} ${user.fullName}`} onClick={() => onActivate(action.label)}><LockOpen aria-hidden="true" />{action.label}</Button>}
    </div>
    {blocked && <p id={reasonId} className="max-w-[26ch] text-xs text-muted-foreground">{lockBlockReason(blocks)}</p>}
  </div>
}

function CreateUserSheet({ close, done }: { close: () => void; done: () => void }) {
  const form = useForm({ email: '', password: '', fullName: '', phone: '' })
  const { values, errors } = form
  return <FormSheet title="Tạo tài khoản nhân viên" submitLabel="Tạo tài khoản" successMessage="Đã tạo tài khoản nhân viên" close={close} onFieldErrors={form.setErrors}
    description="Tài khoản mới có vai trò Nhân viên, trạng thái Hoạt động và đăng nhập được ngay. Hãy gửi mật khẩu cho người dùng qua kênh riêng."
    onSubmit={async () => {
      const problems = validateCreateUser(values)
      if (Object.keys(problems).length) form.fail(problems)
      try { await usersApi.create(createUserBody(values)) } catch (error) { throw describeCreateError(error) }
      done()
    }}>
    <FormField label="Họ tên" required error={errors.fullName} className="mb-4"><Input value={values.fullName} maxLength={LIMITS.fullName} autoComplete="off" onChange={event => form.set('fullName')(event.target.value)} /></FormField>
    <FormField label="Email" required error={errors.email} hint="Dùng để đăng nhập; không đổi được sau khi tạo." className="mb-4"><Input type="email" value={values.email} maxLength={LIMITS.email} autoComplete="off" spellCheck={false} onChange={event => form.set('email')(event.target.value)} /></FormField>
    <FormField label="Mật khẩu" required error={errors.password} hint={`Tối thiểu ${LIMITS.passwordMinDefault} ký tự (theo cấu hình hệ thống), tối đa ${LIMITS.passwordBytes} byte.`} className="mb-4"><PasswordInput value={values.password} autoComplete="new-password" onChange={event => form.set('password')(event.target.value)} /></FormField>
    <FormField label="Điện thoại (không bắt buộc)" error={errors.phone} className="mb-4"><Input type="tel" value={values.phone} maxLength={LIMITS.phone} autoComplete="off" onChange={event => form.set('phone')(event.target.value)} /></FormField>
  </FormSheet>
}

function EditUserSheet({ user, self, close, done }: { user: User; self: boolean; close: () => void; done: () => void }) {
  const form = useForm({ fullName: user.fullName, phone: user.phone ?? '' })
  const { values, errors } = form
  return <FormSheet title="Sửa tài khoản" submitLabel="Lưu thay đổi" successMessage="Đã lưu thay đổi" close={close} onFieldErrors={form.setErrors}
    description={<>{user.fullName}{self ? ' (bạn)' : ''}. Chỉ sửa được họ tên và điện thoại; khóa hoặc mở khóa ở cột Thao tác.</>}
    onSubmit={async () => {
      const problems = validateUpdateUser(values)
      if (Object.keys(problems).length) form.fail(problems)
      await usersApi.update(user.id, updateUserBody(values))
      done()
    }}>
    <FormField label="Email" hint="Email đăng nhập không đổi được." className="mb-4"><Input value={user.email} readOnly /></FormField>
    <FormField label="Họ tên" required error={errors.fullName} className="mb-4"><Input value={values.fullName} maxLength={LIMITS.fullName} autoComplete="off" onChange={event => form.set('fullName')(event.target.value)} /></FormField>
    <FormField label="Điện thoại" error={errors.phone} hint="Để trống để xóa số điện thoại." className="mb-4"><Input type="tel" value={values.phone} maxLength={LIMITS.phone} autoComplete="off" onChange={event => form.set('phone')(event.target.value)} /></FormField>
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/40 px-3.5 py-3 text-[13px]">
      <dt className="text-muted-foreground">Vai trò</dt>
      <dd className="flex flex-wrap gap-1">{user.roles.map(role => <Badge key={role} value={role.replace(/^ROLE_/, '')} />)}</dd>
      <dt className="text-muted-foreground">Trạng thái</dt>
      <dd><Badge domain="user" value={user.status} /></dd>
      <dt className="text-muted-foreground">Cập nhật</dt>
      <dd>{formatDateTime(user.updatedAt)}</dd>
    </dl>
  </FormSheet>
}

const LOCK_CHOICES = [
  { status: 'LOCKED', label: 'Khóa', note: 'Chặn đăng nhập, dùng khi tài khoản có dấu hiệu bị lộ hoặc vi phạm.' },
  { status: 'INACTIVE', label: 'Ngừng hoạt động', note: 'Tắt tài khoản không còn dùng, ví dụ nhân viên đã nghỉ.' },
] as const

/** Confirmation before PATCH /users/{id}/status. Either choice signs the person out at their next request. */
function LockDialog({ user, close, done }: { user: User; close: () => void; done: () => void }) {
  const [status, setStatus] = useState<'LOCKED' | 'INACTIVE'>('LOCKED')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const groupId = useId()
  const { onCloseAutoFocus } = useReturnFocus()
  const choice = LOCK_CHOICES.find(item => item.status === status) ?? LOCK_CHOICES[0]
  async function confirm() {
    if (pending) return
    setPending(true); setFailure('')
    try {
      await usersApi.setStatus(user.id, status)
      close(); done()
      toast.success(`Đã chuyển sang “${statusMeta('user', status).label}”`, { description: user.fullName })
    } catch (error) {
      // A 409 means the list is out of date (someone else changed an admin): refresh it behind the dialog.
      if (error instanceof ApiError && error.status === 409) done()
      setFailure(errorMessage(describeStatusError(error))); setPending(false)
    }
  }
  return <AlertDialog open onOpenChange={open => { if (!open && !pending) close() }}>
    <AlertDialogContent aria-busy={pending} onEscapeKeyDown={event => { if (pending) event.preventDefault() }} onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogTitle>Khóa tài khoản {user.fullName}?</AlertDialogTitle>
      <AlertDialogDescription>
        {user.email}{hasRole(user, 'ADMIN') ? ' (Quản trị viên)' : ''} sẽ không đăng nhập được và bị đăng xuất ở thao tác kế tiếp. Lịch sử thao tác được giữ nguyên; có thể mở lại sau.
      </AlertDialogDescription>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">Hình thức</legend>
        {LOCK_CHOICES.map(item => <label key={item.status} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors has-checked:border-primary has-checked:bg-primary/8 has-focus-visible:ring-3 has-focus-visible:ring-ring/40', pending && 'cursor-not-allowed opacity-70')}>
          <input type="radio" data-slot="radio" name={groupId} value={item.status} checked={status === item.status} disabled={pending}
            onChange={() => setStatus(item.status)} className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span className="grid gap-0.5"><span className="font-medium">{item.label}</span><span className="text-xs text-muted-foreground">{item.note}</span></span>
        </label>)}
      </fieldset>
      {failure && <p className="my-1! rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-sm text-destructive" role="alert">{failure}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Hủy</AlertDialogCancel>
        <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>{pending ? 'Đang xử lý…' : choice.label}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

export default UsersPage
