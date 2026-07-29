/**
 * Authenticated application shell.
 *
 * Layout: a fixed sidebar from `lg` upward, with the content column offset by
 * its width. Below `lg` the sidebar becomes a drawer and the offset disappears.
 *
 * The drawer closes on navigation (handled in Sidebar) and on Escape, because
 * a drawer that traps a mobile user is a common and avoidable annoyance.
 */
import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { Navbar } from '@/layouts/navbar';
import { Sidebar } from '@/layouts/sidebar';

export const DashboardLayout = (): React.JSX.Element => {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const location = useLocation();

  // Close the drawer whenever the route changes.
  React.useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  // Escape closes the drawer.
  React.useEffect(() => {
    if (!isSidebarOpen) return undefined;

    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsSidebarOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSidebarOpen]);

  // Prevent the page behind the drawer from scrolling while it is open.
  React.useEffect(() => {
    document.body.style.overflow = isSidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSidebarOpen]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex min-h-screen flex-col lg:pl-64">
        <Navbar onMenuToggle={() => setIsSidebarOpen((open) => !open)} />

        {/* `id` is the skip-link target; `tabIndex={-1}` makes it focusable
            programmatically without adding it to the tab order. */}
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 focus:outline-none sm:p-6">
          <div className="mx-auto w-full max-w-[1440px]">
            <Outlet />
          </div>
        </main>

        <footer className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground sm:px-6">
          Mini ERP + CRM Operations Portal · v1.0.0
        </footer>
      </div>
    </div>
  );
};
