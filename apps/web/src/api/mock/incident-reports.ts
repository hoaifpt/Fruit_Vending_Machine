// Mock of the public incident report (FE 8.2, draft api-contract/drafts/incident-reports.yaml, backend 5.2).
// The multipart body arrives as a plain object (fetcher.ts turns FormData into { field: string | MockUploadedFile }).
// Reports are kept in store.incidentReports and, as the backend would (FE 8.3), each one opens an OPEN INCIDENT work
// ticket in store.tickets; orders, payments, inventory and machines never change (BR-15). GET /incident-reports is the
// admin read of W-12 ("Cần hoàn tiền" lists the flagged ones).
import { created, Form, MockHttpError, ok, paginate } from './http.ts'
import type { Route, HandlerContext } from './handlers.ts'
import type { MockStore, MockTicket } from './seed.ts'
import type { components } from '../drafts/incident-reports'

type D = components['schemas']
/** A file part of a multipart body, as fetcher.ts passes it to handlers (content is not kept). */
export interface MockUploadedFile { name: string; type: string; size: number }
export interface MockIncidentReport {
  id: string
  reportCode: string
  machineId: string
  machineCode: string
  orderId: string | null
  orderCode: string | null
  type: D['IncidentType']
  description: string | null
  contactPhone: string | null
  photo: MockUploadedFile | null
  /** The named order was PAID or DISPENSE_FAILED: the backend flags it for the admin (W-12) without changing it. */
  orderFlagged: boolean
  /** The INCIDENT work ticket opened for this report (FE 8.3). */
  ticketId: string | null
  createdAt: string
}

/** Title words of the INCIDENT ticket, as the server would write them (same labels as the public form). */
const TYPE_TITLES: Record<D['IncidentType'], string> = {
  PAID_NOT_RECEIVED: 'Đã trả tiền nhưng không nhận hàng', SPOILED_FRUIT: 'Trái cây hỏng', MACHINE_FAULT: 'Máy lỗi', OTHER: 'Khác',
}

export const INCIDENT_TYPES = ['PAID_NOT_RECEIVED', 'SPOILED_FRUIT', 'MACHINE_FAULT', 'OTHER'] as const
export const INCIDENT_RATE_LIMIT = 5
export const INCIDENT_RATE_WINDOW_MS = 60_000
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PHOTO_MAX_BYTES = 5 * 1024 * 1024
const FIELDS = ['machineCode', 'type', 'orderCode', 'description', 'contactPhone', 'photo'] as const
const ORDER_CODE = /^ORD-\d{8}-[A-Z0-9]{8}$/
const PHONE = /^0[35789]\d{8}$/

const isFile = (value: unknown): value is MockUploadedFile =>
  !!value && typeof value === 'object' && typeof (value as MockUploadedFile).type === 'string' && typeof (value as MockUploadedFile).size === 'number'
