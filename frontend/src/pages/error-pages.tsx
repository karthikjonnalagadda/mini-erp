/**
 * Terminal route states.
 *
 * Both pages give the user a way forward rather than a dead end. The 403 in
 * particular names the role requirement, because "access denied" with no
 * explanation generates a support ticket every time.
 */
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard, ShieldOff, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-context';

const ErrorLayout = ({
  icon: Icon,
  code,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  code: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}): React.JSX.Element => (
  <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
    <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-muted">
      <Icon className="size-7 text-muted-foreground" aria-hidden="true" />
    </div>

    <p className="text-sm font-semibold tracking-wide text-muted-foreground">{code}</p>
    <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
    <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>

    <div className="mt-7 flex flex-wrap items-center justify-center gap-2">{children}</div>
  </div>
);

export const NotFoundPage = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  return (
    <ErrorLayout
      icon={SearchX}
      code="404"
      title="Page not found"
      description="The page you are looking for does not exist, or it may have been moved."
    >
      <Button variant="outline" onClick={() => navigate(-1)}>
        <ArrowLeft aria-hidden="true" />
        Go back
      </Button>
      <Button asChild>
        <Link to={isAuthenticated ? '/dashboard' : '/login'}>
          <LayoutDashboard aria-hidden="true" />
          {isAuthenticated ? 'Go to dashboard' : 'Sign in'}
        </Link>
      </Button>
    </ErrorLayout>
  );
};

export const ForbiddenPage = (): React.JSX.Element => {
  const { user } = useAuth();

  return (
    <ErrorLayout
      icon={ShieldOff}
      code="403"
      title="You do not have access"
      description={
        user
          ? `Your role (${user.role.name}) does not have permission to view this page. Contact an administrator if you believe this is a mistake.`
          : 'You do not have permission to view this page.'
      }
    >
      <Button asChild>
        <Link to="/dashboard">
          <LayoutDashboard aria-hidden="true" />
          Go to dashboard
        </Link>
      </Button>
    </ErrorLayout>
  );
};
