import { ChevronRight, ChevronsUpDown, Home, Leaf, LogOut, Menu, Monitor, Moon, PanelLeft, Search, Sun } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Role } from '../../api/session.ts'
import { Button } from '../../components/ui/button.tsx'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../../components/ui/command.tsx'
import { Kbd } from '../../components/ui/kbd.tsx'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../../components/ui/sheet.tsx'
import { Toaster } from '../../components/ui/sonner.tsx'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.tsx'
import { cn } from '../../lib/cn.ts'
import { linkHandler, navigate } from '../../lib/router.ts'
import { useTheme } from '../../lib/theme.ts'
import type { ThemeChoice } from '../../lib/theme.ts'
import { breadcrumbFor } from '../routes.ts'
import type { NavItem, RouteMatch } from '../routes.ts'
import { NAV_ICONS } from './nav-icons.ts'
import { TopProgress } from './TopProgress.tsx'

const COLLAPSE_KEY = 'fruit-vending-sidebar-collapsed'
const ROLE_LABELS: Record<Role, string> = { ADMIN: 'Quản trị viên', STAFF: 'Nhân viên' }
const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Sáng', icon: Sun }, { value: 'dark', label: 'Tối', icon: Moon }, { value: 'system', label: 'Theo hệ thống', icon: Monitor },
]

/** Vietnamese without diacritics, so typing "may ban" finds "Máy bán hàng". */
const plain = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}

interface ShellProps { nav: NavItem[]; route: RouteMatch | undefined; email: string; roles: Role[]; onLogout: () => void; children: ReactNode }

