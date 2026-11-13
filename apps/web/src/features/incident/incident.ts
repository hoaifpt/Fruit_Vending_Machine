// Public incident report form (FE 8.2, screen P1 / K-09). Contract: api-contract/drafts/incident-reports.yaml.
// Pure rules only (no React): which fields each type requires, client checks, the multipart body and how API errors
// land on the form, so they are unit-tested in tests/incident-report.test.mjs.
import { ApiError } from '../../api/client.ts'
import type { components } from '../../api/drafts/incident-reports'

type D = components['schemas']
export type IncidentType = D['IncidentType']
export type IncidentReceipt = D['IncidentReportReceipt']
export type IncidentField = 'machineCode' | 'type' | 'orderCode' | 'description' | 'contactPhone' | 'photo'
export type IncidentFieldErrors = Partial<Record<IncidentField, string>>

/** Query parameter of the kiosk QR (FE 5.4, src/kiosk/incident.ts on the FM5 branch): the machine's public code. */
export const MACHINE_PARAM = 'machine'
export const DESCRIPTION_MAX = 500
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export interface IncidentTypeOption {
  value: IncidentType
  label: string
  /** One line under the label, telling what to include. */
  help: string
  orderRequired: boolean
  descriptionRequired: boolean
}

/** Labels from SRS 3.6.4. Only PAID_NOT_RECEIVED needs the order code; only OTHER needs a description. */
export const INCIDENT_TYPES: readonly IncidentTypeOption[] = [
  { value: 'PAID_NOT_RECEIVED', label: 'Đã trả tiền nhưng không nhận hàng', help: 'Cần mã đơn hiện trên màn hình máy sau khi thanh toán.', orderRequired: true, descriptionRequired: false },
  { value: 'SPOILED_FRUIT', label: 'Trái cây hỏng', help: 'Nên kèm mã đơn và ảnh hộp trái cây.', orderRequired: false, descriptionRequired: false },
  { value: 'MACHINE_FAULT', label: 'Máy lỗi', help: 'Ví dụ: màn hình không phản hồi, cửa lấy hàng bị kẹt.', orderRequired: false, descriptionRequired: false },
  { value: 'OTHER', label: 'Khác', help: 'Cần mô tả ngắn vấn đề bạn gặp.', orderRequired: false, descriptionRequired: true },
]
export const typeOption = (type: IncidentType | ''): IncidentTypeOption | undefined => INCIDENT_TYPES.find(option => option.value === type)

/** Messages of the SRS. MSG47 is built by thankYouMessage. */
export const MSG46 = 'Không tìm thấy mã đơn của máy này.'
export const MSG48 = 'Bạn gửi quá nhiều báo cáo. Vui lòng thử lại sau một phút.'
export const thankYouMessage = (reportCode: string) => `Cảm ơn bạn. Mã báo cáo của bạn là ${reportCode}.`

/** Same rule as the backend's machine codes: stripped, upper-cased, at most 64 letters, digits, `-` or `_`. */
const MACHINE_CODE = /^[A-Z0-9][A-Z0-9_-]{0,63}$/
const ORDER_CODE = /^ORD-\d{8}-[A-Z0-9]{8}$/

export const normalizeMachineCode = (raw: string) => raw.trim().toUpperCase()
export const isMachineCode = (code: string) => MACHINE_CODE.test(code)
/** Case and surrounding spaces do not matter; inner spaces are kept so a mistyped code is not silently "fixed". */
export const normalizeOrderCode = (raw: string) => raw.trim().toUpperCase()

/**
 * Machine code from the page URL (`?machine=`), or null when absent or malformed: the form then asks the customer to
 * type the code printed on the machine instead of failing.
 */
export function machineFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(MACHINE_PARAM)
  const code = raw === null ? '' : normalizeMachineCode(raw)
  return code && isMachineCode(code) ? code : null
}

