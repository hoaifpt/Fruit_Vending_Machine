// FE 8.2: public customer report form on the real API of backend #74 (api.yaml, docs/customer-reports.md): the route
// /report/{reportToken}, form rules, the multipart body (part `report` JSON + `photos`), error mapping (400, 404 token,
// 413, 422, 429 Retry-After), the client calls, and the mock of GET /public/report-forms/{token} and
// POST /public/report-forms/{token}/reports (token, validation, photos by content, honeypot, rate limits, verdicts).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient, retryAfterOf } from '../src/api/client.ts'
import { authApi, customerReportsApi, ordersApi, publicReportsApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { REPORT_LIMITS, photoSize, seedReportToken } from '../src/api/mock/customer-reports.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { resolvePage } from '../src/routing.ts'
import {
  GONE_MESSAGE, MSG48, REPORT_TYPES, buildReportForm, describeIncidentError, draftFromSearch, emptyDraft, firstErrorField, formLoadProblem, limitsOf, normalizePhone,
  offeredTypes, photoError, reportBody, thankYouMessage, tokenFromPath, validateIncident, waitText,
} from '../src/features/incident/incident.ts'
import { jsonResponse } from './helpers.mjs'

const TOKEN_1 = seedReportToken('DEV-MACHINE-01'), TOKEN_3 = seedReportToken('DEV-MACHINE-03')
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const draft = patch => ({ ...emptyDraft(), consent: true, ...patch })
/** A PNG whose IHDR says width × height (the mock reads the header like the backend, before decoding). */
function png(width = 800, height = 600, size = 64) {
  const bytes = new Uint8Array(Math.max(size, 33))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}
function jpeg(width = 800, height = 600, size = 64) {
  const bytes = new Uint8Array(Math.max(size, 20))
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08])
  new DataView(bytes.buffer).setUint16(7, height); new DataView(bytes.buffer).setUint16(9, width)
  return bytes
}
const file = (bytes, name = 'hop.jpg', type = 'image/jpeg') => new File([bytes], name, { type })

// ---- route and token

test('the form lives at /report/{token} (PUBLIC_REPORT_BASE_URL); /report and the former /bao-su-co explain to scan the QR', () => {
  for (const path of [`/report/${TOKEN_1}`, `/report/${TOKEN_1}/`, '/report', '/bao-su-co']) assert.equal(resolvePage(path), 'incident', path)
  assert.equal(resolvePage(`/report/${TOKEN_1}/x`), 'not-found')
  assert.equal(tokenFromPath(`/report/${TOKEN_1}`), TOKEN_1)
  assert.equal(tokenFromPath('/report/Q2x9-_abc'), 'Q2x9-_abc')
  for (const bad of ['/report', '/report/', '/report/a%20b', '/report/<script>', '/bao-su-co', `/report/${'a'.repeat(65)}`, '/report/%E0%A4%A']) assert.equal(tokenFromPath(bad), '', bad)
})

test('the kiosk\'s ?order= pre-selects "Đã trả tiền nhưng không nhận hàng"; a malformed order is ignored', () => {
  assert.deepEqual(draftFromSearch('?order=ord-20261109-ab12cd34'), { ...emptyDraft(), type: 'PAID_NOT_RECEIVED', orderCode: 'ORD-20261109-AB12CD34' })
  for (const bad of ['', '?order=', '?order=<script>', '?order=ORD-1']) assert.deepEqual(draftFromSearch(bad), emptyDraft(), bad)
})

// ---- rules

test('the four types of the backend and what each requires; the form offers the types the server lists', () => {
  assert.deepEqual(REPORT_TYPES.map(option => option.value), ['PAID_NOT_RECEIVED', 'PRODUCT_QUALITY', 'MACHINE_FAULT', 'OTHER'])
  assert.deepEqual(REPORT_TYPES.filter(option => option.orderRequired).map(option => option.value), ['PAID_NOT_RECEIVED'])
  assert.deepEqual(REPORT_TYPES.filter(option => !option.descriptionRequired).map(option => option.value), ['PAID_NOT_RECEIVED'])
  assert.deepEqual(REPORT_TYPES.filter(option => option.contactRequired).map(option => option.value), ['PAID_NOT_RECEIVED', 'PRODUCT_QUALITY'])
  assert.deepEqual(offeredTypes({ types: ['OTHER', 'NEW_KIND', 'MACHINE_FAULT'] }).map(option => option.value), ['OTHER', 'MACHINE_FAULT'])
  assert.equal(offeredTypes(undefined).length, 4)
  assert.deepEqual(limitsOf({ maxPhotos: 2, maxPhotoBytes: 1000 }), { maxPhotos: 2, maxPhotoBytes: 1000 })
  assert.deepEqual(limitsOf({ maxPhotos: 0 }), { maxPhotos: 3, maxPhotoBytes: 2 * 1024 * 1024 })
})

