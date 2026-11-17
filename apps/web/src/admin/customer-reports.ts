// Rules of the customer report screens (list and detail, backend #74, docs/customer-reports.md) that do not need React,
// unit-tested in tests/incident-ticket.test.mjs. CUSTOMER_REPORT_READ (ADMIN, STAFF; STAFF only sees the reports of
// work orders assigned to them, the server answers 404 for the others) reads; CUSTOMER_REPORT_MANAGE (ADMIN) sees the
// full contact and reviews (NEW → IN_REVIEW), resolves (FIXED, NO_ACTION_NEEDED, REFUNDED) or rejects (SPAM,
// DUPLICATE). RESOLVED and REJECTED are final. A report never refunds by itself: the refund is recorded on W-12.
import { ApiError } from '../api/client.ts'
import type { CustomerReport, CustomerReportDetail, CustomerReportListQuery, ReportDecisionBody, ReportResolution, ReportStatus, ReportVerdict } from '../api/resources.ts'
import { REPORT_TYPES, reportTypeLabel } from '../features/incident/incident.ts'
import { oneOf, uuidParam } from '../lib/table-query.ts'
import { errorCode } from './form-error.ts'
import { refundPathFor } from './refunds.ts'

export { reportTypeLabel }
export const CUSTOMER_REPORTS_PATH = '/admin/customer-reports'
export function customerReportPath(reportId: string | undefined): string {
  const id = uuidParam(reportId ?? '')
  return id ? `${CUSTOMER_REPORTS_PATH}/${id}` : CUSTOMER_REPORTS_PATH
}

export const REPORT_STATUSES: readonly ReportStatus[] = ['NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED']
export const REPORT_TYPE_VALUES = REPORT_TYPES.map(option => option.value)
export const REPORT_VERDICTS: readonly ReportVerdict[] = ['NOT_APPLICABLE', 'ORDER_NOT_FOUND', 'REFUND_ELIGIBLE', 'DISPENSE_PENDING', 'DELIVERED_PER_MACHINE', 'ALREADY_REFUNDED', 'NOT_PAID']

/** What the backend found when it checked the order of the report, and what to do about it. */
export const VERDICT_LABELS: Readonly<Record<ReportVerdict, { label: string; help: string }>> = {
  NOT_APPLICABLE: { label: 'Không kiểm tra đơn', help: 'Phản ánh không gắn với đơn (máy lỗi, khác, hoặc không ghi mã đơn).' },
  ORDER_NOT_FOUND: { label: 'Không thấy đơn', help: 'Không có đơn với mã này ở máy trong 7 ngày gần nhất. Liên hệ khách để hỏi lại mã đơn.' },
  REFUND_ELIGIBLE: { label: 'Cần hoàn tiền', help: 'Khách đã trả tiền nhưng không nhận hộp (nhả thất bại hoặc tiền về sau khi hủy). Chuyển khoản trả khách rồi ghi nhận ở màn Hoàn tiền.' },
  DISPENSE_PENDING: { label: 'Máy chưa báo kết quả', help: 'Đơn đã thanh toán, máy chưa báo nhả xong. Kiểm tra máy trước khi quyết định.' },
  DELIVERED_PER_MACHINE: { label: 'Máy báo đã giao', help: 'Máy báo đã nhả hộp. Kiểm tra camera hoặc máy; hoàn tiền nếu xác định khách không nhận hoặc hàng lỗi.' },
  ALREADY_REFUNDED: { label: 'Đã hoàn tiền', help: 'Đơn hoặc khoản thanh toán của đơn đã được hoàn tiền trước đó; không chuyển khoản thêm.' },
  NOT_PAID: { label: 'Chưa thanh toán', help: 'Đơn không có khoản thanh toán thành công nào: không có tiền để hoàn.' },
}
export function verdictLabel(verdict: string | undefined | null): string {
  return verdict && Object.hasOwn(VERDICT_LABELS, verdict) ? VERDICT_LABELS[verdict as ReportVerdict].label : (verdict || '—')
}
export function verdictHelp(verdict: string | undefined | null): string {
  return verdict && Object.hasOwn(VERDICT_LABELS, verdict) ? VERDICT_LABELS[verdict as ReportVerdict].help : ''
}

