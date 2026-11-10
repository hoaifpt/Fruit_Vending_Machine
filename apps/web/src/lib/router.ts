// Minimal History API router: path + query string in the URL, so filters stay shareable and back-button friendly.
import { useCallback, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

const listeners = new Set<() => void>()
function emit() { listeners.forEach(listener => listener()) }
const snapshot = () => window.location.pathname + window.location.search

/**
 * Runs a screen change inside a View Transition (styles/app.css animates `.vt-content`), so moving between pages
 * fades and slides instead of jumping. Falls back to an instant update when unsupported or reduced motion is on.
 */
function withTransition(update: () => void, direction: 'forward' | 'back') {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduced) { update(); return }
  document.documentElement.dataset.nav = direction
  const transition = document.startViewTransition(() => flushSync(update))
  transition.finished.finally(() => { delete document.documentElement.dataset.nav })
}

/**
 * Leave guard of a screen with unsaved changes (one at a time): returns true to let the user leave. Asked only when the
 * path changes (filters on the same screen are not leaving) and never for forced moves such as a session expiry.
 */
type LeaveGuard = () => boolean
let leaveGuard: LeaveGuard | null = null
/** Installs the guard (null clears it). The returned function removes it only if it is still the active one. */
export function setLeaveGuard(guard: LeaveGuard | null): () => void {
  leaveGuard = guard
  return () => { if (leaveGuard === guard) leaveGuard = null }
}
/** True when nothing blocks leaving the current screen (asks the active guard, if any). */
export function confirmLeave(): boolean { return leaveGuard ? leaveGuard() : true }
const pathOf = (to: string) => new URL(to, 'https://web.invalid').pathname
/** Whether moving from `fromPath` to `to` leaves the screen (and so must ask the guard). */
export function leavesScreen(fromPath: string, to: string): boolean { return pathOf(to) !== fromPath }

let lastPath = typeof window === 'undefined' ? '/' : window.location.pathname
let lastUrl = typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search
function onPopState() {
  const changed = window.location.pathname !== lastPath
  // Back/forward cannot be cancelled: when the guard says stay, put the screen's URL back. Limitation: this pushes a new
  // entry, so the entry the user went back to stays in history and "forward" history beyond it is lost.
  if (changed && !confirmLeave()) { window.history.pushState(null, '', lastUrl); return }
  lastPath = window.location.pathname
  lastUrl = snapshot()
  if (changed) withTransition(emit, 'back'); else emit()
}

function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('popstate', onPopState)
  listeners.add(listener)
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('popstate', onPopState) }
}

/** `force`: skip the leave guard (session expired, already confirmed). */
export function navigate(to: string, { replace = false, force = false }: { replace?: boolean; force?: boolean } = {}) {
  if (to === snapshot()) return
  if (!force && leavesScreen(window.location.pathname, to) && !confirmLeave()) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to)
  // Filters and redirects replace the entry in place: no page animation for those.
  const changed = window.location.pathname !== lastPath
  lastPath = window.location.pathname
  lastUrl = snapshot()
  if (changed && !replace) withTransition(emit, 'forward'); else emit()
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
