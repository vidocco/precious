import '@fontsource-variable/instrument-sans/standard.css';
import '@fontsource-variable/instrument-sans/standard-italic.css';
import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { makeRouter } from './app/router.tsx';
import { listenForInstall } from './lib/install.ts';
import { applyTheme, readTheme } from './lib/theme.ts';

applyTheme(readTheme());
listenForInstall();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});
const router = makeRouter(queryClient);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

// Makes the app installable and quick to open; it never caches your data (see public/sw.js).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not served over HTTPS or localhost: the app works the same, it just can't be installed.
    });
  });
}
