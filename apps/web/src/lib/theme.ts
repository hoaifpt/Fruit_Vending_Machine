// Light / dark / system theme for the management UI. The choice lives in localStorage (a per-viewer convenience);
// index.html applies it before first paint so there is no flash. `.dark` on <html> switches the --ui-* tokens.
import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
const STORAGE_KEY = 'fruit-vending-theme'
const listeners = new Set<() => void>()
const media = typeof window === 'undefined' ? undefined : window.matchMedia('(prefers-color-scheme: dark)')

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch { return 'system' }
}

let choice: ThemeChoice = typeof window === 'undefined' ? 'system' : read()

export function resolvedTheme(value: ThemeChoice = choice): 'light' | 'dark' {
  return value === 'system' ? (media?.matches ? 'dark' : 'light') : value
}

function apply() {
  document.documentElement.classList.toggle('dark', resolvedTheme() === 'dark')
  listeners.forEach(listener => listener())
}

export function setTheme(next: ThemeChoice) {
  choice = next
  try { if (next === 'system') localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, next) } catch { /* storage blocked: keep it for this tab */ }
  const swap = () => apply()
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap)
  else swap()
}

media?.addEventListener('change', () => { if (choice === 'system') apply() })

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useTheme() {
  const value = useSyncExternalStore(subscribe, () => choice, () => 'system' as ThemeChoice)
  const resolved = useSyncExternalStore(subscribe, () => resolvedTheme(), () => 'light' as const)
  return { choice: value, resolved, setTheme }
}
