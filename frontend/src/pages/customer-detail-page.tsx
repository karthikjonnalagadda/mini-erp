/**
 * Customer detail.
 *
 * Three panels: the account record, a follow-up worklist, and a merged activity
 * timeline. The timeline interleaves CRM activities with audit events, so "who
 * changed this customer's credit limit" and "who called them last Tuesday"
 * appear in the same chronology instead of two disconnected lists.
 */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
} from 'lucide-react';

import { invalidateGroup, queryKeys } from '@/api/query-client';
import { PageHeader } from '@/components/common/page-header';
import { CustomerFormDialog } from '@/components/customers/customer-form-dialog';
import { FollowUpDialog } from '@/components/customers/follow-up-dialog';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { useAuth } from '@/context/auth-context';
import { toast, toastApiError } from '@/hooks/use-toast';
import { customerService } from '@/services/customer.service';
import type { FollowUp } from '@/types/api.types';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDate, formatDateTime, formatRelative, humanizeEnum } from '@/utils/format';

/** Label/value row used throughout the account panel. */
const DetailRow = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element => (
  <div className="grid grid-cols-3 gap-3 py-2">
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd className="col-span-2 text-sm text-foreground">{children}</dd>
  </div>
);

export const CustomerDetailPage = (): React.JSX.Element => {
  const { id = '' } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = React.useState(false);
  const [followUpOpen, setFollowUpOpen] = React.useState(false);
  const [completing, setCompleting] = React.useState<FollowUp | null>(null);

  const canManage = hasRole('ADMIN', 'SALES');

  const customerQuery = useQuery({
    queryKey: queryKeys.customers.detail(id),
    queryFn: () => customerService.getById(id),
    enabled: id.length > 0,
  });

  const followUpsQuery = useQuery({
    queryKey: queryKeys.customers.followUps(id, { limit: 50 }),
    queryFn: () => customerService.listFollowUps(id, { limit: 50, sortOrder: 'desc' }),
    enabled: id.length > 0,
  });

  const timelineQuery = useQuery({
    queryKey: queryKeys.customers.timeline(id),
    queryFn: () => customerService.getTimeline(id),
    enabled: id.length > 0,
  });

  const completeMutation = useMutation({
    mutationFn: ({ followUpId, outcome }: { followUpId: string; outcome: string }) =>
      customerService.completeFollowUp(followUpId, { outcome }),
    onSuccess: async () => {
      toast.success('Follow-up completed');
      setCompleting(null);
      await invalidateGroup('customer');
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(id) });
    },
    onError: (error: unknown) => toastApiError(error, 'Could not complete follow-up'),
  });

  if (customerQuery.isLoading) return <DetailSkeleton />;

  if (customerQuery.isError || !customerQuery.data) {
    return (
      <ErrorState error={customerQuery.error} onRetry={() => void customerQuery.refetch()} />
    );
  }

  const customer = customerQuery.data;
  const followUps = followUpsQuery.data?.items ?? [];
  const pendingFollowUps = followUps.filter(
    (item) => item.status === 'PENDING' || item.status === 'OVERDUE',
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Customers', to: '/customers' },
          { label: customer.businessName ?? customer.name },
        ]}
        title={customer.businessName ?? customer.name}
        description={`${customer.code} · ${humanizeEnum(customer.customerType)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/customers')}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => setFollowUpOpen(true)}>
                  <CalendarPlus aria-hidden="true" />
                  Schedule follow-up
                </Button>
                <Button size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Account record */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Account details</CardTitle>
                <CardDescription>Contact, tax and commercial terms</CardDescription>
              </div>
              <Badge variant={statusVariant.customer(customer.status)}>
                {humanizeEnum(customer.status)}
              </Badge>
            </CardHeader>

            <CardContent>
              <dl className="divide-y divide-border">
                <DetailRow label="Contact name">{customer.name}</DetailRow>

                <DetailRow label="Mobile">
                  <a
                    href={`tel:${customer.mobile}`}
                    className="inline-flex items-center gap-1.5 tabular-nums hover:text-primary"
                  >
                    <Phone className="size-3.5" aria-hidden="true" />
                    {customer.mobile}
                  </a>
                </DetailRow>

                <DetailRow label="Email">
                  {customer.email ? (
                    <a
                      href={`mailto:${customer.email}`}
                      className="inline-flex items-center gap-1.5 hover:text-primary"
                    >
                      <Mail className="size-3.5" aria-hidden="true" />
                      {customer.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </DetailRow>

                <DetailRow label="GSTIN">
                  <span className="font-mono">{customer.gstNumber ?? '—'}</span>
                </DetailRow>

                <DetailRow label="Address">
                  {customer.address.formatted ? (
                    <span className="inline-flex items-start gap-1.5">
                      <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {customer.address.formatted}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </DetailRow>

                <DetailRow label="Account owner">
                  {customer.owner?.name ?? <span className="text-muted-foreground">Unassigned</span>}
                </DetailRow>

                <DetailRow label="Created">{formatDate(customer.createdAt)}</DetailRow>

                {customer.notes && <DetailRow label="Notes">{customer.notes}</DetailRow>}
              </dl>
            </CardContent>
          </Card>

          {/* Activity timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Activity timeline</CardTitle>
              <CardDescription>Follow-ups and record changes, most recent first</CardDescription>
            </CardHeader>
            <CardContent>
              {timelineQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="skeleton h-12 w-full" />
                  ))}
                </div>
              ) : !timelineQuery.data || timelineQuery.data.length === 0 ? (
                <EmptyState
                  title="No activity yet"
                  description="Follow-ups and changes to this account will appear here."
                  className="py-8"
                />
              ) : (
                <ol className="relative space-y-0 border-l border-border pl-5">
                  {timelineQuery.data.map((event) => (
                    <li key={`${event.kind}-${event.id}`} className="relative pb-5 last:pb-0">
                      {/* Timeline dot, centred on the rail. */}
                      <span
                        className={cn(
                          'absolute -left-[1.6rem] top-1 size-2.5 rounded-full ring-4 ring-card',
                          event.kind === 'FOLLOW_UP' ? 'bg-primary' : 'bg-muted-foreground/40',
                        )}
                        aria-hidden="true"
                      />
                      <p className="text-sm font-medium text-foreground">{event.title}</p>
                      {event.description && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{event.description}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.actor ?? 'System'} · {formatDateTime(event.occurredAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: commercials + follow-ups */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Commercials</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Credit limit</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(customer.creditLimit)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Outstanding</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(customer.outstandingAmount)}
                </span>
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">Available credit</span>
                <span
                  className={cn(
                    'text-sm font-semibold tabular-nums',
                    customer.availableCredit > 0 ? 'text-success' : 'text-destructive',
                  )}
                >
                  {formatCurrency(customer.availableCredit)}
                </span>
              </div>

              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to={`/challans?customerId=${customer.id}`}>
                  <FileText aria-hidden="true" />
                  {customer.stats.challanCount} challan
                  {customer.stats.challanCount === 1 ? '' : 's'}
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle>Follow-ups</CardTitle>
                <CardDescription>{pendingFollowUps.length} pending</CardDescription>
              </div>
              {canManage && (
                <Button variant="ghost" size="icon-sm" onClick={() => setFollowUpOpen(true)}>
                  <CalendarPlus aria-hidden="true" />
                  <span className="sr-only">Schedule follow-up</span>
                </Button>
              )}
            </CardHeader>

            <CardContent className="pt-0">
              {followUpsQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="skeleton h-14 w-full" />
                  ))}
                </div>
              ) : followUps.length === 0 ? (
                <EmptyState
                  title="No follow-ups"
                  description="Schedule a call or meeting to keep this account warm."
                  className="py-6"
                />
              ) : (
                <ul className="divide-y divide-border">
                  {followUps.slice(0, 8).map((followUp) => (
                    <li key={followUp.id} className="py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {followUp.subject}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {humanizeEnum(followUp.type)} · {formatRelative(followUp.scheduledAt)}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <Badge variant={statusVariant.followUp(followUp.status)}>
                            {humanizeEnum(followUp.status)}
                          </Badge>
                          {canManage && followUp.status !== 'COMPLETED' && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setCompleting(followUp)}
                              aria-label={`Complete ${followUp.subject}`}
                            >
                              <CheckCircle2 className="text-success" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {followUp.outcome && (
                        <p className="mt-1.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                          {followUp.outcome}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />

      <FollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        customerId={customer.id}
        customerName={customer.businessName ?? customer.name}
      />

      {/* Completing a follow-up records an outcome, so it reuses the
          reason-collecting confirm dialog rather than a bespoke form. */}
      {completing && (
        <FollowUpDialog
          open
          onOpenChange={(open) => !open && setCompleting(null)}
          customerId={customer.id}
          customerName={customer.businessName ?? customer.name}
          completing={completing}
          isSubmitting={completeMutation.isPending}
          onComplete={(outcome) =>
            completeMutation.mutate({ followUpId: completing.id, outcome })
          }
        />
      )}
    </div>
  );
};
