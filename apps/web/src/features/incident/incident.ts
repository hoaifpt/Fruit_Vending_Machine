// Public customer report form (FE 8.2, screen P1 / K-09), opened from the machine's QR: /report/{reportToken}[?order=].
// Contract: api.yaml (backend #74, docs/customer-reports.md): GET /public/report-forms/{reportToken} (machine, types,
// photo limits) and POST /public/report-forms/{reportToken}/reports, multipart: part `report` (PublicReportRequest JSON)
// and 0..3 `photos` (JPEG/PNG, at most 2 MB and 4000 x 4000 px each). Pure rules only (no React), unit-tested in
// tests/incident-report.test.mjs.
import { ApiError } from '../../api/client.ts'
import type { PublicReportBody, ReportForm, ReportType } from '../../api/resources.ts'

export type { ReportType }
export type IncidentField = 'type' | 'orderCode' | 'description' | 'contactName' | 'contactPhone' | 'contactEmail' | 'photos' | 'consent'
export type IncidentFieldErrors = Partial<Record<IncidentField, string>>

/** Route of the form on the web; the backend's PUBLIC_REPORT_BASE_URL points here (`https://<web>/report`). */
export const REPORT_PAGE_PATH = '/report'
export const ORDER_PARAM = 'order'
export const DESCRIPTION_MAX = 1000
export const CONTACT_NAME_MAX = 100
export const EMAIL_MAX = 254
/** Defaults of the backend, used until the form information says otherwise. */
export const DEFAULT_LIMITS = { maxPhotos: 3, maxPhotoBytes: 2 * 1024 * 1024 } as const
export const PHOTO_TYPES = ['image/jpeg', 'image/png'] as const
/** The whole request is refused above 7 MB (413). */
export const REQUEST_MAX_BYTES = 7 * 1024 * 1024

export interface ReportTypeOption {
  value: ReportType
  label: string
  /** One line under the label, telling what to include. */
  help: string
  orderRequired: boolean
  descriptionRequired: boolean
  /** A phone number or an e-mail is required (the team calls back about the money or the fruit). */
  contactRequired: boolean
}

/** The four types of the backend; PAID_NOT_RECEIVED needs the order code, the others a description. */
export const REPORT_TYPES: readonly ReportTypeOption[] = [
  { value: 'PAID_NOT_RECEIVED', label: 'Đã trả tiền nhưng không nhận hàng', help: 'Cần mã đơn hiện trên màn hình máy sau khi thanh toán và số điện thoại hoặc email.', orderRequired: true, descriptionRequired: false, contactRequired: true },
  { value: 'PRODUCT_QUALITY', label: 'Trái cây không đạt chất lượng', help: 'Mô tả vấn đề, nên kèm mã đơn và ảnh hộp trái cây; cần số điện thoại hoặc email.', orderRequired: false, descriptionRequired: true, contactRequired: true },
  { value: 'MACHINE_FAULT', label: 'Máy lỗi', help: 'Ví dụ: màn hình không phản hồi, cửa lấy hàng bị kẹt.', orderRequired: false, descriptionRequired: true, contactRequired: false },
  { value: 'OTHER', label: 'Khác', help: 'Mô tả ngắn vấn đề bạn gặp.', orderRequired: false, descriptionRequired: true, contactRequired: false },
]
export const typeOption = (type: ReportType | '' | string | undefined | null): ReportTypeOption | undefined => REPORT_TYPES.find(option => option.value === type)
/** Vietnamese label of a report type (also used by the management screens). */
export function reportTypeLabel(type: string | undefined | null): string {
  return typeOption(type)?.label ?? (type || 'Sự cố khác')
}
/** The types the form offers: those the server lists, in its order, among the ones this page knows. */
export function offeredTypes(form: Pick<ReportForm, 'types'> | undefined): ReportTypeOption[] {
  const listed = form?.types?.length ? form.types : REPORT_TYPES.map(option => option.value)
  return listed.flatMap(type => typeOption(type) ?? [])
}

/** Messages of the SRS. */
export const MSG48 = 'Bạn gửi quá nhiều báo cáo. Vui lòng thử lại sau ít phút.'
export const thankYouMessage = (reportCode: string) => `Cảm ơn bạn. Mã báo cáo của bạn là ${reportCode}.`
export const GONE_MESSAGE = 'Mã QR này không còn dùng được (máy đã đổi mã hoặc ngừng hoạt động). Hãy quét lại mã QR đang dán trên máy hoặc báo nhân viên.'

