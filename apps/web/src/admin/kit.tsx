import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError } from '../api/client.ts'
import { linkHandler } from '../lib/router.ts'
import { errorMessage } from './useApi.ts'
import type { ApiState } from './useApi.ts'

export const LABELS: Record<string, string> = {
  ACTIVE: 'Hoạt động', INACTIVE: 'Ngừng hoạt động', LOCKED: 'Đã khóa', MAINTENANCE: 'Bảo trì', ERROR: 'Lỗi',
  AVAILABLE: 'Sẵn sàng', RESERVED: 'Đã giữ chỗ', SOLD: 'Đã bán', EXPIRED: 'Hết hạn', REMOVED: 'Đã gỡ', DISPENSE_FAILED: 'Nhả hàng thất bại',
  PENDING_PAYMENT: 'Chờ thanh toán', PAID: 'Đã thanh toán', DISPENSING: 'Đang nhả hàng', COMPLETED: 'Hoàn tất', CANCELLED: 'Đã hủy', PAYMENT_FAILED: 'Thanh toán thất bại', REFUNDED: 'Đã hoàn tiền',
  PENDING: 'Đang chờ', SUCCESS: 'Thành công', FAILED: 'Thất bại', REVOKED: 'Đã thu hồi', DISPENSED: 'Đã nhả hàng', RELEASED: 'Đã nhả giữ chỗ',
  LOAD: 'Nạp hàng', RESERVE: 'Giữ chỗ', SALE: 'Bán', EXPIRE: 'Hết hạn', REMOVE: 'Gỡ', RETURN: 'Hoàn trả', ADJUSTMENT: 'Điều chỉnh',
  ADMIN: 'Quản trị viên', STAFF: 'Nhân viên', fresh: 'Còn hạn', soon: 'Sắp hết hạn', expired: 'Đã hết hạn',
}
const BAD = new Set(['LOCKED', 'ERROR', 'EXPIRED', 'REMOVED', 'DISPENSE_FAILED', 'PAYMENT_FAILED', 'FAILED', 'REVOKED', 'CANCELLED', 'expired'])
const WARN = new Set(['MAINTENANCE', 'INACTIVE', 'PENDING', 'PENDING_PAYMENT', 'RESERVED', 'soon', 'REFUNDED'])

export function Badge({ value }: { value: string | undefined }) {
  if (!value) return <>—</>
  const tone = BAD.has(value) ? 'a-expired' : WARN.has(value) ? 'a-warning' : ''
  return <span className={`a-badge ${tone}`}>{LABELS[value] ?? value}</span>
}

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return <a href={to} className={className} onClick={linkHandler(to)}>{children}</a>
}

export function PageHead({ title, subtitle, actions, back }: { title: string; subtitle?: string; actions?: ReactNode; back?: { to: string; label: string } }) {
  return <header className="a-page-head">
    <div>
      {back && <p className="a-breadcrumb"><Link to={back.to}>← {back.label}</Link></p>}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {actions && <div className="a-actions">{actions}</div>}
  </header>
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return <label className="a-field"><span>{label}</span>{children}{hint && !error && <small>{hint}</small>}{error && <small className="a-field-error" role="alert">{error}</small>}</label>
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return <p className={tone === 'error' ? 'a-error' : 'a-notice'} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>
}

export function Loading({ label = 'Đang tải dữ liệu…' }: { label?: string }) {
  return <p className="a-empty" role="status">{label}</p>
}

/** Query failure: 403 explains the missing permission without logging out; others offer a retry. */
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const forbidden = error instanceof ApiError && error.status === 403
  return <div className="a-empty" role="alert">
    <p>{errorMessage(error)}</p>
    {!forbidden && retry && <p><button type="button" onClick={retry}>Thử lại</button></p>}
  </div>
}

export interface Column<T> { head: string; cell: (row: T) => ReactNode }

export function DataTable<T>({ columns, rows, rowKey, state, empty = 'Không có kết quả phù hợp.' }: {
  columns: Column<T>[]; rows: T[] | undefined; rowKey: (row: T) => string; state: Pick<ApiState<unknown>, 'loading' | 'error' | 'reload'>; empty?: string
}) {
  if (state.error && !rows) return <ErrorState error={state.error} retry={state.reload} />
  if (!rows) return <Loading />
  return <div className="a-table-wrap" aria-busy={state.loading}>
    {state.error && <ErrorState error={state.error} retry={state.reload} />}
    <table>
      <thead><tr>{columns.map(column => <th key={column.head}>{column.head}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.head} data-label={column.head}>{column.cell(row)}</td>)}</tr>)}</tbody>
    </table>
    {!rows.length && !state.loading && <p className="a-empty">{empty}</p>}
  </div>
}

