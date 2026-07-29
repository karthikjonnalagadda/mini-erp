/**
 * Sign-in screen.
 *
 * Two-column split at desktop widths: a branded panel that explains what the
 * system is, and the form. On mobile the branding collapses to a compact header
 * so the form stays above the fold with the keyboard open.
 */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Boxes, Eye, EyeOff, ShieldCheck, TrendingUp, Warehouse } from 'lucide-react';

import { ApiRequestError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField, fieldAria } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/auth-context';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/utils/cn';

/**
 * Login validation is deliberately loose on the password: enforcing the
 * composition policy here would tell an attacker that a candidate password
 * cannot possibly be correct without a single request reaching the server.
 */
const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

/** Seeded accounts, shown in development to make the demo one click away. */
const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@erpportal.io' },
  { role: 'Sales', email: 'sales@erpportal.io' },
  { role: 'Warehouse', email: 'warehouse@erpportal.io' },
  { role: 'Accounts', email: 'accounts@erpportal.io' },
] as const;

const DEMO_PASSWORD = 'Admin@12345';

export const LoginPage = (): React.JSX.Element => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  /** Where the user was heading before the guard redirected them here. */
  const redirectTo =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/dashboard';

  const onSubmit = async (values: LoginForm): Promise<void> => {
    try {
      const user = await login(values.email, values.password);
      toast.success(`Welcome back, ${user.firstName}`, `Signed in as ${user.role.name}.`);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        // 401 attaches to the form as a whole, not to a field: the server does
        // not say WHICH credential was wrong, and neither should the UI.
        if (error.code === 'INVALID_CREDENTIALS' || error.status === 401) {
          setError('root', { message: error.message });
          return;
        }

        if (error.code === 'RATE_LIMIT_EXCEEDED') {
          setError('root', {
            message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
          });
          return;
        }

        if (error.code === 'FORBIDDEN') {
          setError('root', { message: error.message });
          return;
        }

        setError('root', { message: error.message });
        return;
      }

      setError('root', { message: 'Unable to sign in. Please try again.' });
    }
  };

  const fillDemoAccount = (email: string): void => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', DEMO_PASSWORD, { shouldValidate: true });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — desktop only. */}
      <div className="relative hidden flex-col justify-between bg-sidebar p-10 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-sidebar-accent">
            <Boxes className="size-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">Mini ERP + CRM</p>
            <p className="text-xs uppercase tracking-wider text-sidebar-foreground/60">
              Operations Portal
            </p>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Run your distribution business from one place.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-sidebar-foreground/75">
            Customers, catalogue, live stock and delivery challans — with a full audit trail on
            every movement.
          </p>

          <ul className="mt-8 space-y-4">
            {[
              { Icon: TrendingUp, text: 'CRM with follow-up scheduling and activity history' },
              { Icon: Warehouse, text: 'Real-time inventory with an append-only stock ledger' },
              { Icon: ShieldCheck, text: 'Role-based access with separation of duties' },
            ].map(({ Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-white/8">
                  <Icon className="size-3.5 text-sidebar-accent" aria-hidden="true" />
                </span>
                <span className="text-sm text-sidebar-foreground/80">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-sidebar-foreground/45">
          © {new Date().getFullYear()} Mini ERP + CRM · v1.0.0
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-sm">
          {/* Compact brand for mobile. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary">
              <Boxes className="size-4.5 text-primary-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Mini ERP + CRM</p>
              <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                Operations Portal
              </p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Enter your credentials to access the portal.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* Form-level error, e.g. bad credentials or rate limiting. */}
            {errors.root && (
              <div
                role="alert"
                className="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive"
              >
                {errors.root.message}
              </div>
            )}

            <FormField label="Email address" htmlFor="email" required error={errors.email?.message}>
              <Input
                {...register('email')}
                {...fieldAria('email', errors.email?.message)}
                type="email"
                autoComplete="username"
                placeholder="you@company.com"
                hasError={Boolean(errors.email)}
                autoFocus
              />
            </FormField>

            <FormField label="Password" htmlFor="password" required error={errors.password?.message}>
              <div className="relative">
                <Input
                  {...register('password')}
                  {...fieldAria('password', errors.password?.message)}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  hasError={Boolean(errors.password)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-0 top-0 flex h-9 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                  // Not a tab stop: it would sit between the password field and
                  // the submit button, breaking the natural keyboard flow.
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </FormField>

            <Button type="submit" className="w-full" loading={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {/* Demo credentials — development builds only. */}
          {import.meta.env.DEV && (
            <Card className="mt-6 border-dashed">
              <CardContent className="p-4">
                <p className="text-xs font-medium text-foreground">Demo accounts</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Password for all seeded users: <code className="font-mono">{DEMO_PASSWORD}</code>
                </p>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {DEMO_ACCOUNTS.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      onClick={() => fillDemoAccount(account.email)}
                      className={cn(
                        'rounded-md border border-border px-2 py-1.5 text-left text-xs transition-colors',
                        'hover:border-primary/40 hover:bg-accent',
                      )}
                    >
                      <span className="block font-medium text-foreground">{account.role}</span>
                      <span className="block truncate text-[0.65rem] text-muted-foreground">
                        {account.email}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
