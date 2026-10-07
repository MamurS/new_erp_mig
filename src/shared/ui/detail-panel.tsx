/*
 * Split view: a list in the portal content area and the details card of the selected row next to it.
 * - The portal layout provides the place (<DetailPanelHost>, rendered by <ContentScroll>): the row
 *   [content area — the only scroll of the page] [card slot]. A page renders <DetailPanel> anywhere in
 *   its tree; the card is portalled into the slot, so it is a sibling of the content area, never its
 *   descendant: the table's sticky header, totals and pager cannot cover it, and it does not scroll
 *   with the page.
 * - Docked (≥ 1280 px): the content area narrows by the card's width. The card spans from the top
 *   bar's bottom edge to the bottom of the window: its header (title, chips, close) is pinned at the
 *   top, the actions at the bottom, the body scrolls by itself. The left edge is dragged (360–640 px;
 *   double click → 420; arrows ±16 px on the focused separator, Home/End → min/max), the width is
 *   remembered (storage.ts, a UI preference). Esc closes it unless something inside handled Esc first.
 * - Overlay (< 1280 px): the card opens over the table on the right with a light backdrop (modal
 *   dialog: Esc, backdrop click, close button, focus trap); the content area under it does not scroll.
 * - Print: the card is not printed (the table prints alone).
 * The ?panel=id URL parameter and the history rules live in useDetailPanelParam().
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { clampDetailWidth, DETAIL_WIDTH, getDetailWidth, setDetailWidth } from '@/shared/lib/storage';
import { t } from '@/i18n';

/** Below this width the card opens over the table instead of next to it. */
export const DETAIL_DOCK_QUERY = '(min-width: 1280px)';
/** Keyboard step of the width separator, px. */
export const DETAIL_STEP = 16;

// ---------------------------------------------------------------- host (provided by the portal layout)

interface HostState {
  slot: HTMLElement | null;
  /** The overlay card is open: the content area under it must not scroll. */
  setOverlay: (open: boolean) => void;
}

const HostCtx = createContext<HostState | null>(null);

