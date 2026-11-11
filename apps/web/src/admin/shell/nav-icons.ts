import { Apple, BellRing, Boxes, CreditCard, KeyRound, LayoutDashboard, ReceiptText, Refrigerator, UserCog, Warehouse, Webhook } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const NAV_ICONS: Record<string, LucideIcon> = {
  '/admin/overview': LayoutDashboard,
  '/admin/machines': Refrigerator,
  '/admin/products': Apple,
  '/admin/batches': Boxes,
  '/admin/inventory': Warehouse,
  '/admin/alerts': BellRing,
  '/admin/orders': ReceiptText,
  '/admin/payments': CreditCard,
  '/admin/webhook-logs': Webhook,
  '/admin/users': UserCog,
  '/admin/roles': KeyRound,
}
