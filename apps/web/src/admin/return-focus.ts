// Focus return for dialogs and sheets opened from state (useDialog) rather than a Radix Trigger: Radix then has no
// trigger to go back to and focus falls to <body>. The opener is remembered when the dialog mounts and focused again
// when it closes. If the opener is gone (the list re-rendered), the element with the same `data-focus-key` is used,
// and as a last resort the page region `#admin-main`, so keyboard and screen-reader users never restart from the top.
import { useCallback, useState } from 'react'

/** Minimal DOM surface used here, so the rules can be unit-tested without a browser. */
export interface FocusableLike {
  focus(options?: FocusOptions): void
  getAttribute(name: string): string | null
  readonly isConnected: boolean
  disabled?: boolean
}
export interface DocumentLike {
  readonly activeElement: unknown
  readonly body: unknown
  querySelectorAll(selector: string): ArrayLike<unknown>
  getElementById(id: string): unknown
}

export const FOCUS_KEY_ATTRIBUTE = 'data-focus-key'
export interface FocusOrigin { element: FocusableLike | null; key: string | null }

export function captureFocus(doc: DocumentLike): FocusOrigin {
  const active = doc.activeElement as FocusableLike | null
  if (!active || active === doc.body || typeof active.focus !== 'function') return { element: null, key: null }
  return { element: active, key: active.getAttribute(FOCUS_KEY_ATTRIBUTE) }
}

function usable(element: FocusableLike | null | undefined): element is FocusableLike {
  return !!element && element.isConnected && !element.disabled
}

function byKey(doc: DocumentLike, key: string): FocusableLike | null {
  // Compared in JS rather than in a selector, so keys need no escaping.
  for (const candidate of Array.from(doc.querySelectorAll(`[${FOCUS_KEY_ATTRIBUTE}]`)) as FocusableLike[]) {
    if (candidate.getAttribute(FOCUS_KEY_ATTRIBUTE) === key && usable(candidate)) return candidate
  }
  return null
}

export type FocusReturn = 'origin' | 'key' | 'main' | 'none'

/** Focuses the opener, else its stand-in with the same key, else the page region. Returns which one was used. */
export function restoreFocus(origin: FocusOrigin, doc: DocumentLike): FocusReturn {
  if (usable(origin.element)) { origin.element.focus({ preventScroll: true }); return 'origin' }
  const stand = origin.key ? byKey(doc, origin.key) : null
  if (stand) { stand.focus({ preventScroll: true }); return 'key' }
  const main = doc.getElementById('admin-main') as FocusableLike | null
  if (main && typeof main.focus === 'function') { main.focus({ preventScroll: true }); return 'main' }
  return 'none'
}

/**
 * Call in a dialog/sheet component that mounts when it opens. Pass `onCloseAutoFocus` to Radix content, or call
 * `restore()` when a native dialog closes. The opener is read on the first render, before the dialog takes focus.
 */
export function useReturnFocus() {
  const [origin] = useState<FocusOrigin>(() => typeof document === 'undefined' ? { element: null, key: null } : captureFocus(document))
  const restore = useCallback(() => {
    if (typeof document === 'undefined') return
    // The opener may be replaced in the same commit (a row re-rendered): retry after the next frame before falling back.
    if (usable(origin.element)) { restoreFocus(origin, document); return }
    requestAnimationFrame(() => { restoreFocus(origin, document) })
  }, [origin])
  const onCloseAutoFocus = useCallback((event: Event) => { event.preventDefault(); restore() }, [restore])
  return { restore, onCloseAutoFocus }
}
