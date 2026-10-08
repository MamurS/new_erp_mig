import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { renderRoutes } from '@/test/utils';
import { clampDetailWidth, DETAIL_WIDTH, getDetailWidth, getPref, setDetailWidth, setPref, type DetailPrefs } from '@/shared/lib/storage';
import { ContentScroll } from './content-scroll';
import { DetailPanel, useDetailPanelParam, widthForKey } from './detail-panel';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function List() {
  const p = useDetailPanelParam();
  return (
    <>
      <button type="button" onClick={() => p.open(A)}>
        A
      </button>
      <button type="button" onClick={() => p.open(B)}>
        B
      </button>
      {p.id && (
        <DetailPanel title={`Card ${p.id.slice(0, 1)}`} meta={<span>chip</span>} footer={<button type="button">Open</button>} onClose={p.close}>
          <p>body</p>
        </DetailPanel>
      )}
    </>
  );
}

function Shell() {
  return (
    <ContentScroll>
      <List />
    </ContentScroll>
  );
}

const render = (path = '/list') =>
  renderRoutes(
    [
      { path: '/start', element: <p>start</p> },
      { path: '/list', element: <Shell /> },
    ],
    path,
  );

/** Wide (docked) or narrow (overlay) window for the media query of the card. */
function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: wide, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

describe('storage of the card width', () => {
  beforeEach(() => setPref('detail', {}));

  it('clamps to 360–640 px and falls back to 420', () => {
    expect(clampDetailWidth(100)).toBe(DETAIL_WIDTH.min);
    expect(clampDetailWidth(9999)).toBe(DETAIL_WIDTH.max);
    expect(clampDetailWidth(500.4)).toBe(500);
    expect(clampDetailWidth(Number.NaN)).toBe(DETAIL_WIDTH.default);
    expect(getDetailWidth()).toBe(420);
  });

  it('keeps only a clamped width in the UI preferences; garbage reads as the default', () => {
    setDetailWidth(1000);
    expect(getDetailWidth()).toBe(640);
    expect(getPref('detail', {})).toEqual({ width: 640 });
    // Whatever else lands under the key is dropped on reading.
    setPref('detail', { width: 'wide', token: 'x' } as unknown as DetailPrefs);
    expect(getPref('detail', {})).toEqual({});
    expect(getDetailWidth()).toBe(420);
    setPref('detail', [1] as unknown as DetailPrefs);
    expect(getDetailWidth()).toBe(420);
    setPref('detail', { width: 50 });
    expect(getDetailWidth()).toBe(360);
  });

  it('keys of the separator: ← widens, → narrows by 16 px, Home/End go to the limits', () => {
    expect(widthForKey('ArrowLeft', 420)).toBe(436);
    expect(widthForKey('ArrowRight', 420)).toBe(404);
    expect(widthForKey('Home', 500)).toBe(360);
    expect(widthForKey('End', 500)).toBe(640);
    expect(widthForKey('a', 500)).toBeNull();
  });
});

