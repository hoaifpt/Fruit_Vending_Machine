// I1 Lô hàng: list (server paging, sort, product filter in the URL) with, for each batch, how many boxes were loaded
// from it against the declared quantity; create a batch in a Sheet where the expiry is checked against the
// manufacture time as it is typed. Batches are immutable: no edit and no delete anywhere.
// ADMIN and STAFF: view (BATCH_READ, route guard) and create (BATCH_CREATE). The loaded figure needs INVENTORY_READ.
import { useState } from 'react'
import { PackagePlus } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { batchesApi } from '../../api/resources.ts'
import type { Batch } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, NativeSelect } from '../../components/ui/input.tsx'
import { cn } from '../../lib/cn.ts'
import { expiryState, formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import {
  BATCH_FILTER_KEYS, BATCH_SORT, LIMITS, NEW_BATCH, QUANTITY_TEXT, batchListQuery, countLoaded, createBatchBody, describeSaveError,
  expiryHint, expiryMin, expiryProblem, loadedView, parseQuantity, readBatchFilters, validateBatch,
} from '../batches.ts'
import type { BatchValues, LoadedCount } from '../batches.ts'
import { Badge, DataTable, FormSheet, PAGE_SIZE, PageHead, Pagination, SelectFilter, useDialog, useForm } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useProductOptions } from '../options.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

function BatchesPage() {
  const { can } = useSession()
  const canCreate = can('BATCH_CREATE')
  const canSeeStock = can('INVENTORY_READ')
  const { params, update } = useQueryParams()
  const filters = readBatchFilters(params)
  const query = batchListQuery(filters, PAGE_SIZE)
  const state = useApi(signal => batchesApi.list(query, signal), `${query.productId}|${query.sort}|${query.page}`)
  const products = useProductOptions()
  const dialog = useDialog()
  const data = state.data
  const ids = (data?.content ?? []).map(batch => batch.id).filter((id): id is string => !!id)
  // Reloaded with the list (updatedAt changes after a create), so a new batch gets its figure too.
  const loaded = useApi(signal => canSeeStock && ids.length ? countLoaded(ids, signal) : Promise.resolve({} as Record<string, LoadedCount>),
    `${canSeeStock}|${ids.join(',')}|${state.updatedAt ?? 0}`)
  const filterCount = activeFilterCount([filters.productId])
  const pastEnd = !!data && data.content.length === 0 && data.totalElements > 0
  // The API refused the list (permissions changed after sign-in): only the explanation is shown, no actions or filters.
  const forbidden = state.error instanceof ApiError && state.error.status === 403
  const clearFilters = () => update(clearFiltersPatch(BATCH_FILTER_KEYS))

  const columns: Column<Batch>[] = [
    { head: 'Mã lô', sortKey: 'batchCode', nowrap: true, cell: batch => <span className="font-mono text-[13px] font-medium">{batch.batchCode}</span> },
    { head: 'Sản phẩm', cell: batch => <span className="grid gap-0.5">
      <span className="font-medium">{batch.productName}</span>
      <span className="font-mono text-xs text-muted-foreground">{batch.productSku}</span>
    </span> },
    { head: 'Sản xuất', sortKey: 'manufacturedAt', nowrap: true, cell: batch => formatDateTime(batch.manufacturedAt) },
    { head: 'Hạn dùng', sortKey: 'expiresAt', cell: batch => <span className="grid justify-items-start gap-1">
      <span className="whitespace-nowrap">{formatDateTime(batch.expiresAt)}</span><Badge value={expiryState(batch.expiresAt)} />
    </span> },
    { head: 'Đã nạp / khai báo', cell: batch => <LoadedCell batch={batch} canSeeStock={canSeeStock} counts={loaded.data} loading={loaded.loading} failed={loaded.error} retry={loaded.reload} /> },
    { head: 'Tạo lúc', secondary: true, nowrap: true, cell: batch => formatDateTime(batch.createdAt) },
  ]

  const productLabel = products.find(option => option.value === filters.productId)?.label
  const empty = pastEnd
    ? <>Trang này không còn lô nào. <Button type="button" variant="link" className="h-auto p-0" onClick={() => update({ page: undefined })}>Về trang đầu</Button></>
    : filterCount
      ? <>Không có lô nào của {productLabel ?? 'sản phẩm đã chọn'}. <Button type="button" variant="link" className="h-auto p-0" onClick={clearFilters}>Xóa bộ lọc</Button></>
      : canCreate
        ? <>Chưa có lô hàng nào. Bấm “Tạo lô hàng” để ghi nhận lô đầu tiên trước khi nạp hộp vào ngăn.</>
        : 'Chưa có lô hàng nào. Người có quyền tạo lô sẽ ghi nhận lô trước khi nạp hộp.'

  return <>
    <PageHead title="Lô hàng"
      subtitle={`Mỗi lô ghi mã lô, ngày sản xuất, hạn dùng và số hộp khai báo; lô không sửa hay xóa được sau khi tạo. Cột Đã nạp đếm mọi hộp đã nạp vào ngăn từ lô, kể cả hộp đã bán hoặc đã rút.${canCreate ? '' : ' Bạn chỉ xem; tạo lô do người có quyền thực hiện.'}`}
      actions={canCreate && !forbidden ? <Button type="button" data-focus-key="batches-create" onClick={() => dialog.open()}><PackagePlus aria-hidden="true" />Tạo lô hàng</Button> : undefined} />
    {!forbidden && <FilterBar activeCount={filterCount} onClear={clearFilters}>
      <SelectFilter label="Sản phẩm" value={filters.productId} onChange={value => update({ productId: value || undefined, page: undefined })} options={products} />
    </FilterBar>}
    <DataTable state={state} rows={data?.content} rowKey={batch => batch.id ?? batch.batchCode ?? ''} columns={columns} caption="Danh sách lô hàng" empty={empty}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, BATCH_SORT), page: undefined })} />
    {canSeeStock && !forbidden && <p className="sr-only" role="status">{loaded.loading && ids.length ? 'Đang đếm số hộp đã nạp của các lô…' : ''}</p>}
    {data && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} onPage={next => update({ page: next ? String(next) : undefined })} />}
    {dialog.value && <BatchSheet close={dialog.close} done={state.reload} />}
  </>
}

