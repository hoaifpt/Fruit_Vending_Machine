// Rules of screen T3 / W-12 "Hoàn tiền" (FE 8.1) that do not need React, unit-tested in tests/refunds.test.mjs.
//
// The money goes back outside the system: an ADMIN transfers it to the customer, then records the bank's transfer
// reference here. API: draft contract api-contract/drafts/refunds.yaml (waiting for backend 5.1):
// POST /orders/{orderId}/refund { transferRef, note?, paymentId } and GET /refunds. The cases to refund come from APIs
// that already exist: GET /orders?status=DISPENSE_FAILED and GET /payments?requiresAttention=true (late payment on a
// cancelled order, duplicate payment). ADMIN only (REFUND_RECORD, draft permission; never STAFF, BR-19/20).
// FE 8.3: customer reports naming a paid order (GET /incident-reports?flagged=true, draft incident-reports.yaml) are
// listed first, as soon as they arrive. A report never makes an order refundable by itself (BR-15): an order still PAID
// is shown for checking only; a DISPENSE_FAILED one is refunded as usual.
import { ApiError } from '../api/client.ts'
import type { IncidentReport, IncidentReportListQuery, OrderDetail, Refund, RefundBody, RefundListQuery } from '../api/resources.ts'
import { dateRangeToInstants, formatDateTime } from '../lib/format.ts'
import { formatSort, oneOf, parseSort, uuidParam } from '../lib/table-query.ts'
import type { SortRule, SortState } from '../lib/table-query.ts'
import type { ListAnomalyInfo } from './payments.ts'

export const REFUNDS_PATH = '/admin/refunds'
export const REFUNDED_VIEW_PATH = `${REFUNDS_PATH}?view=refunded`
/** The refund screen narrowed to one order (entry from the order and payment detail screens). */
export function refundPathFor(orderId: string | undefined): string {
  const id = uuidParam(orderId ?? '')
  return id ? `${REFUNDS_PATH}?orderId=${id}` : REFUNDS_PATH
}

// ---- reasons

export const REFUND_REASONS = ['DISPENSE_FAILED', 'PAYMENT_LATE', 'PAYMENT_DUPLICATE'] as const
export type RefundReason = typeof REFUND_REASONS[number]
export const REFUND_REASON_LABELS: Readonly<Record<RefundReason, string>> = {
  DISPENSE_FAILED: 'Nhả hàng thất bại',
  PAYMENT_LATE: 'Thanh toán muộn (đơn đã hủy)',
  PAYMENT_DUPLICATE: 'Thanh toán trùng',
}
export function refundReasonLabel(reason: string | undefined): string {
  return reason && Object.hasOwn(REFUND_REASON_LABELS, reason) ? REFUND_REASON_LABELS[reason as RefundReason] : (reason || '—')
}

// ---- URL filters

/** `pending` ("Cần hoàn tiền", the default when absent) or `refunded` ("Đã hoàn tiền"). */
export const REFUND_VIEWS = ['pending', 'refunded'] as const
export type RefundView = typeof REFUND_VIEWS[number]
/** The only sorts `GET /refunds` approves. */
export const REFUND_SORT_RULE: SortRule = { fields: ['refundedAt', 'amount'], fallback: 'refundedAt,desc' }
/** Filters the "Xóa bộ lọc" button clears (the view and the order focus are kept). */
export const REFUND_FILTER_KEYS = ['machineId', 'reason', 'from', 'to'] as const