export const RESOLVE_OPTIONS: readonly ReportResolution[] = ['FIXED', 'NO_ACTION_NEEDED', 'REFUNDED']
export const REJECT_OPTIONS: readonly ReportResolution[] = ['SPAM', 'DUPLICATE']
export const RESOLUTION_LABELS: Readonly<Record<ReportResolution, string>> = {
  FIXED: 'Đã khắc phục', NO_ACTION_NEEDED: 'Không cần xử lý', REFUNDED: 'Đã hoàn tiền', SPAM: 'Tin rác', DUPLICATE: 'Trùng phản ánh khác',
}
export function resolutionLabel(value: string | undefined | null): string {
  return value && Object.hasOwn(RESOLUTION_LABELS, value) ? RESOLUTION_LABELS[value as ReportResolution] : (value || '—')
}

// ---- URL filters (server-side: no sort parameter, newest first)

export interface ReportFilters {
  status: ReportStatus | ''; type: string; verdict: ReportVerdict | ''; machineId: string
  /** Vietnam days of createdAt, inclusive. */
  from: string; to: string
  hasOrder: 'true' | 'false' | ''
  page: number
}
export const REPORT_FILTER_KEYS = ['status', 'type', 'verdict', 'machineId', 'from', 'to', 'hasOrder'] as const
const DATE = /^\d{4}-\d{2}-\d{2}$/
const dateParam = (value: string | null) => (value && DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : '')

export function readReportFilters(params: URLSearchParams): ReportFilters {
  const page = Number(params.get('page') ?? '')
  let from = dateParam(params.get('from')), to = dateParam(params.get('to'))
  if (from && to && to < from) [from, to] = [to, from]
  return {
    status: oneOf(params.get('status'), REPORT_STATUSES) as ReportStatus | '',
    type: oneOf(params.get('type'), REPORT_TYPE_VALUES),
    verdict: oneOf(params.get('verdict'), REPORT_VERDICTS) as ReportVerdict | '',
    machineId: uuidParam((params.get('machineId') ?? '').trim()),
    from, to,
    hasOrder: oneOf(params.get('hasOrder'), ['true', 'false']) as ReportFilters['hasOrder'],
    page: Number.isSafeInteger(page) && page > 0 ? page : 0,
  }
}
/** GET /customer-reports: only contract parameters, absent when not in effect. */
export function reportListQuery(filters: ReportFilters, size: number): CustomerReportListQuery {
  return {
    page: filters.page, size, status: filters.status || undefined, type: (filters.type || undefined) as CustomerReportListQuery['type'],
    verdict: filters.verdict || undefined, machineId: filters.machineId || undefined, from: filters.from || undefined, to: filters.to || undefined,
    hasOrder: filters.hasOrder ? filters.hasOrder === 'true' : undefined,
  }
}

// ---- detail: what can be done next

export const isOpenReport = (status: string | undefined) => status === 'NEW' || status === 'IN_REVIEW'
export type ReportAction = 'review' | 'resolve' | 'reject'
/** Actions of the detail header for this account and status (CUSTOMER_REPORT_MANAGE only; none once closed). */
export function reportActions(report: Pick<CustomerReport, 'status'>, canManage: boolean): ReportAction[] {
  if (!canManage || !isOpenReport(report.status)) return []
  return report.status === 'NEW' ? ['review', 'resolve', 'reject'] : ['resolve', 'reject']
}

