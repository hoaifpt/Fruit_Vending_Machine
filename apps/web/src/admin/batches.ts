// Rules of the Batches screen (I1) that do not need React: URL filter and sort limited to what GET /product-batches
// accepts, the create form (dates checked as they are typed, request body limited to the contract fields), the
// "loaded / declared" figure of each batch and Vietnamese wording of backend errors. Unit-tested.
// Contract: api-contract/api.yaml (listProductBatches, createProductBatch, listInventory); rules:
// docs/product-batch-management.md, docs/inventory-management.md.
//
// "Đã nạp" (loaded): GET /product-batches has no stock figure, so it is the totalElements of GET /inventory?batchId=…
// (size 1). Every inventory item is one box created by a load and never deleted, whatever its status later (SOLD,
// REMOVED…), which is exactly what the backend counts against the batch quantity when loading.
import { ApiError } from '../api/client.ts'
import { inventoryApi } from '../api/resources.ts'
import type { components } from '../api/schema'
import { formatDateTime, localDateTimeToInstant } from '../lib/format.ts'
import { formatSort, parseSort, uuidParam } from '../lib/table-query.ts'
import type { SortRule, SortState } from '../lib/table-query.ts'
import { ValidationError } from './form-error.ts'

type S = components['schemas']
export type CreateBatchBody = S['CreateProductBatchRequest']

export const BATCH_FILTER_KEYS = ['productId'] as const
/** `sort` of GET /product-batches: one approved field, default createdAt,desc. */
export const BATCH_SORT: SortRule = { fields: ['id', 'batchCode', 'manufacturedAt', 'expiresAt', 'quantity', 'createdAt'], fallback: 'createdAt,desc' }
/** Limits of CreateProductBatchRequest. */
export const LIMITS = { batchCode: 64, quantity: 2_147_483_647 } as const

export interface BatchFilters { productId: string; sort: SortState; page: number }

/** Reads the list state from the URL; a productId that is not a UUID or an unknown sort never reaches the API as a 400. */
export function readBatchFilters(params: URLSearchParams): BatchFilters {
  const rawPage = Number(params.get('page') ?? 0)
  return {
    productId: uuidParam(params.get('productId')),
    sort: parseSort(params.get('sort'), BATCH_SORT),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0,
  }
}

/** Query of GET /product-batches: only page, size, productId and sort (the contract's parameters). */
export function batchListQuery(filters: BatchFilters, size: number) {
  return { page: filters.page, size, productId: filters.productId || undefined, sort: formatSort(filters.sort) }
}

export type BatchValues = { productId: string; batchCode: string; manufacturedAt: string; expiresAt: string; quantity: string }
export const NEW_BATCH: BatchValues = { productId: '', batchCode: '', manufacturedAt: '', expiresAt: '', quantity: '' }

export const EXPIRY_TEXT = {
  required: 'Vui lòng chọn hạn dùng.',
  beforeManufacture: 'Hạn dùng phải sau thời điểm sản xuất. Chọn ngày giờ muộn hơn ngày sản xuất.',
  past: 'Hạn dùng đã qua. Lô hết hạn không tạo được; chọn ngày giờ trong tương lai.',
} as const
export const MANUFACTURED_REQUIRED = 'Vui lòng chọn thời điểm sản xuất.'