/**
 * Vietnamese mobile number as `0` + 9 digits, or null when it is not one. Spaces, dots and dashes are ignored and the
 * +84 / 84 prefix becomes 0 (mobile ranges 03, 05, 07, 08, 09).
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s.\-()]/g, '')
  const local = digits.startsWith('+84') ? `0${digits.slice(3)}` : /^84\d{9}$/.test(digits) ? `0${digits.slice(2)}` : digits
  return /^0[35789]\d{8}$/.test(local) ? local : null
}

export interface PhotoInfo { type: string; size: number }
/** Message for a photo the form cannot send, or undefined when it is acceptable. */
export function photoError(photo: PhotoInfo | null | undefined): string | undefined {
  if (!photo) return undefined
  if (!(PHOTO_TYPES as readonly string[]).includes(photo.type)) return 'Ảnh phải là JPG, PNG hoặc WebP.'
  if (photo.size > PHOTO_MAX_BYTES) return 'Ảnh lớn hơn 5 MB. Chọn ảnh khác hoặc chụp lại với chất lượng thấp hơn.'
  if (photo.size === 0) return 'Ảnh trống. Chọn ảnh khác.'
  return undefined
}

export interface IncidentDraft {
  machineCode: string
  type: IncidentType | ''
  orderCode: string
  description: string
  contactPhone: string
  photo: (PhotoInfo & Blob & { name?: string }) | null
}
export const emptyDraft = (machineCode = ''): IncidentDraft => ({ machineCode, type: '', orderCode: '', description: '', contactPhone: '', photo: null })

/** Query parameter the kiosk adds after a failed dispense (FE 8.3, screen K-07): the order the customer paid for. */
export const ORDER_PARAM = 'order'
/**
 * First draft of the form from the page URL: the machine of the QR and, when the QR came from the "máy chưa nhả được
 * hàng" screen, its well-formed order code with "Đã trả tiền nhưng không nhận hàng" pre-selected. A malformed order
 * code is ignored (the customer can still type it).
 */
export function draftFromSearch(search: string): IncidentDraft {
  const draft = emptyDraft(machineFromSearch(search) ?? '')
  const order = normalizeOrderCode(new URLSearchParams(search).get(ORDER_PARAM) ?? '')
  return order && ORDER_CODE.test(order) ? { ...draft, type: 'PAID_NOT_RECEIVED', orderCode: order } : draft
}

/** Fields in screen order: the first one with an error receives focus. */
export const FIELD_ORDER: readonly IncidentField[] = ['machineCode', 'type', 'orderCode', 'description', 'contactPhone', 'photo']
export const firstErrorField = (errors: IncidentFieldErrors): IncidentField | undefined => FIELD_ORDER.find(field => errors[field])

/** Client checks before sending; the backend has the final say. */
export function validateIncident(draft: IncidentDraft): IncidentFieldErrors {
  const errors: IncidentFieldErrors = {}
  const machine = normalizeMachineCode(draft.machineCode)
  if (!machine) errors.machineCode = 'Nhập mã máy in trên thân máy.'
  else if (!isMachineCode(machine)) errors.machineCode = 'Mã máy chỉ gồm chữ, số, dấu gạch (-, _), tối đa 64 ký tự.'

  const option = typeOption(draft.type)
  if (!option) errors.type = 'Chọn loại sự cố.'

  const order = normalizeOrderCode(draft.orderCode)
  if (!order) { if (option?.orderRequired) errors.orderCode = 'Nhập mã đơn để chúng tôi kiểm tra giao dịch.' }
  else if (!ORDER_CODE.test(order)) errors.orderCode = 'Mã đơn có dạng ORD-20261109-AB12CD34.'

  const description = draft.description.trim()
  if (!description) { if (option?.descriptionRequired) errors.description = 'Mô tả ngắn vấn đề bạn gặp.' }
  else if (description.length > DESCRIPTION_MAX) errors.description = `Mô tả tối đa ${DESCRIPTION_MAX} ký tự (đang có ${description.length}).`

  if (draft.contactPhone.trim() && !normalizePhone(draft.contactPhone)) errors.contactPhone = 'Số điện thoại chưa đúng, ví dụ 0912 345 678.'

  const photo = photoError(draft.photo)
  if (photo) errors.photo = photo
  return errors
}

