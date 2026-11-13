import { batchesApi, machinesApi, productsApi, slotsApi, usersApi } from '../api/resources.ts'
import { useApi } from './useApi.ts'

export interface Option { value: string; label: string }

// Pickers load the first 100 records (API maximum page size) sorted by name; refine with search if a catalogue outgrows it.
export function useProductOptions(activeOnly = false): Option[] {
  const state = useApi(signal => productsApi.list({ page: 0, size: 100, status: activeOnly ? 'ACTIVE' : undefined, sort: 'name,asc' }, signal), `products|${activeOnly}`)
  return (state.data?.content ?? []).map(product => ({ value: product.id, label: `${product.name} (${product.sku})` }))
}
export function useMachineOptions(): Option[] {
  const state = useApi(signal => machinesApi.list({ page: 0, size: 100, sort: 'name,asc' }, signal), 'machines')
  return (state.data?.content ?? []).map(machine => ({ value: machine.id, label: `${machine.name} (${machine.code})` }))
}
export function useSlotOptions(machineId: string): Option[] {
  const state = useApi(signal => machineId ? slotsApi.list(machineId, { page: 0, size: 100, sort: 'slotCode,asc' }, signal) : Promise.resolve(undefined), `slots|${machineId}`)
  return (state.data?.content ?? []).map(slot => ({ value: slot.id, label: `${slot.slotCode} · ${slot.capacity} hộp` }))
}
export function useBatchOptions(): Option[] {
  const state = useApi(signal => batchesApi.list({ page: 0, size: 100, sort: 'expiresAt,asc' }, signal), 'batches')
  return (state.data?.content ?? []).map(batch => ({ value: batch.id ?? '', label: `${batch.batchCode} · ${batch.productName}` }))
}
/**
 * ACTIVE staff accounts who can be given a work ticket (FE 7.1). Needs USER_READ (admins); without it, or when `enabled`
 * is false, no request is sent and the list is empty. `state` tells loading and errors apart from "no staff".
 */
export function useStaffOptions(enabled: boolean) {
  const state = useApi(signal => enabled ? usersApi.list({ page: 0, size: 100, status: 'ACTIVE', role: 'STAFF' }, signal) : Promise.resolve(undefined), `staff|${enabled}`)
  const options: Option[] = (state.data?.content ?? []).map(user => ({ value: user.id, label: `${user.fullName} (${user.email})` }))
  return { options, loading: enabled && state.loading, error: state.error }
}