test('required fields change with the type; contact for money and quality; consent always', () => {
  assert.deepEqual(Object.keys(validateIncident(draft({}))), ['type'])
  assert.deepEqual(Object.keys(validateIncident(draft({ type: 'PAID_NOT_RECEIVED' }))).sort(), ['contactPhone', 'orderCode'])
  assert.deepEqual(validateIncident(draft({ type: 'PAID_NOT_RECEIVED', orderCode: ' ord-20261109-ab12cd34 ', contactEmail: 'An@Example.com' })), {})
  assert.deepEqual(Object.keys(validateIncident(draft({ type: 'PRODUCT_QUALITY', contactPhone: '0912345678' }))), ['description'])
  assert.deepEqual(Object.keys(validateIncident(draft({ type: 'MACHINE_FAULT' }))), ['description'])
  assert.deepEqual(validateIncident(draft({ type: 'MACHINE_FAULT', description: 'Màn hình đen' })), {})
  assert.deepEqual(Object.keys(validateIncident({ ...draft({ type: 'OTHER', description: 'x' }), consent: false })), ['consent'])
  const errors = validateIncident(draft({ type: 'OTHER', orderCode: 'ORD-123', description: 'x'.repeat(1001), contactName: 'n'.repeat(101), contactPhone: '12345', contactEmail: 'a@b' }))
  assert.deepEqual(Object.keys(errors), ['orderCode', 'description', 'contactName', 'contactPhone', 'contactEmail'])
  assert.equal(firstErrorField(errors), 'orderCode')
})

test('phone numbers as the backend accepts them: 0 or +84 then 9–10 digits, separators removed', () => {
  assert.equal(normalizePhone('0912 345 678'), '0912345678')
  assert.equal(normalizePhone('+84 912.345.678'), '+84912345678')
  assert.equal(normalizePhone('(028) 3822-1234'), '02838221234')
  assert.equal(normalizePhone('84912345678'), null)
  assert.equal(normalizePhone('091234567'), null)
  assert.equal(normalizePhone('abc'), null)
})

test('photos: at most 3 JPG/PNG of at most 2 MB each (limits from the server)', () => {
  assert.equal(photoError(null), undefined)
  assert.equal(photoError(file(jpeg())), undefined)
  assert.equal(photoError({ type: 'image/png', size: 2 * 1024 * 1024 }), undefined)
  assert.match(photoError({ type: 'image/png', size: 2 * 1024 * 1024 + 1 }), /2 MB/)
  assert.match(photoError({ type: 'image/png', size: 1001 }, 1000), /lớn hơn/)
  assert.match(photoError({ type: 'image/webp', size: 10 }), /JPG hoặc PNG/)
  assert.match(photoError({ type: 'image/jpeg', size: 0 }), /trống/)
  const four = Array.from({ length: 4 }, () => file(jpeg()))
  assert.match(validateIncident(draft({ type: 'OTHER', description: 'x', photos: four })).photos, /Tối đa 3 ảnh/)
  assert.match(validateIncident(draft({ type: 'OTHER', description: 'x', photos: [file(jpeg())] }), { maxPhotos: 0, maxPhotoBytes: 10 }).photos, /Tối đa 0 ảnh/)
})

test('the multipart body: part `report` (application/json, contract fields only, normalised) and one `photos` part per photo', async () => {
  const photos = [file(jpeg(), 'a.jpg'), file(png(), 'b.png', 'image/png')]
  const value = draft({ type: 'PAID_NOT_RECEIVED', orderCode: 'ord-20261109-ab12cd34', description: '  ', contactName: ' An ', contactPhone: '+84 912 345 678', contactEmail: ' ', photos })
  assert.deepEqual(reportBody(value), { type: 'PAID_NOT_RECEIVED', orderCode: 'ORD-20261109-AB12CD34', contactName: 'An', contactPhone: '+84912345678', consent: true })
  const form = buildReportForm(value)
  assert.deepEqual([...form.keys()], ['report', 'photos', 'photos'])
  const report = form.get('report')
  assert.equal(report.type, 'application/json')
  assert.deepEqual(JSON.parse(await report.text()), reportBody(value))
  assert.deepEqual(form.getAll('photos').map(part => part.name), ['a.jpg', 'b.png'])
  // A bot filling the hidden field sends it, so the server can drop the report.
  assert.equal(reportBody(draft({ type: 'OTHER', description: 'x', website: 'spam.example' })).website, 'spam.example')
})

