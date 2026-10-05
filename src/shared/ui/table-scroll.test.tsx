import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataTable } from './data-table';
import { TableScroll } from './table-scroll';

describe('pinned table header', () => {
  it('TableScroll marks itself scrolled only when it is not at the top', () => {
    render(
      <TableScroll data-testid="scroll">
        <table>
          <thead>
            <tr>
              <th>A</th>
            </tr>
          </thead>
        </table>
      </TableScroll>,
    );
    const el = screen.getByTestId('scroll');
    expect(el).toHaveClass('table-scroll');
    expect(el).not.toHaveAttribute('data-scrolled');
    el.scrollTop = 120;
    fireEvent.scroll(el);
    expect(el).toHaveAttribute('data-scrolled');
    el.scrollTop = 0;
    fireEvent.scroll(el);
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

  it('the CSS pins header cells at top: 0 and the totals row at bottom: 0, unpinned in print, limited by --app-top', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/index.css'), 'utf8');
    expect(css).toMatch(/\.table-scroll \{[^}]*overflow: auto;[^}]*max-height: calc\(100dvh - var\(--app-top, 0px\)\)/);
    expect(css).toMatch(/\.table-scroll :is\(thead > tr > th, \[data-sticky-head\]\) \{[^}]*position: sticky;[^}]*top: 0;/);
    expect(css).toMatch(/\[data-sticky-foot\]\) \{[^}]*position: sticky;[^}]*bottom: 0;/);
    expect(css).toMatch(/@media print \{[^@]*\.table-scroll \{[^}]*overflow: visible;/);
  });
});
