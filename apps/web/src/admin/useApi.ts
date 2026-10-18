import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client.ts'

export interface ApiState<T> { data?: T; error?: ApiError | Error; loading: boolean; reload: () => void }

/** Runs `loader` whenever `key` changes (key must encode every input the loader reads). Aborts stale requests. */
export function useApi<T>(loader: (signal: AbortSignal) => Promise<T>, key: string): ApiState<T> {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [state, setState] = useState<{ data?: T; error?: ApiError | Error; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setState(previous => ({ data: previous.data, loading: true }))
    loaderRef.current(controller.signal).then(
      data => { if (!controller.signal.aborted) setState({ data, loading: false }) },
      error => { if (!controller.signal.aborted) setState({ error, loading: false }) },
    )
    return () => controller.abort()
  }, [key, tick])
  const reload = useCallback(() => setTick(value => value + 1), [])
  return { ...state, reload }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.'
}
