// FE 8.2: public incident report form (rules, multipart body, error mapping), its client call and the mock of
// api-contract/drafts/incident-reports.yaml.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { incidentReportsApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { incidentReportRoutes, INCIDENT_RATE_LIMIT, INCIDENT_RATE_WINDOW_MS } from '../src/api/mock/incident-reports.ts'
import { createStore } from '../src/api/mock/seed.ts'
import { resolvePage } from '../src/routing.ts'
import {
  buildIncidentForm, describeIncidentError, emptyDraft, firstErrorField, INCIDENT_TYPES, machineFromSearch, MSG46, MSG48, normalizePhone,
  PHOTO_MAX_BYTES, photoError, thankYouMessage, validateIncident,
} from '../src/features/incident/incident.ts'
import { jsonResponse } from './helpers.mjs'

const draft = patch => ({ ...emptyDraft('DEV-MACHINE-01'), ...patch })
const jpeg = (size = 1000, name = 'hop.jpg', type = 'image/jpeg') => new File([new Uint8Array(size)], name, { type })

test('the page lives at /bao-su-co, the path printed in the kiosk QR', () => {
  assert.equal(resolvePage('/bao-su-co'), 'incident')
  assert.equal(resolvePage('/bao-su-co/'), 'incident')
  assert.equal(resolvePage('/bao-su-co/x'), 'not-found')
})

test('the machine code comes from ?machine= of the QR, normalised; a missing or malformed one is null', () => {
  assert.equal(machineFromSearch('?machine=fv-hcm-001'), 'FV-HCM-001')
  assert.equal(machineFromSearch('?machine=%20DEV-MACHINE-01%20'), 'DEV-MACHINE-01')
  assert.equal(machineFromSearch(''), null)
  assert.equal(machineFromSearch('?machine='), null)
  assert.equal(machineFromSearch('?machine=<script>'), null)
  assert.equal(machineFromSearch(`?machine=${'A'.repeat(65)}`), null)
})

test('labels and requirements per incident type follow SRS 3.6.4', () => {
  assert.deepEqual(INCIDENT_TYPES.map(option => [option.value, option.label]), [
    ['PAID_NOT_RECEIVED', 'Đã trả tiền nhưng không nhận hàng'], ['SPOILED_FRUIT', 'Trái cây hỏng'], ['MACHINE_FAULT', 'Máy lỗi'], ['OTHER', 'Khác'],
  ])
  assert.deepEqual(INCIDENT_TYPES.filter(option => option.orderRequired).map(option => option.value), ['PAID_NOT_RECEIVED'])
  assert.deepEqual(INCIDENT_TYPES.filter(option => option.descriptionRequired).map(option => option.value), ['OTHER'])
})

test('required fields change with the type', () => {
  assert.deepEqual(Object.keys(validateIncident(draft({}))), ['type'])
  assert.deepEqual(Object.keys(validateIncident(draft({ type: 'PAID_NOT_RECEIVED' }))), ['orderCode'])
  assert.deepEqual(Object.keys(validateIncident(draft({ type: 'OTHER' }))), ['description'])
  assert.deepEqual(validateIncident(draft({ type: 'SPOILED_FRUIT' })), {})
  assert.deepEqual(validateIncident(draft({ type: 'MACHINE_FAULT' })), {})
  assert.deepEqual(validateIncident(draft({ type: 'PAID_NOT_RECEIVED', orderCode: ' ord-20261109-ab12cd34 ' })), {})
  assert.deepEqual(validateIncident(draft({ type: 'OTHER', description: '  Màn hình tắt  ' })), {})
})

test('optional fields are still checked when filled', () => {
  const errors = validateIncident(draft({ machineCode: '', type: 'MACHINE_FAULT', orderCode: 'ORD-123', description: 'x'.repeat(501), contactPhone: '12345', photo: jpeg(10, 'a.gif', 'image/gif') }))
  assert.deepEqual(Object.keys(errors), ['machineCode', 'orderCode', 'description', 'contactPhone', 'photo'])
  assert.equal(firstErrorField(errors), 'machineCode')
  assert.match(validateIncident(draft({ machineCode: 'MÁY 1', type: 'OTHER', description: 'a' })).machineCode, /chữ, số/)
})

test('Vietnamese mobile numbers are normalised to 0 + 9 digits', () => {
  assert.equal(normalizePhone('0912 345 678'), '0912345678')
  assert.equal(normalizePhone('+84 912.345.678'), '0912345678')
  assert.equal(normalizePhone('84912345678'), '0912345678')
  assert.equal(normalizePhone('0312-345-678'), '0312345678')
  assert.equal(normalizePhone('0212345678'), null) // landline prefix
  assert.equal(normalizePhone('091234567'), null)
  assert.equal(normalizePhone('abc'), null)
})

