// URL state of server-side lists: which sort and filter values may reach the API. Pure functions so they can be unit-tested.
export type SortDirection = 'asc' | 'desc'
export interface SortState { field: string; direction: SortDirection }
/** Sort fields the contract approves for one endpoint, plus its default (`field,dir`). */
export interface SortRule { fields: readonly string[]; fallback: string }

function readSort(raw: string, fields: readonly string[]): SortState | undefined {
  const [field, direction = 'asc', extra] = raw.split(',')
  if (extra !== undefined || !fields.includes(field) || (direction !== 'asc' && direction !== 'desc')) return undefined
  return { field, direction }
}

/** Reads `?sort=`; anything the contract does not approve falls back to the endpoint default instead of a 400. */
export function parseSort(raw: string | null | undefined, rule: SortRule): SortState {
  const sort = raw ? readSort(raw, rule.fields) : undefined
  return sort ?? readSort(rule.fallback, rule.fields) ?? { field: rule.fields[0], direction: 'asc' }
}

export function formatSort(sort: SortState): string { return `${sort.field},${sort.direction}` }

/** URL value for a sort: the default is left out so links stay short. */
export function sortParam(sort: SortState, rule: SortRule): string | undefined {
  const value = formatSort(sort)
  return value === rule.fallback ? undefined : value
}

/** Sort after pressing a column header: a new column starts at its first direction, the same column flips. */
export function nextSort(current: SortState | undefined, field: string, firstDirection: SortDirection = 'asc'): SortState {
  if (current?.field !== field) return { field, direction: firstDirection }
  return { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

/** A URL value limited to a known vocabulary; '' when absent or unknown, so hand-edited URLs never reach the API. */
export function oneOf(value: string | null | undefined, allowed: readonly string[]): string {
  return value && allowed.includes(value) ? value : ''
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A URL value that must be a UUID in the contract; '' otherwise. */
export function uuidParam(value: string | null | undefined): string {
  return value && UUID.test(value) ? value : ''
}

/** How many filters are in effect, counted on the cleaned values so ignored URL junk is not reported (sort and page are not filters). */
export function activeFilterCount(values: readonly (string | undefined)[]): number {
  return values.filter(Boolean).length
}

/** Patch for `useQueryParams().update` that removes every filter and returns to the first page. */
export function clearFiltersPatch(keys: readonly string[]): Record<string, undefined> {
  return Object.fromEntries(keys.map(key => [key, undefined]))
}