/** "8 / 20 hộp", a bar and what it means; or why the figure is missing. */
function LoadedCell({ batch, canSeeStock, counts, loading, failed, retry }: {
  batch: Batch; canSeeStock: boolean; counts?: Record<string, LoadedCount>; loading: boolean; failed?: unknown; retry: () => void
}) {
  const declared = batch.quantity ?? 0
  const declaredText = `Khai báo ${declared.toLocaleString('vi-VN')} hộp`
  if (!canSeeStock) return <span className="grid gap-0.5"><span>{declaredText}</span>
    <span className="text-xs text-muted-foreground">Cần quyền xem tồn kho để biết số đã nạp.</span></span>
  const count = batch.id ? counts?.[batch.id] : undefined
  if (!count) {
    if (failed && !loading) return <MissingCount batchCode={batch.batchCode} declaredText={declaredText} error={failed} retry={retry} />
    // No live region per cell: the page announces the count once (see BatchesPage).
    return <span className="grid gap-0.5" aria-busy="true"><span>{declaredText}</span><span className="text-xs text-muted-foreground">Đang đếm số đã nạp…</span></span>
  }
  if (!count.ok) return <MissingCount batchCode={batch.batchCode} declaredText={declaredText} error={count.error} retry={retry} />
  const expired = expiryState(batch.expiresAt) === 'expired'
  const view = loadedView(count.loaded, declared, expired)
  return <span className="grid min-w-36 gap-1">
    <span className="font-medium tabular-nums whitespace-nowrap">{view.text}</span>
    <span aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span className={cn('block h-full rounded-full', expired || view.state === 'full' ? 'bg-muted-foreground' : 'bg-primary')} style={{ width: `${view.percent}%` }} />
    </span>
    <span className="text-xs text-muted-foreground">{view.detail}</span>
  </span>
}

