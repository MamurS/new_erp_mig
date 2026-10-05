/*
 * Side panel of every portal (staff, assistance, clinic, HR), modelled on Claude's sidebar.
 * - Docked: on the left, 288 px by default, the person drags its right edge (224–400 px; double click
 *   resets; arrows ±16 px on the focused separator).
 * - Hidden: it disappears completely; the toggle stays at the top left of the content. Hovering the
 *   toggle for 200 ms slides the panel over the content (preview) until the mouse has been away for
 *   300 ms; a click pins it. Right after hiding, the preview waits until the pointer has left the toggle
 *   and come back. Ctrl/⌘+B toggles it, except while typing.
 * - Below 1024 px it is hidden and opens over the content with a dimmed backdrop (dialog: Esc, outside
 *   click, focus trap, closes on navigation).
 * State and width are remembered per portal. The look does not depend on the staff/client theme.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import * as D from '@radix-ui/react-dialog';
import { ChevronsUpDown, LogOut, PanelLeft, Search, UserRound, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { clampNavWidth, getNavPrefs, NAV_WIDTH, setNavPrefs, type NavPortal } from '@/shared/lib/storage';
import { Modal } from './dialog';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './dropdown';
import { Tooltip } from './tooltip';

export interface SidebarItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Open work in this section (queue counters). */
  count?: number;
  /** Match only this exact path (home pages). */
  end?: boolean;
}

export interface SidebarGroup {
  /** Shown as a small grey title; omit for the first, untitled group. */
  label?: string;
  items: SidebarItem[];
}

export interface AppSidebarProps {
  /** «MIG», «MIG · Ассистанс», «MIG · Клиника», «MIG · Компания». */
  title: string;
  ariaLabel: string;
  groups: SidebarGroup[];
  /** Path of the active item (the layout knows its own matching rules). */
  activePath: string | undefined;
  user: { name: string; role: string; portal: string };
  onLogout: () => void;
  /** The command palette, where the portal has one. */
  onSearch?: () => void;
}

const PREVIEW_OPEN_MS = 200;
const PREVIEW_CLOSE_MS = 300;
const TOGGLE_ATTR = 'data-sidebar-toggle';
/** Longer than the 150 ms width transition: until then the toggle is still moving under the pointer. */
const SETTLE_MS = 250;
const STEP = 16;

// ---------------------------------------------------------------- state

interface SidebarState {
  portal: NavPortal;
  desktop: boolean;
  collapsed: boolean;
  width: number;
  preview: boolean;
  mobileOpen: boolean;
  panelId: string;
  mobileId: string;
  toggle: () => void;
  setWidth: (w: number, persist?: boolean) => void;
  setMobileOpen: (open: boolean) => void;
  openPreview: () => void;
  closePreviewSoon: () => void;
  keepPreview: () => void;
}

const Ctx = createContext<SidebarState | null>(null);

function useSidebar(): SidebarState {
  const v = useContext(Ctx);
  if (!v) throw new Error('Sidebar parts must be inside <SidebarProvider>');
  return v;
}

const DESKTOP = '(min-width: 1024px)';
function subscribeDesktop(cb: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const isDesktopNow = () =>
  typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP).matches : true;

/** Ctrl/⌘+B anywhere except text fields. */
function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) ||
    t.getAttribute('role') === 'textbox' ||
    t.getAttribute('role') === 'combobox'
  );
}

export function shortcut(key: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return mac ? `⌘+${key}` : `Ctrl+${key}`;
}