const TOKEN = /^[A-Za-z0-9_-]{1,64}$/
const ORDER_CODE = /^ORD-\d{8}-[0-9A-Z]{8}$/
const PHONE = /^(0|\+84)[0-9]{9,10}$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** The report token of the page path `/report/{token}`, or '' when absent or malformed (never sent to the API then). */
export function tokenFromPath(pathname: string): string {
  const match = /^\/report\/([^/]+)\/?$/.exec(pathname)
  if (!match) return ''
  let token = ''
  try { token = decodeURIComponent(match[1]) } catch { return '' }
  return TOKEN.test(token) ? token : ''
}

/** Case and surrounding spaces do not matter; inner spaces are kept so a mistyped code is not silently "fixed". */
export const normalizeOrderCode = (raw: string) => raw.trim().toUpperCase()

/**
 * A phone number the backend accepts (`0` or `+84` then 9–10 digits), with spaces, dots, dashes and brackets removed,
 * or null when it is not one.
 */
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s.\-()]/g, '')
  return PHONE.test(compact) ? compact : null
}
export const normalizeEmail = (raw: string) => raw.trim().toLowerCase()

export interface PhotoInfo { type: string; size: number; name?: string }
/** Message for a photo the form cannot send, or undefined when it is acceptable. */
export function photoError(photo: PhotoInfo | null | undefined, maxBytes: number = DEFAULT_LIMITS.maxPhotoBytes): string | undefined {
  if (!photo) return undefined
  if (!(PHOTO_TYPES as readonly string[]).includes(photo.type)) return 'Ảnh phải là JPG hoặc PNG.'
  if (photo.size === 0) return 'Ảnh trống. Chọn ảnh khác.'
  if (photo.size > maxBytes) return `Ảnh lớn hơn ${megabytes(maxBytes)}. Chọn ảnh khác hoặc chụp lại với chất lượng thấp hơn.`
  return undefined
}
/** "2 MB", "1,5 MB". */
export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`
}

export type Photo = PhotoInfo & Blob
export interface IncidentDraft {
  type: ReportType | ''
  orderCode: string
  description: string
  contactName: string
  contactPhone: string
  contactEmail: string
  consent: boolean
  /** Honeypot: hidden from people; a filled value makes the server accept and drop the report. */
  website: string
  photos: Photo[]
}
export const emptyDraft = (): IncidentDraft => ({ type: '', orderCode: '', description: '', contactName: '', contactPhone: '', contactEmail: '', consent: false, website: '', photos: [] })

/** A well-formed `?order=` of the page (the kiosk adds it after a failed dispense), or ''. */
export function orderFromSearch(search: string): string {
  const order = normalizeOrderCode(new URLSearchParams(search).get(ORDER_PARAM) ?? '')
  return ORDER_CODE.test(order) ? order : ''
}
/**
 * First draft from the page URL: when the QR came from the "máy chưa nhả được hàng" screen, its order code with
 * "Đã trả tiền nhưng không nhận hàng" pre-selected. A malformed order code is ignored (the customer can still type it).
 */
export function draftFromSearch(search: string): IncidentDraft {
  const order = orderFromSearch(search)
  return order ? { ...emptyDraft(), type: 'PAID_NOT_RECEIVED', orderCode: order } : emptyDraft()
}

/** Fields in screen order: the first one with an error receives focus. */
export const FIELD_ORDER: readonly IncidentField[] = ['type', 'orderCode', 'description', 'contactName', 'contactPhone', 'contactEmail', 'photos', 'consent']
export const firstErrorField = (errors: IncidentFieldErrors): IncidentField | undefined => FIELD_ORDER.find(field => errors[field])

export interface FormLimits { maxPhotos: number; maxPhotoBytes: number }
export function limitsOf(form: Pick<ReportForm, 'maxPhotos' | 'maxPhotoBytes'> | undefined): FormLimits {
  const positive = (value: number | undefined, fallback: number) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback)
  return { maxPhotos: positive(form?.maxPhotos, DEFAULT_LIMITS.maxPhotos), maxPhotoBytes: positive(form?.maxPhotoBytes, DEFAULT_LIMITS.maxPhotoBytes) }
}

/** Client checks before sending; the backend has the final say. */
export function validateIncident(draft: IncidentDraft, limits: FormLimits = DEFAULT_LIMITS): IncidentFieldErrors {
  const errors: IncidentFieldErrors = {}
  const option = typeOption(draft.type)
  if (!option) errors.type = 'Chọn loại sự cố.'

  const order = normalizeOrderCode(draft.orderCode)
  if (!order) { if (option?.orderRequired) errors.orderCode = 'Nhập mã đơn để chúng tôi kiểm tra giao dịch.' }
  else if (!ORDER_CODE.test(order)) errors.orderCode = 'Mã đơn có dạng ORD-20261109-AB12CD34.'

  const description = draft.description.trim()
  if (!description) { if (option?.descriptionRequired) errors.description = 'Mô tả ngắn vấn đề bạn gặp.' }
  else if (description.length > DESCRIPTION_MAX) errors.description = `Mô tả tối đa ${DESCRIPTION_MAX} ký tự (đang có ${description.length}).`

  if (draft.contactName.trim().length > CONTACT_NAME_MAX) errors.contactName = `Tên tối đa ${CONTACT_NAME_MAX} ký tự.`
  const phone = draft.contactPhone.trim(), email = normalizeEmail(draft.contactEmail)
  if (phone && !normalizePhone(phone)) errors.contactPhone = 'Số điện thoại chưa đúng, ví dụ 0912 345 678 hoặc +84 912 345 678.'
  if (email && (email.length > EMAIL_MAX || !EMAIL.test(email))) errors.contactEmail = 'Email chưa đúng, ví dụ ten@example.com.'
  if (option?.contactRequired && !phone && !email) errors.contactPhone = 'Để lại số điện thoại hoặc email để chúng tôi liên hệ lại.'

  if (draft.photos.length > limits.maxPhotos) errors.photos = `Tối đa ${limits.maxPhotos} ảnh.`
  else {
    const problem = draft.photos.map(photo => photoError(photo, limits.maxPhotoBytes)).find(Boolean)
    if (problem) errors.photos = problem
    else if (draft.photos.reduce((sum, photo) => sum + photo.size, 0) > REQUEST_MAX_BYTES - 64 * 1024) errors.photos = 'Tổng dung lượng ảnh quá lớn. Bỏ bớt ảnh rồi gửi lại.'
  }
  if (!draft.consent) errors.consent = 'Bạn cần đồng ý để chúng tôi dùng thông tin này xử lý phản ánh.'
  return errors
}

/** The JSON of part `report`: only contract fields, normalised, blank optional fields left out. Call after validateIncident passed. */
export function reportBody(draft: IncidentDraft): PublicReportBody {
  const order = normalizeOrderCode(draft.orderCode)
  const description = draft.description.trim()
  const name = draft.contactName.trim()
  const phone = draft.contactPhone.trim() ? normalizePhone(draft.contactPhone) : null
  const email = normalizeEmail(draft.contactEmail)
  return {
    type: draft.type as ReportType,
    ...(order ? { orderCode: order } : {}),
    ...(description ? { description } : {}),
    ...(name ? { contactName: name } : {}),
    ...(phone ? { contactPhone: phone } : {}),
    ...(email ? { contactEmail: email } : {}),
    consent: draft.consent,
    ...(draft.website ? { website: draft.website } : {}),
  }
}

/** multipart/form-data body: part `report` as application/json, then one `photos` part per photo. */
export function buildReportForm(draft: IncidentDraft): FormData {
  const form = new FormData()
  form.append('report', new Blob([JSON.stringify(reportBody(draft))], { type: 'application/json' }), 'report.json')
  draft.photos.forEach((photo, index) => form.append('photos', photo, photo.name || `photo-${index + 1}.${photo.type === 'image/png' ? 'png' : 'jpg'}`))
  return form
}

/** What the form shows for a failed submit and where focus goes. */
export interface IncidentFailure {
  fieldErrors: IncidentFieldErrors
  /** Form-level message next to the submit button (empty when every problem sits on a field). */
  message: string
  focus: IncidentField | 'form'
  /** 429: the customer must wait before trying again (seconds from Retry-After when the server sent it). */
  rateLimited: boolean
  retryAfterSeconds?: number
  /** 404: the QR's token is unknown or was rotated; the page shows the "quét lại" screen instead of the form. */
  gone?: boolean
}

/** Backend field messages are English validation text; the form uses its own wording per field. */
const SERVER_FIELD_MESSAGES: Record<IncidentField, string> = {
  type: 'Chọn lại loại sự cố.',
  orderCode: 'Mã đơn chưa hợp lệ. Mã đơn có dạng ORD-20261109-AB12CD34.',
  description: `Mô tả chưa hợp lệ hoặc dài hơn ${DESCRIPTION_MAX} ký tự.`,
  contactName: `Tên chưa hợp lệ hoặc dài hơn ${CONTACT_NAME_MAX} ký tự.`,
  contactPhone: 'Kiểm tra lại số điện thoại (ví dụ 0912 345 678), hoặc để lại email.',
  contactEmail: 'Email chưa đúng, ví dụ ten@example.com.',
  photos: 'Có ảnh không gửi được: chỉ nhận ảnh JPG hoặc PNG, tối đa 2 MB và 4000 × 4000 điểm ảnh.',
  consent: 'Bạn cần đồng ý để chúng tôi dùng thông tin này xử lý phản ánh.',
}
/** `photos[1]` and `photos` both land on the photo field. */
const fieldOf = (key: string): IncidentField | undefined => (key.startsWith('photos') ? 'photos' : (FIELD_ORDER as readonly string[]).includes(key) ? key as IncidentField : undefined)

function onFields(fieldErrors: IncidentFieldErrors, message = ''): IncidentFailure {
  return { fieldErrors, message, focus: firstErrorField(fieldErrors) ?? 'form', rateLimited: false }
}
const formOnly = (message: string): IncidentFailure => ({ fieldErrors: {}, message, focus: 'form', rateLimited: false })

/** "Vui lòng thử lại sau 45 giây." / "… sau 2 phút." */
export function waitText(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return MSG48
  if (seconds < 90) return `Bạn gửi quá nhiều báo cáo. Vui lòng thử lại sau ${seconds} giây.`
  return `Bạn gửi quá nhiều báo cáo. Vui lòng thử lại sau ${Math.ceil(seconds / 60)} phút.`
}

/** Maps a submit failure (ApiError from the client, or anything else) to the form. */
export function describeIncidentError(error: unknown): IncidentFailure {
  if (!(error instanceof ApiError)) return formOnly('Không gửi được báo cáo. Vui lòng thử lại.')
  switch (error.status) {
    case 429: return { ...formOnly(waitText(error.retryAfterSeconds)), rateLimited: true, retryAfterSeconds: error.retryAfterSeconds }
    case 413: return onFields({ photos: 'Ảnh quá lớn so với giới hạn gửi một lần. Bỏ bớt ảnh hoặc chọn ảnh nhỏ hơn rồi gửi lại.' })
    case 415:
    case 422: return onFields({ photos: SERVER_FIELD_MESSAGES.photos })
    case 404: return { ...formOnly(GONE_MESSAGE), gone: true }
    case 400: {
      const fieldErrors: IncidentFieldErrors = {}
      const keys = Object.keys(error.fieldErrors)
      for (const key of keys) { const field = fieldOf(key); if (field) fieldErrors[field] = SERVER_FIELD_MESSAGES[field] }
      const unknown = keys.some(key => !fieldOf(key))
      return onFields(fieldErrors, unknown || !Object.keys(fieldErrors).length ? 'Thông tin gửi lên chưa hợp lệ. Kiểm tra lại rồi gửi lại.' : '')
    }
  }
  if (error.status === 0 || error.status >= 500) return formOnly(`${error.message} Thông tin bạn đã nhập vẫn được giữ.`)
  return formOnly('Hệ thống chưa thể nhận báo cáo lúc này. Vui lòng thử lại sau.')
}

/** What the page shows when the form information cannot be read (before the form is shown). */
export type FormLoadProblem = { kind: 'gone' } | { kind: 'busy'; retryAfterSeconds?: number } | { kind: 'failed'; message: string }
export function formLoadProblem(error: unknown): FormLoadProblem {
  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return { kind: 'gone' }
  if (error instanceof ApiError && error.status === 429) return { kind: 'busy', retryAfterSeconds: error.retryAfterSeconds }
  return { kind: 'failed', message: error instanceof ApiError ? error.message : 'Không tải được trang báo sự cố. Kiểm tra kết nối mạng rồi thử lại.' }
}
