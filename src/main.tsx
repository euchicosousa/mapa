import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './app/query-client';
import { router } from './app/router';
import './styles.css';
import { connectDiagnostics } from './lib/diagnostics';

const disconnectDiagnostics = connectDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(disconnectDiagnostics);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