export function Pagination({ page, totalPages, totalElements, onPage }: { page: number; totalPages: number; totalElements: number; onPage: (page: number) => void }) {
  if (!totalElements) return null
  return <nav className="a-pagination" aria-label="Phân trang">
    <span>Trang {page + 1} / {Math.max(totalPages, 1)} · {totalElements} bản ghi</span>
    <div>
      <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}>Trước</button>
      <button type="button" disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)}>Sau</button>
    </div>
  </nav>
}

export function SelectFilter({ label, value, onChange, options, empty = 'Tất cả' }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; empty?: string
}) {
  return <Field label={label}><select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{empty}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></Field>
}
export function enumOptions(values: readonly string[]) { return values.map(value => ({ value, label: LABELS[value] ?? value })) }

/** Text filter committed to the URL after a short pause, so each keystroke does not call the API. */
export function SearchFilter({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit: (value: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  useEffect(() => {
    if (text.trim() === value) return
    const timer = setTimeout(() => onCommit(text.trim()), 350)
    return () => clearTimeout(timer)
  }, [text, value, onCommit])
  return <Field label={label}><input className="a-search" type="search" value={text} maxLength={200} placeholder={placeholder} onChange={event => setText(event.target.value)} /></Field>
}
/** Free-text filter committed to the URL after a short pause (alias of SearchFilter for non-search fields such as ids). */
export const TextInput = SearchFilter
export function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><input type="date" value={value} onChange={event => onChange(event.target.value)} /></Field>
}

export function Toolbar({ children }: { children: ReactNode }) { return <div className="a-toolbar">{children}</div> }

/**
 * Modal form. `onSubmit` resolves to close the dialog, or throws: ApiError `fieldErrors` go to `onFieldErrors`
 * (shown beside the fields) and any other message becomes a form-level alert.
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
    try { await onSubmit(); close() } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length) { onFieldErrors?.(error.fieldErrors); setMessage('Vui lòng kiểm tra các trường được đánh dấu.') }
      else if (error instanceof ValidationError) { onFieldErrors?.(error.fieldErrors); setMessage('Vui lòng kiểm tra các trường được đánh dấu.') }
      else setMessage(errorMessage(error))
      setPending(false)
    }
  }
  return <dialog ref={ref} className="a-modal admin-app" style={wide ? { width: 'min(820px, calc(100vw - 24px))' } : undefined} aria-labelledby={id} onCancel={event => { if (pending) event.preventDefault(); else close() }}>
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <header><h2 id={id}>{title}</h2><button type="button" aria-label="Đóng" disabled={pending} onClick={close}>×</button></header>
      <div className="a-modal-body">
        {children}
        {message && <p className="a-error" role="alert">{message}</p>}
      </div>
      <footer>
        <button type="button" disabled={pending} onClick={close}>Hủy</button>
        <button type="submit" className={danger ? 'a-danger' : 'a-primary'} disabled={pending}>{pending ? 'Đang xử lý…' : submitLabel}</button>
      </footer>
    </form>
  </dialog>
}

/** Thrown by client-side validation before any request is sent. */
export class ValidationError extends Error {
  readonly fieldErrors: Record<string, string>
  constructor(fieldErrors: Record<string, string>) { super('Dữ liệu chưa hợp lệ.'); this.name = 'ValidationError'; this.fieldErrors = fieldErrors }
}

export function ConfirmDialog({ title, message, confirmLabel, close, onConfirm, danger }: {
  title: string; message: ReactNode; confirmLabel: string; close: () => void; onConfirm: () => Promise<void>; danger?: boolean
}) {
  return <FormDialog title={title} submitLabel={confirmLabel} close={close} onSubmit={onConfirm} danger={danger}><p>{message}</p></FormDialog>
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
export function StatusDialog({ title, current, options, close, onSubmit, note }: {
  title: string; current: string | undefined; options: readonly string[]; close: () => void; onSubmit: (status: string) => Promise<unknown>; note?: string
}) {
  const [status, setStatus] = useState(options.find(option => option !== current) ?? options[0])
  return <FormDialog title={title} submitLabel="Cập nhật trạng thái" close={close} onSubmit={async () => { await onSubmit(status) }}>
    <p className="a-hint">Trạng thái hiện tại: <Badge value={current} /></p>
    <Field label="Trạng thái mới"><select value={status} onChange={event => setStatus(event.target.value)}>
      {options.map(option => <option key={option} value={option} disabled={option === current}>{LABELS[option] ?? option}</option>)}
    </select></Field>
    {note && <p className="a-hint">{note}</p>}
  </FormDialog>
}
