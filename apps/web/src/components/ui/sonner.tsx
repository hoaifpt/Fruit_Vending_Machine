import { useSyncExternalStore } from 'react'
import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'

/** Phones (Tailwind `max-sm`): toasts go to the top, where they do not cover the actions at the bottom of the screen. */
const PHONE = '(max-width: 639.98px)'
function subscribe(change: () => void) {
  const query = window.matchMedia(PHONE)
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}
const isPhone = () => window.matchMedia(PHONE).matches

export function Toaster(props: ToasterProps) {
  const phone = useSyncExternalStore(subscribe, isPhone, () => false)
  return <Sonner position={phone ? 'top-center' : 'bottom-right'} closeButton className="ui-root" toastOptions={{ classNames: { toast: 'font-sans !rounded-lg !border-border !bg-popover !text-popover-foreground', description: '!text-muted-foreground' } }} {...props} />
}
