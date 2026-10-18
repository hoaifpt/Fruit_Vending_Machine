// Counts work the user is waiting on (API requests, lazy screens) for the top progress bar.
import { useSyncExternalStore } from 'react'

let pending = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())

/** Marks one unit of work as started; call the returned function exactly once when it settles. */
export function beginProgress(): () => void {
  pending += 1
  emit()
  let done = false
  return () => {
    if (done) return
    done = true
    pending -= 1
    emit()
  }
}

export function usePendingWork(): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => pending > 0,
    () => false,
  )
}
