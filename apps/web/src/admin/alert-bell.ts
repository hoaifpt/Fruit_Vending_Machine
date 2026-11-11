// Polling of the alert bell without React (FE 6.3), so the "new alert shows within one poll" rule is tested with fake
// timers (tests/alerts.test.mjs). One poll at a time through createPoller (each poll: the newest open alerts and the
// count of open CRITICAL ones): paused while the tab is hidden, refreshed
// as soon as it shows again, and stopped for good on 401, 403 or a missing endpoint (backend 3.6 not shipped: no spam).
import type { Alert, Page } from '../api/resources.ts'
import { createPoller } from '../lib/poller.ts'
import type { Poller, Visibility } from '../lib/poller.ts'
import { BELL_SIZE, alertsAvailability, bellAnnouncement, freshAlerts } from './alerts.ts'
import type { AlertsAvailability } from './alerts.ts'

export interface BellSnapshot {
  /** `off`: hidden for good (endpoint missing, no permission, signed out); `error`: last poll failed, retried next time. */
  status: 'loading' | 'ready' | 'error' | 'off'
  openCount?: number
  /** Open CRITICAL alerts (all of them, not only among the newest); undefined when that count could not be read. */
  criticalCount?: number
  latest: Alert[]
  /** Ids that arrived in the last poll (highlighted in the list). */
  fresh: string[]
  /** Text for the polite live region (last new-alert message). */
  announcement: string
  /** Increases each time new alerts arrive, so the same text is announced again (the view clears the region first). */
  announcementSeq: number
  offReason?: Exclude<AlertsAvailability, 'error'>
}

/** One poll: the newest open alerts, and the count of open CRITICAL alerts when it could be read. */
export interface BellData { page: Page<Alert>; criticalCount?: number }

export interface BellOptions {
  load: (signal: AbortSignal) => Promise<BellData>
  intervalMs: number
  onChange: (snapshot: BellSnapshot) => void
  visibility?: Visibility
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface AlertBell {
  start(): void
  /** Load now (after an alert was acknowledged or closed on a screen) and keep polling from there. */
  refresh(): void
  dispose(): void
  readonly snapshot: BellSnapshot
}

export function createAlertBell(options: BellOptions): AlertBell {
  let snapshot: BellSnapshot = { status: 'loading', latest: [], fresh: [], announcement: '', announcementSeq: 0 }
  /** Every id seen since the bell started; null until the first successful load. */
  let seen: Set<string> | null = null
  let poller: Poller | null = null
  let controller: AbortController | null = null
  let disposed = false

  function set(next: BellSnapshot) {
    snapshot = next
    if (!disposed) options.onChange(next)
  }

  async function run(): Promise<boolean> {
    controller?.abort()
    const own = new AbortController()
    controller = own
    try {
      const { page, criticalCount } = await options.load(own.signal)
      if (own.signal.aborted || disposed) return true
      const latest = page.content ?? []
      const fresh = freshAlerts(seen, latest)
      seen ??= new Set()
      for (const alert of latest) if (alert.id) seen.add(alert.id)
      const announcement = bellAnnouncement(fresh, latest.length >= BELL_SIZE)
      set({
        status: 'ready', openCount: page.totalElements ?? latest.length, criticalCount, latest, fresh: fresh.map(alert => alert.id),
        announcement: announcement || snapshot.announcement, announcementSeq: snapshot.announcementSeq + (announcement ? 1 : 0),
      })
      return true
    } catch (error) {
      if (own.signal.aborted || disposed) return true
      const availability = alertsAvailability(error)
      if (availability !== 'error') {
        set({ status: 'off', latest: [], fresh: [], announcement: '', announcementSeq: snapshot.announcementSeq, offReason: availability })
        return false
      }
      // Keep what was shown; the next poll tries again.
      set({ ...snapshot, status: 'error', fresh: [] })
      return true
    }
  }

  function startPoller() {
    poller?.dispose()
    poller = createPoller({ intervalMs: options.intervalMs, run, visibility: options.visibility, setTimer: options.setTimer, clearTimer: options.clearTimer })
    poller.start()
  }

  return {
    start() { if (!disposed && !poller) startPoller() },
    refresh() { if (!disposed && snapshot.status !== 'off') startPoller() },
    dispose() {
      disposed = true
      poller?.dispose()
      controller?.abort()
    },
    get snapshot() { return snapshot },
  }
}

// Screens that acknowledge or close an alert tell the bell, so its count follows at once instead of at the next poll.
const changeListeners = new Set<() => void>()
export function onAlertsChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => { changeListeners.delete(listener) }
}
export function notifyAlertsChanged(): void {
  for (const listener of [...changeListeners]) listener()
}