test('API errors land on the right field, on the form, or replace the form (rotated QR)', () => {
  const rate = describeIncidentError(new ApiError(429, 'x', {}, 45))
  assert.deepEqual([rate.rateLimited, rate.retryAfterSeconds, rate.focus], [true, 45, 'form'])
  assert.equal(rate.message, 'Bạn gửi quá nhiều báo cáo. Vui lòng thử lại sau 45 giây.')
  assert.equal(waitText(undefined), MSG48)
  assert.match(waitText(150), /sau 3 phút/)
  const gone = describeIncidentError(new ApiError(404, 'x'))
  assert.deepEqual([gone.gone, gone.message], [true, GONE_MESSAGE])
  assert.equal(describeIncidentError(new ApiError(413, 'x')).focus, 'photos')
  assert.equal(describeIncidentError(new ApiError(422, 'x')).focus, 'photos')
  const invalid = describeIncidentError(new ApiError(400, 'Validation Failed', { description: 'size must be between 1 and 1000', 'photos[1]': 'must be a JPEG or PNG image', contactPhone: 'x' }))
  assert.deepEqual(Object.keys(invalid.fieldErrors), ['description', 'photos', 'contactPhone'])
  assert.equal(invalid.focus, 'description')
  assert.equal(invalid.message, '')
  assert.doesNotMatch(Object.values(invalid.fieldErrors).join(' '), /must|size/)
  const unknownField = describeIncidentError(new ApiError(400, 'x', { somethingElse: 'bad' }))
  assert.equal(unknownField.focus, 'form')
  assert.ok(unknownField.message)
  assert.match(describeIncidentError(new ApiError(500, 'Hệ thống đang gặp sự cố. Vui lòng thử lại.')).message, /vẫn được giữ/)
  assert.match(describeIncidentError(new ApiError(0, 'Không thể kết nối đến hệ thống.')).message, /Không thể kết nối/)
  assert.equal(describeIncidentError(new Error('boom')).focus, 'form')
  assert.deepEqual(formLoadProblem(new ApiError(404, 'x')), { kind: 'gone' })
  assert.deepEqual(formLoadProblem(new ApiError(429, 'x', {}, 12)), { kind: 'busy', retryAfterSeconds: 12 })
  assert.equal(formLoadProblem(new ApiError(500, 'Hệ thống đang gặp sự cố.')).kind, 'failed')
  assert.equal(thankYouMessage('RPT-20261114-7KQ2'), 'Cảm ơn bạn. Mã báo cáo của bạn là RPT-20261114-7KQ2.')
})

test('the client: GET form and POST report without Authorization, FormData as is; Retry-After of a 429 is kept', async () => {
  const seen = []
  configureClient({ baseUrl: '', getToken: () => 'admin-token', fetcher: async (url, init) => {
    seen.push({ url, init })
    if (init.method === 'GET') return jsonResponse(200, { data: { machineName: 'Máy 1', machineCode: 'DEV-MACHINE-01', types: ['OTHER'], maxPhotos: 3, maxPhotoBytes: 2097152 } })
    return jsonResponse(201, { data: { reportCode: 'RPT-20261114-7KQ2', message: 'Report received' } })
  } })
  assert.equal((await publicReportsApi.form(TOKEN_1)).machineCode, 'DEV-MACHINE-01')
  const form = buildReportForm(draft({ type: 'OTHER', description: 'x' }))
  assert.equal((await publicReportsApi.submit(TOKEN_1, form)).reportCode, 'RPT-20261114-7KQ2')
  assert.deepEqual(seen.map(call => [call.init.method, call.url]), [['GET', `/api/v1/public/report-forms/${TOKEN_1}`], ['POST', `/api/v1/public/report-forms/${TOKEN_1}/reports`]])
  assert.equal(seen[1].init.body, form)
  for (const call of seen) assert.equal(call.init.headers.Authorization, undefined)
  assert.equal(seen[1].init.headers['Content-Type'], undefined)
  configureClient({ fetcher: async () => new Response(JSON.stringify({ status: 429, message: 'Too many' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '37' } }) })
  await assert.rejects(publicReportsApi.form(TOKEN_1), error => error instanceof ApiError && error.status === 429 && error.retryAfterSeconds === 37)
  assert.equal(retryAfterOf(' 12 '), 12)
  assert.equal(retryAfterOf('Wed, 21 Oct 2026 07:28:00 GMT'), undefined)
})