/** The row [content area][card slot]; `children` gets whether an overlay card locks the content area. */
export function DetailPanelHost({ children }: { children: (locked: boolean) => ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [overlay, setOverlay] = useState(false);
  const value = useMemo<HostState>(() => ({ slot, setOverlay }), [slot]);
  return (
    <HostCtx.Provider value={value}>
      <div data-split-view="" className="flex min-h-0 min-w-0 flex-1">
        {children(overlay)}
        <div ref={setSlot} data-detail-slot="" className="contents" />
      </div>
    </HostCtx.Provider>
  );
}

// ---------------------------------------------------------------- media query

function subscribeDock(cb: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(DETAIL_DOCK_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const isDockNow = () => (typeof window.matchMedia === 'function' ? window.matchMedia(DETAIL_DOCK_QUERY).matches : true);

// ---------------------------------------------------------------- width

/** Width of the card with the person's preference; `persist: false` while dragging. */
export function useDetailWidth() {
  const [width, set] = useState(getDetailWidth);
  const setWidth = useCallback((w: number, persist = true) => {
    const next = clampDetailWidth(w);
    set(next);
    if (persist) setDetailWidth(next);
  }, []);
  return [width, setWidth] as const;
}

/** New width for a key on the separator of the card's left edge (null: not ours). */
export function widthForKey(key: string, width: number): number | null {
  switch (key) {
    case 'ArrowLeft':
      return width + DETAIL_STEP;
    case 'ArrowRight':
      return width - DETAIL_STEP;
    case 'Home':
      return DETAIL_WIDTH.min;
    case 'End':
      return DETAIL_WIDTH.max;
    default:
      return null;
  }
}

function ResizeHandle({ width, setWidth }: { width: number; setWidth: (w: number, persist?: boolean) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  // The card grows to the left: moving the pointer left adds width.
  const at = (x: number) => (start.current ? start.current.w - (x - start.current.x) : width);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('shell.sidePanel.width')}
      aria-valuenow={width}
      aria-valuemin={DETAIL_WIDTH.min}
      aria-valuemax={DETAIL_WIDTH.max}
      tabIndex={0}
      data-testid="detail-panel-resize"
      className="group absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize outline-none"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start.current = { x: e.clientX, w: width };
      }}
      onPointerMove={(e) => {
        if (start.current) setWidth(at(e.clientX), false);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        setWidth(at(e.clientX));
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onDoubleClick={() => setWidth(DETAIL_WIDTH.default)}
      onKeyDown={(e: ReactKeyboardEvent) => {
        const next = widthForKey(e.key, width);
        if (next === null) return;
        e.preventDefault();
        setWidth(next);
      }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
    </div>
  );
}

// ---------------------------------------------------------------- the card

export interface DetailPanelProps {
  /** The name of the entity: pinned at the top of the card. */
  title: ReactNode;
  /** Plain-text title for the dialog's accessible name (overlay mode) when `title` is not a string. */
  titleText?: string;
  /** Chips under the title (legal form, status…): pinned with it. */
  meta?: ReactNode;
  /** Action buttons («Открыть карточку»…): pinned at the bottom of the card. */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Accessible name of the card region. */
  label?: string;
}

export function DetailPanel(p: DetailPanelProps) {
  const host = useContext(HostCtx);
  const docked = useSyncExternalStore(subscribeDock, isDockNow, () => true);
  const [width, setWidth] = useDetailWidth();
  const { onClose } = p;
  const label = p.label ?? t('shell.sidePanel.label');

  // Overlay: lock the content area under the card.
  const setOverlay = host?.setOverlay;
  useEffect(() => {
    if (docked || !setOverlay) return;
    setOverlay(true);
    return () => setOverlay(false);
  }, [docked, setOverlay]);

  // Docked: Esc closes the card, unless a menu, dialog or field inside handled it first.
  useEffect(() => {
    if (!docked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked, onClose]);

  const close = (
    <button type="button" onClick={onClose} aria-label={t('shell.sidePanel.close')} data-testid="detail-panel-close" className="-mr-1 shrink-0 rounded-btn p-1 text-muted hover:bg-rail">
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
  const inner = (TitleTag: 'h2' | typeof D.Title) => (
    <>
      <header data-testid="detail-panel-header" className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start gap-2">
          {TitleTag === 'h2' ? (
            <h2 data-testid="detail-panel-title" className="min-w-0 flex-1 truncate text-[16px] font-bold">
              {p.title}
            </h2>
          ) : (
            <D.Title data-testid="detail-panel-title" className="min-w-0 flex-1 truncate text-[16px] font-bold">
              {p.title}
            </D.Title>
          )}
          {close}
        </div>
        {p.meta && <div className="mt-1.5 flex flex-wrap items-center gap-2">{p.meta}</div>}
      </header>
      <div data-testid="detail-panel-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {p.children}
      </div>
      {p.footer && (
        <footer data-testid="detail-panel-footer" className="flex shrink-0 flex-wrap gap-2 border-t border-border px-4 py-3">
          {p.footer}
        </footer>
      )}
    </>
  );

  if (!docked) {
    return (
      <D.Root open onOpenChange={(o) => !o && onClose()}>
        <D.Portal container={host?.slot ?? undefined}>
          <D.Overlay data-testid="detail-panel-backdrop" className="fixed inset-0 z-40 bg-black/10 print:hidden" />
          <D.Content
            aria-describedby={undefined}
            aria-label={p.titleText}
            data-testid="detail-panel"
            data-mode="overlay"
            style={{ width }}
            className="animate-panel fixed bottom-0 right-0 top-[calc(var(--banner-h,0px)+var(--topbar-h))] z-40 flex max-w-full flex-col border-l border-border bg-surface text-text shadow-xl outline-none print:hidden"
          >
            {inner(D.Title)}
          </D.Content>
        </D.Portal>
      </D.Root>
    );
  }

  const card = (
    <aside
      aria-label={label}
      data-testid="detail-panel"
      data-mode="docked"
      style={{ width }}
      className="animate-panel relative z-10 flex min-h-0 shrink-0 flex-col self-stretch border-l border-border bg-surface text-text print:hidden"
    >
      <ResizeHandle width={width} setWidth={setWidth} />
      {inner('h2')}
    </aside>
  );
  if (!host) return card; // outside a portal layout (unit tests): in place
  return host.slot ? createPortal(card, host.slot) : null;
}

// ---------------------------------------------------------------- ?panel=id

interface PanelHistoryState {
  detailPanel?: boolean;
}

/**
 * The selected row of a split view lives in the URL (`?panel=id`): a direct link opens the list with
 * the card. Opening the card pushes a history entry (browser Back closes it); switching to another row
 * replaces that entry; closing goes back to the entry the card was opened from, or — when the page was
 * loaded with ?panel= — replaces the URL without it.
 */
export function useDetailPanelParam(key = 'panel') {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const raw = params.get(key) ?? '';
  const id = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  const pushed = (location.state as PanelHistoryState | null)?.detailPanel === true;

  const open = useCallback(
    (next: string) => {
      if (next === id) return;
      setParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set(key, next);
          return sp;
        },
        id ? { replace: true, state: location.state as unknown } : { state: { detailPanel: true } satisfies PanelHistoryState },
      );
    },
    [id, key, location.state, setParams],
  );

  const close = useCallback(() => {
    if (!id) return;
    if (pushed) {
      navigate(-1);
      return;
    }
    setParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.delete(key);
        return sp;
      },
      { replace: true },
    );
  }, [id, key, navigate, pushed, setParams]);

  return { id, open, close };
}
