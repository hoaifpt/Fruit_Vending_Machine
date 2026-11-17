// Rules of screen T3 / W-12 "Hoàn tiền" (FE 8.1) that do not need React, unit-tested in tests/refunds.test.mjs.
//
// The money goes back outside the system: an ADMIN transfers it to the customer, then records the bank's transfer
// reference here. API: api.yaml (backend #72, docs/refunds.md): GET /refunds/candidates ("Cần hoàn tiền", with the
// payer's account and the customer report of the order), POST /payments/{paymentId}/refund { reason, transferReference,
// note?, workOrderId? } (the full amount of the payment, never sent), GET /refunds and GET /refunds/summary ("Đã hoàn
// tiền"). REFUND_READ to read, PAYMENT_REFUND to record: ADMIN only, never STAFF. from/to are Vietnam calendar days.
import { ApiError } from '../api/client.ts'
import type {
  OrderDetail, OrderRefund, RefundBody, RefundCandidate, RefundCandidateQuery, RefundCandidateType, RefundListQuery, RefundReason, RefundSummary,
  RefundSummaryQuery,
} from '../api/resources.ts'
import { formatDateTime } from '../lib/format.ts'
import { oneOf, uuidParam } from '../lib/table-query.ts'
import { errorCode } from './form-error.ts'

export const REFUNDS_PATH = '/admin/refunds'
export const REFUNDED_VIEW_PATH = `${REFUNDS_PATH}?view=refunded`
/**
 * The refund screen narrowed to one order (entry from the order, payment, customer report and work order screens).
 * `workOrderId`: the INCIDENT work order that receives a note about the refund.
 */
export function refundPathFor(orderId: string | undefined, workOrderId?: string): string {
  const id = uuidParam(orderId ?? '')
  if (!id) return REFUNDS_PATH
  const workOrder = uuidParam(workOrderId ?? '')
  return `${REFUNDS_PATH}?orderId=${id}${workOrder ? `&workOrderId=${workOrder}` : ''}`
}

// ---- reasons and candidate types

export const REFUND_REASONS: readonly RefundReason[] = ['DISPENSE_FAILED', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'PRODUCT_QUALITY', 'OTHER']
export const REFUND_REASON_LABELS: Readonly<Record<RefundReason, string>> = {
  DISPENSE_FAILED: 'Nhả hàng thất bại',
  LATE_PAYMENT: 'Thanh toán muộn (đơn đã hủy)',
  DUPLICATE_PAYMENT: 'Thanh toán trùng',
  PRODUCT_QUALITY: 'Chất lượng sản phẩm',
  OTHER: 'Lý do khác',
}
/** One line under each reason in the dialog: when it applies and what happens to the order. */
export const REFUND_REASON_HELP: Readonly<Record<RefundReason, string>> = {
  DISPENSE_FAILED: 'Khách đã trả tiền nhưng máy không nhả được hộp. Đơn chuyển sang “Đã hoàn tiền”.',
  LATE_PAYMENT: 'Tiền về sau khi đơn đã hủy, khách không nhận hộp. Trạng thái đơn giữ nguyên.',
  DUPLICATE_PAYMENT: 'Đơn đã có khoản thanh toán đến trước; hoàn khoản đến sau. Trạng thái đơn giữ nguyên.',
  PRODUCT_QUALITY: 'Khách đã nhận hộp nhưng phản ánh chất lượng. Đơn chuyển sang “Đã hoàn tiền”.',
  OTHER: 'Trường hợp khác: bắt buộc ghi chú lý do. Đơn chuyển sang “Đã hoàn tiền”.',
}
export function refundReasonLabel(reason: string | undefined): string {
  return reason && Object.hasOwn(REFUND_REASON_LABELS, reason) ? REFUND_REASON_LABELS[reason as RefundReason] : (reason || '—')
}

export const CANDIDATE_TYPES: readonly RefundCandidateType[] = ['DISPENSE_FAILED', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'CUSTOMER_REPORT']
export const CANDIDATE_TYPE_LABELS: Readonly<Record<RefundCandidateType, string>> = {
  DISPENSE_FAILED: 'Nhả hàng thất bại',
  LATE_PAYMENT: 'Thanh toán muộn (đơn đã hủy)',
  DUPLICATE_PAYMENT: 'Thanh toán trùng',
  CUSTOMER_REPORT: 'Khách phản ánh',
}
export function candidateTypeLabel(type: string | undefined): string {
  return type && Object.hasOwn(CANDIDATE_TYPE_LABELS, type) ? CANDIDATE_TYPE_LABELS[type as RefundCandidateType] : (type || '—')
}

