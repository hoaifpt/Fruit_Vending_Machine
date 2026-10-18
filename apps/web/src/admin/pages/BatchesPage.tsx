import { batchesApi } from '../../api/resources.ts'
import { expiryState, formatDateTime, localDateTimeToInstant, parseInteger } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { Badge, DataTable, Field, FormDialog, PAGE_SIZE, PageHead, Pagination, SelectFilter, Toolbar, pageParam, useDialog, useForm } from '../kit.tsx'
import { useProductOptions } from '../options.ts'
import { useApi } from '../useApi.ts'

const SORTS = [
  { value: 'expiresAt,asc', label: 'Hạn dùng gần nhất' }, { value: 'createdAt,desc', label: 'Mới tạo' },
  { value: 'batchCode,asc', label: 'Mã lô A → Z' }, { value: 'quantity,desc', label: 'Số lượng giảm dần' },
]

function BatchesPage() {
  const { params, update } = useQueryParams()
  const productId = params.get('productId') ?? '', sort = params.get('sort') ?? 'createdAt,desc', page = pageParam(params)
  const products = useProductOptions()
  const state = useApi(signal => batchesApi.list({ page, size: PAGE_SIZE, productId: productId || undefined, sort }, signal), params.toString())
  const dialog = useDialog()
  return <>
    <PageHead title="Lô hàng" subtitle="Lô hàng không thể sửa hoặc xóa sau khi tạo."
      actions={<button type="button" className="a-primary" onClick={() => dialog.open()}>Tạo lô hàng</button>} />
    <Toolbar>
      <SelectFilter label="Sản phẩm" value={productId} onChange={value => update({ productId: value })} options={products} />
      <SelectFilter label="Sắp xếp" value={sort} onChange={value => update({ sort: value })} options={SORTS} empty="Mặc định" />
    </Toolbar>
    <DataTable state={state} rows={state.data?.content} rowKey={batch => batch.id ?? ''} columns={[
      { head: 'Mã lô', cell: batch => batch.batchCode },
      { head: 'Sản phẩm', cell: batch => `${batch.productName} (${batch.productSku})` },
      { head: 'Sản xuất', cell: batch => formatDateTime(batch.manufacturedAt) },
      { head: 'Hết hạn', cell: batch => <>{formatDateTime(batch.expiresAt)} <Badge value={expiryState(batch.expiresAt)} /></> },
      { head: 'Số lượng khai báo', cell: batch => batch.quantity },
      { head: 'Tạo lúc', cell: batch => formatDateTime(batch.createdAt) },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
    {dialog.value && <BatchDialog close={dialog.close} done={state.reload} />}
  </>
}

function BatchDialog({ close, done }: { close: () => void; done: () => void }) {
  const products = useProductOptions(true)
  const form = useForm({ productId: '', batchCode: '', manufacturedAt: '', expiresAt: '', quantity: '' })
  const { values, errors } = form
  return <FormDialog title="Tạo lô hàng" submitLabel="Tạo lô" close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    const problems: Record<string, string> = {}
    if (!values.productId) problems.productId = 'Vui lòng chọn sản phẩm.'
    if (!values.batchCode.trim()) problems.batchCode = 'Vui lòng nhập mã lô.'
    const manufacturedAt = localDateTimeToInstant(values.manufacturedAt), expiresAt = localDateTimeToInstant(values.expiresAt)
    if (!manufacturedAt) problems.manufacturedAt = 'Vui lòng chọn thời điểm sản xuất.'
    if (!expiresAt) problems.expiresAt = 'Vui lòng chọn hạn sử dụng.'
    if (manufacturedAt && expiresAt && expiresAt <= manufacturedAt) problems.expiresAt = 'Hạn sử dụng phải sau thời điểm sản xuất.'
    const quantity = parseInteger(values.quantity)
    if (quantity === undefined || quantity < 1) problems.quantity = 'Số lượng phải là số nguyên lớn hơn 0.'
    if (Object.keys(problems).length || !manufacturedAt || !expiresAt || quantity === undefined) return form.fail(problems)
    await batchesApi.create({ productId: values.productId, batchCode: values.batchCode.trim(), manufacturedAt, expiresAt, quantity })
    done()
  }}>
    <Field label="Sản phẩm" error={errors.productId}><select value={values.productId} onChange={event => form.set('productId')(event.target.value)}>
      <option value="">Chọn sản phẩm…</option>{products.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></Field>
    <Field label="Mã lô" error={errors.batchCode}><input value={values.batchCode} onChange={event => form.set('batchCode')(event.target.value)} /></Field>
    <div className="a-field-row">
      <Field label="Sản xuất lúc (giờ Việt Nam)" error={errors.manufacturedAt}><input type="datetime-local" value={values.manufacturedAt} onChange={event => form.set('manufacturedAt')(event.target.value)} /></Field>
      <Field label="Hết hạn lúc (giờ Việt Nam)" error={errors.expiresAt}><input type="datetime-local" value={values.expiresAt} onChange={event => form.set('expiresAt')(event.target.value)} /></Field>
    </div>
    <Field label="Số lượng khai báo (hộp)" error={errors.quantity}><input inputMode="numeric" value={values.quantity} onChange={event => form.set('quantity')(event.target.value)} /></Field>
  </FormDialog>
}

export default BatchesPage
