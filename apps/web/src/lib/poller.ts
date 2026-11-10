// Polling schedule without React, so it can be tested with fake timers. One request at a time: the next poll is
// scheduled only after the previous one settles. Paused while the page is hidden; runs at once when it shows again.

export type RunKind = 'initial' | 'poll' | 'visible'

export interface Visibility {
  hidden(): boolean
  subscribe(listener: () => void): () => void
}

export interface PollerOptions {
  /** 0 or less: run once, never poll. */
  intervalMs: number
  /** Performs one load. Resolve `false` to stop polling for good (for example on 401/403). Must not reject. */
  run: (kind: RunKind) => Promise<boolean>
  visibility?: Visibility
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface Poller {
  start(): void
  dispose(): void
  /** For tests and diagnostics. */
  readonly state: { inflight: boolean; stopped: boolean; scheduled: boolean }
}

/** Shortest accepted interval, so a typo cannot hammer the API. */
export const MIN_POLL_MS = 2000

export function normalizeInterval(ms: number | undefined): number {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return 0
  return Math.max(MIN_POLL_MS, Math.round(ms))
}

export function documentVisibility(): Visibility | undefined {
  if (typeof document === 'undefined') return undefined
  return {
    hidden: () => document.visibilityState === 'hidden',
    subscribe(listener) {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}

export function createPoller(options: PollerOptions): Poller {
  const intervalMs = options.intervalMs > 0 ? options.intervalMs : 0
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const visibility = options.visibility
  let timer: unknown = null
  let inflight = false
  let stopped = false
  let disposed = false
  let unsubscribe: (() => void) | null = null

  const hidden = () => !!visibility?.hidden()
  function clear() {
    if (timer !== null) { clearTimer(timer); timer = null }
  }
  function schedule() {
    clear()
    if (!intervalMs || stopped || disposed || hidden()) return
    timer = setTimer(() => { timer = null; void execute('poll') }, intervalMs)
  }
  async function execute(kind: RunKind) {
    if (inflight || stopped || disposed) return
    inflight = true
    let keepGoing = true
    try { keepGoing = await options.run(kind) } catch { keepGoing = true } finally { inflight = false }
    if (disposed) return
    if (!keepGoing) { stopped = true; clear(); return }
    schedule()
  }
  function onVisibilityChange() {
    if (disposed || stopped) return
    if (hidden()) { clear(); return }
    // Back in view: refresh now instead of waiting a full interval. A load already running reschedules itself.
    if (!inflight) { clear(); void execute('visible') }
  }

  return {
    start() {
      if (intervalMs && visibility) unsubscribe = visibility.subscribe(onVisibilityChange)
      void execute('initial')
    },
    dispose() {
      disposed = true
      clear()
      unsubscribe?.()
      unsubscribe = null
    },
    get state() { return { inflight, stopped, scheduled: timer !== null } },
  }
}