function MissingCount({ batchCode, declaredText, error, retry }: { batchCode?: string; declaredText: string; error: unknown; retry: () => void }) {
  const status = error instanceof ApiError ? error.status : undefined
  return <span className="grid justify-items-start gap-0.5">
    <span>{declaredText}</span>
    <span className="text-xs text-muted-foreground">{status === 403 ? 'Không có quyền xem tồn kho nên không biết số đã nạp.' : 'Chưa đếm được số đã nạp.'}</span>
    {status !== 403 && status !== 401 && <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" aria-label={`Đếm lại số đã nạp của lô ${batchCode ?? ''}`.trim()} onClick={retry}>Đếm lại</Button>}
  </span>
}

/**
 * Create a batch. The expiry is checked whenever either date changes (at or before the manufacture time, or already
 * past), its `min` follows the manufacture time, and the quantity when the field is left; submit sends nothing while
 * an error remains.
 */
function BatchSheet({ close, done }: { close: () => void; done: () => void }) {
  const products = useProductOptions(true)
  const form = useForm<BatchValues>({ ...NEW_BATCH })
  const { values, errors } = form
  // Reference time of the hint and `min` (minute precision); checks on change and submit read the clock again.
  const [now] = useState(() => Date.now())
  // Read out by screen readers when a date change makes the expiry invalid (the field itself may not have focus).
  const [announced, setAnnounced] = useState('')
  const setError = (field: keyof BatchValues, message: string) =>
    form.setErrors(previous => ((previous[field] ?? '') === message ? previous : { ...previous, [field]: message }))
  function changeDate(field: 'manufacturedAt' | 'expiresAt', raw: string) {
    form.set(field)(raw)
    const next = { ...values, [field]: raw }
    // Expiry still empty: keep whatever it shows (e.g. "required" after a submit) instead of clearing it.
    if (field === 'manufacturedAt' && !next.expiresAt) return
    const problem = expiryProblem(next.manufacturedAt, next.expiresAt, Date.now())
    setError('expiresAt', problem)
    setAnnounced(problem)
  }
  function leaveQuantity() {
    if (!values.quantity.trim()) return
    if (parseQuantity(values.quantity) === undefined) setError('quantity', QUANTITY_TEXT)
  }

  return <FormSheet title="Tạo lô hàng" submitLabel="Tạo lô" successMessage="Đã tạo lô hàng" successDescription={null} close={close} onFieldErrors={form.setErrors}
    description="Ghi nhận lô trước khi nạp hộp. Lô không sửa hay xóa được sau khi tạo, nên hãy kiểm tra kỹ ngày giờ và số lượng."
    onSubmit={async () => {
      const problems = validateBatch(values, Date.now())
      if (Object.keys(problems).length) form.fail(problems)
      try { await batchesApi.create(createBatchBody(values, Date.now())) } catch (error) { throw describeSaveError(error) }
      done()
    }}>
    <FormField label="Sản phẩm" required error={errors.productId} hint={products.length ? 'Chỉ sản phẩm đang bán mới tạo lô được.' : 'Chưa có sản phẩm đang bán nào để tạo lô.'} className="mb-4">
      <NativeSelect value={values.productId} onChange={event => form.set('productId')(event.target.value)}>
        <option value="">Chọn sản phẩm…</option>
        {products.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect></FormField>
    <FormField label="Mã lô" required error={errors.batchCode} hint={`Mã duy nhất, tự chuyển thành chữ in hoa, ví dụ MANGO-20261110-01. Tối đa ${LIMITS.batchCode} ký tự.`} className="mb-4">
      <Input value={values.batchCode} maxLength={LIMITS.batchCode} autoComplete="off" spellCheck={false} autoCapitalize="characters" className="font-mono"
        onChange={event => form.set('batchCode')(event.target.value)} /></FormField>
    <div className="grid grid-cols-2 gap-x-3 max-[480px]:grid-cols-1">
      <FormField label="Sản xuất lúc" required error={errors.manufacturedAt} hint="Giờ Việt Nam." className="mb-4">
        <Input type="datetime-local" value={values.manufacturedAt} onChange={event => changeDate('manufacturedAt', event.target.value)} /></FormField>
      <FormField label="Hạn dùng" required error={errors.expiresAt} hint={expiryHint(values.manufacturedAt, now)} className="mb-4">
        <Input type="datetime-local" value={values.expiresAt} min={expiryMin(values.manufacturedAt, now)}
          onChange={event => changeDate('expiresAt', event.target.value)} /></FormField>
    </div>
    <FormField label="Số lượng khai báo (hộp)" required error={errors.quantity} hint="Số hộp ghi nhận ban đầu của lô, ví dụ 20. Không phải tồn kho; số đã nạp không được vượt số này." className="mb-4">
      <Input value={values.quantity} inputMode="numeric" autoComplete="off" onChange={event => form.set('quantity')(event.target.value)} onBlur={leaveQuantity} /></FormField>
    <p className="sr-only" aria-live="polite">{announced ? `Hạn dùng: ${announced}` : ''}</p>
  </FormSheet>
}

export default BatchesPage
