import { Apple, Boxes, CreditCard, ReceiptText, Refrigerator, UserCog, Warehouse, Webhook } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const NAV_ICONS: Record<string, LucideIcon> = {
  '/admin/machines': Refrigerator,
  '/admin/products': Apple,
  '/admin/batches': Boxes,
  '/admin/inventory': Warehouse,
  '/admin/orders': ReceiptText,
  '/admin/payments': CreditCard,
  '/admin/webhook-logs': Webhook,
  '/admin/users': UserCog,
}
