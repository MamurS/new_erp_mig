import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockServer, loginAs, renderRoutes } from '@/test/utils';
import { db } from '@/mocks/db';
import { RevealField } from './RevealField';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => vi.useRealTimers());

describe('RevealField / reveal modal', () => {
  it('requires a reason, shows the value for 30 seconds, then masks it again and writes audit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await loginAs('operator');
    const person = db().insured[3]!;
    renderRoutes(
      [{ path: '/', element: <dl><RevealField insuredId={person.id} field="pinfl" masked="••••••••••0000" canReveal claimNumber="У-2026-000001" /></dl> }],
      '/',
    );
    expect(screen.getByTestId('masked-pinfl')).toHaveTextContent('••••••••••0000');
    expect(document.body.textContent).not.toContain(person.pinfl);

    await user.click(screen.getByRole('button', { name: 'Показать ПИНФЛ' }));
    const dialog = await screen.findByRole('dialog');
    // Too short a reason: rejected on the client, nothing is revealed.
    await user.type(screen.getByLabelText('Причина просмотра'), 'коротко');
    await user.click(screen.getByRole('button', { name: 'Показать' }));
    expect(await screen.findByText('Опишите причину: минимум 10 символов')).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();

    const auditBefore = db().audit.length;
    await user.click(screen.getByRole('button', { name: 'Обработка убытка №У-2026-000001' }));
    await user.click(screen.getByRole('button', { name: 'Показать' }));
    expect(await screen.findByTestId('revealed-pinfl')).toHaveTextContent(person.pinfl);
    expect(db().audit.length).toBe(auditBefore + 1);
    expect(db().audit[0]!.action).toBe('reveal_pii');
    expect(db().audit[0]!.reason).toContain('Обработка убытка №У-2026-000001');

    await act(async () => {
      vi.advanceTimersByTime(29_000);
    });
    expect(screen.getByTestId('revealed-pinfl')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await waitFor(() => expect(screen.queryByTestId('revealed-pinfl')).not.toBeInTheDocument());
    expect(screen.getByTestId('masked-pinfl')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(person.pinfl);
  });

  it('hides the button for roles without reveal rights', async () => {
    await loginAs('underwriter');
    renderRoutes([{ path: '/', element: <dl><RevealField insuredId="x" field="phone" masked="+998 •• ••• •• 12" canReveal={false} /></dl> }], '/');
    expect(screen.queryByRole('button', { name: /Показать/ })).not.toBeInTheDocument();
  });
});
