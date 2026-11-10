import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError } from '../api/client.ts'
import { ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '../components/ui/alert-dialog.tsx'
import { Button } from '../components/ui/button.tsx'
import { DataTable as Table } from '../components/ui/data-table.tsx'
import type { DataTableColumn } from '../components/ui/data-table.tsx'
import { FilterBar } from '../components/ui/filter-bar.tsx'
import { FormField } from '../components/ui/form-field.tsx'
import { Input, NativeSelect } from '../components/ui/input.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { StatusBadge } from '../components/ui/status-badge.tsx'
import { cn } from '../lib/cn.ts'
import { linkHandler } from '../lib/router.ts'
import { STATUS_CATALOG, statusMeta } from '../lib/status.ts'
import type { StatusDomain } from '../lib/status.ts'
import type { SortState } from '../lib/table-query.ts'
import { describeFormFailure, ValidationError } from './form-error.ts'
import { rolesWith } from './permissions.ts'
import type { Permission } from './permissions.ts'
import { homeFor } from './routes.ts'
import { errorMessage } from './useApi.ts'
import type { ApiState } from './useApi.ts'
import { useSession } from './useSession.ts'

/** Labels of the few values that are not backend statuses: roles and the batch expiry hint. Statuses come from STATUS_CATALOG. */
export const LABELS: Record<string, string> = {
  ADMIN: 'Quản trị viên', STAFF: 'Nhân viên', fresh: 'Còn hạn', soon: 'Sắp hết hạn', expired: 'Đã hết hạn',
}
const PLAIN_TONES: Record<string, string> = { expired: 'bg-status-danger text-status-danger-foreground', soon: 'bg-status-warning text-status-warning-foreground' }

// Unlayered global rules (index.css, admin.css) beat Tailwind utilities, so margins on <p> and sizes on plain controls need `!`.
const ERROR_BOX = 'my-3.5! rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-destructive'
const HINT = 'mt-3! mb-4.5! text-[13px] leading-[1.7] text-muted-foreground'
const SMALL_PLAIN_BUTTONS = '[&_button]:min-h-8! [&_button]:px-2.5! [&_button]:text-[13px]!'

/**
 * With `domain` the value is a backend status read in that vocabulary (icon, explanation). Without it the value is a
 * role or an expiry hint (`LABELS`) shown as a plain pill; backend statuses must always pass their domain.
 */
export function Badge({ value, domain, explain }: { value: string | undefined; domain?: StatusDomain; explain?: boolean }) {
  if (domain) return <StatusBadge domain={domain} value={value} explain={explain} />
  if (!value) return <>—</>
  const tone = PLAIN_TONES[value] ?? 'bg-status-success text-status-success-foreground'
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap before:size-1.5 before:rounded-full before:bg-current', tone)}>{LABELS[value] ?? value}</span>
}

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return <a href={to} className={className} onClick={linkHandler(to)}>{children}</a>
}

export function PageHead({ title, subtitle, actions, back }: { title: string; subtitle?: string; actions?: ReactNode; back?: { to: string; label: string } }) {
  return <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      {back && <p className="mb-1.5! text-[13px]"><Link to={back.to} className="text-muted-foreground no-underline transition-colors hover:text-foreground">← {back.label}</Link></p>}
      <h1>{title}</h1>
      {subtitle && <p className="mt-1! max-w-[70ch] text-muted-foreground">{subtitle}</p>}
    </div>
    {actions && <div className={cn('flex flex-wrap items-center gap-1.5', SMALL_PLAIN_BUTTONS)}>{actions}</div>}
  </header>
}

/** Admin form field: the label, hint and error are linked to its single control; stacks with a bottom margin in forms. */
export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return <FormField label={label} error={error} hint={hint} className="mb-4">{children}</FormField>
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  if (tone === 'error') return <p className={ERROR_BOX} role="alert">{children}</p>
  return <p role="status" className="mb-4.5! flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/8 px-3.5 py-2.5">{children}</p>
}

/** First load of a block: shimmering placeholder rows; the label is announced to screen readers only. */
export function Loading({ label = 'Đang tải dữ liệu…', rows = 4 }: { label?: string; rows?: number }) {
  return <div role="status" className="grid gap-3 py-2">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-4" style={{ width: `${92 - ((index * 17) % 40)}%` }} />)}
  </div>
}

