import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataTable } from './data-table';
import { TableScroll } from './table-scroll';

describe('pinned table header', () => {
  it('TableScroll never scrolls by itself; it marks the header pinned while the content area has scrolled past its top', () => {
    render(
      <div data-testid="area" style={{ overflowY: 'auto' }}>
        <TableScroll data-testid="scroll">
          <table>
            <thead>
              <tr>
                <th>A</th>
              </tr>
            </thead>
          </table>
        </TableScroll>
      </div>,
    );
    const area = screen.getByTestId('area');
    const el = screen.getByTestId('scroll');
    expect(el).toHaveClass('table-scroll');
    expect(el).not.toHaveAttribute('data-scrolled');
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
    area.getBoundingClientRect = () => rect(52, 640);
    el.getBoundingClientRect = () => rect(-200, 900);
    fireEvent.scroll(area);
    expect(el).toHaveAttribute('data-scrolled');
    el.getBoundingClientRect = () => rect(120, 900);
    fireEvent.scroll(area);
    expect(el).not.toHaveAttribute('data-scrolled');
  });

  it('DataTable renders inside TableScroll and puts totals into a tfoot', () => {
    render(
      <DataTable
        caption="Строки"
        columns={[
          { key: 'name', header: 'Имя', cell: (r: { id: string; amount: number }) => r.id },
          { key: 'amount', header: 'Сумма', cell: (r) => r.amount },
        ]}
        rows={[
          { id: 'a', amount: 1 },
          { id: 'b', amount: 2 },
        ]}
        rowKey={(r) => r.id}
        totals={{ name: 'Итого', amount: 3 }}
      />,
    );
    const table = screen.getByRole('table', { name: 'Строки' });
    expect(table.closest('.table-scroll')).not.toBeNull();
    const foot = screen.getByTestId('table-totals');
    expect(foot.tagName).toBe('TFOOT');
    expect(foot).toHaveTextContent('Итого');
    expect(foot).toHaveTextContent('3');
  });

  it('the CSS: the wrapper has no overflow or height limit; header at top: 0, totals above the pager, pager at bottom: 0; unpinned in print', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/index.css'), 'utf8');
    const wrapper = /\.table-scroll \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(wrapper).not.toMatch(/overflow|max-height/);
    expect(css).toMatch(/\.table-scroll :is\(thead > tr > th, \[data-sticky-head\]\) \{[^}]*position: sticky;[^}]*top: 0;/);
    expect(css).toMatch(/\[data-sticky-foot\]\) \{[^}]*position: sticky;[^}]*bottom: var\(--pager-h, 0px\);/);
    expect(css).toMatch(/\.table-pager \{[^}]*position: sticky;[^}]*bottom: 0;/);
    expect(css).toMatch(/@media print \{[^@]*\[data-content-scroll\] \{[^}]*overflow: visible;[^@]*\.table-pager \{[^}]*position: static;/);
  });
});