export interface RefundFilters {
  view: RefundView
  /** Focus on one order (deep link from T1/T2); a non-UUID is dropped (the API would answer 400). */
  orderId: string
  machineId: string
  /** "Đã hoàn tiền" only. */
  reason: RefundReason | ''; from: string; to: string; sort: SortState; page: number
  /** "Cần hoàn tiền": one page per list. */
  failedPage: number; paymentPage: number
  /** "Cần hoàn tiền": page of the customer reports (FE 8.3). */
  reportPage: number
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dateParam = (value: string | null) => (value && DATE.test(value) ? value : '')
const pageOf = (params: URLSearchParams, name: string) => {
  const value = Number(params.get(name) ?? '')
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}
/** URL value of a page number: absent for the first page. */
export const pageValue = (page: number) => (page > 0 ? String(page) : undefined)

export function readRefundFilters(params: URLSearchParams): RefundFilters {
  return {
    view: (oneOf(params.get('view'), REFUND_VIEWS) || 'pending') as RefundView,
    orderId: uuidParam((params.get('orderId') ?? '').trim()),
    machineId: uuidParam((params.get('machineId') ?? '').trim()),
    reason: oneOf(params.get('reason'), REFUND_REASONS) as RefundReason | '',
    from: dateParam(params.get('from')), to: dateParam(params.get('to')),
    sort: parseSort(params.get('sort'), REFUND_SORT_RULE),
    page: pageOf(params, 'page'), failedPage: pageOf(params, 'failedPage'), paymentPage: pageOf(params, 'paymentPage'),
    reportPage: pageOf(params, 'reportPage'),
  }
}

/** GET /orders: paid orders whose bowl was never dispensed, oldest problem last. Only contract parameters. */
export function failedOrdersQuery(filters: RefundFilters, size: number) {
  return { page: filters.failedPage, size, sort: 'createdAt,desc', status: 'DISPENSE_FAILED' as const, machineId: filters.machineId || undefined }
}
/** GET /payments: SUCCESS payments with money to give back (late or duplicate), the server's own filter. */
export function attentionPaymentsQuery(filters: RefundFilters, size: number) {
  return { page: filters.paymentPage, size, sort: 'paidAt,desc', requiresAttention: true, machineId: filters.machineId || undefined }
}
/** GET /incident-reports (draft, FE 8.3): customer reports whose paid order still has a payment to check, newest first. */
export function flaggedReportsQuery(filters: RefundFilters, size: number): IncidentReportListQuery {
  return { page: filters.reportPage, size, sort: 'createdAt,desc', flagged: true, machineId: filters.machineId || undefined }
}

// ---- customer reports (FE 8.3)

/**
 * What a flagged report row offers: `record` when the order is a refund case the dialog can check (DISPENSE_FAILED, or
 * CANCELLED with money received), `check-machine` while the order is still PAID or DISPENSING (the report alone does
 * not prove the bowl was not served), `none` otherwise (no order, or already settled).
 */
export type ReportRowAction = 'record' | 'check-machine' | 'none'
export function reportRowAction(report: Pick<IncidentReport, 'orderId' | 'orderStatus'>): ReportRowAction {
  if (!report.orderId) return 'none'
  if (report.orderStatus === 'DISPENSE_FAILED' || report.orderStatus === 'CANCELLED') return 'record'
  if (report.orderStatus === 'PAID' || report.orderStatus === 'DISPENSING') return 'check-machine'
  return 'none'
}
export const REPORT_CHECK_MACHINE = 'Đơn chưa ở trạng thái nhả thất bại; kiểm tra máy trước.'
export const REPORT_NOTHING = 'Đơn không còn thuộc trường hợp cần hoàn tiền; mở đơn để xem.'
/** Reports of the loaded page by order id (newest kept), to mark the matching rows of the other lists. */
export function reportsByOrder(reports: readonly IncidentReport[] | undefined): Map<string, IncidentReport> {
  const map = new Map<string, IncidentReport>()
  for (const report of reports ?? []) if (report.orderId && !map.has(report.orderId)) map.set(report.orderId, report)
  return map
}
/** "Khách báo sự cố INC-20261109-7KQ2" */
export const reportMark = (report: Pick<IncidentReport, 'reportCode'>) => `Khách báo sự cố ${report.reportCode}`
export const REPORTS_MISSING = 'Chưa có dữ liệu báo cáo của khách: máy chủ chưa cung cấp chức năng này. Các trường hợp bên dưới vẫn dùng dữ liệu thật.'

/** GET /refunds (draft): only parameters of the draft contract, absent when not in effect. */
export function refundListQuery(filters: RefundFilters, size: number): RefundListQuery {
  const range = dateRangeToInstants(filters.from, filters.to)
  return {
    page: filters.page, size, sort: formatSort(filters.sort),
    machineId: filters.machineId || undefined, reason: filters.reason || undefined,
    refundedFrom: range.from, refundedTo: range.to,
  }
}

// ---- which payment of an order can be refunded

type OrderLike = Pick<OrderDetail, 'status' | 'payments'>
type PaymentLike = NonNullable<OrderDetail['payments']>[number]
export type BlockedWhy = 'refunded' | 'kept' | 'not-success' | 'not-case' | 'no-payment' | 'unknown-payment'
export type RefundCase =
  | { kind: 'ready'; paymentId: string; amount?: number; reason: RefundReason; payment: PaymentLike }
  | { kind: 'blocked'; why: BlockedWhy; paymentId?: string; payment?: PaymentLike }

const byPaidThenCreated = (a: PaymentLike, b: PaymentLike) =>
  (b.paidAt ?? '').localeCompare(a.paidAt ?? '') || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')

/**
 * Whether one payment of an order (or, without `paymentId`, the order's payment to refund) can be recorded as refunded,
 * with the rules of the draft contract: a SUCCESS payment on a DISPENSE_FAILED order, on a CANCELLED order (late
 * payment), or the later of two SUCCESS payments of one order (duplicate: the earlier one pays for the order).
 * Anything else is blocked with the reason, so the screen never offers a second refund.
 */
export function refundCase(order: OrderLike, paymentId?: string): RefundCase {
  const payments = order.payments ?? []
  const successes = payments.filter(payment => payment.status === 'SUCCESS').sort(byPaidThenCreated)
  let payment: PaymentLike | undefined
  if (paymentId) {
    payment = payments.find(candidate => candidate.id === paymentId)
    if (!payment) return { kind: 'blocked', why: 'unknown-payment', paymentId }
    if (payment.status === 'REFUNDED') return { kind: 'blocked', why: 'refunded', paymentId, payment }
    if (payment.status !== 'SUCCESS') return { kind: 'blocked', why: 'not-success', paymentId, payment }
  } else {
    payment = successes[0]
    if (!payment) {
      const refunded = payments.filter(candidate => candidate.status === 'REFUNDED').sort(byPaidThenCreated)[0]
      return refunded ? { kind: 'blocked', why: 'refunded', paymentId: refunded.id, payment: refunded } : { kind: 'blocked', why: 'no-payment' }
    }
  }
  const ready = (reason: RefundReason): RefundCase => ({ kind: 'ready', paymentId: payment.id ?? '', amount: payment.amount, reason, payment })
  if (order.status === 'DISPENSE_FAILED') return ready('DISPENSE_FAILED')
  if (order.status === 'CANCELLED') return ready('PAYMENT_LATE')
  if (successes.length > 1) return successes[0].id === payment.id ? ready('PAYMENT_DUPLICATE') : { kind: 'blocked', why: 'kept', paymentId: payment.id, payment }
  return { kind: 'blocked', why: 'not-case', paymentId: payment.id, payment }
}

/** Status text of a payment for "not-success" (no money received). */
const NOT_PAID_TEXT: Record<string, string> = { PENDING: 'đang chờ thanh toán', FAILED: 'thất bại', EXPIRED: 'đã hết hạn' }

/** Why nothing can be recorded, with the refund itself when it is known ("Đã hoàn tiền lúc …, mã CK …"). */
export function blockedText(found: Extract<RefundCase, { kind: 'blocked' }>, refund?: Pick<Refund, 'refundedAt' | 'transferRef' | 'refundedByName'>): string {
  switch (found.why) {
    case 'refunded': return refund
      ? `${refundedText(refund)} Không ghi nhận lần nữa và không chuyển khoản thêm cho khách.`
      : 'Khoản này đã được hoàn tiền trước đó. Không ghi nhận lần nữa và không chuyển khoản thêm cho khách; xem mã chuyển khoản ở mục “Đã hoàn tiền”.'
    case 'kept': return 'Khoản này đến trước và được tính cho đơn nên không hoàn. Khoản cần hoàn là khoản thành công đến sau của cùng đơn.'
    case 'not-success': return `Khoản này ${NOT_PAID_TEXT[found.payment?.status ?? ''] ?? 'chưa nhận được tiền'} nên không có tiền để hoàn.`
    case 'not-case': return 'Đơn không thuộc trường hợp cần hoàn tiền: không nhả hàng thất bại, không bị hủy và không có thanh toán trùng.'
    case 'no-payment': return 'Đơn chưa có khoản thanh toán thành công nào nên không có tiền để hoàn.'
    case 'unknown-payment': return 'Không tìm thấy khoản thanh toán này trong đơn. Mở lại từ danh sách cần hoàn tiền.'
  }
}

/** "Đã hoàn tiền lúc 09/11/2026 13:05, mã CK FT123, người ghi nhận Nguyễn Văn A." */
export function refundedText(refund: Pick<Refund, 'refundedAt' | 'transferRef' | 'refundedByName'>): string {
  const by = refund.refundedByName?.trim() ? `, người ghi nhận ${refund.refundedByName.trim()}` : ''
  return `Đã hoàn tiền lúc ${formatDateTime(refund.refundedAt)}, mã CK ${refund.transferRef}${by}.`
}

/** The refund recorded for a payment, among the ones read for its order. */
export function refundOf(refunds: readonly Refund[] | undefined, paymentId: string | undefined): Refund | undefined {
  return paymentId ? refunds?.find(refund => refund.paymentId === paymentId) : undefined
}

/**
 * Row action of a "Thanh toán muộn hoặc trùng" row: the earlier payment of a duplicate pair on the same page is kept
 * (no button, says why); every other row offers the dialog, which reads the order and decides (refundCase).
 */
export function paymentRowAction(info: ListAnomalyInfo | undefined): 'record' | 'kept' {
  return info?.kind === 'duplicate' && !info.refundCandidate ? 'kept' : 'record'
}

/** Entry from the order and payment detail screens: a link to record, or to see the refund already recorded. */
export function refundEntry(order: OrderLike | undefined, paymentId?: string): 'record' | 'refunded' | null {
  if (!order) return null
  const found = refundCase(order, paymentId)
  if (found.kind === 'ready') return 'record'
  return found.why === 'refunded' ? 'refunded' : null
}

// ---- form

export const TRANSFER_REF_MAX = 64
export const TRANSFER_REF_MIN = 3
export const REFUND_NOTE_MAX = 500
/** Same as the draft's RefundRequest.transferRef pattern. */
export const TRANSFER_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,63}$/