/** Management layout: collapsible sidebar (drawer on mobile), top bar with breadcrumb, Ctrl+K palette and menus. */
export function AdminShell({ nav, route, email, roles, onLogout, children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const { resolved } = useTheme()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(open => !open) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => setDrawer(false), [route?.page, route?.id])

  function toggleCollapsed() {
    setCollapsed(value => {
      try { localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1') } catch { /* storage blocked */ }
      return !value
    })
  }

  const account = { email, roles, onLogout }
  return <TooltipProvider delayDuration={300}>
    <div className="ui-root flex min-h-svh bg-background text-foreground antialiased">
      <TopProgress />
      <a href="#admin-main" className="fixed top-2 left-2 z-[70] -translate-y-16 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground transition-transform focus:translate-y-0">Đến nội dung</a>

      <aside className={cn('sticky top-0 hidden h-svh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out lg:flex', collapsed ? 'w-[3.75rem]' : 'w-60')}>
        <SidebarBody nav={nav} route={route} collapsed={collapsed} account={account} />
      </aside>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-72 gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Điều hướng</SheetTitle>
          <SheetDescription className="sr-only">Các khu vực quản trị</SheetDescription>
          <SidebarBody nav={nav} route={route} collapsed={false} account={account} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-5">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Mở điều hướng" onClick={() => setDrawer(true)}><Menu /></Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'} aria-pressed={collapsed} onClick={toggleCollapsed}><PanelLeft /></Button>
            </TooltipTrigger>
            <TooltipContent>{collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}</TooltipContent>
          </Tooltip>
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <Breadcrumb route={route} />
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="w-9 justify-start px-0 text-muted-foreground sm:w-56 sm:px-3" onClick={() => setPalette(true)} aria-label="Tìm kiếm và điều hướng (Ctrl+K)">
              <Search className="mx-auto sm:mx-0" /><span className="hidden flex-1 text-left font-normal sm:inline">Tìm màn hình…</span><Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
            </Button>
            <ThemeMenu />
          </div>
        </header>
        <main id="admin-main" tabIndex={-1} className="vt-content admin-app mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>

      <CommandPalette open={palette} onOpenChange={setPalette} nav={nav} onLogout={onLogout} />
      <Toaster theme={resolved} />
    </div>
  </TooltipProvider>
}

function SidebarBody({ nav, route, collapsed, account }: { nav: NavItem[]; route: RouteMatch | undefined; collapsed: boolean; account: { email: string; roles: Role[]; onLogout: () => void } }) {
  const groups = [...new Set(nav.map(item => item.group))]
  return <>
    <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border', collapsed ? 'justify-center px-0' : 'px-4')}>
      <a href="/" className="flex min-w-0 items-center gap-2.5 rounded-md" aria-label="Fruit Vending, về trang giới thiệu">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Leaf className="size-4" /></span>
        {!collapsed && <span className="min-w-0 leading-tight"><span className="block truncate text-sm font-semibold text-foreground">Fruit Vending</span><span className="block truncate text-xs text-muted-foreground">Quản trị</span></span>}
      </a>
    </div>
    <nav aria-label="Quản trị" className="flex-1 overflow-y-auto px-2 py-3">
      {groups.map(group => <div key={group} className="mb-4 last:mb-0">
        {collapsed ? <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border first:hidden" /> : <p className="mb-1 px-2.5 text-xs font-medium text-muted-foreground">{group}</p>}
        <ul className="grid gap-0.5">
          {nav.filter(item => item.group === group).map(item => {
            const current = !!route && item.match.includes(route.page)
            const Icon = NAV_ICONS[item.to]
            const link = <a href={item.to} onClick={linkHandler(item.to)} aria-current={current ? 'page' : undefined}
              className={cn('group/nav relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-150',
                collapsed && 'justify-center px-0',
                current ? 'bg-sidebar-accent font-medium text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-foreground')}>
              {current && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
              {Icon && <Icon className={cn('size-4 shrink-0', current ? 'text-primary' : 'text-muted-foreground group-hover/nav:text-foreground')} />}
              {!collapsed && <span className="truncate">{item.label}</span>}
            </a>
            return <li key={item.to}>{collapsed ? <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{item.label}</TooltipContent></Tooltip> : link}</li>
          })}
        </ul>
      </div>)}
    </nav>
    <div className="shrink-0 border-t border-sidebar-border p-2"><AccountMenu {...account} collapsed={collapsed} /></div>
  </>
}

function AccountMenu({ email, roles, onLogout, collapsed }: { email: string; roles: Role[]; onLogout: () => void; collapsed: boolean }) {
  const initial = (email[0] ?? '?').toUpperCase()
  const roleText = roles.map(role => ROLE_LABELS[role]).join(' · ')
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className={cn('flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none data-[state=open]:bg-sidebar-accent', collapsed && 'justify-center')} aria-label="Tài khoản">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{initial}</span>
        {!collapsed && <><span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-sm font-medium text-foreground">{email || 'Tài khoản'}</span><span className="block truncate text-xs text-muted-foreground">{roleText}</span></span><ChevronsUpDown className="size-4 text-muted-foreground" /></>}
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" className="w-60">
      <DropdownMenuLabel className="font-normal"><span className="block truncate text-sm font-medium text-foreground">{email}</span><span className="block text-xs">{roleText}</span></DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { window.location.href = '/' }}><Home />Trang giới thiệu</DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={onLogout}><LogOut />Đăng xuất</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

function Breadcrumb({ route }: { route: RouteMatch | undefined }) {
  const trail = breadcrumbFor(route)
  if (!trail.length) return null
  return <nav aria-label="Vị trí" className="min-w-0">
    <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      {trail.map((crumb, index) => {
        const last = index === trail.length - 1
        return <Fragment key={crumb.label}>
          {index > 0 && <ChevronRight className={cn('size-3.5 shrink-0', index === 1 && 'hidden md:block')} aria-hidden="true" />}
          <li className={cn('truncate', index === 0 && 'hidden md:block', last && 'font-medium text-foreground')} aria-current={last ? 'page' : undefined}>
            {crumb.to && !last ? <a href={crumb.to} onClick={linkHandler(crumb.to)} className="transition-colors hover:text-foreground">{crumb.label}</a> : crumb.label}
          </li>
        </Fragment>
      })}
    </ol>
  </nav>
}

function ThemeMenu() {
  const { choice, resolved, setTheme } = useTheme()
  const Current = resolved === 'dark' ? Moon : Sun
  return <DropdownMenu>
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Giao diện sáng/tối"><Current /></Button></DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>Giao diện</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="end" className="min-w-44">
      <DropdownMenuRadioGroup value={choice} onValueChange={value => setTheme(value as ThemeChoice)}>
        {THEMES.map(theme => <DropdownMenuRadioItem key={theme.value} value={theme.value}><theme.icon />{theme.label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}

function CommandPalette({ open, onOpenChange, nav, onLogout }: { open: boolean; onOpenChange: (open: boolean) => void; nav: NavItem[]; onLogout: () => void }) {
  const { setTheme } = useTheme()
  const groups = [...new Set(nav.map(item => item.group))]
  const run = (action: () => void) => { onOpenChange(false); action() }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl p-0" aria-describedby={undefined}>
      <DialogTitle className="sr-only">Tìm kiếm và điều hướng</DialogTitle>
      <Command loop>
        <CommandInput autoFocus placeholder="Nhập tên màn hình hoặc thao tác…" />
        <CommandList>
          <CommandEmpty>Không tìm thấy kết quả.</CommandEmpty>
          {groups.map(group => <CommandGroup key={group} heading={group}>
            {nav.filter(item => item.group === group).map(item => {
              const Icon = NAV_ICONS[item.to]
              return <CommandItem key={item.to} value={item.to} keywords={[item.label, plain(item.label), item.group, plain(item.group)]} onSelect={() => run(() => navigate(item.to))}>{Icon && <Icon />}{item.label}</CommandItem>
            })}
          </CommandGroup>)}
          <CommandGroup heading="Giao diện">
            {THEMES.map(theme => <CommandItem key={theme.value} value={`theme-${theme.value}`} keywords={['Giao diện', 'giao dien', theme.label, plain(theme.label), theme.value]} onSelect={() => run(() => setTheme(theme.value))}><theme.icon />Giao diện: {theme.label}</CommandItem>)}
          </CommandGroup>
          <CommandGroup heading="Tài khoản">
            <CommandItem value="logout" keywords={['Đăng xuất', 'dang xuat']} onSelect={() => run(onLogout)}><LogOut />Đăng xuất</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>
}
