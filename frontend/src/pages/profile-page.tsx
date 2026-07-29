/**
 * Profile and security.
 *
 * Changing a password revokes every session, including this one — the usual
 * reason someone changes a password is that they think it leaked, and leaving
 * the attacker's refresh token valid for another week would defeat the point.
 * The UI says so before the user commits, then signs them out.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, LogOut, ShieldCheck, UserCircle } from 'lucide-react';

import { ApiRequestError } from '@/api/client';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField, fieldAria } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/auth-context';
import { toast, toastApiError } from '@/hooks/use-toast';
import { authService } from '@/services/auth.service';
import { formatDateTime, initialsOf } from '@/utils/format';

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  phone: z
    .union([z.string().trim().regex(/^\+?\d{6,15}$/, 'Enter a valid phone number'), z.literal('')])
    .optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .max(72, 'At most 72 characters')
      .regex(/[a-z]/, 'Needs a lowercase letter')
      .regex(/[A-Z]/, 'Needs an uppercase letter')
      .regex(/\d/, 'Needs a number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current one',
  });

type PasswordForm = z.infer<typeof passwordSchema>;

export const ProfilePage = (): React.JSX.Element => {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      phone: user?.phone ?? '',
    },
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const profileMutation = useMutation({
    mutationFn: (values: ProfileForm) =>
      authService.updateProfile({
        firstName: values.firstName,
        lastName: values.lastName,
        ...(values.phone ? { phone: values.phone } : {}),
      }),
    onSuccess: (updated) => {
      setUser(updated);
      toast.success('Profile updated');
      profileForm.reset({
        firstName: updated.firstName,
        lastName: updated.lastName,
        phone: updated.phone ?? '',
      });
    },
    onError: (error: unknown) => toastApiError(error, 'Could not update profile'),
  });

  const passwordMutation = useMutation({
    mutationFn: (values: PasswordForm) => authService.changePassword(values),
    onSuccess: async () => {
      toast.success('Password changed', 'All sessions were revoked. Please sign in again.');
      passwordForm.reset();
      // The refresh cookie is already cleared server-side; clean up locally and
      // send the user to the login screen rather than leaving them on a page
      // whose next request will 401.
      await logout();
      navigate('/login', { replace: true });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError && error.code === 'INVALID_CREDENTIALS') {
        passwordForm.setError('currentPassword', { message: error.message });
        return;
      }
      toastApiError(error, 'Could not change password');
    },
  });

  const signOutEverywhere = useMutation({
    mutationFn: () => authService.logoutAll(),
    onSuccess: async (result) => {
      toast.success('Signed out everywhere', `${result.revokedSessions} session(s) revoked.`);
      await logout();
      navigate('/login', { replace: true });
    },
    onError: (error: unknown) => toastApiError(error, 'Could not revoke sessions'),
  });

  if (!user) return <div />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Profile & security" description="Your account details and sign-in options" />

      <div className="space-y-4">
        {/* Identity summary */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
              {initialsOf(user.fullName)}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-foreground">{user.fullName}</p>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="soft-primary">
                  <ShieldCheck className="size-3" aria-hidden="true" />
                  {user.role.name}
                </Badge>
                <span className="text-xs text-muted-foreground">{user.role.description}</span>
              </div>
            </div>

            <div className="shrink-0 text-right text-xs text-muted-foreground">
              <p>Last sign-in</p>
              <p className="text-foreground">
                {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Profile details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCircle className="size-4" aria-hidden="true" />
              Personal details
            </CardTitle>
            <CardDescription>
              Your email address and role are managed by an administrator.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form
              onSubmit={profileForm.handleSubmit((values) => profileMutation.mutate(values))}
              noValidate
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="First name"
                  htmlFor="firstName"
                  required
                  error={profileForm.formState.errors.firstName?.message}
                >
                  <Input
                    {...profileForm.register('firstName')}
                    {...fieldAria('firstName', profileForm.formState.errors.firstName?.message)}
                    hasError={Boolean(profileForm.formState.errors.firstName)}
                  />
                </FormField>

                <FormField
                  label="Last name"
                  htmlFor="lastName"
                  required
                  error={profileForm.formState.errors.lastName?.message}
                >
                  <Input
                    {...profileForm.register('lastName')}
                    {...fieldAria('lastName', profileForm.formState.errors.lastName?.message)}
                    hasError={Boolean(profileForm.formState.errors.lastName)}
                  />
                </FormField>
              </div>

              <FormField
                label="Phone"
                htmlFor="phone"
                error={profileForm.formState.errors.phone?.message}
              >
                <Input
                  {...profileForm.register('phone')}
                  {...fieldAria('phone', profileForm.formState.errors.phone?.message)}
                  type="tel"
                  placeholder="9876543210"
                  hasError={Boolean(profileForm.formState.errors.phone)}
                />
              </FormField>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  loading={profileMutation.isPending}
                  disabled={!profileForm.formState.isDirty}
                >
                  Save changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" aria-hidden="true" />
              Change password
            </CardTitle>
            <CardDescription>
              Changing your password signs you out of every device, including this one.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form
              onSubmit={passwordForm.handleSubmit((values) => passwordMutation.mutate(values))}
              noValidate
              className="space-y-4"
            >
              <FormField
                label="Current password"
                htmlFor="currentPassword"
                required
                error={passwordForm.formState.errors.currentPassword?.message}
              >
                <Input
                  {...passwordForm.register('currentPassword')}
                  {...fieldAria(
                    'currentPassword',
                    passwordForm.formState.errors.currentPassword?.message,
                  )}
                  type="password"
                  autoComplete="current-password"
                  hasError={Boolean(passwordForm.formState.errors.currentPassword)}
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="New password"
                  htmlFor="newPassword"
                  required
                  error={passwordForm.formState.errors.newPassword?.message}
                  hint="8+ chars with upper, lower and a digit"
                >
                  <Input
                    {...passwordForm.register('newPassword')}
                    {...fieldAria(
                      'newPassword',
                      passwordForm.formState.errors.newPassword?.message,
                      '8+ chars with upper, lower and a digit',
                    )}
                    type="password"
                    autoComplete="new-password"
                    hasError={Boolean(passwordForm.formState.errors.newPassword)}
                  />
                </FormField>

                <FormField
                  label="Confirm new password"
                  htmlFor="confirmNewPassword"
                  required
                  error={passwordForm.formState.errors.confirmPassword?.message}
                >
                  <Input
                    {...passwordForm.register('confirmPassword')}
                    {...fieldAria(
                      'confirmNewPassword',
                      passwordForm.formState.errors.confirmPassword?.message,
                    )}
                    type="password"
                    autoComplete="new-password"
                    hasError={Boolean(passwordForm.formState.errors.confirmPassword)}
                  />
                </FormField>
              </div>

              <div className="flex justify-end">
                <Button type="submit" loading={passwordMutation.isPending}>
                  Change password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Sessions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogOut className="size-4" aria-hidden="true" />
              Active sessions
            </CardTitle>
            <CardDescription>
              Sign out of every device where your account is signed in. Use this if you have lost a
              device or suspect someone else has access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => signOutEverywhere.mutate()}
              loading={signOutEverywhere.isPending}
            >
              Sign out everywhere
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