/** Table-shaped placeholder used while a list loads for the first time. */
export function TableSkeleton({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return <div role="status" className="w-full overflow-hidden rounded-xl border bg-card in-[.a-panel]:rounded-none in-[.a-panel]:border-0 in-[.a-panel]:bg-transparent">
    <span className="sr-only">Đang tải dữ liệu…</span>
    <div className="flex gap-6 border-b bg-muted px-3.5 py-3">{Array.from({ length: columns }, (_, index) => <Skeleton key={index} className="h-3 flex-1 opacity-70" />)}</div>
    {Array.from({ length: rows }, (_, row) => <div key={row} className="flex items-center gap-6 border-b px-3.5 py-4 last:border-b-0">
      {Array.from({ length: columns }, (_, index) => <Skeleton key={index} className={index === 0 ? 'h-4 flex-[1.3]' : 'h-4 flex-1'} style={{ opacity: 1 - row * 0.1 }} />)}
    </div>)}
  </div>
}

/** Whole-screen placeholder while a lazy screen loads: header, toolbar and a table. */
export function PageSkeleton() {
  return <div role="status" aria-label="Đang mở màn hình…" className="animate-in fade-in-0 duration-300">
    <div className="mb-6 grid gap-2.5"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-96 max-w-full" /></div>
    <div className="mb-4 flex gap-3"><Skeleton className="h-9 w-72 max-w-full" /><Skeleton className="h-9 w-40" /></div>
    <TableSkeleton />
  </div>
}

/**
 * "No access" explanation with the current role and the next step. Never signs the user out.
 * `permission` set: the route guard refused the screen before any API call (says who may open it).
 * Without it: the API answered 403 (permissions can change after sign-in).
 */
export function Forbidden({ permission, page = false }: { permission?: Permission; page?: boolean }) {
  const { session, roles } = useSession()
  const titleId = useId()
  const Heading = page ? 'h1' : 'h2'
  const current = roles.map(role => LABELS[role] ?? role).join(', ') || 'chưa xác định'
  const allowed = permission ? rolesWith(permission).map(role => LABELS[role] ?? role).join(', ') : ''
  const home = homeFor(roles)
  return <section role="alert" aria-labelledby={titleId}
    className={cn('mx-auto grid max-w-xl justify-items-center gap-3 px-4 text-center', page ? 'py-16' : 'py-10')}>
    <span className="grid size-12 place-items-center rounded-full bg-status-warning text-status-warning-foreground" aria-hidden="true"><ShieldAlert className="size-6" /></span>
    <Heading id={titleId} className="text-lg font-semibold text-foreground">Không có quyền truy cập</Heading>
    <p className="text-muted-foreground">
      {permission
        ? <>Mục này chỉ dành cho {allowed ? <strong className="font-medium text-foreground">{allowed}</strong> : 'tài khoản được cấp quyền'}.</>
        : <>Hệ thống đã từ chối yêu cầu vì tài khoản của bạn không có quyền xem hoặc thao tác với dữ liệu này.</>}
    </p>
    <p className="text-[13px] text-muted-foreground">
      Bạn đang đăng nhập với vai trò <strong className="font-medium text-foreground">{current}</strong>{session?.user.email ? <> ({session.user.email})</> : null}.
    </p>
    <p className="text-[13px] text-muted-foreground">Nếu công việc cần mục này, hãy liên hệ quản trị viên để được cấp quyền, rồi đăng nhập lại để quyền mới có hiệu lực.</p>
    {home !== '/login' && <Button asChild variant="outline" size="sm" className="mt-1"><a href={home} onClick={linkHandler(home)}>Về trang đầu của bạn</a></Button>}
  </section>
}

/** Query failure with the next step: 403 explains the missing permission, 401 is on its way to login, others offer a retry. */
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 403) return <Forbidden />
  return <div className="px-4 py-10 text-center text-muted-foreground" role="alert">
    <p>{errorMessage(error)}</p>
    {status === 401 && <p className="mt-1.5! text-[13px]">Đang chuyển đến trang đăng nhập…</p>}
    {status !== 401 && retry && <p className="mt-3!"><Button type="button" variant="outline" size="sm" onClick={retry}>Thử lại</Button></p>}
  </div>
}

export type Column<T> = DataTableColumn<T>