/**
 * multipart/form-data body of the draft: plain fields, blank optional ones left out, only fields of the contract.
 * Call after validateIncident passed.
 */
export function buildIncidentForm(draft: IncidentDraft): FormData {
  const form = new FormData()
  form.set('machineCode', normalizeMachineCode(draft.machineCode))
  form.set('type', draft.type)
  const order = normalizeOrderCode(draft.orderCode)
  if (order) form.set('orderCode', order)
  const description = draft.description.trim()
  if (description) form.set('description', description)
  const phone = draft.contactPhone.trim() ? normalizePhone(draft.contactPhone) : null
  if (phone) form.set('contactPhone', phone)
  if (draft.photo) form.set('photo', draft.photo, draft.photo.name || 'photo')
  return form
}

/** What the form shows for a failed submit and where focus goes. */
export interface IncidentFailure {
  fieldErrors: IncidentFieldErrors
  /** Form-level message next to the submit button (empty when every problem sits on a field). */
  message: string
  focus: IncidentField | 'form'
  /** 429: the customer must wait before trying again. */
  rateLimited: boolean
}

/** Backend field messages may be English validation text; the form uses its own wording per field. */
const SERVER_FIELD_MESSAGES: Record<IncidentField, string> = {
  machineCode: 'Mã máy chưa hợp lệ. Kiểm tra mã in trên thân máy.',
  type: 'Chọn lại loại sự cố.',
  orderCode: 'Mã đơn chưa hợp lệ. Mã đơn có dạng ORD-20261109-AB12CD34.',
  description: `Mô tả chưa hợp lệ hoặc dài hơn ${DESCRIPTION_MAX} ký tự.`,
  contactPhone: 'Số điện thoại chưa đúng, ví dụ 0912 345 678.',
  photo: 'Ảnh không gửi được. Dùng ảnh JPG, PNG hoặc WebP dưới 5 MB.',
}
const MACHINE_NOT_FOUND = 'Không tìm thấy máy có mã này. Kiểm tra mã in trên thân máy.'

function onFields(fieldErrors: IncidentFieldErrors, message = ''): IncidentFailure {
  return { fieldErrors, message, focus: firstErrorField(fieldErrors) ?? 'form', rateLimited: false }
}
const formOnly = (message: string, rateLimited = false): IncidentFailure => ({ fieldErrors: {}, message, focus: 'form', rateLimited })

/** Maps a submit failure (ApiError from the client, or anything else) to the form. */
export function describeIncidentError(error: unknown): IncidentFailure {
  if (!(error instanceof ApiError)) return formOnly('Không gửi được báo cáo. Vui lòng thử lại.')
  const known = FIELD_ORDER.filter(field => error.fieldErrors[field])
  const unknown = Object.keys(error.fieldErrors).filter(field => !(FIELD_ORDER as readonly string[]).includes(field))
  switch (error.status) {
    case 429: return formOnly(MSG48, true)
    case 413: return onFields({ photo: 'Ảnh lớn hơn 5 MB. Chọn ảnh khác hoặc chụp lại với chất lượng thấp hơn.' })
    case 415: return onFields({ photo: 'Ảnh phải là JPG, PNG hoặc WebP.' })
    case 404:
    case 422: {
      // 422 (or a 404 naming orderCode): the order is not one of this machine. A plain 404: the machine does not exist.
      if (error.fieldErrors.orderCode) return onFields({ orderCode: MSG46 })
      if (error.status === 404) return onFields({ machineCode: MACHINE_NOT_FOUND })
      break
    }
    case 400: {
      const fieldErrors: IncidentFieldErrors = {}
      for (const field of known) fieldErrors[field] = SERVER_FIELD_MESSAGES[field]
      const message = unknown.length || !known.length ? 'Thông tin gửi lên chưa hợp lệ. Kiểm tra lại rồi gửi lại.' : ''
      return onFields(fieldErrors, message)
    }
  }
  if (error.status === 0 || error.status >= 500) return formOnly(`${error.message} Thông tin bạn đã nhập vẫn được giữ.`)
  return formOnly('Hệ thống chưa thể nhận báo cáo lúc này. Vui lòng thử lại sau.')
}