test('one JPEG/PNG/WebP photo up to 5 MB is accepted', () => {
  assert.equal(photoError(null), undefined)
  assert.equal(photoError(jpeg()), undefined)
  assert.equal(photoError({ type: 'image/png', size: PHOTO_MAX_BYTES }), undefined)
  assert.match(photoError({ type: 'image/webp', size: PHOTO_MAX_BYTES + 1 }), /5 MB/)
  assert.match(photoError({ type: 'image/heic', size: 10 }), /JPG, PNG hoặc WebP/)
  assert.match(photoError({ type: 'image/jpeg', size: 0 }), /trống/)
})

test('the multipart body carries only contract fields, normalised, blanks left out', () => {
  const photo = jpeg(20)
  const form = buildIncidentForm(draft({ machineCode: ' dev-machine-01 ', type: 'PAID_NOT_RECEIVED', orderCode: 'ord-20261109-ab12cd34', description: '  ', contactPhone: '+84 912 345 678', photo }))
  assert.deepEqual([...form.keys()].sort(), ['contactPhone', 'machineCode', 'orderCode', 'photo', 'type'])
  assert.equal(form.get('machineCode'), 'DEV-MACHINE-01')
  assert.equal(form.get('orderCode'), 'ORD-20261109-AB12CD34')
  assert.equal(form.get('contactPhone'), '0912345678')
  assert.equal(form.get('photo').name, 'hop.jpg')
  const minimal = buildIncidentForm(draft({ type: 'MACHINE_FAULT' }))
  assert.deepEqual([...minimal.keys()].sort(), ['machineCode', 'type'])
})

test('API errors land on the right field or on the form', () => {
  const rate = describeIncidentError(new ApiError(429, 'Yêu cầu không hợp lệ.'))
  assert.deepEqual(rate, { fieldErrors: {}, message: MSG48, focus: 'form', rateLimited: true })

  const order = describeIncidentError(new ApiError(422, 'x', { orderCode: 'Order not found for this machine' }))
  assert.deepEqual(order.fieldErrors, { orderCode: MSG46 })
  assert.equal(order.focus, 'orderCode')
  assert.equal(order.message, '')
  assert.deepEqual(describeIncidentError(new ApiError(404, 'x', { orderCode: 'x' })).fieldErrors, { orderCode: MSG46 })

  const machine = describeIncidentError(new ApiError(404, 'Không tìm thấy dữ liệu yêu cầu.'))
  assert.equal(machine.focus, 'machineCode')
  assert.match(machine.fieldErrors.machineCode, /Không tìm thấy máy/)

  const invalid = describeIncidentError(new ApiError(400, 'Validation Failed', { description: 'size must be between 0 and 500', contactPhone: 'must match' }))
  assert.deepEqual(Object.keys(invalid.fieldErrors), ['description', 'contactPhone'])
  assert.equal(invalid.focus, 'description')
  assert.equal(invalid.message, '')
  assert.doesNotMatch(Object.values(invalid.fieldErrors).join(' '), /must|size/) // never the backend's English text

  const unknownField = describeIncidentError(new ApiError(400, 'x', { somethingElse: 'bad' }))
  assert.equal(unknownField.focus, 'form')
  assert.ok(unknownField.message)

  assert.equal(describeIncidentError(new ApiError(413, 'x')).focus, 'photo')
  assert.match(describeIncidentError(new ApiError(500, 'Hệ thống đang gặp sự cố. Vui lòng thử lại.')).message, /vẫn được giữ/)
  assert.match(describeIncidentError(new ApiError(0, 'Không thể kết nối đến hệ thống.')).message, /Không thể kết nối/)
  assert.equal(describeIncidentError(new Error('boom')).focus, 'form')
})

test('MSG47 names the report code', () => {
  assert.equal(thankYouMessage('INC-20261109-7KQ2'), 'Cảm ơn bạn. Mã báo cáo của bạn là INC-20261109-7KQ2.')
})

test('the client posts the FormData as is, without Authorization nor a JSON content type', async () => {
  let seen
  configureClient({ baseUrl: '', getToken: () => 'admin-token', fetcher: async (url, init) => { seen = { url, init }; return jsonResponse(201, { data: { reportCode: 'INC-20261109-7KQ2', createdAt: '2026-11-09T06:05:00Z' } }) } })
  const form = buildIncidentForm(draft({ type: 'MACHINE_FAULT' }))
  const receipt = await incidentReportsApi.create(form)
  assert.equal(seen.url, '/api/v1/public/incident-reports')
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.body, form)
  assert.equal(seen.init.headers.Authorization, undefined)
  assert.equal(seen.init.headers['Content-Type'], undefined)
  assert.equal(receipt.reportCode, 'INC-20261109-7KQ2')
})

// ---- mock