export function DataTable<T>({ columns, rows, rowKey, state, empty = 'Không có kết quả phù hợp.', sort, onSort, caption }: {
  columns: Column<T>[]; rows: T[] | undefined; rowKey: (row: T) => string; state: Pick<ApiState<unknown>, 'loading' | 'error' | 'reload'>; empty?: string
  /** Current server sort; columns with a `sortKey` become sortable when `onSort` is set. */
  sort?: SortState; onSort?: (sort: SortState) => void; caption?: string
}) {
  if (state.error && !rows) return <ErrorState error={state.error} retry={state.reload} />
  if (!rows) return <TableSkeleton columns={Math.min(columns.length, 6)} />
  return <Table columns={columns} rows={rows} rowKey={rowKey} loading={state.loading} empty={empty} sort={sort} onSort={onSort} caption={caption}
    error={state.error ? <ErrorState error={state.error} retry={state.reload} /> : undefined} />
}

export function Pagination({ page, totalPages, totalElements, onPage }: { page: number; totalPages: number; totalElements: number; onPage: (page: number) => void }) {
  if (!totalElements) return null
  return <nav className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5 text-[13px] text-muted-foreground" aria-label="Phân trang">
    <span>Trang {page + 1} / {Math.max(totalPages, 1)} · {totalElements} bản ghi</span>
    <div className="flex gap-2">
      <Button type="button" variant="outline" disabled={page <= 0} onClick={() => onPage(page - 1)}>Trước</Button>
      <Button type="button" variant="outline" disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)}>Sau</Button>
    </div>
  </nav>
}

export function SelectFilter({ label, value, onChange, options, empty = 'Tất cả' }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; empty?: string
}) {
  return <Field label={label}><NativeSelect value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{empty}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </NativeSelect></Field>
}
/** Filter options of a status domain, labelled from STATUS_CATALOG (all values in catalog order unless `values` narrows them). */
export function enumOptions(domain: StatusDomain, values: readonly string[] = Object.keys(STATUS_CATALOG[domain])) {
  return values.map(value => ({ value, label: statusMeta(domain, value).label }))
}

