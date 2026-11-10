// C1 Sản phẩm: list (server paging, sort, status/search filters in the URL), create and edit in a Sheet (SKU fixed after
// creation), stop/resume selling through PATCH /products/{id}/status with a confirmation. No delete anywhere.
// ADMIN: view, create, edit, change status (PRODUCT_WRITE). STAFF: view only (PRODUCT_READ, route guard).
import { useState } from 'react'
import { CirclePause, CirclePlay, PackagePlus, Pencil } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { productsApi } from '../../api/resources.ts'
import type { Product } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, Textarea } from '../../components/ui/input.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, sortParam } from '../../lib/table-query.ts'
import { Badge, ConfirmDialog, DataTable, FormSheet, PAGE_SIZE, PageHead, Pagination, SearchFilter, SelectFilter, enumOptions, useDialog, useForm } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'
import {
  LIMITS, PRODUCT_FILTER_KEYS, PRODUCT_SORT, createProductBody, describeSaveError, formatPrice, parsePriceInput, priceInputValue,
  productListQuery, readProductFilters, statusAction, updateProductBody, validateProduct,
} from '../products.ts'
import type { ProductValues } from '../products.ts'

type Target = { kind: 'create' } | { kind: 'edit'; product: Product } | { kind: 'status'; product: Product }

function ProductsPage() {
  const { can } = useSession()
  const canWrite = can('PRODUCT_WRITE')
  const { params, update } = useQueryParams()
  const filters = readProductFilters(params)
  const query = productListQuery(filters, PAGE_SIZE)
  const state = useApi(signal => productsApi.list(query, signal), `${query.status}|${query.search}|${query.sort}|${query.page}`)
  const dialog = useDialog<Target>()
  const target = dialog.value
  const filterCount = activeFilterCount([filters.status, filters.search])
  const data = state.data
  const pastEnd = !!data && data.content.length === 0 && data.totalElements > 0
  // The API refused the list (permissions changed after sign-in): only the explanation is shown, no actions or filters.
  const forbidden = state.error instanceof ApiError && state.error.status === 403
  const clearFilters = () => update(clearFiltersPatch(PRODUCT_FILTER_KEYS))

  const columns: Column<Product>[] = [
    { head: 'SKU', sortKey: 'sku', nowrap: true, cell: product => <span className="font-mono text-[13px]">{product.sku}</span> },
    { head: 'Tên sản phẩm', sortKey: 'name', cell: product => <span className="grid gap-0.5">
      <span className="font-medium">{product.name}</span>
      {product.description && <span className="line-clamp-2 text-xs text-muted-foreground">{product.description}</span>}
    </span> },
    { head: 'Giá bán', sortKey: 'price', nowrap: true, cell: product => <span className="tabular-nums">{formatPrice(product.price)}</span> },
    { head: 'Trạng thái', sortKey: 'status', cell: product => <Badge domain="product" value={product.status} /> },
    { head: 'Cập nhật', secondary: true, nowrap: true, cell: product => formatDateTime(product.updatedAt) },
    ...(canWrite ? [{ head: 'Thao tác', cell: (product: Product) => <RowActions product={product}
      onEdit={() => dialog.open({ kind: 'edit', product })} onStatus={() => dialog.open({ kind: 'status', product })} /> }] : []),
  ]

  const empty = pastEnd
    ? <>Trang này không còn sản phẩm nào. <Button type="button" variant="link" className="h-auto p-0" onClick={() => update({ page: undefined })}>Về trang đầu</Button></>
    : filterCount
      ? <>Không có sản phẩm nào khớp bộ lọc. <Button type="button" variant="link" className="h-auto p-0" onClick={clearFilters}>Xóa bộ lọc</Button></>
      : canWrite
        ? <>Chưa có sản phẩm nào. Bấm “Thêm sản phẩm” để tạo sản phẩm đầu tiên.</>
        : 'Chưa có sản phẩm nào. Quản trị viên sẽ thêm sản phẩm vào danh mục.'

  return <>
    <PageHead title="Sản phẩm"
      subtitle={canWrite
        ? 'Danh mục sản phẩm, SKU và giá bán. SKU cố định sau khi tạo; ngừng bán thay cho xóa để giữ lịch sử lô và đơn hàng.'
        : 'Danh mục sản phẩm, SKU và giá bán (chỉ xem). Thêm, sửa hoặc ngừng bán do Quản trị viên thực hiện.'}
      actions={canWrite && !forbidden ? <Button type="button" data-focus-key="products-create" onClick={() => dialog.open({ kind: 'create' })}><PackagePlus aria-hidden="true" />Thêm sản phẩm</Button> : undefined} />
    {!forbidden && <FilterBar activeCount={filterCount} onClear={clearFilters}>
      <SearchFilter label="Tìm theo tên hoặc SKU" value={filters.search} onCommit={value => update({ search: value || undefined, page: undefined })} />
      <SelectFilter label="Trạng thái" value={filters.status} onChange={value => update({ status: value || undefined, page: undefined })} options={enumOptions('product')} />
    </FilterBar>}
    <DataTable state={state} rows={data?.content} rowKey={product => product.id} columns={columns} caption="Danh sách sản phẩm" empty={empty}
      sort={filters.sort} onSort={next => update({ sort: sortParam(next, PRODUCT_SORT), page: undefined })} />
    {data && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} onPage={next => update({ page: next ? String(next) : undefined })} />}
    {target?.kind === 'create' && <ProductSheet close={dialog.close} done={state.reload} />}
    {target?.kind === 'edit' && <ProductSheet product={target.product} close={dialog.close} done={state.reload} />}
    {target?.kind === 'status' && <StatusConfirm product={target.product} close={dialog.close} done={state.reload} />}
  </>
}