function mock() {
  const state = { clock: Date.now() }
  const fetcher = createMockFetcher(parseSelection('incident-reports'), { now: () => state.clock, realFetch: async () => { throw new Error('real network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => null })
  return state
}
const fails = (status, check = () => true) => error => error instanceof ApiError && error.status === status && check(error)
const send = patch => incidentReportsApi.create(buildIncidentForm(draft(patch)))

test('the public report has its own mock group and needs no sign-in', async () => {
  assert.equal(groupOf('/public/incident-reports'), 'incident-reports')
  mock()
  const receipt = await send({ type: 'MACHINE_FAULT', description: 'Màn hình đen', photo: jpeg(2048) })
  assert.match(receipt.reportCode, /^INC-\d{8}-[A-Z0-9]{4}$/)
  assert.ok(Number.isFinite(Date.parse(receipt.createdAt)))
})

test('mock: order code must belong to the machine (422 orderCode), unknown machine is 404, missing fields are 400', async () => {
  const store = createStore(Date.now())
  const own = store.orders.find(order => order.machineCode === 'DEV-MACHINE-01').orderCode
  const other = store.orders.find(order => order.machineCode === 'DEV-MACHINE-02').orderCode
  mock()
  assert.ok(await send({ type: 'PAID_NOT_RECEIVED', orderCode: own.toLowerCase() }))
  await assert.rejects(send({ type: 'PAID_NOT_RECEIVED', orderCode: other }), fails(422, error => !!error.fieldErrors.orderCode))
  await assert.rejects(send({ machineCode: 'NO-SUCH-MACHINE', type: 'MACHINE_FAULT' }), fails(404, error => !!error.fieldErrors.machineCode))
  mock()
  const form = new FormData()
  form.set('machineCode', 'DEV-MACHINE-01')
  form.set('type', 'OTHER')
  await assert.rejects(incidentReportsApi.create(form), fails(400, error => Object.keys(error.fieldErrors).join() === 'description'))
  form.set('type', 'PAID_NOT_RECEIVED')
  await assert.rejects(incidentReportsApi.create(form), fails(400, error => Object.keys(error.fieldErrors).join() === 'orderCode'))
  form.set('refund', 'yes')
  await assert.rejects(incidentReportsApi.create(form), fails(400, error => 'refund' in error.fieldErrors))
})

test('mock: photo must be an image of at most 5 MB', async () => {
  mock()
  await assert.rejects(send({ type: 'MACHINE_FAULT', photo: jpeg(10, 'a.gif', 'image/gif') }), fails(400, error => !!error.fieldErrors.photo))
  await assert.rejects(send({ type: 'MACHINE_FAULT', photo: jpeg(PHOTO_MAX_BYTES + 1) }), fails(413))
})

test('mock: the 6th request within a minute gets 429, the window then frees up (BR-32)', async () => {
  const state = mock()
  for (let n = 0; n < INCIDENT_RATE_LIMIT; n += 1) {
    // Invalid requests count too.
    if (n === 0) await assert.rejects(send({ type: 'OTHER' }), fails(400))
    else await send({ type: 'MACHINE_FAULT' })
  }
  await assert.rejects(send({ type: 'MACHINE_FAULT' }), fails(429))
  state.clock += INCIDENT_RATE_WINDOW_MS - 1
  await assert.rejects(send({ type: 'MACHINE_FAULT' }), fails(429))
  state.clock += 2
  assert.ok(await send({ type: 'MACHINE_FAULT' }))
})

test('mock: a report is stored, flags a PAID/DISPENSE_FAILED order and changes nothing else (BR-15)', () => {
  const now = Date.now()
  const store = createStore(now)
  const failed = store.orders.find(order => order.machineCode === 'DEV-MACHINE-01' && order.status === 'DISPENSE_FAILED')
  const before = JSON.stringify({ orders: store.orders, payments: store.payments, machines: store.machines, items: store.items })
  const [route] = incidentReportRoutes
  const reply = route.handle({ store, now, params: {}, query: new URLSearchParams(), body: { machineCode: 'dev-machine-01', type: 'PAID_NOT_RECEIVED', orderCode: failed.orderCode, contactPhone: '0912345678', photo: { name: 'a.jpg', type: 'image/jpeg', size: 10 } }, user: undefined, machineId: '', options: {} })
  assert.equal(reply.status, 201)
  assert.equal(route.policy, 'public')
  assert.equal(store.incidentReports.length, 1)
  const [report] = store.incidentReports
  assert.equal(report.reportCode, reply.data.reportCode)
  assert.equal(report.machineCode, 'DEV-MACHINE-01')
  assert.equal(report.orderId, failed.id)
  assert.equal(report.orderFlagged, true)
  assert.deepEqual(report.photo, { name: 'a.jpg', type: 'image/jpeg', size: 10 })
  assert.equal(JSON.stringify({ orders: store.orders, payments: store.payments, machines: store.machines, items: store.items }), before)
})
