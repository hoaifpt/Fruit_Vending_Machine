// Mock of the public incident report (FE 8.2, draft api-contract/drafts/incident-reports.yaml, backend 5.2).
// The multipart body arrives as a plain object (fetcher.ts turns FormData into { field: string | MockUploadedFile }).
// Reports are kept in store.incidentReports; nothing else in the store changes (BR-15).
import { created, Form, MockHttpError } from './http.ts'
import type { Route, HandlerContext } from './handlers.ts'
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
  createdAt: string
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
  store.incidentReports.push({
    id: crypto.randomUUID(), reportCode, machineId: machine.id, machineCode: machine.code, orderId: order?.id ?? null, orderCode: order?.orderCode ?? null,
    type, description, contactPhone, photo: photo ? { name: photo.name, type: photo.type, size: photo.size } : null,
    orderFlagged: !!order && (order.status === 'PAID' || order.status === 'DISPENSE_FAILED'), createdAt,
  })
  const receipt: D['IncidentReportReceipt'] = { reportCode, createdAt }
  return created(receipt)
}

export const incidentReportRoutes: Route[] = [
  { method: 'POST', pattern: /^\/public\/incident-reports\/?$/, policy: 'public', handle: createReport },
]
