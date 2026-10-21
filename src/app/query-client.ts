import { QueryClient } from '@tanstack/react-query';
// Remote data belongs here; the active document will belong to the editor store.
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
