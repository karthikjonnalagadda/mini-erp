/**
 * User administration (ADMIN only).
 *
 * There is no self-registration in this system — accounts are provisioned here.
 * A public sign-up endpoint in an internal ERP would let anyone mint themselves
 * an ADMIN, which is why the API exposes user creation as an admin action.
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react';

import { ApiRequestError } from '@/api/client';
import { queryKeys } from '@/api/query-client';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataToolbar } from '@/components/common/data-toolbar';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, fieldAria } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/context/auth-context';
import { useListParams } from '@/hooks/use-list-params';
import { toast, toastApiError } from '@/hooks/use-toast';
import { authService } from '@/services/auth.service';
import type { RoleName, User, UserStatus } from '@/types/api.types';
import { cn } from '@/utils/cn';
import { formatRelative, humanizeEnum, initialsOf } from '@/utils/format';

const FILTER_KEYS = ['role', 'status'] as const;

const ROLE_OPTIONS: Array<{ value: RoleName; label: string; description: string }> = [
  { value: 'ADMIN', label: 'Admin', description: 'Full access including user management' },
  { value: 'SALES', label: 'Sales', description: 'CRM and challan creation' },
  { value: 'WAREHOUSE', label: 'Warehouse', description: 'Catalogue, stock and dispatch' },
  { value: 'ACCOUNTS', label: 'Accounts', description: 'Read-only plus challan cancellation' },
];

const STATUS_OPTIONS: Array<{ value: UserStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

const createUserSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(80),
    lastName: z.string().trim().min(1, 'Last name is required').max(80),
    email: z.string().trim().email('Enter a valid email address'),
    phone: z.union([z.string().trim().regex(/^\+?\d{6,15}$/, 'Enter a valid phone number'), z.literal('')]).optional(),
    role: z.enum(['ADMIN', 'SALES', 'WAREHOUSE', 'ACCOUNTS']),
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .max(72, 'At most 72 characters')
      .regex(/[a-z]/, 'Needs a lowercase letter')
      .regex(/[A-Z]/, 'Needs an uppercase letter')
      .regex(/\d/, 'Needs a number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

type CreateUserForm = z.infer<typeof createUserSchema>;

const statusBadgeVariant = (status: UserStatus): 'soft-success' | 'soft-neutral' | 'soft-danger' =>
  status === 'ACTIVE' ? 'soft-success' : status === 'SUSPENDED' ? 'soft-danger' : 'soft-neutral';

export const UsersPage = (): React.JSX.Element => {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const params = useListParams({ defaultSortBy: 'createdAt', filterKeys: FILTER_KEYS });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<User | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.auth.users(params.queryParams),
    queryFn: () => authService.listUsers(params.queryParams),
    placeholderData: (previous) => previous,
  });

  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      role: 'SALES',
      password: '',
      confirmPassword: '',
    },
  });

  const refreshUsers = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['auth', 'users'] });
  };

  const createMutation = useMutation({
    mutationFn: (values: CreateUserForm) =>
      authService.createUser({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        ...(values.phone ? { phone: values.phone } : {}),
        role: values.role,
        password: values.password,
        confirmPassword: values.confirmPassword,
      }),
    onSuccess: async (created) => {
      toast.success('User created', `${created.fullName} · ${created.role.name}`);
      setCreateOpen(false);
      form.reset();
      await refreshUsers();
    },
    onError: (mutationError: unknown) => {
      if (mutationError instanceof ApiRequestError && mutationError.code === 'DUPLICATE_RESOURCE') {
        form.setError('email', { message: mutationError.message });
        return;
      }
      toastApiError(mutationError, 'Could not create user');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      authService.updateUserStatus(id, status),
    onSuccess: async (updated) => {
      toast.success('Status updated', `${updated.fullName} is now ${updated.status.toLowerCase()}.`);
      await refreshUsers();
    },
    onError: (mutationError: unknown) => toastApiError(mutationError, 'Could not update status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authService.deleteUser(id),
    onSuccess: async () => {
      toast.success('User deleted');
      setDeleting(null);
      await refreshUsers();
    },
    onError: (mutationError: unknown) => toastApiError(mutationError, 'Could not delete user'),
  });

  return (
    <div>
      <PageHeader
        title="Users"
        description="Provision accounts and assign roles"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            New user
          </Button>
        }
      />

      <DataToolbar
        className="mb-4"
        searchValue={params.searchInput}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search name or email…"
        filters={[
          {
            key: 'role',
            placeholder: 'All roles',
            options: ROLE_OPTIONS.map((r) => ({ value: r.value, label: r.label })),
          },
          { key: 'status', placeholder: 'All statuses', options: STATUS_OPTIONS },
        ]}
        filterValues={params.filters}
        onFilterChange={params.setFilter}
        hasActiveFilters={params.hasActiveFilters}
        onClearFilters={params.clearFilters}
      />

      <Card>
        {isLoading ? (
          <TableSkeleton rows={6} columns={5} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState icon={UserCog} title="No users found" variant="no-results" />
        ) : (
          <>
            <div className={cn('transition-opacity', isFetching && 'opacity-60')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead className="w-40 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {data?.items.map((user) => {
                    // An admin must not be able to lock themselves out.
                    const isSelf = user.id === currentUser?.id;

                    return (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                              {initialsOf(user.fullName)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {user.fullName}
                                {isSelf && (
                                  <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                                )}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell>
                          <Badge variant={user.role.name === 'ADMIN' ? 'soft-primary' : 'soft-neutral'}>
                            {user.role.name === 'ADMIN' && (
                              <ShieldCheck className="size-3" aria-hidden="true" />
                            )}
                            {humanizeEnum(user.role.name)}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <Badge variant={statusBadgeVariant(user.status)}>
                            {humanizeEnum(user.status)}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-xs text-muted-foreground">
                          {user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'Never'}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Select
                              value={user.status}
                              onValueChange={(value) =>
                                statusMutation.mutate({ id: user.id, status: value as UserStatus })
                              }
                              disabled={isSelf || statusMutation.isPending}
                            >
                              <SelectTrigger className="h-8 w-[7.5rem]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUS_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={isSelf}
                              onClick={() => setDeleting(user)}
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Delete ${user.fullName}`}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {data && (
              <Pagination
                meta={data.meta}
                onPageChange={params.setPage}
                onLimitChange={params.setLimit}
              />
            )}
          </>
        )}
      </Card>

      {/* Create user */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent size="md">
          <form onSubmit={form.handleSubmit((values) => createMutation.mutate(values))} noValidate>
            <DialogHeader>
              <DialogTitle>New user</DialogTitle>
              <DialogDescription>
                The account is active immediately. Share the password securely and ask the user to
                change it after first sign-in.
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="First name"
                  htmlFor="firstName"
                  required
                  error={form.formState.errors.firstName?.message}
                >
                  <Input
                    {...form.register('firstName')}
                    {...fieldAria('firstName', form.formState.errors.firstName?.message)}
                    hasError={Boolean(form.formState.errors.firstName)}
                  />
                </FormField>

                <FormField
                  label="Last name"
                  htmlFor="lastName"
                  required
                  error={form.formState.errors.lastName?.message}
                >
                  <Input
                    {...form.register('lastName')}
                    {...fieldAria('lastName', form.formState.errors.lastName?.message)}
                    hasError={Boolean(form.formState.errors.lastName)}
                  />
                </FormField>
              </div>

              <FormField
                label="Email"
                htmlFor="user-email"
                required
                error={form.formState.errors.email?.message}
              >
                <Input
                  {...form.register('email')}
                  {...fieldAria('user-email', form.formState.errors.email?.message)}
                  type="email"
                  placeholder="name@company.com"
                  hasError={Boolean(form.formState.errors.email)}
                />
              </FormField>

              <FormField label="Phone" htmlFor="phone" error={form.formState.errors.phone?.message}>
                <Input
                  {...form.register('phone')}
                  {...fieldAria('phone', form.formState.errors.phone?.message)}
                  type="tel"
                  placeholder="9876543210"
                  hasError={Boolean(form.formState.errors.phone)}
                />
              </FormField>

              <FormField
                label="Role"
                htmlFor="role"
                required
                hint={ROLE_OPTIONS.find((r) => r.value === form.watch('role'))?.description}
              >
                <Select
                  value={form.watch('role')}
                  onValueChange={(value) => form.setValue('role', value as RoleName)}
                >
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Password"
                  htmlFor="password"
                  required
                  error={form.formState.errors.password?.message}
                  hint="8+ chars with upper, lower and a digit"
                >
                  <Input
                    {...form.register('password')}
                    {...fieldAria('password', form.formState.errors.password?.message)}
                    type="password"
                    autoComplete="new-password"
                    hasError={Boolean(form.formState.errors.password)}
                  />
                </FormField>

                <FormField
                  label="Confirm password"
                  htmlFor="confirmPassword"
                  required
                  error={form.formState.errors.confirmPassword?.message}
                >
                  <Input
                    {...form.register('confirmPassword')}
                    {...fieldAria('confirmPassword', form.formState.errors.confirmPassword?.message)}
                    type="password"
                    autoComplete="new-password"
                    hasError={Boolean(form.formState.errors.confirmPassword)}
                  />
                </FormField>
              </div>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createMutation.isPending}>
                Create user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete user?"
        description={
          <>
            <strong>{deleting?.fullName}</strong> will lose access immediately and all their
            sessions will be revoked. Their name remains on historical documents and audit entries.
            The last remaining administrator cannot be deleted.
          </>
        }
        confirmLabel="Delete user"
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </div>
  );
};
