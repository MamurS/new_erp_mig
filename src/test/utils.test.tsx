import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { createMockServer, loginAs, renderRoutes } from './utils';
import { useUser } from '@/shared/auth/session';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

function Who() {
  const u = useUser();
  return <p>role:{u?.role}</p>;
}

describe('test utils', () => {
  it('logs in through the mock and renders a route', async () => {
    await loginAs('operator');
    renderRoutes([{ path: '/', element: <Who /> }], '/');
    expect(await screen.findByText('role:operator')).toBeInTheDocument();
  });
});