const MINUTE = 60_000
const vietnamParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** UTC instant → `<input type="datetime-local">` value in Vietnam time (`YYYY-MM-DDTHH:mm`), the reverse of localDateTimeToInstant. */
export function instantToLocalDateTime(instant: number | string): string {
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return ''
  const part = Object.fromEntries(vietnamParts.formatToParts(date).map(item => [item.type, item.value]))
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`
}

/**
 * Problem of the expiry field from what is typed so far, or '' when there is none yet. Used on every change of either
 * date, so an expiry at or before the manufacture time (or already past) is reported before submitting. An empty
 * expiry is not an error while typing; only the submit requires it.
 */
export function expiryProblem(manufacturedAt: string, expiresAt: string, now: number): string {
  const expires = localDateTimeToInstant(expiresAt)
  if (!expires) return ''
  const made = localDateTimeToInstant(manufacturedAt)
  if (made && Date.parse(expires) <= Date.parse(made)) return EXPIRY_TEXT.beforeManufacture
  if (Date.parse(expires) <= now) return EXPIRY_TEXT.past
  return ''
}

/**
 * `min` of the expiry input: one minute after the manufacture time and after now (the input works in minutes and the
 * expiry must be strictly later than both). Undefined while the manufacture time is not set.
 */
export function expiryMin(manufacturedAt: string, now: number): string | undefined {
  const made = localDateTimeToInstant(manufacturedAt)
  if (!made) return undefined
  const madeMinute = Date.parse(made) + MINUTE
  const nowMinute = Math.floor(now / MINUTE) * MINUTE + MINUTE
  return instantToLocalDateTime(Math.max(madeMinute, nowMinute))
}

/** Declared quantity typed by a person: a whole number 1..2147483647 (spaces and dot grouping like `1.000` allowed). */
export function parseQuantity(raw: string): number | undefined {
  const text = raw.replace(/\s/g, '')
  if (!/^\d+$/.test(text) && !/^\d{1,3}(\.\d{3})+$/.test(text)) return undefined
  const value = Number(text.replace(/\./g, ''))
  return Number.isSafeInteger(value) && value >= 1 && value <= LIMITS.quantity ? value : undefined
}
export const QUANTITY_TEXT = 'Số lượng khai báo phải là số nguyên từ 1 đến 2.147.483.647 hộp.'

/** Every check the backend would also make, shown beside the fields without a round trip. */
export function validateBatch(values: BatchValues, now: number): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!values.productId) errors.productId = 'Vui lòng chọn sản phẩm.'
  const code = values.batchCode.trim()
  if (!code) errors.batchCode = 'Vui lòng nhập mã lô.'
  else if (code.length > LIMITS.batchCode) errors.batchCode = `Mã lô tối đa ${LIMITS.batchCode} ký tự.`
  if (!localDateTimeToInstant(values.manufacturedAt)) errors.manufacturedAt = MANUFACTURED_REQUIRED
  const expiry = localDateTimeToInstant(values.expiresAt) ? expiryProblem(values.manufacturedAt, values.expiresAt, now) : EXPIRY_TEXT.required
  if (expiry) errors.expiresAt = expiry
  if (parseQuantity(values.quantity) === undefined) errors.quantity = values.quantity.trim() ? QUANTITY_TEXT : 'Vui lòng nhập số lượng khai báo.'
  return errors
}

/** POST /product-batches body: exactly batchCode, productId, manufacturedAt, expiresAt (UTC ISO-8601) and quantity. */
export function createBatchBody(values: BatchValues, now: number): CreateBatchBody {
  const errors = validateBatch(values, now)
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return {
    batchCode: values.batchCode.trim().toUpperCase(),
    productId: values.productId,
    manufacturedAt: localDateTimeToInstant(values.manufacturedAt) as string,
    expiresAt: localDateTimeToInstant(values.expiresAt) as string,
    quantity: parseQuantity(values.quantity) as number,
  }
}

/** Hint of the expiry field: the earliest accepted time once the manufacture time is known. */
export function expiryHint(manufacturedAt: string, now: number): string {
  const min = expiryMin(manufacturedAt, now)
  const earliest = min ? localDateTimeToInstant(min) : undefined
  return earliest
    ? `Giờ Việt Nam. Sớm nhất ${formatDateTime(earliest)}: sau thời điểm sản xuất và sau hiện tại.`
    : 'Giờ Việt Nam. Phải sau thời điểm sản xuất và sau hiện tại.'
}

// ---- loaded / declared

export type LoadedCount = { ok: true; loaded: number } | { ok: false; error: unknown }

/**
 * Boxes loaded from each batch: totalElements of GET /inventory?batchId=<id>&size=1, one request per batch of the page
 * (at most PAGE_SIZE), run together. One failing batch does not hide the others.
 */
export async function countLoaded(batchIds: readonly string[], signal?: AbortSignal): Promise<Record<string, LoadedCount>> {
  const results = await Promise.allSettled(batchIds.map(batchId => inventoryApi.list({ batchId, page: 0, size: 1 }, signal)))
  return Object.fromEntries(batchIds.map((batchId, index) => {
    const result = results[index]
    return [batchId, result.status === 'fulfilled' ? { ok: true, loaded: result.value.totalElements } : { ok: false, error: result.reason }]
  }))
}

export type LoadState = 'none' | 'partial' | 'full'
export interface LoadedView { text: string; state: LoadState; detail: string; percent: number }

const count = new Intl.NumberFormat('vi-VN')

/**
 * "8 / 20 hộp" with what it means for the next load. An expired batch cannot be loaded any more (the backend refuses
 * it), so it never says how many boxes are left to load.
 */
export function loadedView(loaded: number, declared: number, expired = false): LoadedView {
  const remaining = Math.max(declared - loaded, 0)
  const state: LoadState = loaded <= 0 ? 'none' : remaining === 0 ? 'full' : 'partial'
  const detail = expired
    ? 'Lô đã hết hạn, không nạp thêm được.'
    : state === 'none' ? 'Chưa nạp hộp nào vào ngăn.' : state === 'full' ? 'Đã nạp đủ số khai báo, không nạp thêm được.' : `Còn nạp được ${count.format(remaining)} hộp.`
  const percent = declared > 0 ? Math.min(100, Math.round((loaded / declared) * 100)) : 0
  return { text: `${count.format(loaded)} / ${count.format(declared)} hộp`, state, detail, percent }
}

// ---- save errors

export const CODE_TAKEN = 'Mã lô này đã tồn tại (không phân biệt hoa thường). Hãy nhập mã lô khác.'
export const PRODUCT_INACTIVE = 'Sản phẩm này đang ngừng bán nên không tạo lô được. Chọn sản phẩm khác hoặc nhờ quản trị viên mở bán lại.'
export const PRODUCT_GONE = 'Không tìm thấy sản phẩm này nữa. Hãy đóng biểu mẫu, tải lại trang rồi chọn lại sản phẩm.'
export const NOT_FOUND_OTHER = 'Máy chủ không tìm thấy dữ liệu cần để tạo lô (không phải sản phẩm). Hãy tải lại trang, đăng nhập lại rồi thử lại.'
const FORM_FIELDS = ['productId', 'batchCode', 'manufacturedAt', 'expiresAt', 'quantity'] as const

/** Bean-validation messages of the backend (English) in Vietnamese; an unknown message is kept as is. */
export function translateFieldError(field: string, message: string): string {
  if (/must not be (blank|null|empty)|is required/i.test(message)) return 'Không được để trống.'
  const size = /size must be between (\d+) and (\d+)/i.exec(message)
  if (size) return `Tối đa ${size[2]} ký tự.`
  if (field === 'quantity' && /positive|greater than|integer|number|range|overflow/i.test(message)) return QUANTITY_TEXT
  if ((field === 'manufacturedAt' || field === 'expiresAt') && /timestamp|date|time|format|offset/i.test(message)) return 'Ngày giờ chưa đúng định dạng.'
  return message
}

/**
 * Errors of POST /product-batches shown where they belong:
 * - 409: a taken batch code (service check, or the unique constraint hit by two simultaneous creates) under Mã lô; an
 *   INACTIVE product under Sản phẩm.
 * - 404 "Product not found": the product is gone, under Sản phẩm. Any other 404 is a form-level message.
 * - 400 "Expiration must be after preparation time" / "Batch must not already be expired" (no field in the body):
 *   under Hạn dùng. 400 with field errors: under the matching fields, in Vietnamese; a field the form does not have is
 *   named in the form-level message instead.
 * Anything else (401, 403, 5xx, network) is returned unchanged.
 */
export function describeSaveError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) {
    if (/active|ngừng bán|inactive/i.test(error.message)) return new ValidationError({ productId: PRODUCT_INACTIVE })
    return new ValidationError({ batchCode: CODE_TAKEN })
  }
  if (error.status === 404) {
    if (/product not found|không tìm thấy sản phẩm/i.test(error.message)) return new ValidationError({ productId: PRODUCT_GONE })
    return new ApiError(404, NOT_FOUND_OTHER)
  }
  if (error.status !== 400) return error
  const entries = Object.entries(error.fieldErrors)
  if (!entries.length) {
    if (/after preparation|sau thời điểm sản xuất/i.test(error.message)) return new ValidationError({ expiresAt: EXPIRY_TEXT.beforeManufacture })
    if (/already be expired|expired|tương lai/i.test(error.message)) return new ValidationError({ expiresAt: EXPIRY_TEXT.past })
    if (/unknown request field/i.test(error.message)) return new ApiError(400, 'Máy chủ từ chối một trường không có trong biểu mẫu. Hãy tải lại trang rồi thử lại.')
    return error
  }
  const unknown = entries.filter(([field]) => !(FORM_FIELDS as readonly string[]).includes(field))
  if (unknown.length) {
    const all = entries.map(([field, message]) => `${field}: ${translateFieldError(field, message)}`).join('; ')
    return new ApiError(400, `Máy chủ từ chối dữ liệu gửi lên (${all}). Hãy tải lại trang rồi thử lại.`)
  }
  return new ValidationError(Object.fromEntries(entries.map(([field, message]) => [field, translateFieldError(field, message)])))
}
