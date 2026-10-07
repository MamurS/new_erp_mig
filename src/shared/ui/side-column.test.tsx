import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderRoutes } from '@/test/utils';
import { ContentScroll } from './content-scroll';
import { SideColumn } from './side-column';
import { markStuck, SideSection } from './sticky-sections';
import { Card } from './page';

function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: wide, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

function Page() {
  return (
    <ContentScroll>
      <p>main</p>
      <SideColumn label="Side" header={<span>Head</span>} footer={<button type="button">Act</button>}>
        <Card title="Block">body</Card>
        <SideSection title="Section">text</SideSection>
      </SideColumn>
    </ContentScroll>
  );
}

const render = () => renderRoutes([{ path: '/p', element: <Page /> }], '/p');

beforeAll(() => {
  Element.prototype.scrollTo ??= () => undefined;
});
afterEach(() => vi.unstubAllGlobals());

describe('SideColumn', () => {
  it('≥ 1280 px: a sibling of the content area with a pinned header and actions; its sections pin their headings', async () => {
    viewport(true);
    render();
    const col = await screen.findByRole('complementary', { name: 'Side' });
    expect(col).toHaveAttribute('data-mode', 'docked');
    expect(col.closest('[data-content-scroll]')).toBeNull();
    expect(col.closest('[data-side-slot="end"]')).not.toBeNull();
    expect(screen.getByText('main').closest('[data-content-scroll]')).not.toBeNull();
    const scroll = screen.getByTestId('side-column-scroll');
    expect(scroll).toHaveAttribute('data-column-scroll');
    expect(screen.getByTestId('side-column-header')).toHaveClass('sticky', 'top-0');
    expect(screen.getByTestId('side-column-footer')).toHaveClass('sticky', 'bottom-0');
    // The card and the section inside the column pin their headings.
    expect(screen.getByRole('heading', { name: 'Block' }).closest('[data-section-head]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Section' }).closest('[data-section-head]')).not.toBeNull();
  });

  it('< 1280 px: stays where the page put it, inside the content area, after the main content', () => {
    viewport(false);
    render();
    const col = screen.getByRole('complementary', { name: 'Side' });
    expect(col).toHaveAttribute('data-mode', 'inline');
    expect(col.closest('[data-content-scroll]')).not.toBeNull();
    expect(screen.getByText('main').compareDocumentPosition(col) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a card outside a column keeps an ordinary heading', () => {
    viewport(true);
    renderRoutes([{ path: '/p', element: <Card title="Plain">x</Card> }], '/p');
    expect(screen.getByRole('heading', { name: 'Plain' }).closest('[data-section-head]')).toBeNull();
  });
});

describe('markStuck', () => {
  it('marks a heading that no longer stands at the top of its section', () => {
    document.body.innerHTML = '<section id="s"><div data-section-head id="h"></div></section>';
    const s = document.getElementById('s')!;
    const h = document.getElementById('h')!;
    const rect = (top: number) => ({ top, bottom: top + 10, left: 0, right: 0, width: 0, height: 10, x: 0, y: top, toJSON: () => ({}) });
    s.getBoundingClientRect = () => rect(0);
    h.getBoundingClientRect = () => rect(0);
    markStuck();
    expect(h.hasAttribute('data-stuck')).toBe(false);
    s.getBoundingClientRect = () => rect(-200);
    markStuck();
    expect(h.hasAttribute('data-stuck')).toBe(true);
    document.body.innerHTML = '';
  });
});
