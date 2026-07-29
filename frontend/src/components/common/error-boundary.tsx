/**
 * Error boundary.
 *
 * React unmounts the entire tree when a render throws, so without a boundary a
 * single bad `.map()` on one widget blanks the whole application. This catches
 * the throw, keeps the shell alive and offers a way out.
 *
 * Must be a class component: `componentDidCatch` and `getDerivedStateFromError`
 * have no hook equivalents.
 */
import * as React from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional custom fallback; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // In production this is where a Sentry/Rollbar call goes. Logging to the
    // console is the honest placeholder — silently swallowing would make a
    // white-screen report unactionable.
    // eslint-disable-next-line no-console
    console.error('Unhandled render error:', error, errorInfo.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;
    if (fallback) return fallback(error, this.reset);

    return (
      <div
        role="alert"
        className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center"
      >
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/12">
          <AlertOctagon className="size-6 text-destructive" aria-hidden="true" />
        </div>

        <h2 className="text-lg font-semibold text-foreground">This screen ran into a problem</h2>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          The error has been logged. You can try again, or return to the dashboard.
        </p>

        {/* The message is shown in development only — a production stack trace
            tells a user nothing and can leak internal detail. */}
        {import.meta.env.DEV && (
          <pre className="mt-4 max-w-2xl overflow-x-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-muted-foreground">
            {error.message}
          </pre>
        )}

        <div className="mt-6 flex gap-2">
          <Button onClick={this.reset} variant="outline">
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button onClick={() => window.location.assign('/dashboard')}>Go to dashboard</Button>
        </div>
      </div>
    );
  }
}
