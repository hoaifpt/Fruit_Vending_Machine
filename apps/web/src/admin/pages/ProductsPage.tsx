import { productsApi } from '../../api/resources.ts'
import type { Product } from '../../api/resources.ts'
import { formatDateTime, formatMoney, parsePrice } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { Badge, DataTable, Field, FormDialog, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter, STATUS_ACTIONS, StatusDialog, Toolbar, enumOptions, pageParam, useDialog, useForm } from '../kit.tsx'
import { useApi } from '../useApi.ts'

const SORTS = [
  { value: 'name,asc', label: 'Tên A → Z' }, { value: 'name,desc', label: 'Tên Z → A' },
  { value: 'price,asc', label: 'Giá tăng dần' }, { value: 'price,desc', label: 'Giá giảm dần' },
  { value: 'createdAt,desc', label: 'Mới tạo' },
]
type Target = { kind: 'form'; product?: Product } | { kind: 'status'; product: Product }

function ProductsPage({ isAdmin }: { isAdmin: boolean }) {
  const { params, update } = useQueryParams()
  const status = params.get('status') ?? '', search = params.get('search') ?? '', sort = params.get('sort') ?? 'name,asc', page = pageParam(params)
  const state = useApi(signal => productsApi.list({ page, size: PAGE_SIZE, status: (status || undefined) as 'ACTIVE' | undefined, search: search || undefined, sort }, signal), params.toString())
  const dialog = useDialog<Target>()
  const target = dialog.value

  return <>
    <PageHead title="Sản phẩm" subtitle={isAdmin ? 'Danh mục, SKU và giá bán.' : 'Danh mục sản phẩm (chỉ xem).'}
      actions={isAdmin ? <button type="button" className="a-primary" onClick={() => dialog.open({ kind: 'form' })}>Thêm sản phẩm</button> : undefined} />
    <Toolbar>
      <SearchFilter label="Tìm theo tên hoặc SKU" value={search} onCommit={value => update({ search: value })} />
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ status: value })} options={enumOptions(STATUS_ACTIONS.PRODUCT)} />
      <SelectFilter label="Sắp xếp" value={sort} onChange={value => update({ sort: value })} options={SORTS} empty="Mặc định" />
    </Toolbar>
    <DataTable state={state} rows={state.data?.content} rowKey={product => product.id} columns={[
      { head: 'SKU', cell: product => product.sku },
      { head: 'Tên', cell: product => <>{product.name}{product.description && <small style={{ display: 'block' }}>{product.description}</small>}</> },
      { head: 'Giá', cell: product => formatMoney(product.price) },
      { head: 'Trạng thái', cell: product => <Badge value={product.status} /> },
      { head: 'Cập nhật', cell: product => formatDateTime(product.updatedAt) },
      ...(isAdmin ? [{ head: 'Thao tác', cell: (product: Product) => <div className="a-actions">
        <button type="button" onClick={() => dialog.open({ kind: 'form', product })}>Sửa</button>
        <button type="button" onClick={() => dialog.open({ kind: 'status', product })}>Đổi trạng thái</button>
      </div> }] : []),
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
    {target?.kind === 'form' && <ProductDialog product={target.product} close={dialog.close} done={state.reload} />}
    {target?.kind === 'status' && <StatusDialog title={`Trạng thái: ${target.product.name}`} current={target.product.status} options={STATUS_ACTIONS.PRODUCT} close={dialog.close}
      onSubmit={async next => { await productsApi.setStatus(target.product.id, next as 'ACTIVE'); state.reload() }} />}
  </>
}

function ProductDialog({ product, close, done }: { product?: Product; close: () => void; done: () => void }) {
  const form = useForm({ sku: product?.sku ?? '', name: product?.name ?? '', description: product?.description ?? '', price: product ? String(product.price) : '', imageUrl: product?.imageUrl ?? '' })
  const { values, errors } = form
  return <FormDialog title={product ? 'Sửa sản phẩm' : 'Thêm sản phẩm'} close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    const problems: Record<string, string> = {}
    if (!product && !values.sku.trim()) problems.sku = 'Vui lòng nhập SKU.'
    if (!values.name.trim()) problems.name = 'Vui lòng nhập tên sản phẩm.'
    const price = parsePrice(values.price)
    if (price === undefined) problems.price = 'Giá phải lớn hơn 0 và tối đa 2 chữ số thập phân.'
    if (Object.keys(problems).length || price === undefined) return form.fail(problems)
    const body = { name: values.name.trim(), description: values.description.trim() || null, price, imageUrl: values.imageUrl.trim() || null }
    if (product) await productsApi.update(product.id, body)
    else await productsApi.create({ sku: values.sku.trim(), ...body })
    done()
  }}>
    <Field label="SKU" error={errors.sku} hint={product ? 'SKU không thể thay đổi sau khi tạo.' : undefined}><input value={values.sku} readOnly={!!product} onChange={event => form.set('sku')(event.target.value)} /></Field>
    <Field label="Tên sản phẩm" error={errors.name}><input value={values.name} maxLength={200} onChange={event => form.set('name')(event.target.value)} /></Field>
    <Field label="Mô tả" error={errors.description}><textarea value={values.description} onChange={event => form.set('description')(event.target.value)} /></Field>
    <Field label="Giá bán (VND)" error={errors.price} hint="Lớn hơn 0, tối đa 2 chữ số thập phân."><input inputMode="decimal" value={values.price} onChange={event => form.set('price')(event.target.value)} /></Field>
    <Field label="URL ảnh (không bắt buộc)" error={errors.imageUrl}><input value={values.imageUrl} onChange={event => form.set('imageUrl')(event.target.value)} /></Field>
  </FormDialog>
}

export default ProductsPage
