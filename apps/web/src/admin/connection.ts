// Connectivity of a machine (Trực tuyến / Mất kết nối = OFFLINE), decided in ONE place for every screen that shows a
// machine: the machines list (C2), the machine detail header, overview and "Cảm biến & Sự kiện" tab (C3), and the
// machine picker and map of the inventory screen (I2). Rule (FE 6.4, "máy mất heartbeat > 180 s hiện OFFLINE ở mọi màn"):
// OFFLINE when `lastSeenAt` is null (never connected) or more than 180 s old; never stored, always derived from the
// clock (the server's: callers pass serverNow() of client.ts, so a wrong PC clock does not matter). It is kept apart from the administrative status (ACTIVE/MAINTENANCE/INACTIVE, see saleState in machines.ts):
// a machine can be ACTIVE and OFFLINE at the same time. `lastSeenAt` is MachineResponse.lastSeenAt of api.yaml, touched
// by the backend on every MQTT message of the machine (MachineMessageHandler). Pure and unit-tested; the React side is
// useConnection.ts (re-renders exactly when the 180 s are up) and connection-parts.tsx (the badge).
import { formatDateTime } from '../lib/format.ts'

/** A machine silent for longer than this is OFFLINE (180 s). Exactly 180 s is still online. */
export const OFFLINE_AFTER_MS = 180_000
/** How often screens showing connectivity reload `lastSeenAt` (a machine coming back shows within one poll). */
export const CONNECTION_POLL_MS = 30_000

export type ConnectionState = 'ONLINE' | 'OFFLINE'
export interface Connection {
  state: ConnectionState
  /** Never connected (or an unreadable time): OFFLINE, worded "Chưa từng kết nối". */
  never: boolean
  /** ms since the last message (0 when the server clock is ahead of ours), null when never connected. */
  ageMs: number | null
}

function timeOf(value: string | null | undefined): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/** The connectivity of a machine at `now` (ms). */
export function connectionOf(lastSeenAt: string | null | undefined, now: number): Connection {
  const seen = timeOf(lastSeenAt)
  if (seen === null) return { state: 'OFFLINE', never: true, ageMs: null }
  const ageMs = Math.max(0, now - seen)
  return { state: ageMs > OFFLINE_AFTER_MS ? 'OFFLINE' : 'ONLINE', never: false, ageMs }
}

/** ms until a machine that is online now turns OFFLINE if nothing new arrives (at least 1); null when already OFFLINE. */
export function msUntilOffline(lastSeenAt: string | null | undefined, now: number): number | null {
  const connection = connectionOf(lastSeenAt, now)
  if (connection.state === 'OFFLINE' || connection.ageMs === null) return null
  return Math.max(1, OFFLINE_AFTER_MS - connection.ageMs + 1)
}

/** The newer of several `lastSeenAt` values (the machine and its heartbeat may be read at different times). */
export function latestSeen(...values: (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestTime = -Infinity
  for (const value of values) {
    const time = timeOf(value)
    if (time !== null && time > bestTime) { best = value!; bestTime = time }
  }
  return best
}

/** A duration in words, rounded down: "45 giây", "3 phút", "2 giờ", "5 ngày". */
export function formatAge(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return `${seconds} giây`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ`
  return `${Math.floor(hours / 24)} ngày`
}

/**
 * One line under the badge: when the machine was last heard from, and for OFFLINE what it means. Ages are not shown
 * for ONLINE (they would change every second); the absolute time is enough.
 */
export function connectionDetail(connection: Connection, lastSeenAt: string | null | undefined): string {
  if (connection.never) return 'Chưa từng kết nối'
  const at = formatDateTime(lastSeenAt)
  if (connection.state === 'ONLINE') return `Tín hiệu lần cuối ${at}`
  return `Mất tín hiệu từ ${at} (hơn ${formatAge(connection.ageMs ?? 0)})`
}

/** What an OFFLINE machine means for the operator, and what to check. */
export const OFFLINE_HELP = 'Máy không gửi tín hiệu quá 180 giây (3 phút). Lệnh nhả hàng có thể không tới được máy nên đơn đã thanh toán có thể nhả hàng thất bại. Kiểm tra nguồn điện và Wi-Fi của máy.'
export const NEVER_HELP = 'Máy chưa từng gửi tín hiệu về hệ thống. Kiểm tra máy đã được cấu hình mã máy, Wi-Fi và tài khoản MQTT chưa.'

// ---- data that may be out of date

/**
 * The data holding `lastSeenAt` is not trusted any more after a failed reload, or when no reload succeeded for two
 * cycles plus a margin (75 s): then the screen never claims OFFLINE, it says it does not know.
 */
export const STALE_AFTER_MS = 2 * CONNECTION_POLL_MS + 15_000

/** A screen's load state (useApi): its data, last error and when the data was received (client clock, ms). */
export interface ConnectionSource { data?: unknown; error?: unknown; updatedAt?: number }

/** Whether `source` is stale at `clientNow` (client clock, like updatedAt), and since when the data is from. */
export function staleness(source: ConnectionSource | undefined, clientNow: number): { stale: boolean; since?: number } {
  if (!source) return { stale: false }
  const since = source.data ? source.updatedAt : undefined
  if (source.error) return { stale: true, since }
  if (since !== undefined && clientNow - since > STALE_AFTER_MS) return { stale: true, since }
  return { stale: false, since }
}

/** ms until fresh data becomes stale without a new reload (at least 1); null when it already is or cannot be. */
export function msUntilStale(source: ConnectionSource | undefined, clientNow: number): number | null {
  if (!source || source.error || !source.data || source.updatedAt === undefined) return null
  const left = source.updatedAt + STALE_AFTER_MS - clientNow
  return left >= 0 ? Math.max(1, left + 1) : null
}

/** What the badge shows: OFFLINE is only claimed from data that is up to date; online stays true until its 180 s. */
export type ShownConnection = ConnectionState | 'UNKNOWN'
export function shownConnection(connection: Connection, stale: boolean): ShownConnection {
  return stale && connection.state === 'OFFLINE' ? 'UNKNOWN' : connection.state
}

export function unknownDetail(since: number | undefined): string {
  return `Chưa rõ – không cập nhật được trạng thái kết nối${since !== undefined ? ` từ ${formatDateTime(new Date(since).toISOString())}` : ''}`
}