// ---- URL filters

/** `pending` ("Cần hoàn tiền", the default when absent) or `refunded` ("Đã hoàn tiền"). */
export const REFUND_VIEWS = ['pending', 'refunded'] as const
export type RefundView = typeof REFUND_VIEWS[number]

export interface RefundFilters {
  view: RefundView
  /** Focus on one order (deep link); a non-UUID is dropped (the API would answer 400). */
  orderId: string
  /** INCIDENT work order the refund of the focused order is noted on (deep link from a report or a work order). */
  workOrderId: string
  machineId: string
  /** "Cần hoàn tiền": candidate type. */
  type: RefundCandidateType | ''
  /** "Đã hoàn tiền": reason and the administrator who recorded it. */
  reason: RefundReason | ''
  refundedBy: string
  /** Vietnam days, inclusive: paidAt for "Cần hoàn tiền", refundedAt for "Đã hoàn tiền". */
  from: string; to: string
  page: number
}

/** Filters the "Xóa bộ lọc" button clears, per view (the view and the order focus are kept). */
export const PENDING_FILTER_KEYS = ['machineId', 'type', 'from', 'to'] as const
export const REFUNDED_FILTER_KEYS = ['machineId', 'reason', 'refundedBy', 'from', 'to'] as const

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dateParam = (value: string | null) => (value && DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : '')
/** URL value of a page number: absent for the first page. */
export const pageValue = (page: number) => (page > 0 ? String(page) : undefined)

export function readRefundFilters(params: URLSearchParams): RefundFilters {
  const page = Number(params.get('page') ?? '')
  let from = dateParam(params.get('from')), to = dateParam(params.get('to'))
  if (from && to && to < from) [from, to] = [to, from]
  return {
    view: (oneOf(params.get('view'), REFUND_VIEWS) || 'pending') as RefundView,
    orderId: uuidParam((params.get('orderId') ?? '').trim()),
    workOrderId: uuidParam((params.get('workOrderId') ?? '').trim()),
    machineId: uuidParam((params.get('machineId') ?? '').trim()),
    type: oneOf(params.get('type'), CANDIDATE_TYPES) as RefundCandidateType | '',
    reason: oneOf(params.get('reason'), REFUND_REASONS) as RefundReason | '',
    refundedBy: uuidParam((params.get('refundedBy') ?? '').trim()),
    from, to,
    page: Number.isSafeInteger(page) && page > 0 ? page : 0,
  }
}

/** GET /refunds/candidates: only contract parameters, absent when not in effect (no sort: oldest waiting first). */
export function candidateQuery(filters: RefundFilters, size: number): RefundCandidateQuery {
  return { page: filters.page, size, type: filters.type || undefined, machineId: filters.machineId || undefined, from: filters.from || undefined, to: filters.to || undefined }
}
/** GET /refunds (no sort: newest refund first). */
export function refundListQuery(filters: RefundFilters, size: number): RefundListQuery {
  return {
    page: filters.page, size, reason: filters.reason || undefined, machineId: filters.machineId || undefined, refundedBy: filters.refundedBy || undefined,
    from: filters.from || undefined, to: filters.to || undefined,
  }
}
/** GET /refunds/summary: the same period and machine as the list (reason and person do not narrow the totals). */
export function summaryQuery(filters: RefundFilters): RefundSummaryQuery {
  return { from: filters.from || undefined, to: filters.to || undefined, machineId: filters.machineId || undefined }
}

/** Totals by reason in the order of the reasons; every reason listed (0 when the server sends nothing for it). */
export function summaryRows(summary: RefundSummary | undefined): { reason: RefundReason; label: string; count: number; totalAmount: number }[] {
  return REFUND_REASONS.map(reason => {
    const row = summary?.byReason?.find(entry => entry.reason === reason)
    return { reason, label: REFUND_REASON_LABELS[reason], count: row?.count ?? 0, totalAmount: row?.totalAmount ?? 0 }
  })
}

// ---- which payment of an order can be refunded (docs/refunds.md "Các trường hợp")

type OrderLike = Pick<OrderDetail, 'status' | 'payments'>
type PaymentLike = NonNullable<OrderDetail['payments']>[number]
export type BlockedWhy = 'refunded' | 'not-success' | 'in-progress' | 'not-case' | 'no-payment' | 'unknown-payment'
export type RefundCase =
  | {
    kind: 'ready'; paymentId: string; amount?: number; payment: PaymentLike
    /** Reasons the backend accepts for this payment and order, the usual one first. */
    reasons: RefundReason[]
    /** A refund the system expects (failed dispense, late or duplicate payment); false for a delivered order (only on a complaint). */
    expected: boolean
  }
  | { kind: 'blocked'; why: BlockedWhy; paymentId?: string; payment?: PaymentLike }