// ---- mock

function mock(group = 'customer-reports') {
  const state = { clock: Date.parse('2026-11-30T03:00:00Z'), token: null }
  const fetcher = createMockFetcher(parseSelection(group), { now: () => state.clock, realFetch: async () => { throw new Error('real network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return { state, fetcher }
}
const fails = (status, check = () => true) => error => error instanceof ApiError && error.status === status && check(error)
const send = (patch, token = TOKEN_1) => publicReportsApi.submit(token, buildReportForm(draft(patch)))
/** A raw report part, to send what the form would never build. */
function rawForm(report, photos = []) {
  const form = new FormData()
  form.append('report', new Blob([JSON.stringify(report)], { type: 'application/json' }))
  for (const photo of photos) form.append('photos', photo)
  return form
}

test('mock: groups; the form of a token names its machine; an unknown, rotated or INACTIVE machine token is 404', async () => {
  assert.equal(groupOf(`/public/report-forms/${TOKEN_1}`), 'customer-reports')
  assert.equal(groupOf(`/public/report-forms/${TOKEN_1}/reports`), 'customer-reports')
  assert.equal(groupOf('/kiosk/incident-report-link'), 'customer-reports')
  assert.equal(groupOf(`/machines/${id('20000000', 1)}/report-token/rotate`), 'customer-reports')
  assert.equal(groupOf('/customer-reports'), 'customer-reports')
  mock()
  assert.deepEqual(await publicReportsApi.form(TOKEN_1), { machineName: 'Development fruit machine', machineCode: 'DEV-MACHINE-01', types: ['PAID_NOT_RECEIVED', 'PRODUCT_QUALITY', 'MACHINE_FAULT', 'OTHER'], maxPhotos: 3, maxPhotoBytes: 2097152 })
  await assert.rejects(publicReportsApi.form('unknown-token-0000000000'), fails(404))
  await assert.rejects(publicReportsApi.form(TOKEN_3), fails(404), 'INACTIVE machine')
  await assert.rejects(send({ type: 'OTHER', description: 'x' }, TOKEN_3), fails(404))
})

test('mock: the same receipt for every accepted report; validation 400 per field, unknown fields refused', async () => {
  mock()
  const receipt = await send({ type: 'MACHINE_FAULT', description: 'Màn hình đen' })
  assert.match(receipt.reportCode, /^RPT-\d{8}-[0-9A-Z]{4}$/)
  assert.equal(receipt.message, 'Report received')
  const fields = (...names) => error => names.every(name => !!error.fieldErrors[name])
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm({ type: 'OTHER', consent: true })), fails(400, fields('description')))
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm({ type: 'PAID_NOT_RECEIVED', consent: true, contactPhone: '0912345678' })), fails(400, fields('orderCode')))
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm({ type: 'PRODUCT_QUALITY', description: 'Dập', consent: true })), fails(400, fields('contactPhone')))
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm({ type: 'OTHER', description: 'x', consent: false })), fails(400, fields('consent')))
  mock()
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm({ type: 'OTHER', description: 'x', consent: true, contactPhone: '12345', contactEmail: 'a@b' })), fails(400, fields('contactPhone', 'contactEmail')))
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm({ type: 'OTHER', description: 'x', consent: true, refund: true })), fails(400, fields('refund')))
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm({ type: 'LOST', description: 'x', consent: true })), fails(400, fields('type')))
})

