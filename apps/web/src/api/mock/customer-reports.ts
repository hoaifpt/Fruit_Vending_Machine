// Mock of the customer incident reports of the real backend (#74, docs/customer-reports.md, api.yaml): the public form
// behind a machine's report token (QR), the kiosk's report link, the management list / detail / photo / review /
// resolve / reject, and the rotation of a machine's token. Messages in English as the backend sends them; business 409s
// start with the backend's code. Every accepted report verifies its order (verdict), then opens or joins an INCIDENT
// work order (source CUSTOMER_REPORT). Contact data is masked in lists and for callers without CUSTOMER_REPORT_MANAGE,
// and never written on the work order. Nothing is deleted.
import { conflict, created, fixedPage, Form, MockHttpError, notFound, ok } from './http.ts'
import type { Reply } from './http.ts'
import type { HandlerContext, Route } from './handlers.ts'
import { permissionsOfUser } from './handlers.ts'
import type { MockOrder, MockStore } from './seed.ts'
import { closed, createWorkOrder, recordEvent } from './work-orders.ts'
import type { MockWorkOrder } from './work-orders.ts'
import type { components } from '../schema'
import { addDays, isDateString, vietnamDate } from '../../admin/maintenance-schedules.ts'

type S = components['schemas']
export type ReportType = NonNullable<S['PublicReportRequest']['type']>
export type ReportStatus = NonNullable<S['CustomerReportSummaryResponse']['status']>
export type ReportVerdict = NonNullable<S['CustomerReportSummaryResponse']['verdict']>
export type ReportResolution = NonNullable<S['CustomerReportSummaryResponse']['resolution']>

/** A file part of a multipart body, as fetcher.ts passes it to handlers. */
export interface MockUploadedFile { name: string; type: string; size: number; bytes?: Uint8Array }
export interface MockReportPhoto { id: string; contentType: 'image/jpeg' | 'image/png'; sizeBytes: number; bytes: Uint8Array }
export interface MockCustomerReport {
  id: string; code: string; machineId: string; type: ReportType; status: ReportStatus; verdict: ReportVerdict
  description: string | null; orderCodeInput: string | null; orderId: string | null; batchCode: string | null
  contactName: string | null; contactPhone: string | null; contactEmail: string | null
  photos: MockReportPhoto[]; workOrderId: string | null
  resolution: ReportResolution | null; resolutionNote: string | null; resolvedById: string | null; resolvedAt: string | null
  createdAt: string; updatedAt: string
}

export const REPORT_TYPES: readonly ReportType[] = ['PAID_NOT_RECEIVED', 'PRODUCT_QUALITY', 'MACHINE_FAULT', 'OTHER']
const STATUSES: readonly ReportStatus[] = ['NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED']
const VERDICTS: readonly ReportVerdict[] = ['NOT_APPLICABLE', 'ORDER_NOT_FOUND', 'REFUND_ELIGIBLE', 'DISPENSE_PENDING', 'DELIVERED_PER_MACHINE', 'ALREADY_REFUNDED', 'NOT_PAID']
const RESOLVE: readonly ReportResolution[] = ['FIXED', 'NO_ACTION_NEEDED', 'REFUNDED']
const REJECT: readonly ReportResolution[] = ['SPAM', 'DUPLICATE']
/** app.public-report limits of the backend (defaults). */
export const REPORT_LIMITS = { perMinute: 5, perMachineHour: 60, formPerMinute: 30, maxPhotos: 3, maxPhotoBytes: 2 * 1024 * 1024, maxRequestBytes: 7 * 1024 * 1024, maxPixels: 4000 } as const
/** Form path of the web (PUBLIC_REPORT_BASE_URL in the backend's configuration). */
export const REPORT_PATH = '/report'
const FIELDS = ['type', 'orderCode', 'description', 'contactName', 'contactPhone', 'contactEmail', 'consent', 'website'] as const
const ORDER_CODE = /^ORD-\d{8}-[0-9A-Z]{8}$/
const PHONE = /^(0|\+84)[0-9]{9,10}$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRIORITY: Record<ReportType, 'HIGH' | 'NORMAL' | 'LOW'> = { PAID_NOT_RECEIVED: 'HIGH', MACHINE_FAULT: 'HIGH', PRODUCT_QUALITY: 'NORMAL', OTHER: 'LOW' }
const OPEN: readonly ReportStatus[] = ['NEW', 'IN_REVIEW']
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR
const BUSY_ORDER: readonly MockOrder['status'][] = ['PAID', 'DISPENSING']

