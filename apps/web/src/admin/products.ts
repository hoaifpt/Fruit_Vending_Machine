// Rules of the Products screen (C1) that do not need React: URL filters and sort limited to what GET /products accepts,
// price input (Vietnamese or plain notation), request bodies limited to the contract fields, and Vietnamese wording of
// backend errors. Unit-tested. Contract: api-contract/api.yaml (listProducts, createProduct, updateProduct,
// updateProductStatus); rules: docs/product-management.md.
import { ApiError } from '../api/client.ts'
import { ValidationError } from './form-error.ts'
import type { components } from '../api/schema'
import { formatSort, oneOf, parseSort } from '../lib/table-query.ts'
import type { SortRule, SortState } from '../lib/table-query.ts'

type S = components['schemas']
export type ProductStatus = S['ProductResponse']['status']
export type CreateProductBody = S['CreateProductRequest']
export type UpdateProductBody = S['UpdateProductRequest']

export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const
export const PRODUCT_FILTER_KEYS = ['status', 'search'] as const
/** `sort` of GET /products: one approved field, default createdAt,desc. */
export const PRODUCT_SORT: SortRule = { fields: ['id', 'sku', 'name', 'price', 'status', 'createdAt', 'updatedAt'], fallback: 'createdAt,desc' }

/** Limits of CreateProductRequest / UpdateProductRequest and of the `search` parameter. */
export const LIMITS = { sku: 64, name: 200, imageUrl: 2048, search: 200 } as const
/** Largest price the API accepts (9999999999.99): at most 10 integer digits and 2 decimals. */
export const PRICE_MAX_INTEGER_DIGITS = 10

export interface ProductFilters { status: string; search: string; sort: SortState; page: number }

/** Reads the list state from the URL; unknown values are dropped so hand-edited URLs never reach the API as a 400. */
export function readProductFilters(params: URLSearchParams): ProductFilters {
  const rawPage = Number(params.get('page') ?? 0)
  return {
    status: oneOf(params.get('status'), PRODUCT_STATUSES),
    search: (params.get('search') ?? '').trim().slice(0, LIMITS.search),
    sort: parseSort(params.get('sort'), PRODUCT_SORT),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0,
  }
}

/** Query of GET /products: only page, size, status, search and sort (the contract's parameters). */
export function productListQuery(filters: ProductFilters, size: number) {
  return {
    page: filters.page, size,
    status: (filters.status || undefined) as ProductStatus | undefined,
    search: filters.search || undefined,
    sort: formatSort(filters.sort),
  }
}

export type PriceProblem = 'empty' | 'format' | 'notPositive' | 'decimals' | 'tooLarge'
export const PRICE_TEXT: Record<PriceProblem, string> = {
  empty: 'Vui lòng nhập giá bán.',
  format: 'Giá chưa đúng định dạng. Chỉ nhập số, ví dụ 35000 hoặc 35.000.',
  notPositive: 'Giá phải lớn hơn 0 ₫.',
  decimals: 'Giá chỉ được có tối đa 2 chữ số thập phân.',
  tooLarge: 'Giá tối đa là 9.999.999.999,99 ₫.',
}

export type PriceResult = { ok: true; value: number } | { ok: false; problem: PriceProblem; message: string }
const fail = (problem: PriceProblem): PriceResult => ({ ok: false, problem, message: PRICE_TEXT[problem] })

/**
 * Price typed by a person. Accepted: `35000`, `35.000` / `1.234.567` (dots group thousands, Vietnamese style),
 * `35000,5` or `35000.5` (one separator followed by 1–2 digits is the decimal point), `1.234.567,89`, spaces ignored.
 * Rejected, with the reason: empty, letters or other symbols, zero or negative, more than 2 decimals, above the maximum.
 * The value is built from the digits, never rounded.
 */
export function parsePriceInput(raw: string): PriceResult {
  const text = raw.replace(/[\s ₫]/g, '').replace(/(VND|đ)$/i, '')
  if (!text) return fail('empty')
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  let integer: string, fraction: string
  // "35,000" is thousands grouping written the English way, not 35 with three decimals: ask for the Vietnamese form.
  if (/^\d{1,3}(?:,\d{3})+$/.test(body)) return fail(negative ? 'notPositive' : 'format')
  const grouped = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/.exec(body)
  const plain = /^(\d+)(?:[.,](\d+))?$/.exec(body)
  if (grouped) { integer = grouped[1].replace(/\./g, ''); fraction = grouped[2] ?? '' }
  else if (plain) { integer = plain[1]; fraction = plain[2] ?? '' }
  else return fail(negative && /^[\d.,]+$/.test(body) ? 'notPositive' : 'format')
  const value = Number(`${integer}.${fraction || '0'}`)
  if (negative || value <= 0) return fail('notPositive')
  if (fraction.length > 2) return fail('decimals')
  if (integer.replace(/^0+(?=\d)/, '').length > PRICE_MAX_INTEGER_DIGITS) return fail('tooLarge')
  return { ok: true, value }
}

const priceNumber = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2, useGrouping: true })
const priceMoney = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** Catalog price for display, e.g. `35.000 ₫`; keeps up to 2 decimals (`35.000,5 ₫`) instead of rounding them away. */
export function formatPrice(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? priceMoney.format(value) : '—'
}

/** Price as it is put back into the input, e.g. `35.000` or `35.000,5`; reads back to the same value. */
export function priceInputValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? priceNumber.format(value) : ''
}

export type ProductValues = { sku: string; name: string; description: string; price: string; imageUrl: string }