function RowActions({ product, onEdit, onStatus }: { product: Product; onEdit: () => void; onStatus: () => void }) {
  const action = statusAction(product.status)
  const Icon = action.next === 'INACTIVE' ? CirclePause : CirclePlay
  return <div className="flex flex-wrap justify-end gap-1.5 @min-[681px]:flex-nowrap @min-[681px]:justify-start">
    <Button type="button" size="sm" variant="outline" data-focus-key={`product-edit-${product.id}`} aria-label={`Sửa ${product.name}`} onClick={onEdit}><Pencil aria-hidden="true" />Sửa</Button>
    <Button type="button" size="sm" variant="outline" data-focus-key={`product-status-${product.id}`} aria-label={`${action.label} ${product.name}`} onClick={onStatus}><Icon aria-hidden="true" />{action.label}</Button>
  </div>
}

/** Create (no product) or edit. The price is checked as it is typed and when the field is left, not only on submit. */
function ProductSheet({ product, close, done }: { product?: Product; close: () => void; done: () => void }) {
  const editing = !!product
  const form = useForm<ProductValues>({
    sku: product?.sku ?? '', name: product?.name ?? '', description: product?.description ?? '',
    price: priceInputValue(product?.price), imageUrl: product?.imageUrl ?? '',
  })
  const { values, errors } = form
  // Once the price field has been left, every change is checked again; before that only a value ≤ 0 is reported at once.
  const [priceTouched, setPriceTouched] = useState(false)
  const setPriceError = (message: string) => form.setErrors(previous => (previous.price === message ? previous : { ...previous, price: message }))
  function changePrice(raw: string) {
    form.set('price')(raw)
    const result = parsePriceInput(raw)
    if (!result.ok && (priceTouched || result.problem === 'notPositive')) setPriceError(result.message)
  }
  function leavePrice() {
    // Tabbing through an untouched empty field is not an error yet; submit still requires a price.
    if (!values.price.trim() && !priceTouched && !product) return
    setPriceTouched(true)
    const result = parsePriceInput(values.price)
    if (!result.ok) setPriceError(result.message)
    else form.set('price')(priceInputValue(result.value))
  }
  const preview = parsePriceInput(values.price)
  const priceHint = preview.ok
    ? `Hiển thị: ${formatPrice(preview.value)}.${editing ? ' Giá mới chỉ áp dụng cho đơn tạo sau khi lưu.' : ''}`
    : 'Lớn hơn 0, tối đa 2 chữ số thập phân, ví dụ 35000 hoặc 35.000.'

  return <FormSheet title={editing ? 'Sửa sản phẩm' : 'Thêm sản phẩm'} submitLabel={editing ? 'Lưu thay đổi' : 'Thêm sản phẩm'}
    successMessage={editing ? 'Đã lưu thay đổi' : 'Đã thêm sản phẩm'} close={close} onFieldErrors={form.setErrors}
    description={editing
      ? <>{product.name}. Sửa tên, mô tả, giá và ảnh; SKU không đổi được. Ngừng bán hoặc mở bán lại ở cột Thao tác.</>
      : 'Sản phẩm mới ở trạng thái Đang bán. SKU không đổi được sau khi tạo.'}
    onSubmit={async () => {
      const mode = editing ? 'edit' : 'create'
      const problems = validateProduct(values, mode)
      if (Object.keys(problems).length) { setPriceTouched(true); form.fail(problems) }
      try {
        if (product) await productsApi.update(product.id, updateProductBody(values))
        else await productsApi.create(createProductBody(values))
      } catch (error) { throw describeSaveError(error) }
      done()
    }}>
    {editing
      ? <FormField label="SKU" hint="SKU cố định sau khi tạo để lô, tồn kho và đơn hàng luôn trỏ đúng sản phẩm. Cần SKU khác thì thêm sản phẩm mới và ngừng bán sản phẩm này." className="mb-4">
        <Input value={product.sku} readOnly className="font-mono" /></FormField>
      : <FormField label="SKU" required error={errors.sku} hint={`Mã duy nhất, tự chuyển thành chữ in hoa, ví dụ MANGO-BOX-001. Tối đa ${LIMITS.sku} ký tự; không đổi được sau khi tạo.`} className="mb-4">
        <Input value={values.sku} maxLength={LIMITS.sku} autoComplete="off" spellCheck={false} autoCapitalize="characters" className="font-mono" onChange={event => form.set('sku')(event.target.value)} /></FormField>}
    <FormField label="Tên sản phẩm" required error={errors.name} className="mb-4">
      <Input value={values.name} maxLength={LIMITS.name} autoComplete="off" onChange={event => form.set('name')(event.target.value)} /></FormField>
    <FormField label="Giá bán (VND)" required error={errors.price} hint={priceHint} className="mb-4">
      <Input value={values.price} inputMode="decimal" autoComplete="off" onChange={event => changePrice(event.target.value)} onBlur={leavePrice} /></FormField>
    <FormField label="Mô tả (không bắt buộc)" error={errors.description} hint={editing ? 'Để trống để xóa mô tả.' : undefined} className="mb-4">
      <Textarea value={values.description} onChange={event => form.set('description')(event.target.value)} /></FormField>
    <FormField label="Đường dẫn ảnh (không bắt buộc)" error={errors.imageUrl} hint={`Đường dẫn tới ảnh đã có sẵn, tối đa ${LIMITS.imageUrl} ký tự.${editing ? ' Để trống để bỏ ảnh.' : ''}`} className="mb-4">
      <Input type="url" value={values.imageUrl} maxLength={LIMITS.imageUrl} autoComplete="off" spellCheck={false} onChange={event => form.set('imageUrl')(event.target.value)} /></FormField>
    {product && <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/40 px-3.5 py-3 text-[13px]">
      <dt className="text-muted-foreground">Trạng thái</dt>
      <dd><Badge domain="product" value={product.status} /></dd>
      <dt className="text-muted-foreground">Tạo lúc</dt>
      <dd>{formatDateTime(product.createdAt)}</dd>
      <dt className="text-muted-foreground">Cập nhật</dt>
      <dd>{formatDateTime(product.updatedAt)}</dd>
    </dl>}
  </FormSheet>
}

