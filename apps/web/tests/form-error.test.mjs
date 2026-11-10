import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../src/api/client.ts'
import { CHECK_FIELDS, ValidationError, describeFormFailure } from '../src/admin/form-error.ts'

test('409 keeps the business message at form level (never replaced by the generic line)', () => {
  assert.deepEqual(describeFormFailure(new ApiError(409, 'Product SKU already exists')), { message: 'Product SKU already exists', fieldErrors: undefined })
  // Even if a 409 ever carried field errors, the conflict message stays and the fields are still marked.
  const failure = describeFormFailure(new ApiError(409, 'Slot is full', { quantity: 'too many' }))
  assert.equal(failure.message, 'Slot is full')
  assert.deepEqual(failure.fieldErrors, { quantity: 'too many' })
})
test('400 with field errors marks the fields and shows the generic line; 400 without them shows its message', () => {
  assert.deepEqual(describeFormFailure(new ApiError(400, 'Request validation failed', { email: 'must be a well-formed email address' })),
    { message: CHECK_FIELDS, fieldErrors: { email: 'must be a well-formed email address' } })
  assert.deepEqual(describeFormFailure(new ApiError(400, 'Batch already expired')), { message: 'Batch already expired' })
})
test('client-side validation and other failures', () => {
  assert.deepEqual(describeFormFailure(new ValidationError({ name: 'Vui lòng nhập tên.' })), { message: CHECK_FIELDS, fieldErrors: { name: 'Vui lòng nhập tên.' } })
  assert.equal(describeFormFailure(new ApiError(500, 'Hệ thống đang gặp sự cố. Vui lòng thử lại.')).message, 'Hệ thống đang gặp sự cố. Vui lòng thử lại.')
  assert.match(describeFormFailure('boom').message, /Đã xảy ra lỗi/)
})
