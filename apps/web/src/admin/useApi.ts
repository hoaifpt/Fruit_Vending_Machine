import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, markBackground } from '../api/client.ts'
import { createPoller, documentVisibility, normalizeInterval } from '../lib/poller.ts'
import type { RunKind } from '../lib/poller.ts'

export interface ApiState<T> {
  data?: T
  error?: ApiError | Error
  /** Foreground load (first load, filter change, reload): screens may show a skeleton when there is no data yet. */
  loading: boolean
  /** Background poll in progress: keep showing the current data, at most a quiet indicator. */
  refreshing: boolean
  /** When the shown data was received (ms since epoch). */
  updatedAt?: number
  reload: () => void
}

export interface ApiOptions {
  /** Reload every `pollMs` ms (minimum 2 s) while the tab is visible. Stops after a 401/403. */
  pollMs?: number
}

type LoadState<T> = Omit<ApiState<T>, 'reload'>

/** 401 (session gone) and 403 (no permission) will not fix themselves by polling again. */
export function stopsPolling(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403)
}

/**
 * Runs `loader` whenever `key` changes (key must encode every input the loader reads), optionally polling.
 * Only one request is in flight: a new load aborts the previous one, and polls wait for the last to settle.
 */
export function useApi<T>(loader: (signal: AbortSignal) => Promise<T>, key: string, options: ApiOptions = {}): ApiState<T> {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const pollMs = normalizeInterval(options.pollMs)
  const [state, setState] = useState<LoadState<T>>({ loading: true, refreshing: false })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let controller: AbortController | null = null
    const run = (kind: RunKind) => new Promise<boolean>(resolve => {
      controller?.abort()
      const own = new AbortController()
      controller = own
      const background = kind !== 'initial'
      // Polls are not something the user waits on: their requests do not run the top progress bar.
      if (background) markBackground(own.signal)
      setState(previous => background ? { ...previous, refreshing: true } : { data: previous.data, updatedAt: previous.updatedAt, loading: true, refreshing: false })
      loaderRef.current(own.signal).then(
        data => {
          if (!own.signal.aborted) setState({ data, loading: false, refreshing: false, updatedAt: Date.now() })
          resolve(true)
        },
        (error: ApiError | Error) => {
          if (own.signal.aborted) { resolve(true); return }
          // A failed poll keeps the data on screen next to the error; a failed foreground load shows the error alone.
          setState(previous => background ? { ...previous, error, loading: false, refreshing: false } : { error, loading: false, refreshing: false })
          resolve(!stopsPolling(error))
        },
      )
    })
    const poller = createPoller({ intervalMs: pollMs, run, visibility: documentVisibility() })
    poller.start()
    return () => { poller.dispose(); controller?.abort() }
  }, [key, tick, pollMs])
  const reload = useCallback(() => setTick(value => value + 1), [])
  return { ...state, reload }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.'
}