export interface RefundForm { transferRef: string; note: string }

/** Client checks before sending (the server checks again): field → message, empty when valid. */
export function validateRefund(values: RefundForm): Record<string, string> {
  const errors: Record<string, string> = {}
  const ref = values.transferRef.trim()
  if (!ref) errors.transferRef = 'Nhập mã giao dịch của lần chuyển khoản hoàn tiền cho khách.'
  else if (ref.length > TRANSFER_REF_MAX) errors.transferRef = `Tối đa ${TRANSFER_REF_MAX} ký tự.`
  else if (ref.length < TRANSFER_REF_MIN) errors.transferRef = `Tối thiểu ${TRANSFER_REF_MIN} ký tự.`
  else if (!TRANSFER_REF_PATTERN.test(ref)) errors.transferRef = 'Chỉ gồm chữ không dấu, số và . _ / - (không có khoảng trắng), bắt đầu bằng chữ hoặc số.'
  if (values.note.trim().length > REFUND_NOTE_MAX) errors.note = `Tối đa ${REFUND_NOTE_MAX} ký tự.`
  return errors
}

/** Body of POST /orders/{orderId}/refund: only contract fields, the note only when there is one, always the payment. */
export function refundBody(values: RefundForm, paymentId: string): RefundBody {
  const note = values.note.trim()
  return { transferRef: values.transferRef.trim(), paymentId, ...(note ? { note } : {}) }
}

