/*
 * Collapsible side navigation of the staff and assistance portals. Two states, switched only by the
 * person (button or Ctrl/⌘+B): expanded with labels, group titles and queue counters, or collapsed to
 * icons with tooltips and dot counters. The choice is remembered per portal. Below 1024 px the panel is
 * hidden and opens over the content from a burger button (a dialog: Esc, click outside, focus trap).
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import * as D from '@radix-ui/react-dialog';
import { LogOut, Menu as MenuIcon, PanelLeft, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { getNavCollapsed, setNavCollapsed, type NavPortal } from '@/shared/lib/storage';
import { Avatar } from './chips';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './dropdown';
import { Tooltip } from './tooltip';

export interface SidebarItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Open work in this section (queue counters). */
  count?: number;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export interface AppSidebarProps {
  portal: NavPortal;
  theme: 'staff' | 'client';
  ariaLabel: string;
  brand: { to: string; label: string; title: string; subtitle?: ReactNode; icon: LucideIcon };
  groups: SidebarGroup[];
  /** Path of the active item (the layout knows its own matching rules). */
  activePath: string | undefined;
  user: { name: string; role: string };
  onLogout: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  /** Id of the overlay panel (the burger's `aria-controls`). */
  mobileId: string;
}

const EXPANDED = 'w-[248px]';
const COLLAPSED = 'w-16';

/** Ctrl/⌘+B anywhere except text fields. */
function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.getAttribute('role') === 'textbox';
}

export function useSidebarCollapsed(portal: NavPortal): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => getNavCollapsed(portal));
  const toggle = useCallback(() => {
    setCollapsed((v) => {
      setNavCollapsed(portal, !v);
      return !v;
    });
  }, [portal]);
  return [collapsed, toggle];
}

export function SidebarBurger({ onClick, controls, expanded }: { onClick: () => void; controls: string; expanded: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Открыть меню"
      aria-expanded={expanded}
      aria-controls={controls}
      className="-ml-1 rounded-btn p-2 text-muted hover:bg-rail hover:text-text lg:hidden"
    >
      <MenuIcon className="h-5 w-5" aria-hidden />
    </button>
  );
}

