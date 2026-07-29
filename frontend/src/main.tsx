/**
 * Application entry point.
 *
 * Provider order matters:
 *   ErrorBoundary  — outermost, so a crash in any provider is still caught
 *   QueryClient    — must wrap anything that fetches
 *   Theme          — no dependencies
 *   Router         — must wrap AuthProvider, which uses navigation state
 *   Auth           — depends on the query client and the router
 */
import * as React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/api/query-client';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { AuthProvider } from '@/context/auth-context';
import { ThemeProvider } from '@/context/theme-context';
import { Toaster } from '@/hooks/use-toast';
import { AppRoutes } from '@/routes';

import '@/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root was not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <AuthProvider>
              {/* Skip link: the first tab stop, letting keyboard users jump
                  past the sidebar straight to the page content. */}
              <a
                href="#main-content"
                className="sr-only-focusable fixed left-4 top-4 z-[100] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg"
              >
                Skip to main content
              </a>

              <AppRoutes />
              <Toaster />
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