export const REFUND_SUCCESS_TITLE = 'Đã ghi nhận hoàn tiền'
/** MSG36. */
export function refundSuccessText(orderCode: string | undefined): string {
  return `Thanh toán của đơn ${orderCode || 'này'} đã được đánh dấu hoàn tiền.`
}

export const REFUND_CONFLICT = 'Không ghi nhận được: khoản này vừa được hoàn tiền (có thể bởi quản trị viên khác) hoặc không còn thuộc trường hợp cần hoàn. Thông tin bên dưới đã được tải lại. Đừng chuyển khoản thêm cho khách trước khi kiểm tra lại.'
export const REFUND_BAD_PAYMENT = 'Máy chủ không xác định được khoản thanh toán cần hoàn. Đóng hộp thoại, tải lại danh sách rồi mở lại.'
export const REFUND_NOT_FOUND ='Không tìm thấy đơn hoặc khoản thanh toán này, hoặc máy chủ chưa có chức năng ghi nhận hoàn tiền. Tải lại danh sách rồi thử lại; nếu vẫn lỗi, ghi lại mã chuyển khoản và báo cho bộ phận kỹ thuật.'

/**
 * The error a failed recording shows: a 409 (refunded meanwhile, or no longer a refund case) and a 404 are explained
 * with the next step; other errors keep their message (ApiError already makes 400 and 5xx readable). A 400 on
 * paymentId has no field on the form, so it becomes the form-level message.
 */
export function refundActionError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) return new ApiError(409, REFUND_CONFLICT)
  if (error.status === 404) return new ApiError(404, REFUND_NOT_FOUND)
  if (error.status === 400 && error.fieldErrors.paymentId) {
    const { paymentId: _paymentId, ...rest } = error.fieldErrors
    return new ApiError(400, REFUND_BAD_PAYMENT, rest)
  }
  return error
}
export function isRefundConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

/** GET /refunds answered 404/405/501: the backend has not shipped 5.1 (nothing to list, the action cannot work either). */
export function refundsMissing(error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : undefined
  return status === 404 || status === 405 || status === 501
}
export const REFUNDS_MISSING = 'Chưa có dữ liệu hoàn tiền: máy chủ chưa cung cấp chức năng ghi nhận hoàn tiền. Danh sách “Cần hoàn tiền” vẫn dùng dữ liệu thật; tạm thời hãy ghi mã chuyển khoản ra sổ.'