const UNFINISHED: readonly string[] = ['PENDING_PAYMENT', 'PAID', 'DISPENSING']
const byPaid = (a: PaymentLike, b: PaymentLike) => (a.paidAt ?? '').localeCompare(b.paidAt ?? '') || (a.id ?? '').localeCompare(b.id ?? '')

/** The paying payment of an order: SUCCESS or REFUNDED with the earliest paidAt (tie: id). */
export function payingPayment(order: OrderLike): PaymentLike | undefined {
  return (order.payments ?? []).filter(payment => (payment.status === 'SUCCESS' || payment.status === 'REFUNDED') && payment.paidAt).sort(byPaid)[0]
}

function caseOf(order: OrderLike, payment: PaymentLike): RefundCase {
  const paymentId = payment.id ?? ''
  if (payment.status === 'REFUNDED') return { kind: 'blocked', why: 'refunded', paymentId, payment }
  if (payment.status !== 'SUCCESS') return { kind: 'blocked', why: 'not-success', paymentId, payment }
  if (UNFINISHED.includes(order.status ?? '')) return { kind: 'blocked', why: 'in-progress', paymentId, payment }
  const ready = (reasons: RefundReason[], expected: boolean): RefundCase => ({ kind: 'ready', paymentId, amount: payment.amount, payment, reasons, expected })
  if (order.status === 'CANCELLED') return ready(['LATE_PAYMENT'], true)
  if (payingPayment(order)?.id !== payment.id) return ready(['DUPLICATE_PAYMENT'], true)
  if (order.status === 'DISPENSE_FAILED') return ready(['DISPENSE_FAILED', 'OTHER'], true)
  if (order.status === 'COMPLETED') return ready(['PRODUCT_QUALITY', 'OTHER'], false)
  return { kind: 'blocked', why: 'not-case', paymentId, payment }
}

/**
 * Whether one payment of an order (or, without `paymentId`, the order's payment to refund) can be recorded as refunded,
 * with the reasons the backend accepts. Anything else is blocked with the reason, so the screen never offers a second
 * refund. Without `paymentId`: the expected case first (failed dispense, late, the later duplicate), then a delivered one.
 */
export function refundCase(order: OrderLike, paymentId?: string): RefundCase {
  const payments = order.payments ?? []
  if (paymentId) {
    const payment = payments.find(candidate => candidate.id === paymentId)
    return payment ? caseOf(order, payment) : { kind: 'blocked', why: 'unknown-payment', paymentId }
  }
  const cases = payments.filter(payment => payment.status === 'SUCCESS').sort((a, b) => byPaid(b, a)).map(payment => caseOf(order, payment))
  const ready = cases.filter(found => found.kind === 'ready')
  const found = ready.find(entry => entry.kind === 'ready' && entry.expected) ?? ready[0] ?? cases[0]
  if (found) return found
  const refunded = payments.filter(payment => payment.status === 'REFUNDED').sort((a, b) => byPaid(b, a))[0]
  return refunded ? { kind: 'blocked', why: 'refunded', paymentId: refunded.id, payment: refunded } : { kind: 'blocked', why: 'no-payment' }
}

/** Reason pre-selected in the dialog: the candidate's own type, else the first reason allowed. */
export function defaultReason(reasons: readonly RefundReason[], candidateType?: RefundCandidateType | string): RefundReason | '' {
  if (candidateType && candidateType !== 'CUSTOMER_REPORT' && reasons.includes(candidateType as RefundReason)) return candidateType as RefundReason
  return reasons[0] ?? ''
}

/** Status text of a payment for "not-success" (no money received). */
const NOT_PAID_TEXT: Record<string, string> = { PENDING: 'đang chờ thanh toán', FAILED: 'thất bại', EXPIRED: 'đã hết hạn' }

/** "Đã hoàn tiền lúc 09/11/2026 13:05, mã CK FT123, người ghi nhận Nguyễn Văn A." */
export function refundedText(refund: Pick<OrderRefund, 'refundedAt' | 'transferReference' | 'refundedBy'>): string {
  const name = refund.refundedBy?.fullName?.trim()
  return `Đã hoàn tiền lúc ${formatDateTime(refund.refundedAt)}, mã CK ${refund.transferReference ?? '—'}${name ? `, người ghi nhận ${name}` : ''}.`
}

