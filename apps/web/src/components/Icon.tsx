import type { SVGProps } from 'react'

type IconName = 'arrow' | 'leaf' | 'fruit' | 'qr' | 'bag' | 'plus' | 'mail' | 'phone' | 'menu' | 'close' | 'dashboard' | 'machine' | 'inventory' | 'transactions' | 'tasks' | 'users'
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M9 10h12"/></>,
    machine: <><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 5h8v9H8zM8 18h5m3 0h.1"/></>,
    inventory: <><path d="m3 7 9-4 9 4v13H3V7Z"/><path d="M3 7h18M9 7v5h6V7M7 16h10"/></>,
    transactions: <><path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/></>,
    tasks: <><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 2h6v4H9zM8 13l3 3 5-6"/></>,
    users: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    leaf: <><path d="M20 3C8 2 2 8 5 16c8 5 15-1 15-13Z" /><path d="M3 21 15 9" /></>,
    fruit: <><path d="M12 7c-3-3-8-1-8 4 0 5 3 10 6 9 1-.4 3-.4 4 0 3 1 6-4 6-9 0-5-5-7-8-4Z" /><path d="M12 7c-1-4 1-5 4-5 0 3-2 4-4 5Z" /></>,
    qr: <><path d="M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h3v3h3v3h-6zM3 12h3m6-9v3m0 6v3m9-3h-3m-6 6v3" /></>,
    bag: <><path d="M5 7h14l1 14H4L5 7Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
    phone: <path d="m7 3 3 5-2 2c1 3 3 5 6 6l2-2 5 3c-1 5-4 5-8 3A20 20 0 0 1 4 11C2 7 2 4 7 3Z" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  }
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}