const iso = (ms: number) => new Date(ms).toISOString()
const newId = () => crypto.randomUUID()
const decode = (value: string) => decodeURIComponent(value)
const has = (ctx: HandlerContext, code: string) => permissionsOfUser(ctx.store, ctx.user!).includes(code)
const code4 = () => Array.from({ length: 4 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('')
function route(method: string, template: string, policy: Route['policy'], handle: Route['handle']): Route {
  return { method, pattern: new RegExp(`^${template.replace(/:(\w+)/g, '(?<$1>[^/]+)')}/?$`), policy, handle }
}

// ---- report token of a machine (machines.report_token, never in a machine response)

/** Seed token of a machine: 22..32 characters of [A-Za-z0-9_-], readable in demos (`/report/mock-report-token-dev-machine-01`). */
export function seedReportToken(machineCode: string): string {
  return `mock-report-token-${machineCode.toLowerCase()}`.replace(/[^a-z0-9_-]/g, '-').slice(0, 32).padEnd(22, '0')
}
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
/** Base URL of the public form (the web serving the mock), as the backend reads PUBLIC_REPORT_BASE_URL. */
export function reportBaseUrl(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return `${origin && /^https?:/.test(origin) ? origin : 'http://localhost:5173'}${REPORT_PATH}`
}
export function reportUrl(store: MockStore, machineId: string, orderCode?: string | null): string {
  const url = new URL(`${reportBaseUrl()}/${store.reportTokens[machineId]}`)
  if (orderCode) url.searchParams.set('order', orderCode)
  return url.toString()
}
function machineOfToken(store: MockStore, token: string) {
  const entry = Object.entries(store.reportTokens).find(([, value]) => value === token)
  const machine = entry ? store.machines.find(candidate => candidate.id === entry[0]) : undefined
  if (!machine || machine.status === 'INACTIVE') throw notFound('Report form not found')
  return machine
}

// ---- rate limits (one in-memory sliding window, a single source in the mock)

function limit(log: number[], now: number, windowMs: number, max: number) {
  while (log.length && log[0] <= now - windowMs) log.shift()
  if (log.length >= max) throw new MockHttpError(429, 'Too many requests, try again later', undefined, { 'Retry-After': String(Math.max(1, Math.ceil((log[0] + windowMs - now) / 1000))) })
  log.push(now)
}

// ---- masking

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  return phone.length <= 6 ? '****' : `${phone.slice(0, 3)}****${phone.slice(-3)}`
}
export function maskEmail(email: string | null): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  return at <= 0 ? '***' : `${email[0]}***${email.slice(at)}`
}
const maskName = (name: string | null) => (name ? `${[...name][0]}***` : null)
function contactView(report: MockCustomerReport, full: boolean): S['ReportContactResponse'] {
  return full
    ? { name: report.contactName ?? undefined, phone: report.contactPhone ?? undefined, email: report.contactEmail ?? undefined, masked: false }
    : { name: maskName(report.contactName) ?? undefined, phone: maskPhone(report.contactPhone) ?? undefined, email: maskEmail(report.contactEmail) ?? undefined, masked: true }
}

// ---- photos: magic bytes and dimensions, as the backend checks them before decoding