/** Text filter committed to the URL after a short pause, so each keystroke does not call the API. */
export function SearchFilter({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit: (value: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  useEffect(() => {
    if (text.trim() === value) return
    const timer = setTimeout(() => onCommit(text.trim()), 350)
    return () => clearTimeout(timer)
  }, [text, value, onCommit])
  return <Field label={label}><Input type="search" value={text} maxLength={200} placeholder={placeholder} onChange={event => setText(event.target.value)} /></Field>
}
/** Free-text filter committed to the URL after a short pause (alias of SearchFilter for non-search fields such as ids). */
export const TextInput = SearchFilter
export function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><Input type="date" value={value} onChange={event => onChange(event.target.value)} /></Field>
}

/** Filter row of the screens that have no "clear filters" yet; see `FilterBar`. */
export function Toolbar({ children }: { children: ReactNode }) { return <FilterBar>{children}</FilterBar> }

/**
 * Modal form. `onSubmit` resolves to close the dialog, or throws: field errors go to `onFieldErrors` (shown beside the
 * fields) and the form-level alert follows `describeFormFailure` (a 409 keeps its business message).
 */
export function FormDialog({ title, submitLabel = 'Lưu', close, onSubmit, children, onFieldErrors, danger = false, wide = false }: {
  title: string; submitLabel?: string; close: () => void
  onSubmit: () => Promise<void>
  children: ReactNode
  onFieldErrors?: (fieldErrors: Record<string, string>) => void
  danger?: boolean; wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true); setMessage('')
    try { await onSubmit(); close(); toast.success(`Đã ${submitLabel.charAt(0).toLowerCase()}${submitLabel.slice(1)}`, { description: title }) } catch (error) {
      const failure = describeFormFailure(error)
      if (failure.fieldErrors) onFieldErrors?.(failure.fieldErrors)
      setMessage(failure.message)
      setPending(false)
    }
  }
  return <dialog ref={ref} aria-labelledby={id} onCancel={event => { if (pending) event.preventDefault(); else close() }}
    className={cn('m-auto max-h-[calc(100dvh-32px)] rounded-[14px] border bg-popover p-0 text-foreground shadow-2xl open:animate-in open:fade-in-0 open:zoom-in-95 backdrop:bg-black/40 motion-reduce:animate-none!', wide ? 'w-[min(820px,calc(100vw-24px))]' : 'w-[min(560px,calc(100vw-24px))]')}>
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <header className="flex items-center justify-between gap-3 border-b px-5 py-4 max-[680px]:px-4 max-[680px]:py-3.5">
        <h2 id={id}>{title}</h2>
        <Button type="button" variant="ghost" size="icon-sm" className="text-xl font-normal text-muted-foreground" aria-label="Đóng" disabled={pending} onClick={close}>×</Button>
      </header>
      <div className="p-5 max-[680px]:px-4 max-[680px]:py-3.5 [&_textarea]:min-h-25! [&_textarea]:resize-y!">
        {children}
        {message && <p className={ERROR_BOX} role="alert">{message}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t bg-muted/50 px-5 py-3.5 max-[680px]:px-4">
        <Button type="button" variant="outline" disabled={pending} onClick={close}>Hủy</Button>
        <Button type="submit" variant={danger ? 'destructive' : 'default'} disabled={pending}>{pending ? 'Đang xử lý…' : submitLabel}</Button>
      </footer>
    </form>
  </dialog>
}

export { ValidationError }

/** Asks before an action that cannot be undone. Stays open while it runs; a failure is shown inside, so the user can retry. */
export function ConfirmDialog({ title, message, confirmLabel, close, onConfirm, danger }: {
  title: string; message: ReactNode; confirmLabel: string; close: () => void; onConfirm: () => Promise<void>; danger?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  async function confirm() {
    if (pending) return
    setPending(true); setFailure('')
    try { await onConfirm(); close(); toast.success(`Đã ${confirmLabel.charAt(0).toLowerCase()}${confirmLabel.slice(1)}`, { description: title }) } catch (error) {
      setFailure(errorMessage(error)); setPending(false)
    }
  }
  return <AlertDialog open onOpenChange={open => { if (!open && !pending) close() }}>
    <AlertDialogContent aria-busy={pending} onEscapeKeyDown={event => { if (pending) event.preventDefault() }}>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      <AlertDialogDescription asChild><div>{message}</div></AlertDialogDescription>
      {failure && <p className={ERROR_BOX} role="alert">{failure}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Hủy</AlertDialogCancel>
        <Button type="button" variant={danger ? 'destructive' : 'default'} disabled={pending} onClick={confirm}>{pending ? 'Đang xử lý…' : confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

export function useDialog<T = true>() {
  const [value, setValue] = useState<T | null>(null)
  return { value, open: (next: T = true as T) => setValue(next), close: () => setValue(null) }
}

/** Form-state helper: values, per-field errors (client + server), and a setter that clears the field error. */
export function useForm<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState<T>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  return {
    values, errors, setErrors,
    set: (name: keyof T & string) => (value: string) => {
      setValues(previous => ({ ...previous, [name]: value }))
      setErrors(previous => (previous[name] ? { ...previous, [name]: '' } : previous))
    },
    fail(fieldErrors: Record<string, string>): never { setErrors(fieldErrors); throw new ValidationError(fieldErrors) },
  }
}

export function pageParam(params: URLSearchParams): number {
  const value = Number(params.get('page') ?? 0)
  return Number.isInteger(value) && value > 0 ? value : 0
}
export const PAGE_SIZE = 20

export const STATUS_ACTIONS = { USER: ['ACTIVE', 'INACTIVE', 'LOCKED'], PRODUCT: ['ACTIVE', 'INACTIVE'], MACHINE: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'], SLOT: ['ACTIVE', 'INACTIVE', 'ERROR'] } as const

/** Dialog that moves a record to another status through its dedicated status endpoint. */
export function StatusDialog({ title, domain, current, options, close, onSubmit, note }: {
  title: string; domain: StatusDomain; current: string | undefined; options: readonly string[]; close: () => void; onSubmit: (status: string) => Promise<unknown>; note?: string
}) {
  const [status, setStatus] = useState(options.find(option => option !== current) ?? options[0])
  return <FormDialog title={title} submitLabel="Cập nhật trạng thái" close={close} onSubmit={async () => { await onSubmit(status) }}>
    <p className={HINT}>Trạng thái hiện tại: <Badge domain={domain} value={current} /></p>
    <Field label="Trạng thái mới"><NativeSelect value={status} onChange={event => setStatus(event.target.value)}>
      {options.map(option => <option key={option} value={option} disabled={option === current}>{statusMeta(domain, option).label}</option>)}
    </NativeSelect></Field>
    {note && <p className={HINT}>{note}</p>}
  </FormDialog>
}