test('mock: photos are checked by content (JPEG/PNG magic bytes), size, pixels and count; the whole request above 7 MB is 413', async () => {
  assert.deepEqual(photoSize(png(1200, 900)), { width: 1200, height: 900 })
  assert.deepEqual(photoSize(jpeg(640, 480)), { width: 640, height: 480 })
  mock()
  const ok = { type: 'OTHER', description: 'Khay bẩn', consent: true }
  assert.ok(await publicReportsApi.submit(TOKEN_1, rawForm(ok, [file(png(), 'x.txt', 'text/plain')])), 'the declared type is ignored, the bytes count')
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm(ok, [file(new Uint8Array([1, 2, 3, 4]), 'a.jpg')]))
    , fails(400, error => !!error.fieldErrors['photos[0]']))
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm(ok, [file(jpeg(), 'a.jpg'), file(jpeg(4001, 10), 'big.jpg')])), fails(400, error => !!error.fieldErrors['photos[1]']))
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm(ok, [file(jpeg(100, 100, REPORT_LIMITS.maxPhotoBytes + 1))])), fails(400, error => !!error.fieldErrors['photos[0]']))
  mock()
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm(ok, Array.from({ length: 4 }, () => file(jpeg())))), fails(400, error => !!error.fieldErrors.photos))
  await assert.rejects(publicReportsApi.submit(TOKEN_1, rawForm(ok, Array.from({ length: 4 }, () => file(jpeg(100, 100, 2 * 1024 * 1024))))), fails(413))
})

test('mock: 5 submissions a minute per source (counted before validation), 429 with Retry-After, then free again', async () => {
  const { state } = mock()
  for (let n = 0; n < REPORT_LIMITS.perMinute; n += 1) {
    if (n === 0) await assert.rejects(send({ type: 'OTHER' }), fails(400))
    else await send({ type: 'MACHINE_FAULT', description: 'x' })
  }
  await assert.rejects(send({ type: 'MACHINE_FAULT', description: 'x' }), fails(429, error => error.retryAfterSeconds > 0 && error.retryAfterSeconds <= 60))
  state.clock += 60_000 - 1
  await assert.rejects(send({ type: 'MACHINE_FAULT', description: 'x' }), fails(429))
  state.clock += 2
  assert.ok(await send({ type: 'MACHINE_FAULT', description: 'x' }))
})

test('mock: the honeypot is accepted with the same answer and nothing is stored', async () => {
  const { state } = mock('all')
  const receipt = await send({ type: 'OTHER', description: 'buy now', website: 'spam.example' })
  assert.match(receipt.reportCode, /^RPT-/)
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin })).accessToken
  assert.equal((await customerReportsApi.list({ page: 0, size: 20 })).totalElements, 0)
})

test('mock: each report checks its order on this machine (verdict, batch of the sold bowl); the receipt never tells', async () => {
  const { state } = mock('all')
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin })).accessToken
  const codeOf = async orderId => (await ordersApi.get(orderId)).orderCode
  const failed = await codeOf(id('90000000', 8)), paid = await codeOf(id('90000000', 6)), done = await codeOf(id('90000000', 2)), other = await codeOf(id('93000000', 1))
  const token = state.token
  state.token = null
  const contact = { contactPhone: '0912345678' }
  const receipts = [
    await send({ type: 'PAID_NOT_RECEIVED', orderCode: failed, ...contact }),
    await send({ type: 'PAID_NOT_RECEIVED', orderCode: paid, ...contact }),
    await send({ type: 'PRODUCT_QUALITY', orderCode: done, description: 'Dưa bị dập', ...contact }),
    await send({ type: 'PAID_NOT_RECEIVED', orderCode: other, ...contact }),
  ]
  state.clock += 60_000
  receipts.push(await send({ type: 'MACHINE_FAULT', description: 'Màn hình đen' }))
  assert.deepEqual(new Set(receipts.map(receipt => receipt.message)).size, 1)
  state.token = token
  const rows = (await customerReportsApi.list({ page: 0, size: 20 })).content
  const verdict = code => rows.find(row => row.code === code).verdict
  assert.deepEqual(receipts.map(receipt => verdict(receipt.reportCode)), ['REFUND_ELIGIBLE', 'DISPENSE_PENDING', 'DELIVERED_PER_MACHINE', 'ORDER_NOT_FOUND', 'NOT_APPLICABLE'])
  const quality = await customerReportsApi.get(rows.find(row => row.code === receipts[2].reportCode).id)
  assert.ok(quality.batch?.batchCode, 'batch of the sold bowl')
  assert.equal(quality.order.status, 'COMPLETED')
  assert.equal(rows.find(row => row.code === receipts[3].reportCode).orderId, undefined, "another machine's order is not found")
})
