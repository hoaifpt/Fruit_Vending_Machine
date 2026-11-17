// fieldErrors keys as the backend sends them: field names (body validation) or Java paths of method validation
// (`update.request.percent`, `complete.request.lineVariances[0].reason`, `addNote.request.note`; e2e-real/cases
// inventory.md L-01, staff.md BE-1, admin.md L-04). Both land under the same field, never with English text on screen.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { INVALID_REQUEST, fieldMessageVi, isValidationFailedMessage, listFieldOf, normalizeFieldErrors, normalizeFieldKey } from '../src/api/field-errors.ts'
import { CHECK_FIELDS, ValidationError, describeFormFailure } from '../src/admin/form-error.ts'
import { PLAN_LINE_MAX, RESULT_REQUIRED, VARIANCE_REQUIRED, describeCompleteError, describePlanError, reconcile, varianceField } from '../src/admin/restock.ts'
import { authApi, pricingApi, workOrdersApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { jsonResponse } from './helpers.mjs'

test('normalizeFieldKey: method path → field; a list index is kept from the list on', () => {
  assert.equal(normalizeFieldKey('update.request.percent'), 'percent')
  assert.equal(normalizeFieldKey('addNote.request.note'), 'note')
  assert.equal(normalizeFieldKey('create.request.intervalDays'), 'intervalDays')
  assert.equal(normalizeFieldKey('addLine.input.plannedQuantity'), 'plannedQuantity')
  assert.equal(normalizeFieldKey('complete.request.lineVariances[0].reason'), 'lineVariances[0].reason')
  assert.equal(normalizeFieldKey('lineVariances[3].reason'), 'lineVariances[3].reason')
  assert.equal(normalizeFieldKey('photos[0]'), 'photos[0]')
  assert.equal(normalizeFieldKey('quantity'), 'quantity')
})

test('normalizeFieldErrors keeps the first message when two keys meet; listFieldOf reads the row', () => {
  assert.deepEqual(normalizeFieldErrors({ 'update.request.percent': 'must be greater than or equal to 1', percent: 'other', 'update.request.version': 'must not be null' }),
    { percent: 'must be greater than or equal to 1', version: 'must not be null' })
  assert.deepEqual(listFieldOf('complete.request.lineVariances[2].reason'), { list: 'lineVariances', index: 2, field: 'reason' })
  assert.deepEqual(listFieldOf('photos[1]'), { list: 'photos', index: 1, field: '' })
  assert.equal(listFieldOf('update.request.percent'), undefined)
})

test('fieldMessageVi: English bean-validation lines in Vietnamese, Vietnamese kept, unknown English neutral', () => {
  assert.equal(fieldMessageVi('must not be blank'), 'Không được để trống.')
  assert.equal(fieldMessageVi('size must be between 0 and 2000'), 'Tối đa 2000 ký tự.')
  assert.equal(fieldMessageVi('size must be between 3 and 50'), 'Từ 3 đến 50 ký tự.')
  assert.equal(fieldMessageVi('must be greater than or equal to 1'), 'Phải lớn hơn hoặc bằng 1.')
  assert.equal(fieldMessageVi('must be less than or equal to 90'), 'Phải nhỏ hơn hoặc bằng 90.')
  assert.equal(fieldMessageVi('Tối thiểu 12 ký tự.'), 'Tối thiểu 12 ký tự.')
  assert.equal(fieldMessageVi('something odd happened'), 'Giá trị chưa hợp lệ.')
  assert.ok(isValidationFailedMessage('Request validation failed'))
  assert.ok(isValidationFailedMessage('Validation failed.'))
  assert.ok(!isValidationFailedMessage('Unknown request field: hack'))
})

test('client: path keys are normalized and the generic English 400 line becomes Vietnamese', async () => {
  configureClient({ baseUrl: 'http://api.test', getToken: () => 'tok', onUnauthorized: () => {}, fetcher: async () => jsonResponse(400, {
    status: 400, error: 'Bad Request', message: 'Request validation failed', fieldErrors: { 'update.request.percent': 'must be greater than or equal to 1' },
  }) })
  await assert.rejects(pricingApi.update({ enabled: true, percent: 0, version: 0 }), error => {
    assert.ok(error instanceof ApiError)
    assert.deepEqual(error.fieldErrors, { percent: 'must be greater than or equal to 1' })
    assert.equal(error.message, INVALID_REQUEST)
    assert.deepEqual(describeFormFailure(error), { message: CHECK_FIELDS, fieldErrors: { percent: 'Phải lớn hơn hoặc bằng 1.' } })
    return true
  })
})

test('describeFormFailure: no field of the form matches → one Vietnamese line, never the English message', () => {
  const error = new ApiError(400, 'Request validation failed', { version: 'must not be null' })
  assert.deepEqual(describeFormFailure(error, ['enabled', 'percent']), { message: INVALID_REQUEST })
  assert.deepEqual(describeFormFailure(new ApiError(400, 'Request validation failed')), { message: INVALID_REQUEST })
})

test('restock: lineVariances[i].reason (also as a method path) lands under the reason of the line that was sent', () => {
  const line = (id, planned, loaded) => ({ id, slotCode: id.toUpperCase(), productName: 'Táo', plannedQuantity: planned, loadedQuantity: loaded })
  const rows = reconcile([line('a', 4, 4), line('b', 4, 2), line('c', 3, 1)]).rows
  const sent = [{ lineId: 'c', reason: ' ' }, { lineId: 'b', reason: 'x'.repeat(501) }]
  const shown = describeCompleteError(new ApiError(400, INVALID_REQUEST, normalizeFieldErrors({
    'complete.request.lineVariances[0].reason': 'must not be blank',
    'complete.request.lineVariances[1].reason': 'size must be between 1 and 500',
  })), rows, sent)
  assert.ok(shown.error instanceof ValidationError)
  assert.deepEqual(shown.error.fieldErrors, { [varianceField('c')]: VARIANCE_REQUIRED, [varianceField('b')]: 'Tối đa 500 ký tự.' })
  assert.equal(shown.stale, false)
  const note = describeCompleteError(new ApiError(400, INVALID_REQUEST, normalizeFieldErrors({ 'complete.request.resultNote': 'must not be blank' })), rows)
  assert.deepEqual(note.error.fieldErrors, { resultNote: RESULT_REQUIRED })
  // An index that matches no line sent: not invented; the error stays a plain 400 with the Vietnamese line.
  const unknown = new ApiError(400, INVALID_REQUEST, { 'lineVariances[5].reason': 'must not be blank' })
  assert.equal(describeCompleteError(unknown, rows, sent).error, unknown)
})

test('restock plan: addLine.input.plannedQuantity marks the planned quantity in Vietnamese', () => {
  const shown = describePlanError(new ApiError(400, INVALID_REQUEST, normalizeFieldErrors({ 'addLine.input.plannedQuantity': 'must be greater than or equal to 1' })))
  assert.ok(shown.error instanceof ValidationError)
  assert.match(shown.error.fieldErrors.plannedQuantity, new RegExp(`từ 1 đến ${PLAN_LINE_MAX}`))
})

/**
 * The mock API answering like the backend's method validation: every 400 `fieldErrors` key becomes
 * `<method>.request.<key>` and the message the generic English line.
 */
function pathKeyedMock() {
  const state = { token: null, method: 'update' }
  const inner = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now(), realFetch: async () => { throw new Error('no network') } })
  const fetcher = async (input, init) => {
    const response = await inner(input, init)
    if (response.status !== 400) return response
    const body = await response.json()
    const fieldErrors = Object.fromEntries(Object.entries(body.fieldErrors ?? {}).map(([key, message]) => [`${state.method}.request.${key}`, message]))
    return jsonResponse(400, { ...body, message: 'Request validation failed', fieldErrors })
  }
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}

