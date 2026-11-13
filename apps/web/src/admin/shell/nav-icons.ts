import { Apple, BellRing, Boxes, CalendarClock, ChartColumn,ClipboardList, CreditCard, KeyRound, LayoutDashboard, ReceiptText, Refrigerator, UserCog, Warehouse, Webhook } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const NAV_ICONS: Record<string, LucideIcon> = {
  '/admin/overview': LayoutDashboard,
  '/admin/machines': Refrigerator,
  '/admin/products': Apple,
  '/admin/batches': Boxes,
  '/admin/inventory': Warehouse,
  '/admin/alerts': BellRing,
  '/admin/tickets': ClipboardList,
  '/admin/maintenance-schedules': CalendarClock,
  '/admin/orders': ReceiptText,
  '/admin/payments': CreditCard,
  '/admin/webhook-logs': Webhook,
  '/admin/reports/revenue': ChartColumn,
  '/admin/users': UserCog,
  '/admin/roles': KeyRound,
}