/** Checks the backend would also make, shown beside the fields without a round trip. `sku` only when creating. */
export function validateProduct(values: ProductValues, mode: 'create' | 'edit'): Record<string, string> {
  const errors: Record<string, string> = {}
  if (mode === 'create') {
    const sku = values.sku.trim()
    if (!sku) errors.sku = 'Vui lòng nhập SKU.'
    else if (sku.length > LIMITS.sku) errors.sku = `SKU tối đa ${LIMITS.sku} ký tự.`
  }
  const name = values.name.trim()
  if (!name) errors.name = 'Vui lòng nhập tên sản phẩm.'
  else if (name.length > LIMITS.name) errors.name = `Tên sản phẩm tối đa ${LIMITS.name} ký tự.`
  const price = parsePriceInput(values.price)
  if (!price.ok) errors.price = price.message
  if (values.imageUrl.trim().length > LIMITS.imageUrl) errors.imageUrl = `Đường dẫn ảnh tối đa ${LIMITS.imageUrl} ký tự.`
  return errors
}

function priceOf(values: ProductValues): number {
  const price = parsePriceInput(values.price)
  if (!price.ok) throw new ValidationError({ price: price.message })
  return price.value
}

/**
 * POST /products body: sku, name, price and the optional description/imageUrl when given. Nothing else (status is
 * server-controlled). The SKU is uppercased here as the backend does, so what the person sees matches what is saved.
 */
export function createProductBody(values: ProductValues): CreateProductBody {
  const body: CreateProductBody = { sku: values.sku.trim().toUpperCase(), name: values.name.trim(), price: priceOf(values) }
  const description = values.description.trim(), imageUrl = values.imageUrl.trim()
  if (description) body.description = description
  if (imageUrl) body.imageUrl = imageUrl
  return body
}

/** PUT /products/{id} body: name, description, price, imageUrl only (never sku or status). PUT replaces: empty is sent as null. */
export function updateProductBody(values: ProductValues): UpdateProductBody {
  return { name: values.name.trim(), description: values.description.trim() || null, price: priceOf(values), imageUrl: values.imageUrl.trim() || null }
}

/** The status action of a row: stop selling an active product, or sell an inactive one again. */
export function statusAction(status: ProductStatus): { next: ProductStatus; label: string } {
  return status === 'ACTIVE' ? { next: 'INACTIVE', label: 'Ngừng bán' } : { next: 'ACTIVE', label: 'Mở bán lại' }
}

export const SKU_TAKEN = 'SKU này đã được dùng cho một sản phẩm khác (không phân biệt hoa thường). Hãy nhập SKU khác.'
/** Any other 409 of PUT /products/{id} (the backend's generic "Request conflicts with existing data" is English). */
export const PRODUCT_CONFLICT = 'Máy chủ từ chối vì dữ liệu sản phẩm vừa bị thay đổi ở nơi khác. Hãy tải lại danh sách rồi thử lại.'
const FORM_FIELDS = ['sku', 'name', 'description', 'price', 'imageUrl'] as const

/** Bean-validation messages of the backend (English) in Vietnamese, per field; an unknown message is kept as is. */
export function translateFieldError(field: string, message: string): string {
  if (field === 'price') {
    if (/greater than|positive|must be > ?0|lớn hơn 0/i.test(message)) return PRICE_TEXT.notPositive
    if (/fraction|decimal|out of bounds|thập phân/i.test(message)) return 'Giá tối đa 10 chữ số phần nguyên và 2 chữ số thập phân.'
    if (/less than|maximum|tối đa/i.test(message)) return PRICE_TEXT.tooLarge
    if (/null|blank|required|empty/i.test(message)) return PRICE_TEXT.empty
    return message
  }
  if (/must not be (blank|null|empty)|is required/i.test(message)) return 'Không được để trống.'
  const size = /size must be between (\d+) and (\d+)/i.exec(message)
  if (size) return `Tối đa ${size[2]} ký tự.`
  return message
}

/**
 * Errors of POST/PUT shown where they belong:
 * - 409 on create: SKU is the only unique column of products, so both the service check ("SKU is already in use") and
 *   the database constraint hit by two simultaneous creates ("Request conflicts with existing data") mean a taken SKU:
 *   shown once, in Vietnamese, under the SKU field (the form shows its usual "check the marked fields").
 * - 409 on edit (SKU is not sent): a Vietnamese form-level message instead of the backend's English text.
 * - 400 with field errors: under the matching fields in Vietnamese; a field the form does not have (for example a
 *   rejected unknown property) is named in the form-level message instead, so nothing is reported against nothing.
 * Anything else is returned unchanged.
 */
export function describeSaveError(error: unknown, mode: 'create' | 'edit' = 'create'): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) return mode === 'create' ? new ValidationError({ sku: SKU_TAKEN }) : new ApiError(409, PRODUCT_CONFLICT)
  if (error.status !== 400) return error
  const entries = Object.entries(error.fieldErrors)
  if (!entries.length) return error
  const known = entries.filter(([field]) => (FORM_FIELDS as readonly string[]).includes(field))
  const unknown = entries.filter(([field]) => !(FORM_FIELDS as readonly string[]).includes(field))
  if (unknown.length) {
    // No field-level split here: describeFormFailure would replace this message by "check the marked fields".
    const all = entries.map(([field, message]) => `${field}: ${translateFieldError(field, message)}`).join('; ')
    return new ApiError(400, `Máy chủ từ chối dữ liệu gửi lên (${all}). Hãy tải lại trang rồi thử lại.`)
  }
  return new ValidationError(Object.fromEntries(known.map(([field, message]) => [field, translateFieldError(field, message)])))
}