/** Why nothing can be recorded, with the refund itself when it is known ("Đã hoàn tiền lúc …, mã CK …"). */
export function blockedText(found: Extract<RefundCase, { kind: 'blocked' }>, refund?: Pick<OrderRefund, 'refundedAt' | 'transferReference' | 'refundedBy'>): string {
  switch (found.why) {
    case 'refunded': return refund
      ? `${refundedText(refund)} Không ghi nhận lần nữa và không chuyển khoản thêm cho khách.`
      : 'Khoản này đã được hoàn tiền trước đó. Không ghi nhận lần nữa và không chuyển khoản thêm cho khách; xem mã chuyển khoản ở mục “Đã hoàn tiền”.'
    case 'not-success': return `Khoản này ${NOT_PAID_TEXT[found.payment?.status ?? ''] ?? 'chưa nhận được tiền'} nên không có tiền để hoàn.`
    case 'in-progress': return 'Đơn chưa có kết quả cuối cùng (đang chờ thanh toán hoặc máy đang nhả hàng). Chờ máy báo kết quả; nếu máy không nhả được, đơn chuyển sang “Nhả hàng thất bại” và hoàn tiền được.'
    case 'not-case': return 'Đơn không thuộc trường hợp hoàn tiền.'
    case 'no-payment': return 'Đơn chưa có khoản thanh toán thành công nào nên không có tiền để hoàn.'
    case 'unknown-payment': return 'Không tìm thấy khoản thanh toán này trong đơn. Mở lại từ danh sách cần hoàn tiền.'
  }
}

/** The refund recorded for a payment, among the ones of its order (OrderDetailResponse.refunds). */
export function refundOf(refunds: readonly OrderRefund[] | undefined, paymentId: string | undefined): OrderRefund | undefined {
  return paymentId ? refunds?.find(refund => refund.paymentId === paymentId) : undefined
}

/**
 * Entry from the order and payment detail screens: `record` when the system expects a refund (failed dispense, late or
 * duplicate payment), `refunded` to see the refund already recorded, null otherwise (a delivered order is refunded only
 * from a customer report or the refund screen itself).
 */
export function refundEntry(order: OrderLike | undefined, paymentId?: string): 'record' | 'refunded' | null {
  if (!order) return null
  const found = refundCase(order, paymentId)
  if (found.kind === 'ready') return found.expected ? 'record' : null
  return found.why === 'refunded' ? 'refunded' : null
}

/** Payer account of a candidate for the transfer, or null when the bank did not send it. */
export function payerLines(payer: RefundCandidate['payer'] | null): { name: string; account: string; bank: string } | null {
  if (!payer || (!payer.accountNumber && !payer.accountName)) return null
  return { name: payer.accountName?.trim() || '—', account: payer.accountNumber?.trim() || '—', bank: payer.bankName?.trim() || payer.bankId?.trim() || '—' }
}
export const NO_PAYER = 'Ngân hàng không gửi tài khoản người trả. Liên hệ khách (qua phản ánh hoặc nhân viên tại máy) để lấy số tài khoản.'

// ---- form

export const TRANSFER_REF_MIN = 4
export const TRANSFER_REF_MAX = 64
export const REFUND_NOTE_MAX = 500
/** RefundPaymentRequest.transferReference of api.yaml (after trimming). */
export const TRANSFER_REF_PATTERN = /^[A-Za-z0-9._/-]{4,64}$/

export interface RefundForm { reason: string; transferReference: string; note: string; [key: string]: string }

/** Client checks before sending (the server checks again): field → message, empty when valid. */
export function validateRefund(values: RefundForm, allowed: readonly RefundReason[] = REFUND_REASONS): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!values.reason) errors.reason = 'Chọn lý do hoàn tiền.'
  else if (!allowed.includes(values.reason as RefundReason)) errors.reason = 'Lý do này không áp dụng cho khoản thanh toán này.'
  const ref = values.transferReference.trim()
  if (!ref) errors.transferReference = 'Nhập mã giao dịch của lần chuyển khoản hoàn tiền cho khách.'
  else if (ref.length > TRANSFER_REF_MAX) errors.transferReference = `Tối đa ${TRANSFER_REF_MAX} ký tự.`
  else if (ref.length < TRANSFER_REF_MIN) errors.transferReference = `Tối thiểu ${TRANSFER_REF_MIN} ký tự.`
  else if (!TRANSFER_REF_PATTERN.test(ref)) errors.transferReference = 'Chỉ gồm chữ không dấu, số và . _ / - (không có khoảng trắng).'
  const note = values.note.trim()
  if (note.length > REFUND_NOTE_MAX) errors.note = `Tối đa ${REFUND_NOTE_MAX} ký tự.`
  else if (values.reason === 'OTHER' && !note) errors.note = 'Lý do khác: ghi rõ vì sao hoàn tiền.'
  return errors
}

