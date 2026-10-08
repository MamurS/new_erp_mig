/* The help renderer: React elements only, internal links to available anchors only. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HelpMarkdown } from './HelpMarkdown';

const MD = [
  '### Heading {#sub}',
  '',
  'Text with **bold**, *em*, `code` and [a link](#kp), [hidden](#claims-fraud), [bad](javascript:alert(1)) and [ext](https://example.com).',
  '',
  'See раздел 12 and раздел 11.',
  '',
  '1. One',
  '2. Two',
  '   - nested',
  '',
  '| A | B |',
  '| --- | --- |',
  '| <img src=x onerror=alert(1)> | <b>x</b> |',
].join('\n');

describe('HelpMarkdown', () => {
  it('renders the subset with links only to anchors the role can read', () => {
    const available = new Set(['kp', 'finance']);
    const { container } = render(
      <HelpMarkdown markdown={MD} anchorHref={(a) => (available.has(a) ? `/staff/help#${a}` : null)} articleByNumber={(n) => ({ '12': 'finance', '11': 'claims' })[n] ?? null} />,
    );
    expect(container.querySelector('h3#sub')?.textContent).toBe('Heading');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('em');
    expect(container.querySelector('code')?.textContent).toBe('code');
    const links = [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['a link', '/staff/help#kp'],
      ['раздел 12', '/staff/help#finance'],
    ]);
    expect(screen.getByText(/hidden/)).toBeTruthy();
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.innerHTML).not.toContain('https://example.com');
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelector('ol li ul li')?.textContent).toBe('nested');
    expect(container.querySelector('th')?.textContent).toBe('A');
    // Raw HTML in the source stays text.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('td b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('lets the caller decorate text runs (glossary terms)', () => {
    const { container } = render(<HelpMarkdown markdown="ГП одобрено" anchorHref={() => null} renderText={(t) => <span data-term="1">{t}</span>} />);
    expect(container.querySelector('[data-term]')?.textContent).toBe('ГП одобрено');
  });
});