export function AppSidebar(props: AppSidebarProps) {
  const { portal, mobileOpen, onMobileOpenChange } = props;
  const [collapsed, toggle] = useSidebarCollapsed(portal);
  const loc = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b' && !isTyping(e.target)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // A transition closes the overlay panel, and so does a window wide enough for the regular one.
  useEffect(() => {
    onMobileOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on navigation
  }, [loc.pathname, loc.search]);
  useEffect(() => {
    if (!mobileOpen || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => mq.matches && onMobileOpenChange(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mobileOpen, onMobileOpenChange]);

  return (
    <>
      <nav
        aria-label={props.ariaLabel}
        data-collapsed={collapsed}
        data-testid="sidebar"
        className={cn(
          'sticky top-[var(--banner-h,0px)] hidden h-[calc(100vh-var(--banner-h,0px))] shrink-0 flex-col border-r border-border bg-rail transition-[width] duration-150 ease-out motion-reduce:transition-none lg:flex',
          collapsed ? COLLAPSED : EXPANDED,
        )}
      >
        <SidebarBody {...props} collapsed={collapsed} onToggle={toggle} />
      </nav>
      <D.Root open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/30 lg:hidden" />
          <D.Content
            id={props.mobileId}
            data-theme={props.theme}
            aria-describedby={undefined}
            className={cn('fixed inset-y-0 left-0 z-50 flex max-w-[85vw] flex-col border-r border-border bg-rail text-text shadow-xl lg:hidden', EXPANDED)}
          >
            <D.Title className="sr-only">{props.ariaLabel}</D.Title>
            <nav aria-label={props.ariaLabel} className="flex min-h-0 flex-1 flex-col" data-testid="sidebar-mobile">
              <SidebarBody {...props} collapsed={false} onClose={() => onMobileOpenChange(false)} />
            </nav>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}

function SidebarBody({
  brand,
  groups,
  activePath,
  user,
  onLogout,
  collapsed,
  onToggle,
  onClose,
}: AppSidebarProps & { collapsed: boolean; onToggle?: () => void; onClose?: () => void }) {
  const listId = useId();
  const toggleLabel = collapsed ? 'Развернуть меню' : 'Свернуть меню';
  return (
    <>
      <div className={cn('flex shrink-0 gap-2 px-3 pb-2 pt-3', collapsed ? 'flex-col items-center' : 'items-center')}>
        <NavLink to={brand.to} end aria-label={brand.label} className="flex min-w-0 items-center gap-2 rounded-btn">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-accent text-white">
            <brand.icon className="h-5 w-5" aria-hidden />
          </span>
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-semibold">{brand.title}</span>
              {brand.subtitle && <span className="block truncate text-[12px] text-muted">{brand.subtitle}</span>}
            </span>
          )}
        </NavLink>
        {onToggle && (
          <Tooltip content={`${toggleLabel} · ${shortcutLabel()}`} side={collapsed ? 'right' : 'bottom'}>
            <button
              type="button"
              onClick={onToggle}
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              aria-controls={listId}
              className={cn('rounded-btn p-2 text-muted hover:bg-surface hover:text-text', !collapsed && 'ml-auto')}
            >
              <PanelLeft className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </Tooltip>
        )}
        {onClose && (
          <D.Close asChild>
            <button type="button" aria-label="Закрыть меню" className="ml-auto rounded-btn p-2 text-muted hover:bg-surface hover:text-text">
              <X className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </D.Close>
        )}
      </div>
      <div id={listId} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
        {groups.map((g, k) => (
          <div key={g.label} role="group" aria-label={g.label} className={cn(k > 0 && 'mt-3')}>
            {collapsed ? (
              k > 0 && <div aria-hidden className="mx-2 mb-3 border-t border-border" />
            ) : (
              <p aria-hidden className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {g.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((s) => (
                <li key={s.path}>
                  <SidebarLink item={s} active={s.path === activePath} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <UserBlock user={user} onLogout={onLogout} collapsed={collapsed} />
    </>
  );
}

function SidebarLink({ item, active, collapsed }: { item: SidebarItem; active: boolean; collapsed: boolean }) {
  const count = item.count ?? 0;
  const label = count > 0 ? `${item.label}, задач: ${count}` : item.label;
  const link = (
    <NavLink
      to={item.path}
      end
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-9 items-center gap-2.5 rounded-btn text-muted hover:bg-surface hover:text-text',
        collapsed ? 'w-10 justify-center' : 'px-2',
        active && 'bg-surface font-medium text-text shadow-sm ring-1 ring-border',
      )}
    >
      <item.icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-accent')} aria-hidden />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {count > 0 &&
        (collapsed ? (
          <span aria-hidden data-testid="nav-dot" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-rail" />
        ) : (
          <span aria-hidden data-testid="nav-count" className="num rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent-text">
            {count > 99 ? '99+' : count}
          </span>
        ))}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={count > 0 ? `${item.label} · ${count}` : item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function UserBlock({ user, onLogout, collapsed }: { user: { name: string; role: string }; onLogout: () => void; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex shrink-0 justify-center border-t border-border py-3">
        <Menu>
          <Tooltip content={`${user.name} · ${user.role}`} side="right">
            <MenuTrigger asChild>
              <button type="button" aria-label="Профиль и выход" className="rounded-full">
                <Avatar name={user.name} className="h-9 w-9" />
              </button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent align="start">
            <MenuLabel>
              <span className="block font-semibold text-text">{user.name}</span>
              {user.role}
            </MenuLabel>
            <MenuSeparator />
            <MenuItem onSelect={onLogout}>
              <LogOut className="h-4 w-4" aria-hidden /> Выйти
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-3" data-testid="sidebar-user">
      <Avatar name={user.name} className="h-9 w-9" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate font-medium">{user.name}</p>
        <p className="truncate text-[12px] text-muted">{user.role}</p>
      </div>
      <Tooltip content="Выйти" side="top">
        <button type="button" onClick={onLogout} aria-label="Выйти" className="rounded-btn p-2 text-muted hover:bg-surface hover:text-text">
          <LogOut className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}

function shortcutLabel(): string {
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return mac ? '⌘B' : 'Ctrl+B';
}