/** Confirmation before PATCH /products/{id}/status. Nothing is deleted either way; batches, stock and orders stay as they are. */
function StatusConfirm({ product, close, done }: { product: Product; close: () => void; done: () => void }) {
  const action = statusAction(product.status)
  const stopping = action.next === 'INACTIVE'
  return <ConfirmDialog title={`${action.label} “${product.name}”?`} confirmLabel={action.label} danger={stopping} close={close}
    message={stopping
      ? <>Sản phẩm <strong className="font-medium text-foreground">{product.sku}</strong> sẽ không hiện trên kiosk và không tạo lô hay nạp hộp mới được. Hộp đã nạp vẫn ở trong ngăn; lịch sử lô, tồn kho và đơn hàng được giữ nguyên. Có thể mở bán lại bất cứ lúc nào.</>
      : <>Sản phẩm <strong className="font-medium text-foreground">{product.sku}</strong> sẽ bán lại được trên kiosk với giá hiện tại {formatPrice(product.price)}, và được dùng để tạo lô, nạp hộp mới.</>}
    onConfirm={async () => {
      try { await productsApi.setStatus(product.id, action.next) } catch (error) {
        // The product changed or disappeared meanwhile: refresh the list behind the dialog.
        if (error instanceof ApiError && (error.status === 404 || error.status === 409)) done()
        throw error
      }
      done()
    }} />
}

export default ProductsPage