describe('DetailPanel', () => {
  beforeEach(() => {
    setPref('detail', {});
    // jsdom has no element scrolling (the content area scrolls to the top on navigation).
    Element.prototype.scrollTo ??= () => undefined;
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('docked: rendered next to the content area, not inside it; header, body and footer; width from storage', () => {
    viewport(true);
    setDetailWidth(500);
    render('/list?panel=' + A);
    const card = screen.getByTestId('detail-panel');
    expect(card).toHaveAttribute('data-mode', 'docked');
    expect(card.closest('[data-content-scroll]')).toBeNull();
    expect(card.parentElement).toHaveAttribute('data-detail-slot');
    expect(card.style.width).toBe('500px');
    expect(within(screen.getByTestId('detail-panel-header')).getByRole('heading', { name: 'Card 1' })).toBeInTheDocument();
    expect(within(screen.getByTestId('detail-panel-header')).getByText('chip')).toBeInTheDocument();
    expect(within(screen.getByTestId('detail-panel-footer')).getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(within(screen.getByTestId('detail-panel-body')).getByText('body')).toBeInTheDocument();
  });

  it('the separator: arrows, Home/End and double click change the width within the limits and store it', () => {
    viewport(true);
    render('/list?panel=' + A);
    const sep = screen.getByRole('separator', { name: 'Ширина карточки' });
    expect(sep).toHaveAttribute('aria-valuenow', '420');
    expect(sep).toHaveAttribute('aria-valuemin', '360');
    expect(sep).toHaveAttribute('aria-valuemax', '640');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(sep).toHaveAttribute('aria-valuenow', '436');
    expect(getDetailWidth()).toBe(436);
    fireEvent.keyDown(sep, { key: 'End' });
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(sep).toHaveAttribute('aria-valuenow', '640');
    fireEvent.keyDown(sep, { key: 'Home' });
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(sep).toHaveAttribute('aria-valuenow', '360');
    expect(screen.getByTestId('detail-panel').style.width).toBe('360px');
    fireEvent.doubleClick(sep);
    expect(sep).toHaveAttribute('aria-valuenow', '420');
    expect(getDetailWidth()).toBe(420);
  });

  it('dragging the left edge to the left widens the card; the width is stored on release only', () => {
    viewport(true);
    render('/list?panel=' + A);
    const sep = screen.getByTestId('detail-panel-resize');
    fireEvent.pointerDown(sep, { clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 700, pointerId: 1 });
    expect(sep).toHaveAttribute('aria-valuenow', '520');
    expect(getDetailWidth()).toBe(420);
    fireEvent.pointerUp(sep, { clientX: 300, pointerId: 1 });
    expect(sep).toHaveAttribute('aria-valuenow', '640');
    expect(getDetailWidth()).toBe(640);
  });

  it('opening pushes a history entry, switching replaces it, Esc goes back to the list', async () => {
    viewport(true);
    const { router } = render('/start');
    await act(() => router.navigate('/list'));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(router.state.location.search).toBe(`?panel=${A}`);
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(router.state.location.search).toBe(`?panel=${B}`);
    expect(screen.getByRole('heading', { name: 'Card 2' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByTestId('detail-panel')).toBeNull());
    // One step back: the list without the card, not the page before it.
    expect(router.state.location.pathname).toBe('/list');
    expect(router.state.location.search).toBe('');
  });

  it('Esc already handled inside the card (a menu, a dialog) does not close it', () => {
    viewport(true);
    render('/list?panel=' + A);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    ev.preventDefault();
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(screen.getByTestId('detail-panel')).toBeInTheDocument();
  });

  it('a direct ?panel= link: closing drops the parameter in place; an invalid id opens nothing', async () => {
    viewport(true);
    const { router } = render('/list?panel=' + A);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
    await vi.waitFor(() => expect(screen.queryByTestId('detail-panel')).toBeNull());
    expect(router.state.location.pathname).toBe('/list');
    expect(router.state.location.search).toBe('');
    await act(() => router.navigate('/list?panel=<script>'));
    expect(screen.queryByTestId('detail-panel')).toBeNull();
  });

  it('narrow: a modal dialog over the content with a backdrop; the content area is locked; Esc closes', async () => {
    viewport(false);
    render('/list?panel=' + A);
    const dialog = await screen.findByRole('dialog', { name: 'Card 1' });
    expect(dialog).toHaveAttribute('data-mode', 'overlay');
    expect(screen.getByTestId('detail-panel-backdrop')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).toBeNull();
    const area = document.querySelector('[data-content-scroll]')!;
    expect(area).toHaveAttribute('data-locked');
    expect(area.className).toContain('overflow-hidden');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByTestId('detail-panel')).toBeNull());
    expect(area).not.toHaveAttribute('data-locked');
    expect(area.className).toContain('overflow-auto');
  });
});
