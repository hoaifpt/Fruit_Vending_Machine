import { useEffect, useState } from 'react'
import { serverClockOffset } from '../api/client.ts'
import { machinesApi } from '../api/resources.ts'
import { CONNECTION_POLL_MS, connectionOf, msUntilChange, msUntilStale, shownConnection, staleness } from './connection.ts'
import type { Connection, ConnectionSource, Connectivity, ShownConnection } from './connection.ts'
import { useApi } from './useApi.ts'
import type { ApiState } from './useApi.ts'

/** Longest single wait; a later crossing is reached in several steps (setTimeout overflows past ~24.8 days). */
const MAX_WAIT_MS = 3_600_000
/** While OFFLINE, how often "Mất tín hiệu từ … (hơn N phút)" is brought up to date. */
const OFFLINE_REFRESH_MS = 60_000

export interface ShownState extends Connection {
  /** ONLINE / WARNING / OFFLINE, or UNKNOWN when WARNING/OFFLINE would be claimed from data that is out of date. */
  shown: ShownConnection
  /** When the out-of-date data was received (client clock), for "không cập nhật được … từ hh:mm". */
  staleSince?: number
}

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/**
 * Connectivity of a machine that turns WARNING (60 s) and OFFLINE (180 s) on screen at the very moment, without a reload
 * or an API call: one timer per machine, set for the next change (a crossing, or the screen's data going stale) and
 * reset whenever a poll brings new data. Times are compared on the server's clock (serverClockOffset). While the page is
 * hidden nothing is re-evaluated: it waits until the page shows again (polls refresh at that moment too).
 * `connectivity` is the backend's value read with `lastSeenAt` (Last Will OFFLINE). `source` is the load state behind
 * them: a failed or overdue reload never shows WARNING/OFFLINE, only "Chưa rõ".
 * The clock is read in effects and timers only (render stays pure). Rules: connection.ts.
 */
export function useConnection(lastSeenAt: string | null | undefined, source?: ConnectionSource, connectivity?: Connectivity | null): ShownState {
  const [now, setNow] = useState(() => Date.now())
  const [offset, setOffset] = useState(() => serverClockOffset())
  const hasSource = !!source, sourceError = source?.error, sourceData = source?.data, sourceUpdatedAt = source?.updatedAt
  useEffect(() => {
    const clientNow = Date.now()
    const current = { data: sourceData, error: sourceError, updatedAt: sourceUpdatedAt }
    const serverTime = clientNow + serverClockOffset()
    const wait = msUntilChange(lastSeenAt, serverTime, connectivity)
    const shown = connectionOf(lastSeenAt, now + offset, connectivity)
    // Already past a crossing but shown as before (a value read long after `now`): correct it right away.
    const crossing = connectionOf(lastSeenAt, serverTime, connectivity).state !== shown.state ? 0
      : wait ?? (shown.never ? null : OFFLINE_REFRESH_MS)
    const delays = [crossing, hasSource ? msUntilStale(current, clientNow) : null].filter((value): value is number => value !== null)
    if (!delays.length) return
    let stopWaiting = () => {}
    const refresh = () => { setNow(Date.now()); setOffset(serverClockOffset()) }
    const timer = setTimeout(() => {
      if (!hidden()) { refresh(); return }
      const onVisible = () => { if (!hidden()) { stopWaiting(); refresh() } }
      document.addEventListener('visibilitychange', onVisible)
      stopWaiting = () => document.removeEventListener('visibilitychange', onVisible)
    }, Math.min(Math.min(...delays), MAX_WAIT_MS))
    return () => { clearTimeout(timer); stopWaiting() }
  }, [lastSeenAt, connectivity, now, offset, hasSource, sourceError, sourceData, sourceUpdatedAt])
  const connection = connectionOf(lastSeenAt, now + offset, connectivity)
  const { stale, since } = staleness(hasSource ? { data: sourceData, error: sourceError, updatedAt: sourceUpdatedAt } : undefined, now)
  return { ...connection, shown: shownConnection(connection, stale), staleSince: stale ? since : undefined }
}

/**
 * `lastSeenAt` and `connectivity` of a machine on a screen whose own data is not reloaded (the inventory map): reads the
 * machine again every 30 s so a stale value never shows a live machine as OFFLINE. Returns them and the load state.
 */
export function useLiveLastSeen(machineId: string, initial: string | null | undefined, initialConnectivity?: Connectivity | null): {
  lastSeenAt: string | null | undefined; connectivity: Connectivity | null | undefined; source: ApiState<unknown>
} {
  const live = useApi(signal => machinesApi.get(machineId, signal), `connection|${machineId}`, { pollMs: CONNECTION_POLL_MS })
  const fresh = live.data?.id === machineId ? live.data : undefined
  return { lastSeenAt: fresh ? fresh.lastSeenAt : initial, connectivity: fresh ? fresh.connectivity : initialConnectivity, source: live }
}
