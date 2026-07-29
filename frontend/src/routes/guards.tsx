/**
 * Route guards.
 *
 * IMPORTANT: these are a UX affordance, NOT a security boundary. Every rule
 * enforced here is also enforced by the API's RBAC middleware. A user who edits
 * their bundle to bypass `RoleGuard` reaches a screen whose every request comes
 * back 403. Client-side authorisation exists to avoid showing people doors they
 * cannot open — never to keep them locked.
 */
import * as React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { PageLoader } from '@/components/ui/states';
import { useAuth } from '@/context/auth-context';
import type { RoleName } from '@/types/api.types';

/**
 * Requires a signed-in user.
 *
 * While the session is being restored we render a loader rather than
 * redirecting — redirecting first would bounce every signed-in user through
 * /login on each page refresh.
 */
export const RequireAuth = (): React.JSX.Element => {
  const { isAuthenticated, isInitialising } = useAuth();
  const location = useLocation();

  if (isInitialising) return <PageLoader />;

  if (!isAuthenticated) {
    // `state.from` lets the login page return the user where they were headed.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};

/** Keeps a signed-in user out of /login. */
export const RequireGuest = (): React.JSX.Element => {
  const { isAuthenticated, isInitialising } = useAuth();

  if (isInitialising) return <PageLoader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
};

export interface RoleGuardProps {
  allowed: RoleName[];
}

/** Restricts a subtree to specific roles. Mounted inside `RequireAuth`. */
export const RoleGuard = ({ allowed }: RoleGuardProps): React.JSX.Element => {
  const { user, isInitialising } = useAuth();

  if (isInitialising) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;

  if (!allowed.includes(user.role.name)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <Outlet />;
};
