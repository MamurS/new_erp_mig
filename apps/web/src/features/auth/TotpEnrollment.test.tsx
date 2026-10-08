/*
 * The first sign-in without a second factor (API: `totpEnrollment` in the answer of the password step): the code
 * screen shows the QR code and the key of the new factor, the first code confirms it. The secret is never put into
 * the URL, the router's history state or any storage. The mock has no enrolment (demo accounts have their factor),
 * so the API's answers are given here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { clearSession, getUser } from '@/shared/auth/session';
import { createMockServer, renderRoutes } from '@/test/utils';
import LoginPage from './LoginPage';
import OtpPage from './OtpPage';
import { groupedSecret } from './TotpEnrollment';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  clearSession();
});
afterAll(() => server.close());

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/MIG:operator%40demo.mig.uz?secret=${SECRET}&issuer=MIG`;
const USER = { id: '6f1c2b8e-1d0a-4c55-9a43-1c0b8d7e2f10', role: 'operator', displayName: 'Yusupova Nigora Alisherovna', authority: {} };

describe('TOTP enrolment at the first sign-in', () => {
  it('shows the QR code and the key on the code screen; the first code signs in', async () => {
    const user = userEvent.setup();
    let otpBody: unknown = null;
    server.use(
      http.post('*/api/auth/login', () => HttpResponse.json({ challengeId: 'c-1', resendInSec: 60, totpEnrollment: { uri: URI, secret: SECRET } })),
      http.post('*/api/auth/otp', async ({ request }) => {
        otpBody = await request.json();
        return HttpResponse.json({ user: USER });
      }),
    );
    const { router } = renderRoutes(
      [
        { path: '/login', element: <LoginPage /> },
        { path: '/login/otp', element: <OtpPage /> },
        { path: '/staff', element: <p>home</p> },
      ],
      '/login',
    );
    await user.type(screen.getByLabelText('Email'), 'operator@demo.mig.uz');
    await user.type(screen.getByLabelText('Пароль'), 'Demo-2026!');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByRole('heading', { name: 'Подключите второй фактор' })).toBeInTheDocument();
    const qr = await screen.findByTestId('totp-qr');
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByTestId('totp-secret')).toHaveTextContent(groupedSecret(SECRET));
    // Not in the URL nor in the history state.
    expect(router.state.location.pathname + router.state.location.search).toBe('/login/otp');
    expect(JSON.stringify(router.state.location.state)).not.toContain(SECRET);

    await user.type(screen.getByLabelText('Цифра 1'), '123456');
    await waitFor(() => expect(router.state.location.pathname).toBe('/staff'));
    expect(otpBody).toEqual({ challengeId: 'c-1', code: '123456' });
    expect(getUser()?.role).toBe('operator');
  });

  it('without an enrolment the code screen is the usual one', async () => {
    const user = userEvent.setup();
    renderRoutes(
      [
        { path: '/login', element: <LoginPage /> },
        { path: '/login/otp', element: <OtpPage /> },
      ],
      '/login',
    );
    await user.type(screen.getByLabelText('Email'), 'operator@demo.mig.uz');
    await user.type(screen.getByLabelText('Пароль'), 'Demo-2026!');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('heading', { name: 'Второй фактор' })).toBeInTheDocument();
    expect(screen.queryByTestId('totp-enrollment')).toBeNull();
  });

  it('groups the key by four characters', () => {
    expect(groupedSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });
});