/** Body of POST /payments/{paymentId}/refund: only contract fields; note and workOrderId only when there is one. */
export function refundBody(values: RefundForm, workOrderId?: string): RefundBody {
  const note = values.note.trim()
  return {
    reason: values.reason as RefundReason, transferReference: values.transferReference.trim(),
    ...(note ? { note } : {}), ...(workOrderId ? { workOrderId } : {}),
  }
}

export const REFUND_SUCCESS_TITLE = 'Đã ghi nhận hoàn tiền'
/** MSG36. */
export function refundSuccessText(orderCode: string | undefined): string {
  return `Thanh toán của đơn ${orderCode || 'này'} đã được đánh dấu hoàn tiền.`
}

export const REFUND_CONFLICT = 'Không ghi nhận được: khoản này vừa được hoàn tiền (có thể bởi quản trị viên khác). Thông tin bên dưới đã được tải lại. Đừng chuyển khoản thêm cho khách trước khi kiểm tra lại.'
export const REFUND_REF_USED = 'Mã chuyển khoản này đã được ghi cho một lần hoàn tiền khác. Kiểm tra lại mã trên biên lai chuyển khoản.'
export const REFUND_IN_PROGRESS = 'Đơn chưa có kết quả cuối cùng (máy đang nhả hàng hoặc còn lệnh nhả chưa xong). Chờ máy báo kết quả rồi ghi nhận lại.'
export const REFUND_MISMATCH = 'Lý do không khớp với trạng thái hiện tại của đơn. Thông tin đã được tải lại; chọn lại lý do.'
export const REFUND_NOT_REFUNDABLE = 'Khoản này chưa nhận được tiền (đang chờ, thất bại hoặc hết hạn) nên không hoàn được. Thông tin đã được tải lại.'
export const REFUND_GENERIC_CONFLICT = 'Không ghi nhận được vì trạng thái đơn hoặc thanh toán vừa thay đổi. Thông tin đã được tải lại; kiểm tra rồi thử lại.'
export const REFUND_NOT_FOUND = 'Không tìm thấy khoản thanh toán này. Tải lại danh sách rồi thử lại; nếu vẫn lỗi, ghi lại mã chuyển khoản và báo cho bộ phận kỹ thuật.'
export const REFUND_BAD_WORK_ORDER = 'Phiếu sự cố đi kèm không còn hợp lệ (đã hủy hoặc không phải phiếu sự cố). Đóng hộp thoại và mở lại từ danh sách cần hoàn tiền.'

/**
 * The error a failed recording shows, by the backend's 409 code: the transfer reference already used and a reason that
 * no longer fits land on their field; the others are explained with the next step. 404 and an invalid workOrderId are
 * form-level messages; other errors keep their message (ApiError already makes 400 and 5xx readable).
 */
export function refundActionError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) {
    switch (errorCode(error)) {
      case 'PAYMENT_ALREADY_REFUNDED': return new ApiError(409, REFUND_CONFLICT)
      case 'REFUND_TRANSFER_REF_USED': return new ApiError(409, REFUND_REF_USED, { transferReference: REFUND_REF_USED })
      case 'DISPENSE_IN_PROGRESS': return new ApiError(409, REFUND_IN_PROGRESS)
      case 'REFUND_REASON_MISMATCH': return new ApiError(409, REFUND_MISMATCH, { reason: REFUND_MISMATCH })
      case 'PAYMENT_NOT_REFUNDABLE': return new ApiError(409, REFUND_NOT_REFUNDABLE)
      default: return new ApiError(409, REFUND_GENERIC_CONFLICT)
    }
  }
  if (error.status === 404) return new ApiError(404, REFUND_NOT_FOUND)
  if (error.status === 400 && error.fieldErrors.workOrderId) {
    const { workOrderId: _workOrderId, ...rest } = error.fieldErrors
    return new ApiError(400, REFUND_BAD_WORK_ORDER, rest)
  }
  return error
}
/** A 409 after which the order must be read again (everything but a transfer reference typed twice). */
export function reloadsAfter(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && errorCode(error) !== 'REFUND_TRANSFER_REF_USED'
}