const code4 = () => Array.from({ length: 4 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('')

/** BR-32: every POST within the last minute counts (a refused 429 does not); the 6th gets 429. */
function rateLimit(ctx: HandlerContext) {
  const log = ctx.store.incidentRequestLog
  while (log.length && log[0] <= ctx.now - INCIDENT_RATE_WINDOW_MS) log.shift()
  if (log.length >= INCIDENT_RATE_LIMIT) throw new MockHttpError(429, 'Too many incident reports, try again later')
  log.push(ctx.now)
}

function createReport(ctx: HandlerContext) {
  rateLimit(ctx)
  const { store, now } = ctx
  const body = ctx.body as Record<string, unknown> | undefined
  const form = new Form(body, FIELDS)
  const machineCode = form.text('machineCode', 64).toUpperCase()
  const type = form.oneOf('type', INCIDENT_TYPES)
  const orderRaw = form.optionalText('orderCode', 32)
  const orderCode = orderRaw ? orderRaw.toUpperCase() : null
  if (orderCode && !ORDER_CODE.test(orderCode)) form.reject('orderCode', 'must match ORD-yyyyMMdd-XXXXXXXX')
  const description = form.optionalText('description', 500)
  const contactPhone = form.optionalText('contactPhone', 20)
  if (contactPhone && !PHONE.test(contactPhone)) form.reject('contactPhone', 'must be a Vietnamese mobile number')
  const rawPhoto = body?.photo
  const photo = rawPhoto === undefined || rawPhoto === null ? null : isFile(rawPhoto) ? rawPhoto : null
  if (rawPhoto !== undefined && rawPhoto !== null && !photo) form.reject('photo', 'must be a file')
  if (photo && !PHOTO_TYPES.includes(photo.type)) form.reject('photo', 'must be image/jpeg, image/png or image/webp')
  if (!form.errors.type && type === 'PAID_NOT_RECEIVED' && !orderCode && !form.errors.orderCode) form.reject('orderCode', 'is required for PAID_NOT_RECEIVED')
  if (!form.errors.type && type === 'OTHER' && !description && !form.errors.description) form.reject('description', 'is required for OTHER')
  form.done()
  if (photo && photo.size > PHOTO_MAX_BYTES) throw new MockHttpError(413, 'Photo larger than 5 MB')

  const machine = store.machines.find(candidate => candidate.code.toUpperCase() === machineCode)
  if (!machine) throw new MockHttpError(404, 'Machine not found', { machineCode: 'Machine not found' })
  const order = orderCode ? store.orders.find(candidate => candidate.orderCode === orderCode && candidate.machineId === machine.id) : undefined
  if (orderCode && !order) throw new MockHttpError(422, 'Order not found for this machine', { orderCode: 'Order not found for this machine' })

  const createdAt = new Date(now).toISOString()
  const day = createdAt.slice(0, 10).replaceAll('-', '') // same date convention as the mock's order codes
  let reportCode = `INC-${day}-${code4()}`
  while (store.incidentReports.some(report => report.reportCode === reportCode)) reportCode = `INC-${day}-${code4()}`
  const report: MockIncidentReport = {
    id: crypto.randomUUID(), reportCode, machineId: machine.id, machineCode: machine.code, orderId: order?.id ?? null, orderCode: order?.orderCode ?? null,
    type, description, contactPhone, photo: photo ? { name: photo.name, type: photo.type, size: photo.size } : null,
    orderFlagged: !!order && (order.status === 'PAID' || order.status === 'DISPENSE_FAILED'), ticketId: null, createdAt,
  }
  store.incidentReports.push(report)
  openIncidentTicket(store, report, machine.name ?? null)
  const receipt: D['IncidentReportReceipt'] = { reportCode, createdAt }
  return created(receipt)
}

/** Same transaction as the report on the backend: one OPEN INCIDENT ticket, no assignee, created by "Hệ thống". */
export function openIncidentTicket(store: MockStore, report: MockIncidentReport, machineName: string | null): MockTicket {
  const ticket: MockTicket = {
    id: crypto.randomUUID(), type: 'INCIDENT', status: 'OPEN', title: `Sự cố: ${TYPE_TITLES[report.type]} · máy ${report.machineCode}`.slice(0, 200),
    description: report.description, machineId: report.machineId, machineCode: report.machineCode, machineName, alertId: null, dueAt: null,
    assigneeId: null, assigneeName: null, createdById: null, createdByName: 'Hệ thống',
    assignedAt: null, assignedById: null, assignedByName: null, startedAt: null, startedById: null, startedByName: null,
    completedAt: null, completedById: null, completedByName: null, completionNote: null,
    cancelledAt: null, cancelledById: null, cancelledByName: null, cancelReason: null, createdAt: report.createdAt, updatedAt: report.createdAt,
    incidentReport: {
      id: report.id, reportCode: report.reportCode, type: report.type, orderId: report.orderId, orderCode: report.orderCode, orderFlagged: report.orderFlagged,
      description: report.description, contactPhone: report.contactPhone, hasPhoto: !!report.photo, photoUrl: null, createdAt: report.createdAt,
    },
  }
  store.tickets.push(ticket)
  report.ticketId = ticket.id
  return ticket
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A flagged report still waiting for the admin: its order holds a SUCCESS payment with no refund recorded (a refund
 * moves the payment to REFUNDED, so the report leaves the list by itself).
 */
export function stillToCheck(store: MockStore, report: MockIncidentReport): boolean {
  return report.orderFlagged && !!report.orderId && store.payments.some(payment => payment.orderId === report.orderId && payment.status === 'SUCCESS')
}

/** GET /incident-reports (draft, FE 8.3): REFUND_RECORD, newest first, optional flagged / type / machineId filters. */
function listReports(ctx: HandlerContext) {
  const { query, store } = ctx
  const errors: Record<string, string> = {}
  const flagged = query.get('flagged')
  if (flagged !== null && flagged !== 'true' && flagged !== 'false') errors.flagged = 'Must be true or false'
  const type = query.get('type')
  if (type && !(INCIDENT_TYPES as readonly string[]).includes(type)) errors.type = `Must be one of: ${INCIDENT_TYPES.join(', ')}`
  const machineId = query.get('machineId')
  if (machineId && !UUID.test(machineId)) errors.machineId = 'Must be a valid UUID'
  if (Object.keys(errors).length) throw new MockHttpError(400, 'Invalid request parameter', errors)
  const rows = store.incidentReports
    .filter(report => (flagged !== 'true' || stillToCheck(store, report)) && (!type || report.type === type) && (!machineId || report.machineId === machineId))
    .map(report => {
      const order = report.orderId ? store.orders.find(candidate => candidate.id === report.orderId) : undefined
      const row: D['IncidentReportResponse'] = {
        id: report.id, reportCode: report.reportCode, type: report.type, machineId: report.machineId, machineCode: report.machineCode,
        orderId: report.orderId, orderCode: report.orderCode, orderStatus: order?.status ?? null, orderTotalAmount: order?.totalAmount ?? null,
        orderFlagged: report.orderFlagged, description: report.description, contactPhone: report.contactPhone, hasPhoto: !!report.photo,
        ticketId: report.ticketId, createdAt: report.createdAt,
      }
      return row
    })
  return ok(paginate(rows, query, { sorts: { createdAt: row => row.createdAt }, defaultSort: 'createdAt,desc' }))
}

export const incidentReportRoutes: Route[] = [
  { method: 'POST', pattern: /^\/public\/incident-reports\/?$/, policy: 'public', handle: createReport },
  // REFUND_RECORD (ADMIN only), the permission of the screen that reads it (W-12).
  { method: 'GET', pattern: /^\/incident-reports\/?$/, policy: { draftPermission: 'REFUND_RECORD' }, handle: listReports },
]
