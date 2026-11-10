import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeFilterCount, clearFiltersPatch, formatSort, nextSort, oneOf, parseSort, sortParam, sortSelectValue, uuidParam } from '../src/lib/table-query.ts'
import { formatDateTime } from '../src/lib/format.ts'

const rule = { fields: ['createdAt', 'totalAmount', 'orderCode'], fallback: 'createdAt,desc' }
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('sort from the URL: only approved fields and directions pass', () => {
  assert.deepEqual(parseSort('totalAmount,desc', rule), { field: 'totalAmount', direction: 'desc' })
  assert.deepEqual(parseSort('orderCode', rule), { field: 'orderCode', direction: 'asc' })
  for (const bad of [null, '', 'machineCode,asc', 'createdAt,up', 'createdAt,asc,extra', 'createdAt,DESC', 'status']) {
    assert.deepEqual(parseSort(bad, rule), { field: 'createdAt', direction: 'desc' }, String(bad))
  }
})
test('sort round-trips to the URL and the default stays out of it', () => {
  assert.equal(formatSort({ field: 'totalAmount', direction: 'asc' }), 'totalAmount,asc')
  assert.equal(sortParam({ field: 'createdAt', direction: 'desc' }, rule), undefined)
  assert.equal(sortParam({ field: 'createdAt', direction: 'asc' }, rule), 'createdAt,asc')
})
test('pressing a column: new column uses its first direction, same column flips', () => {
  assert.deepEqual(nextSort({ field: 'createdAt', direction: 'desc' }, 'totalAmount', 'desc'), { field: 'totalAmount', direction: 'desc' })
  assert.deepEqual(nextSort({ field: 'createdAt', direction: 'desc' }, 'orderCode'), { field: 'orderCode', direction: 'asc' })
  assert.deepEqual(nextSort({ field: 'orderCode', direction: 'asc' }, 'orderCode'), { field: 'orderCode', direction: 'desc' })
  assert.deepEqual(nextSort({ field: 'orderCode', direction: 'desc' }, 'orderCode'), { field: 'orderCode', direction: 'asc' })
  assert.deepEqual(nextSort(undefined, 'orderCode', 'desc'), { field: 'orderCode', direction: 'desc' })
})
test('URL filters outside the contract vocabulary are dropped', () => {
  assert.equal(oneOf('PAID', ['PAID', 'COMPLETED']), 'PAID')
  assert.equal(oneOf('HACK', ['PAID']), '')
  assert.equal(oneOf(null, ['PAID']), '')
  assert.equal(uuidParam('10000000-0000-0000-0000-000000000001'), '10000000-0000-0000-0000-000000000001')
  for (const bad of ['abc', '', null, '10000000-0000-0000-0000-00000000000']) assert.equal(uuidParam(bad), '')
})
test('active filters are counted and cleared without touching sort', () => {
  const params = new URLSearchParams('status=HACK&search=FV&from=&sort=orderCode,asc&page=2')
  assert.equal(activeFilterCount([params.get('search') ?? '', oneOf(params.get('status'), ['PAID']), params.get('from') ?? '', undefined]), 1)
  assert.deepEqual(clearFiltersPatch(['search', 'status']), { search: undefined, status: undefined })
})
test('date and time read day first in Asia/Ho_Chi_Minh', () => {
  assert.equal(formatDateTime('2026-11-09T06:05:00Z'), '09/11/2026 13:05')
  assert.equal(formatDateTime('2026-10-18T17:00:00Z'), '19/10/2026 00:00')
})

test('kit.tsx no longer emits legacy a-* classes', () => {
  assert.doesNotMatch(read('../src/admin/kit.tsx'), /["'`\s]a-[a-z][a-z-]*["'`\s]/)
})
test('/admin/_kit stays out of production and is loaded lazily', () => {
  const source = read('../src/admin/AdminApp.tsx')
  assert.match(source, /const KitPage = import\.meta\.env\.DEV \|\| import\.meta\.env\.MODE === 'mock' \? lazy\(/)
  assert.doesNotMatch(source, /import KitPage|from '\.\/pages\/KitPage/)
})
test('no delete action in the shared kit or its reference page', () => {
  for (const path of ['../src/admin/kit.tsx', '../src/admin/pages/KitPage.tsx']) assert.doesNotMatch(read(path), /Xóa(?! bộ lọc)|api\.delete|method: 'DELETE'/i, path)
})

test('narrow-screen sort select: a default no column shows reads "Mặc định" (empty value), a column sort is selected', () => {
  const columns = ['code', 'name', 'location', 'status']
  assert.equal(sortSelectValue({ field: 'createdAt', direction: 'desc' }, columns), '')
  assert.equal(sortSelectValue(undefined, columns), '')
  assert.equal(sortSelectValue({ field: 'code', direction: 'asc' }, columns), 'code,asc')
  assert.equal(sortSelectValue({ field: 'status', direction: 'desc' }, columns), 'status,desc')
})