/** One sentence: where the report stands and the next step for this account. */
export function reportNextStep(report: Pick<CustomerReportDetail, 'status' | 'verdict' | 'resolution'>, canManage: boolean, canRefund: boolean): string {
  if (report.status === 'RESOLVED') return `Đã giải quyết: ${resolutionLabel(report.resolution).toLowerCase()}.`
  if (report.status === 'REJECTED') return `Đã từ chối: ${resolutionLabel(report.resolution).toLowerCase()}.`
  if (!canManage) return 'Kiểm tra máy theo phiếu sự cố được giao; quản trị viên sẽ giải quyết phản ánh và hoàn tiền nếu cần.'
  const refund = report.verdict === 'REFUND_ELIGIBLE' || report.verdict === 'DELIVERED_PER_MACHINE'
  if (refund && canRefund) return report.verdict === 'REFUND_ELIGIBLE'
    ? 'Chuyển khoản trả khách rồi ghi nhận hoàn tiền: phản ánh tự chuyển sang “Đã giải quyết · Đã hoàn tiền”.'
    : 'Máy báo đã giao hộp: kiểm tra trước; nếu hoàn tiền thì ghi nhận ở màn Hoàn tiền, phản ánh tự được giải quyết.'
  return report.status === 'NEW' ? 'Bấm “Nhận xử lý”, kiểm tra máy hoặc giao phiếu sự cố cho nhân viên, rồi giải quyết hoặc từ chối.' : 'Khi có kết quả, bấm “Giải quyết” hoặc “Từ chối”.'
}

/** Link to W-12 narrowed to the report's order (and its work order) while a refund may be due; null otherwise. */
export function refundLinkOf(report: Pick<CustomerReportDetail, 'status' | 'verdict' | 'order' | 'workOrder'>, canRefund: boolean): string | null {
  if (!canRefund || !isOpenReport(report.status) || !report.order?.id) return null
  if (report.verdict !== 'REFUND_ELIGIBLE' && report.verdict !== 'DELIVERED_PER_MACHINE') return null
  return refundPathFor(report.order.id, report.workOrder?.id)
}

/** "Nguyễn A · 090****567 · a***@example.com", or a dash. */
export function contactText(contact: CustomerReport['contact']): string {
  const parts = [contact?.name, contact?.phone, contact?.email].map(value => value?.trim()).filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

export function sizeText(bytes: number | undefined): string {
  if (!bytes || bytes < 0) return '—'
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`
}

// ---- decisions

export const DECISION_NOTE_MAX = 1000
export interface DecisionValues { resolution: string; note: string; [key: string]: string }
export function validateDecision(values: DecisionValues, allowed: readonly ReportResolution[]): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!allowed.includes(values.resolution as ReportResolution)) errors.resolution = 'Chọn kết quả xử lý.'
  if (values.note.trim().length > DECISION_NOTE_MAX) errors.note = `Tối đa ${DECISION_NOTE_MAX} ký tự.`
  return errors
}
/** ReportDecisionRequest: the note only when there is one. */
export function decisionBody(values: DecisionValues): ReportDecisionBody {
  const note = values.note.trim()
  return { resolution: values.resolution as ReportResolution, ...(note ? { note } : {}) }
}

export const REPORT_CLOSED = 'Phản ánh này đã được giải quyết hoặc từ chối (có thể bởi quản trị viên khác). Thông tin đã được tải lại.'
export const REPORT_NOT_NEW = 'Phản ánh đã được nhận xử lý trước đó. Thông tin đã được tải lại; bạn có thể giải quyết hoặc từ chối.'
/** 409 by the backend's code (REPORT_ALREADY_CLOSED, REPORT_NOT_NEW), explained with the next step. */
export function reportActionError(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.status !== 409) return error
  const code = errorCode(error)
  if (code === 'REPORT_ALREADY_CLOSED') return new ApiError(409, REPORT_CLOSED)
  if (code === 'REPORT_NOT_NEW') return new ApiError(409, REPORT_NOT_NEW)
  return new ApiError(409, 'Trạng thái phản ánh vừa thay đổi. Thông tin đã được tải lại; kiểm tra rồi thử lại.')
}
