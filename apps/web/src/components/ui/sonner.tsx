import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'

export function Toaster(props: ToasterProps) {
  return <Sonner position="bottom-right" closeButton className="ui-root" toastOptions={{ classNames: { toast: 'font-sans !rounded-lg !border-border !bg-popover !text-popover-foreground', description: '!text-muted-foreground' } }} {...props} />
}