test('mock flow with path keys: discount percent and a blank ticket note reach their fields in Vietnamese', async () => {
  const state = pathKeyedMock()
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin })).accessToken
  const setting = await pricingApi.get()
  await assert.rejects(pricingApi.update({ enabled: true, percent: 91, version: setting.version }), error => {
    const failure = describeFormFailure(error, ['enabled', 'percent'])
    assert.equal(failure.message, CHECK_FIELDS)
    assert.deepEqual(Object.keys(failure.fieldErrors), ['percent'])
    assert.doesNotMatch(failure.fieldErrors.percent, /must|request/i)
    assert.ok(!/validation failed/i.test(error.message))
    return true
  })

  state.method = 'addNote'
  const ticket = (await workOrdersApi.list({ size: 50 })).content.find(row => row.status === 'IN_PROGRESS' || row.status === 'OPEN')
  assert.ok(ticket, 'seed has an open work order')
  await assert.rejects(workOrdersApi.note(ticket.id, '   '), error => {
    const failure = describeFormFailure(error, ['note'])
    assert.equal(failure.message, CHECK_FIELDS)
    assert.ok(failure.fieldErrors?.note, 'marked under the note field')
    assert.doesNotMatch(failure.fieldErrors.note, /must|request/i)
    return true
  })
})
