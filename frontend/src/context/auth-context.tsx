/**
 * Authentication state.
 *
 * React Context rather than Redux Toolkit: the auth slice is one user object
 * and four actions, read by roughly a dozen components and written by three.
 * Redux would add a store, slices, typed hooks and middleware to manage less
 * state than a single form holds. Server state is React Query's job, and it is
 * the only other global state this application has — which leaves Context as
 * the right-sized tool.
 *
 * SESSION BOOTSTRAP: the access token is deliberately held in memory only (see
 * api/client.ts), so a page refresh loses it. On mount we attempt a silent
 * refresh using the httpOnly cookie. That produces exactly one flash of the
 * loading screen and no flash of the login screen for a signed-in user.
 */
import * as React from 'react';

import { setAccessToken, setSessionExpiredHandler } from '@/api/client';
import { authService } from '@/services/auth.service';
import { toast } from '@/hooks/use-toast';
import type { RoleName, User } from '@/types/api.types';

interface AuthContextValue {
  user: User | null;
  /** True until the initial session check completes. */
  isInitialising: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Applies a locally-updated user (e.g. after a profile save). */
  setUser: (user: User) => void;
  /** True when the current user holds any of the given roles. */
  hasRole: (...roles: RoleName[]) => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const [user, setUserState] = React.useState<User | null>(null);
  const [isInitialising, setIsInitialising] = React.useState(true);

  /** Clears client-side session state. Does not call the API. */
  const clearSession = React.useCallback(() => {
    setAccessToken(null);
    setUserState(null);
  }, []);

  /**
   * Registers the handler the Axios interceptor calls when a refresh fails.
   * This is how a 401 deep inside a query surfaces as a redirect to /login
   * without every component knowing about auth.
   */
  React.useEffect(() => {
    setSessionExpiredHandler(() => {
      clearSession();
      toast.warning('Session expired', 'Please sign in again to continue.');
    });

    return () => setSessionExpiredHandler(null);
  }, [clearSession]);

  /** Silent session restore on first mount. */
  React.useEffect(() => {
    let cancelled = false;

    const restore = async (): Promise<void> => {
      try {
        const result = await authService.refresh();
        if (cancelled) return;

        setAccessToken(result.tokens.accessToken);
        setUserState(result.user);
      } catch {
        // No valid refresh cookie — the expected path for a first-time visitor,
        // so this is silent rather than an error.
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setIsInitialising(false);
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = React.useCallback(async (email: string, password: string): Promise<User> => {
    const result = await authService.login({ email, password });
    setAccessToken(result.tokens.accessToken);
    setUserState(result.user);
    return result.user;
  }, []);

  const logout = React.useCallback(async (): Promise<void> => {
    try {
      await authService.logout();
    } catch {
      // A failed logout call must still sign the user out locally — otherwise a
      // network blip leaves them stuck in an app they asked to leave.
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const hasRole = React.useCallback(
    (...roles: RoleName[]): boolean => (user ? roles.includes(user.role.name) : false),
    [user],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      isInitialising,
      isAuthenticated: user !== null,
      login,
      logout,
      setUser: setUserState,
      hasRole,
    }),
    [user, isInitialising, login, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Throws when used outside the provider. A hard failure at development time is
 * far better than a silent `undefined.user` crash in a nested component.
 */
export const useAuth = (): AuthContextValue => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
};
