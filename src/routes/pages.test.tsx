import { render, screen, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it } from 'vitest';
import { RouteErrorPage } from './pages';
afterEach(cleanup);
it('shows a recoverable route error without leaking raw details', async () => {
  const router = createMemoryRouter([{ path: '/', loader: () => { throw new Error('private_error_payload'); }, element: <div>Private</div>, ErrorBoundary: RouteErrorPage }]);
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('heading', { name: 'Não foi possível abrir esta página' })).toBeVisible();
  expect(screen.queryByText('private_error_payload')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
});