export function SidebarProvider({ portal, children }: { portal: NavPortal; children: ReactNode }) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktopNow, () => true);
  const [prefs, setPrefs] = useState(() => getNavPrefs(portal));
  const [preview, setPreview] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  // Set when the panel is shown or hidden: the toggle may now sit under a pointer that did not move to it.
  const suppressed = useRef(false);
  const toggledAt = useRef(0);
  const settleTimer = useRef<number | undefined>(undefined);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const movedAway = useRef(false);
  const release = useCallback(() => {
    if (Date.now() - toggledAt.current >= SETTLE_MS) suppressed.current = false;
  }, []);
  const overToggle = (el: Element | null | undefined) => !!el?.closest(`[${TOGGLE_ATTR}]`);
  const panelId = useId();
  const mobileId = useId();
  const loc = useLocation();

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(settleTimer.current);
  }, []);
  const keepPreview = useCallback(() => window.clearTimeout(closeTimer.current), []);
  const openPreview = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    if (suppressed.current) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setPreview(true), PREVIEW_OPEN_MS);
  }, []);
  const closePreviewSoon = useCallback(() => {
    release();
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPreview(false), PREVIEW_CLOSE_MS);
  }, [release]);
  useEffect(() => clearTimers, [clearTimers]);
  // Once the layout has settled, a pointer moving anywhere but over the toggle has left it: the next hover is a new one.
  useEffect(() => {
    // Before then, a move elsewhere followed by a move onto the toggle is a real hover too.
    const onMove = (e: PointerEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      if (!suppressed.current) return;
      if (!overToggle(e.target instanceof Element ? e.target : null)) {
        movedAway.current = true;
        release();
      } else if (movedAway.current) {
        suppressed.current = false;
        openPreview();
      }
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [release, openPreview]);

  const toggle = useCallback(() => {
    if (!isDesktopNow()) {
      setMobileOpen((v) => !v);
      return;
    }
    clearTimers();
    suppressed.current = true;
    movedAway.current = false;
    toggledAt.current = Date.now();
    // When the layout has settled, a pointer that is not over the toggle needs no fresh leave.
    settleTimer.current = window.setTimeout(() => {
      const p = lastPointer.current;
      const under =
        p && typeof document.elementFromPoint === 'function' ? document.elementFromPoint(p.x, p.y) : null;
      if (!overToggle(under)) suppressed.current = false;
    }, SETTLE_MS);
    setPreview(false);
    setPrefs((p) => {
      const next = { ...p, collapsed: !p.collapsed };
      setNavPrefs(portal, { collapsed: next.collapsed });
      return next;
    });
  }, [portal, clearTimers]);

  const setWidth = useCallback(
    (w: number, persist = true) => {
      const width = clampNavWidth(w);
      setPrefs((p) => ({ ...p, width }));
      if (persist) setNavPrefs(portal, { width });
    },
    [portal],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'b' &&
        !isTyping(e.target)
      ) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // A transition closes the overlay panels.
  useEffect(() => {
    setMobileOpen(false);
    setPreview(false);
    clearTimers();
  }, [loc.pathname, loc.search, clearTimers]);
  // A wide window has no overlay panel.
  useEffect(() => {
    if (desktop) setMobileOpen(false);
  }, [desktop]);

  const value = useMemo<SidebarState>(
    () => ({
      portal,
      desktop,
      collapsed: prefs.collapsed,
      width: prefs.width,
      preview: preview && prefs.collapsed && desktop,
      mobileOpen,
      panelId,
      mobileId,
      toggle,
      setWidth,
      setMobileOpen,
      openPreview,
      closePreviewSoon,
      keepPreview,
    }),
    [
      portal,
      desktop,
      prefs,
      preview,
      mobileOpen,
      panelId,
      mobileId,
      toggle,
      setWidth,
      openPreview,
      closePreviewSoon,
      keepPreview,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------- toggle in the content header

/** The content's own toggle: shown while the panel is hidden (always below 1024 px). */
export function SidebarToggle() {
  const s = useSidebar();
  const shown = !s.desktop || s.collapsed;
  if (!shown) return null;
  const label = 'Показать панель';
  return (
    <Tooltip content={<TipWithKey label={label} keys={shortcut('B')} />} side="bottom">
      <button
        type="button"
        data-testid="sidebar-toggle"
        {...{ [TOGGLE_ATTR]: '' }}
        aria-label={label}
        aria-expanded={s.desktop ? s.preview : s.mobileOpen}
        aria-controls={s.desktop ? s.panelId : s.mobileId}
        onClick={() => (s.desktop ? s.toggle() : s.setMobileOpen(true))}
        onMouseEnter={s.desktop ? s.openPreview : undefined}
        onMouseLeave={s.desktop ? s.closePreviewSoon : undefined}
        className="-ml-1 shrink-0 rounded-lg p-1.5 text-(--sb-muted) hover:bg-(--sb-hover) hover:text-(--sb-text)"
      >
        <PanelLeft className="h-[18px] w-[18px]" aria-hidden />
      </button>
    </Tooltip>
  );
}

function TipWithKey({ label, keys }: { label: string; keys: string }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      <kbd className="rounded-sm bg-white/15 px-1 font-sans text-[11px]">{keys}</kbd>
    </span>
  );
}

// ---------------------------------------------------------------- the panel

export function AppSidebar(props: AppSidebarProps) {
  const s = useSidebar();
  const [dragging, setDragging] = useState(false);
  const docked = s.desktop && !s.collapsed;
  return (
    <>
      <aside
        id={s.panelId}
        data-testid="sidebar"
        data-state={docked ? 'expanded' : 'collapsed'}
        inert={!docked}
        style={{ width: docked ? s.width : 0, fontFamily: "'Golos Text', system-ui, sans-serif" }}
        className={cn(
          'sticky top-(--banner-h,0px) hidden h-[calc(100vh-var(--banner-h,0px))] shrink-0 overflow-hidden bg-(--sb-bg) text-(--sb-text) lg:block',
          docked && 'border-r border-(--sb-border)',
          !dragging && 'transition-[width] duration-150 ease-out motion-reduce:transition-none',
        )}
      >
        <div className="relative flex h-full flex-col" style={{ width: s.width }}>
          <SidebarBody {...props} mode="docked" />
          {docked && <ResizeHandle onDragging={setDragging} />}
        </div>
      </aside>
      {s.preview && (
        <div
          data-testid="sidebar-preview"
          role="navigation"
          aria-label={props.ariaLabel}
          onMouseEnter={s.keepPreview}
          onMouseLeave={s.closePreviewSoon}
          style={{ width: s.width, fontFamily: "'Golos Text', system-ui, sans-serif" }}
          className="fixed bottom-0 left-0 top-(--banner-h,0px) z-40 flex flex-col overflow-hidden rounded-r-xl border-r border-(--sb-border) bg-(--sb-bg) text-(--sb-text) shadow-2xl motion-safe:animate-[sb-in_150ms_ease-out]"
        >
          <SidebarBody {...props} mode="preview" />
        </div>
      )}
      <D.Root open={!s.desktop && s.mobileOpen} onOpenChange={s.setMobileOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/30" />
          <D.Content
            id={s.mobileId}
            aria-describedby={undefined}
            data-testid="sidebar-mobile"
            style={{
              width: Math.min(s.width, NAV_WIDTH.default),
              fontFamily: "'Golos Text', system-ui, sans-serif",
            }}
            className="fixed inset-y-0 left-0 z-50 flex max-w-[85vw] flex-col border-r border-(--sb-border) bg-(--sb-bg) text-(--sb-text) shadow-xl motion-safe:animate-[sb-in_150ms_ease-out]"
          >
            <D.Title className="sr-only">{props.ariaLabel}</D.Title>
            <nav aria-label={props.ariaLabel} className="flex min-h-0 flex-1 flex-col">
              <SidebarBody {...props} mode="drawer" />
            </nav>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}

function SidebarBody({
  title,
  ariaLabel,
  groups,
  activePath,
  user,
  onLogout,
  onSearch,
  mode,
}: AppSidebarProps & { mode: 'docked' | 'preview' | 'drawer' }) {
  const s = useSidebar();
  const body = (
    <>
      <div
        className={cn('flex h-[52px] shrink-0 items-center gap-1 pr-2', mode === 'preview' ? 'pl-3' : 'pl-4')}
      >
        {/* In the preview the pin button sits exactly where the content's toggle is: the same click pins the panel. */}
        {mode === 'preview' && (
          <IconButton
            label="Закрепить панель"
            keys={shortcut('B')}
            icon={PanelLeft}
            onClick={s.toggle}
            controls={s.panelId}
            expanded={false}
          />
        )}
        <span
          className={cn('min-w-0 flex-1 truncate text-[15px] font-semibold', mode === 'preview' && 'pl-1.5')}
          data-testid="sidebar-title"
        >
          {title}
        </span>
        {mode === 'drawer' && (
          <D.Close asChild>
            <IconButton label="Скрыть панель" keys={undefined} icon={PanelLeft} />
          </D.Close>
        )}
        {mode === 'docked' && (
          <IconButton
            label="Скрыть панель"
            keys={shortcut('B')}
            icon={PanelLeft}
            onClick={s.toggle}
            controls={s.panelId}
            expanded
          />
        )}
        {onSearch && <IconButton label="Поиск" keys={shortcut('K')} icon={Search} onClick={onSearch} />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
        {groups.map((g, k) => (
          <div key={g.label ?? k} role="group" aria-label={g.label} className={cn(k > 0 && 'mt-4')}>
            {g.label && (
              <p aria-hidden className="mb-0.5 px-2.5 text-[12px] text-(--sb-group)">
                {g.label}
              </p>
            )}
            <ul className="flex flex-col gap-px">
              {g.items.map((it) => (
                <li key={it.path}>
                  <SidebarLink item={it} active={it.path === activePath} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <UserBlock user={user} onLogout={onLogout} />
    </>
  );
  // The docked and preview panels are landmarks themselves (aside / role=navigation).
  return mode === 'docked' ? (
    <nav aria-label={ariaLabel} className="flex min-h-0 flex-1 flex-col">
      {body}
    </nav>
  ) : (
    body
  );
}

function IconButton({
  label,
  keys,
  icon: Icon,
  onClick,
  controls,
  expanded,
  ...rest
}: {
  label: string;
  keys: string | undefined;
  icon: LucideIcon;
  onClick?: () => void;
  controls?: string;
  expanded?: boolean;
}) {
  const button = (
    <button
      {...rest}
      type="button"
      aria-label={label}
      aria-controls={controls}
      aria-expanded={expanded}
      onClick={onClick}
      className="shrink-0 rounded-lg p-1.5 text-(--sb-muted) hover:bg-(--sb-hover) hover:text-(--sb-text)"
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
  // No tooltip without a shortcut (the drawer on touch screens): Esc then closes the panel at once.
  return keys ? (
    <Tooltip content={<TipWithKey label={label} keys={keys} />} side="bottom">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

function SidebarLink({ item, active }: { item: SidebarItem; active: boolean }) {
  const count = item.count ?? 0;
  return (
    <NavLink
      to={item.path}
      end={item.end ?? true}
      aria-label={count > 0 ? `${item.label}, задач: ${count}` : item.label}
      aria-current={active ? 'page' : undefined}
      data-active={active || undefined}
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px] text-(--sb-text) hover:bg-(--sb-hover)',
        active && 'bg-(--sb-active) hover:bg-(--sb-active)',
      )}
    >
      <item.icon className="h-[18px] w-[18px] shrink-0 text-(--sb-muted)" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count > 0 && (
        <span aria-hidden data-testid="nav-count" className="num text-[12px] text-(--sb-muted)">
          {count > 999 ? '999+' : count}
        </span>
      )}
    </NavLink>
  );
}

function ResizeHandle({ onDragging }: { onDragging: (v: boolean) => void }) {
  const s = useSidebar();
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина панели"
      aria-valuenow={s.width}
      aria-valuemin={NAV_WIDTH.min}
      aria-valuemax={NAV_WIDTH.max}
      tabIndex={0}
      data-testid="sidebar-resize"
      className="group absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize outline-none"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: s.width };
        onDragging(true);
      }}
      onPointerMove={(e) => {
        if (start.current) s.setWidth(start.current.w + e.clientX - start.current.x, false);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        s.setWidth(start.current.w + e.clientX - start.current.x);
        start.current = null;
        onDragging(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        onDragging(false);
      }}
      onDoubleClick={() => s.setWidth(NAV_WIDTH.default)}
      onKeyDown={(e) => {
        const next =
          e.key === 'ArrowLeft'
            ? s.width - STEP
            : e.key === 'ArrowRight'
              ? s.width + STEP
              : e.key === 'Home'
                ? NAV_WIDTH.min
                : e.key === 'End'
                  ? NAV_WIDTH.max
                  : null;
        if (next === null) return;
        e.preventDefault();
        s.setWidth(next);
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 right-0 w-px bg-transparent transition-colors group-hover:bg-(--sb-handle) group-focus-visible:bg-(--sb-handle)"
      />
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function UserBlock({ user, onLogout }: { user: AppSidebarProps['user']; onLogout: () => void }) {
  const [profile, setProfile] = useState(false);
  return (
    <div className="shrink-0 border-t border-(--sb-border) p-2" data-testid="sidebar-user">
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label="Меню пользователя"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[14px] hover:bg-(--sb-hover)"
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--sb-active) text-[12px] font-semibold text-(--sb-text)"
            >
              {initials(user.name)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {user.name} <span className="text-(--sb-muted)">· {user.role}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-(--sb-muted)" aria-hidden />
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <MenuLabel>
            <span className="block font-semibold text-text">{user.name}</span>
            {user.role}
          </MenuLabel>
          <MenuSeparator />
          <MenuItem onSelect={() => setProfile(true)}>
            <UserRound className="h-4 w-4" aria-hidden /> Профиль
          </MenuItem>
          <MenuItem onSelect={onLogout}>
            <LogOut className="h-4 w-4" aria-hidden /> Выйти
          </MenuItem>
        </MenuContent>
      </Menu>
      <Modal open={profile} onOpenChange={setProfile} title="Профиль">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-muted">Имя</dt>
          <dd>{user.name}</dd>
          <dt className="text-muted">Роль</dt>
          <dd>{user.role}</dd>
          <dt className="text-muted">Портал</dt>
          <dd>{user.portal}</dd>
        </dl>
      </Modal>
    </div>
  );
}
