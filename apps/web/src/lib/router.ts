// Minimal History API router: path + query string in the URL, so filters stay shareable and back-button friendly.
import { useCallback, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
function emit() { listeners.forEach(listener => listener()) }
function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => { listeners.delete(listener); window.removeEventListener('popstate', listener) }
}
const snapshot = () => window.location.pathname + window.location.search

export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  if (to === snapshot()) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to)
  emit()
}

export function useLocation() {
  const value = useSyncExternalStore(subscribe, snapshot, () => '/')
  const index = value.indexOf('?')
  return { pathname: index < 0 ? value : value.slice(0, index), search: index < 0 ? '' : value.slice(index) }
}

/** URL query string as editable state. Changing any filter other than `page` resets to the first page. */
export function useQueryParams() {
  const { pathname, search } = useLocation()
  const params = new URLSearchParams(search)
  const update = useCallback((patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key) }
    if (!('page' in patch)) next.delete('page')
    if (next.get('page') === '0') next.delete('page')
    const text = next.toString()
    navigate(window.location.pathname + (text ? `?${text}` : ''), { replace: true })
  }, [])
  return { pathname, params, update }
}

/** Intercepts plain left-clicks on in-app links. */
export function linkHandler(to: string) {
  return (event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; preventDefault: () => void }) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate(to)
  }
}