function photoKind(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return 'image/png'
  return null
}
/** Width and height from the PNG IHDR or the first JPEG SOF marker; null when the header cannot be read. */
export function photoSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (photoKind(bytes) === 'image/png') return bytes.length >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    const length = view.getUint16(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
    offset += 2 + length
  }
  return null
}

const isFile = (value: unknown): value is MockUploadedFile => !!value && typeof value === 'object' && typeof (value as MockUploadedFile).size === 'number'

// ---- verdict, batch and work order of a new report

function payingPayment(store: MockStore, orderId: string) {
  return store.payments.filter(payment => payment.orderId === orderId && (payment.status === 'SUCCESS' || payment.status === 'REFUNDED') && payment.paidAt)
    .sort((a, b) => a.paidAt!.localeCompare(b.paidAt!) || a.id.localeCompare(b.id))[0]
}

/** Verdict of a report naming an order (docs/customer-reports.md "Đối chiếu đơn"). */
export function verdictOf(store: MockStore, order: MockOrder | undefined): ReportVerdict {
  if (!order) return 'ORDER_NOT_FOUND'
  const paying = payingPayment(store, order.id)
  if (order.status === 'REFUNDED' || paying?.status === 'REFUNDED') return 'ALREADY_REFUNDED'
  if (BUSY_ORDER.includes(order.status)) return 'DISPENSE_PENDING'
  if (order.status === 'DISPENSE_FAILED' && paying?.status === 'SUCCESS') return 'REFUND_ELIGIBLE'
  if (order.status === 'COMPLETED') return 'DELIVERED_PER_MACHINE'
  if (order.status === 'CANCELLED' && store.payments.some(payment => payment.orderId === order.id && payment.status === 'SUCCESS')) return 'REFUND_ELIGIBLE'
  return 'NOT_PAID'
}

function linkedView(report: MockCustomerReport): S['WorkOrderLinkedReport'] {
  return { id: report.id, code: report.code, type: report.type, verdict: report.verdict, status: report.status }
}
/** Keeps the work order's linkedReports in step with the report (status after review / resolve / reject). */
function syncLinked(store: MockStore, report: MockCustomerReport) {
  const order = store.workOrders.find(candidate => candidate.id === report.workOrderId)
  if (!order) return
  const index = order.linkedReports.findIndex(row => row.id === report.id)
  if (index >= 0) order.linkedReports[index] = linkedView(report)
  else order.linkedReports.push(linkedView(report))
}

const TYPE_WORDS: Record<ReportType, string> = { PAID_NOT_RECEIVED: 'Paid, not received', PRODUCT_QUALITY: 'Product quality', MACHINE_FAULT: 'Machine fault', OTHER: 'Other' }

function attachWorkOrder(store: MockStore, report: MockCustomerReport, now: number) {
  const unfinished = (order: MockWorkOrder | undefined) => !!order && !closed(order.status)
  // 1. Another open report of the same order with an unfinished work order: join it, IN_REVIEW, no new notification.
  const sibling = report.orderId ? store.customerReports.find(other => other.id !== report.id && other.orderId === report.orderId && OPEN.includes(other.status)
    && unfinished(store.workOrders.find(order => order.id === other.workOrderId))) : undefined
  let target = sibling ? store.workOrders.find(order => order.id === sibling.workOrderId) : undefined
  if (target) report.status = 'IN_REVIEW'
  // 2. MACHINE_FAULT / OTHER while the machine has an unfinished INCIDENT work order from customer reports.
  if (!target && (report.type === 'MACHINE_FAULT' || report.type === 'OTHER')) {
    target = store.workOrders.find(order => order.machineId === report.machineId && order.type === 'INCIDENT' && order.source === 'CUSTOMER_REPORT' && !closed(order.status))
  }
  if (target) {
    report.workOrderId = target.id
    target.linkedReports.push(linkedView(report))
    recordEvent(store, target, 'NOTE', null, now, { before: target.status, note: `New customer report ${report.code}` })
    target.updatedAt = iso(now)
    return
  }
  // 3. A new INCIDENT work order created by the system, due in 24 hours. Never any contact data in it.
  const summary = [report.orderCodeInput ? `Order ${report.orderCodeInput} (${report.verdict})` : null, report.description].filter(Boolean).join('\n') || null
  const order = createWorkOrder(store, {
    type: 'INCIDENT', source: 'CUSTOMER_REPORT', machineId: report.machineId, title: `[${report.code}] ${TYPE_WORDS[report.type]}`, description: summary,
    priority: PRIORITY[report.type], dueAt: iso(now + DAY), createdById: null, linkedReports: [linkedView(report)],
  }, now)
  report.workOrderId = order.id
}

/** POST /payments/{id}/refund closes the open reports of the order (RESOLVED / REFUNDED by the refunding admin). */
export function resolveReportsOnRefund(store: MockStore, orderId: string, userId: string, now: number) {
  for (const report of store.customerReports) {
    if (report.orderId !== orderId || !OPEN.includes(report.status)) continue
    Object.assign(report, { status: 'RESOLVED', resolution: 'REFUNDED', resolvedById: userId, resolvedAt: iso(now), updatedAt: iso(now) })
    syncLinked(store, report)
  }
}

/** The open report of an order (oldest) that makes it a CUSTOMER_REPORT refund candidate, or undefined. */
export function refundReportOf(store: MockStore, orderId: string): MockCustomerReport | undefined {
  return store.customerReports.filter(report => report.orderId === orderId && OPEN.includes(report.status) && (report.verdict === 'REFUND_ELIGIBLE' || report.verdict === 'DELIVERED_PER_MACHINE'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
}
/** RefundCandidateReportResponse: contact masked. */
export function candidateReportView(report: MockCustomerReport): S['RefundCandidateReportResponse'] {
  return { id: report.id, reportCode: report.code, verdict: report.verdict, contactName: maskName(report.contactName) ?? undefined, contactPhone: maskPhone(report.contactPhone) ?? undefined, contactEmail: maskEmail(report.contactEmail) ?? undefined }
}

// ---- public form

function formInfo(ctx: HandlerContext): Reply {
  limit(ctx.store.formRequestLog, ctx.now, MINUTE, REPORT_LIMITS.formPerMinute)
  const machine = machineOfToken(ctx.store, decode(ctx.params.token))
  const form: S['ReportFormResponse'] = { machineName: machine.name, machineCode: machine.code, types: [...REPORT_TYPES], maxPhotos: REPORT_LIMITS.maxPhotos, maxPhotoBytes: REPORT_LIMITS.maxPhotoBytes }
  return ok(form)
}

function readReportPart(value: unknown): Record<string, unknown> {
  let text: string | undefined
  if (typeof value === 'string') text = value
  else if (isFile(value) && value.bytes) text = new TextDecoder().decode(value.bytes)
  if (text === undefined) throw new MockHttpError(400, 'Validation Failed', { report: 'Required part report is missing' })
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch { /* below */ }
  throw new MockHttpError(400, 'Malformed report part')
}

/** Removes control characters except line breaks, as ReportSanitizer does. */
const clean = (value: string) => [...value].filter(char => { const code = char.codePointAt(0)!; return code === 10 || (code > 31 && code !== 127) }).join('').trim()

function submit(ctx: HandlerContext): Reply {
  const { store, now } = ctx
  // Counted before anything is read or checked (HandlerInterceptor), so a burst of invalid requests is limited too.
  limit(store.reportRequestLog, now, MINUTE, REPORT_LIMITS.perMinute)
  const machine = machineOfToken(store, decode(ctx.params.token))
  const machineLog = (store.machineReportLog[machine.id!] ??= [])
  limit(machineLog, now, HOUR, REPORT_LIMITS.perMachineHour)

  const parts = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>
  const rawPhotos = parts.photos === undefined ? [] : Array.isArray(parts.photos) ? parts.photos : [parts.photos]
  const total = rawPhotos.reduce((sum: number, photo) => sum + (isFile(photo) ? photo.size : 0), 0)
  if (total > REPORT_LIMITS.maxRequestBytes) throw new MockHttpError(413, 'Request too large')
  const unknownParts = Object.keys(parts).filter(name => name !== 'report' && name !== 'photos')
  if (unknownParts.length) throw new MockHttpError(400, 'Validation Failed', Object.fromEntries(unknownParts.map(name => [name, 'Unknown part'])))

  const body = readReportPart(parts.report)
  const form = new Form(body, FIELDS)
  const website = body.website
  // Honeypot: accepted silently, nothing stored, same answer as a real report.
  if (typeof website === 'string' && website.trim()) return created({ reportCode: `RPT-${vietnamDate(now).replaceAll('-', '')}-${code4()}`, message: RECEIVED })
  const type = form.oneOf('type', REPORT_TYPES)
  const orderRaw = form.optionalText('orderCode', 32)
  const orderCode = orderRaw ? orderRaw.toUpperCase() : null
  if (orderCode && !ORDER_CODE.test(orderCode)) form.reject('orderCode', 'must match ORD-yyyyMMdd-XXXXXXXX')
  const descriptionRaw = body.description
  const description = typeof descriptionRaw === 'string' ? clean(descriptionRaw) || null : null
  if (descriptionRaw !== undefined && descriptionRaw !== null && typeof descriptionRaw !== 'string') form.reject('description', 'must be a string')
  if (description && description.length > 1000) form.reject('description', 'size must be between 1 and 1000')
  const contactName = form.optionalText('contactName', 100)
  const contactPhone = form.optionalText('contactPhone', 20)
  if (contactPhone && !PHONE.test(contactPhone)) form.reject('contactPhone', 'must match ^(0|\\+84)[0-9]{9,10}$')
  const emailRaw = form.optionalText('contactEmail', 254)
  const contactEmail = emailRaw ? emailRaw.toLowerCase() : null
  if (contactEmail && !EMAIL.test(contactEmail)) form.reject('contactEmail', 'must be a well-formed email address')
  if (body.consent !== true) form.reject('consent', 'must be true')
  if (!form.errors.type) {
    if (type === 'PAID_NOT_RECEIVED' && !orderCode && !form.errors.orderCode) form.reject('orderCode', 'is required for PAID_NOT_RECEIVED')
    if (type !== 'PAID_NOT_RECEIVED' && !description && !form.errors.description) form.reject('description', 'is required for this type')
    if ((type === 'PAID_NOT_RECEIVED' || type === 'PRODUCT_QUALITY') && !contactPhone && !contactEmail && !form.errors.contactPhone && !form.errors.contactEmail) form.reject('contactPhone', 'a phone or an e-mail is required for this type')
  }
  const photos: MockReportPhoto[] = []
  if (rawPhotos.length > REPORT_LIMITS.maxPhotos) form.reject('photos', `at most ${REPORT_LIMITS.maxPhotos} photos`)
  else rawPhotos.forEach((photo, index) => {
    if (!isFile(photo) || !photo.bytes) { form.reject(`photos[${index}]`, 'must be a file'); return }
    const kind = photoKind(photo.bytes)
    if (photo.size > REPORT_LIMITS.maxPhotoBytes) form.reject(`photos[${index}]`, 'larger than 2 MB')
    else if (!kind) form.reject(`photos[${index}]`, 'must be a JPEG or PNG image')
    else {
      const size = photoSize(photo.bytes)
      if (!size) form.reject(`photos[${index}]`, 'unreadable image')
      else if (size.width > REPORT_LIMITS.maxPixels || size.height > REPORT_LIMITS.maxPixels) form.reject(`photos[${index}]`, 'at most 4000 x 4000 pixels')
      else photos.push({ id: newId(), contentType: kind, sizeBytes: photo.size, bytes: photo.bytes })
    }
  })
  form.done()

  // Order check: an order of this machine created within the last 7 days (from the start of the Vietnam day).
  const checks = !!orderCode && (type === 'PAID_NOT_RECEIVED' || type === 'PRODUCT_QUALITY')
  const since = Date.parse(`${addDays(vietnamDate(now), -7)}T00:00:00+07:00`)
  const order = checks ? store.orders.find(candidate => candidate.orderCode === orderCode && candidate.machineId === machine.id && Date.parse(candidate.createdAt) >= since) : undefined
  const verdict: ReportVerdict = checks ? verdictOf(store, order) : 'NOT_APPLICABLE'
  const batchCode = type === 'PRODUCT_QUALITY' && order?.status === 'COMPLETED'
    ? order.items.flatMap(line => line.allocations).find(allocation => allocation.status === 'DISPENSED')?.batchCode ?? null : null

  const day = vietnamDate(now).replaceAll('-', '')
  let code = `RPT-${day}-${code4()}`
  while (store.customerReports.some(report => report.code === code)) code = `RPT-${day}-${code4()}`
  const at = iso(now)
  const report: MockCustomerReport = {
    id: newId(), code, machineId: machine.id!, type, status: 'NEW', verdict, description, orderCodeInput: orderCode, orderId: order?.id ?? null, batchCode,
    contactName, contactPhone, contactEmail, photos, workOrderId: null, resolution: null, resolutionNote: null, resolvedById: null, resolvedAt: null, createdAt: at, updatedAt: at,
  }
  store.customerReports.push(report)
  attachWorkOrder(store, report, now)
  // Same body whatever the order: never tells whether an order exists or was paid.
  return created({ reportCode: code, message: RECEIVED })
}
const RECEIVED = 'Report received'

// ---- kiosk link and token rotation

function kioskLink(ctx: HandlerContext): Reply {
  const orderCode = (ctx.query.get('orderCode') ?? '').trim().toUpperCase()
  const own = orderCode && ctx.store.orders.some(order => order.orderCode === orderCode && order.machineId === ctx.machineId)
  const link: S['ReportLinkResponse'] = { machineId: ctx.machineId, url: reportUrl(ctx.store, ctx.machineId, own ? orderCode : null) }
  return ok(link)
}

function rotate(ctx: HandlerContext): Reply {
  const id = decode(ctx.params.id)
  if (!UUID.test(id)) throw new MockHttpError(400, 'Invalid request parameter', { id: 'Must be a valid UUID' })
  const machine = ctx.store.machines.find(candidate => candidate.id === id)
  if (!machine) throw notFound('Machine not found')
  ctx.store.reportTokens[machine.id!] = newToken()
  const link: S['ReportLinkResponse'] = { machineId: machine.id, url: reportUrl(ctx.store, machine.id!) }
  return ok(link)
}

// ---- management

/** Without CUSTOMER_REPORT_MANAGE only the reports of work orders assigned to the caller. */
function visible(ctx: HandlerContext, report: MockCustomerReport): boolean {
  if (has(ctx, 'CUSTOMER_REPORT_MANAGE')) return true
  const order = ctx.store.workOrders.find(candidate => candidate.id === report.workOrderId)
  return !!order && order.assigneeId === ctx.user!.id
}
function findReport(ctx: HandlerContext): MockCustomerReport {
  const id = decode(ctx.params.id)
  if (!UUID.test(id)) throw new MockHttpError(400, 'Invalid request parameter', { id: 'Must be a valid UUID' })
  const report = ctx.store.customerReports.find(candidate => candidate.id === id)
  if (!report || !visible(ctx, report)) throw notFound('Customer report not found')
  return report
}

function workOrderRef(store: MockStore, report: MockCustomerReport): S['ReportWorkOrderResponse'] | undefined {
  const order = store.workOrders.find(candidate => candidate.id === report.workOrderId)
  return order ? { id: order.id, code: order.code, status: order.status } : undefined
}

function summaryView(store: MockStore, report: MockCustomerReport): S['CustomerReportSummaryResponse'] {
  const machine = store.machines.find(candidate => candidate.id === report.machineId)
  const order = store.orders.find(candidate => candidate.id === report.orderId)
  return {
    id: report.id, code: report.code, type: report.type, status: report.status, verdict: report.verdict, machineId: report.machineId, machineCode: machine?.code,
    orderCode: order?.orderCode ?? report.orderCodeInput ?? undefined, orderId: order?.id, contact: contactView(report, false), workOrder: workOrderRef(store, report),
    resolution: report.resolution ?? undefined, createdAt: report.createdAt, resolvedAt: report.resolvedAt ?? undefined,
  }
}

export function detailView(ctx: HandlerContext, report: MockCustomerReport): S['CustomerReportDetailResponse'] {
  const { store } = ctx
  const machine = store.machines.find(candidate => candidate.id === report.machineId)
  const order = store.orders.find(candidate => candidate.id === report.orderId)
  const batch = report.batchCode ? store.batches.find(candidate => candidate.batchCode === report.batchCode) : undefined
  const resolver = store.users.find(user => user.id === report.resolvedById)
  return {
    id: report.id, code: report.code, type: report.type, status: report.status, verdict: report.verdict, machineId: report.machineId, machineCode: machine?.code, machineName: machine?.name,
    description: report.description ?? undefined, orderCodeInput: report.orderCodeInput ?? undefined,
    order: order ? { id: order.id, orderCode: order.orderCode, status: order.status } : undefined,
    batch: batch ? { id: batch.id, batchCode: batch.batchCode, productName: batch.productName, expiresAt: batch.expiresAt } : undefined,
    contact: contactView(report, has(ctx, 'CUSTOMER_REPORT_MANAGE')),
    photos: report.photos.map(photo => ({ id: photo.id, contentType: photo.contentType, sizeBytes: photo.sizeBytes })),
    workOrder: workOrderRef(store, report), resolution: report.resolution ?? undefined, resolutionNote: report.resolutionNote ?? undefined,
    resolvedBy: report.resolvedById ? { id: report.resolvedById, fullName: resolver?.fullName ?? '' } : undefined, resolvedAt: report.resolvedAt ?? undefined,
    createdAt: report.createdAt, updatedAt: report.updatedAt,
  }
}

function dateRange(query: URLSearchParams, errors: Record<string, string>): { from: number | null; to: number | null } {
  const read = (name: string) => {
    const value = query.get(name)
    if (!value) return null
    if (!isDateString(value)) { errors[name] = 'Must be a date (yyyy-MM-dd)'; return null }
    return value
  }
  const from = read('from'), to = read('to')
  if (from && to && to < from) errors.to = 'Must not be before from'
  return { from: from ? Date.parse(`${from}T00:00:00+07:00`) : null, to: to ? Date.parse(`${addDays(to, 1)}T00:00:00+07:00`) : null }
}

function list(ctx: HandlerContext): Reply {
  const { query, store } = ctx
  const errors: Record<string, string> = {}
  const check = (name: string, values: readonly string[]) => { const value = query.get(name); if (value && !values.includes(value)) errors[name] = `Must be one of: ${values.join(', ')}` }
  check('status', STATUSES); check('type', REPORT_TYPES); check('verdict', VERDICTS)
  const machineId = query.get('machineId')
  if (machineId && !UUID.test(machineId)) errors.machineId = 'Must be a valid UUID'
  const hasOrder = query.get('hasOrder')
  if (hasOrder && hasOrder !== 'true' && hasOrder !== 'false') errors.hasOrder = 'Must be true or false'
  const range = dateRange(query, errors)
  if (Object.keys(errors).length) throw new MockHttpError(400, 'Invalid request parameter', errors)
  const eq = (name: string, value: string | null) => !query.get(name) || query.get(name) === value
  const rows = store.customerReports.filter(report => visible(ctx, report) && eq('status', report.status) && eq('type', report.type) && eq('verdict', report.verdict)
    && eq('machineId', report.machineId) && (!hasOrder || (hasOrder === 'true') === !!report.orderId)
    && (range.from === null || Date.parse(report.createdAt) >= range.from) && (range.to === null || Date.parse(report.createdAt) < range.to))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map(report => summaryView(store, report))
  return ok(fixedPage(rows, query, { defaultSize: 20, maxSize: 100 }))
}

function photo(ctx: HandlerContext): Reply {
  const report = findReport(ctx)
  const found = report.photos.find(candidate => candidate.id === decode(ctx.params.photoId))
  if (!found) throw notFound('Photo not found')
  return { status: 200, data: null, raw: { body: found.bytes, headers: {
    'Content-Type': found.contentType, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
  } } }
}

function decide(ctx: HandlerContext, allowed: readonly ReportResolution[], status: 'RESOLVED' | 'REJECTED'): Reply {
  const form = new Form(ctx.body, ['resolution', 'note'])
  const value = (ctx.body as Record<string, unknown>).resolution
  if (!(RESOLVE as readonly unknown[]).concat(REJECT).includes(value)) form.reject('resolution', `Must be one of: ${[...RESOLVE, ...REJECT].join(', ')}`)
  else if (!allowed.includes(value as ReportResolution)) form.reject('resolution', `Must be one of: ${allowed.join(', ')}`)
  const note = form.optionalText('note', 1000)
  form.done()
  const report = findReport(ctx)
  if (!OPEN.includes(report.status)) throw conflict('REPORT_ALREADY_CLOSED: the report is already closed')
  Object.assign(report, { status, resolution: value as ReportResolution, resolutionNote: note, resolvedById: ctx.user!.id, resolvedAt: iso(ctx.now), updatedAt: iso(ctx.now) })
  syncLinked(ctx.store, report)
  return ok(detailView(ctx, report))
}

export const customerReportRoutes: Route[] = [
  route('GET', '/public/report-forms/:token', 'public', formInfo),
  route('POST', '/public/report-forms/:token/reports', 'public', submit),
  route('GET', '/kiosk/incident-report-link', 'kiosk', kioskLink),
  route('POST', '/machines/:id/report-token/rotate', { permission: 'MACHINE_REPORT_LINK_MANAGE' }, rotate),
  route('GET', '/customer-reports', { permission: 'CUSTOMER_REPORT_READ' }, list),
  route('GET', '/customer-reports/:id', { permission: 'CUSTOMER_REPORT_READ' }, ctx => ok(detailView(ctx, findReport(ctx)))),
  route('GET', '/customer-reports/:id/photos/:photoId', { permission: 'CUSTOMER_REPORT_READ' }, photo),
  route('POST', '/customer-reports/:id/review', { permission: 'CUSTOMER_REPORT_MANAGE' }, ctx => {
    const report = findReport(ctx)
    if (!OPEN.includes(report.status)) throw conflict('REPORT_ALREADY_CLOSED: the report is already closed')
    if (report.status !== 'NEW') throw conflict('REPORT_NOT_NEW: only a NEW report can be taken into review')
    Object.assign(report, { status: 'IN_REVIEW', updatedAt: iso(ctx.now) })
    syncLinked(ctx.store, report)
    return ok(detailView(ctx, report))
  }),
  route('POST', '/customer-reports/:id/resolve', { permission: 'CUSTOMER_REPORT_MANAGE' }, ctx => decide(ctx, RESOLVE, 'RESOLVED')),
  route('POST', '/customer-reports/:id/reject', { permission: 'CUSTOMER_REPORT_MANAGE' }, ctx => decide(ctx, REJECT, 'REJECTED')),
]
