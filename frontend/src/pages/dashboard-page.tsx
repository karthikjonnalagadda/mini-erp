/**
 * Dashboard.
 *
 * One API call renders the whole screen — see the backend's DashboardService for
 * why (eight parallel round-trips to draw one page is a latency budget spent on
 * nothing).
 *
 * The metric set is scoped SERVER-side by role, so this component simply renders
 * whatever it is given. Hiding a card in React would not stop a salesperson from
 * reading stock valuation out of the network tab.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  IndianRupee,
  PackageX,
  ScrollText,
  TrendingUp,
  Users,
  Warehouse,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/api/query-client';
import {
  CategoryBreakdownChart,
  ChartTableView,
  SalesTrendChart,
  StockMovementChart,
} from '@/components/charts/charts';
import { PageHeader } from '@/components/common/page-header';
import { StatChip, StatTile } from '@/components/common/stat-tile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton, EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { useAuth } from '@/context/auth-context';
import { dashboardService } from '@/services/challan.service';
import type { DashboardMetric } from '@/types/api.types';
import { formatCurrency, formatDate, formatMetric, formatNumber, formatRelative, isPast } from '@/utils/format';

/** Metric key -> icon and delta polarity. Keeps the JSX below declarative. */
const METRIC_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; invertDelta?: boolean }
> = {
  salesValue: { icon: IndianRupee },
  challanCount: { icon: TrendingUp },
  totalCustomers: { icon: Users },
  activeProducts: { icon: Boxes },
  // A rising low-stock or out-of-stock count is bad news, so the delta colour
  // must invert.
  lowStockCount: { icon: AlertTriangle, invertDelta: true },
  outOfStockCount: { icon: PackageX, invertDelta: true },
  stockValuation: { icon: Warehouse },
  receivables: { icon: IndianRupee, invertDelta: true },
};

const statusIntent = (status: string): 'neutral' | 'positive' | 'warning' | 'danger' => {
  switch (status) {
    case 'CONFIRMED':
    case 'ACTIVE':
      return 'positive';
    case 'CANCELLED':
    case 'BLACKLISTED':
      return 'danger';
    case 'LEAD':
    case 'DRAFT':
      return 'neutral';
    default:
      return 'warning';
  }
};

export const DashboardPage = (): React.JSX.Element => {
  const { user } = useAuth();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.dashboard.overview,
    queryFn: dashboardService.overview,
    // The dashboard is a summary; a minute of staleness is acceptable and saves
    // a heavy aggregate query on every tab focus.
    staleTime: 60_000,
  });

  const greeting = React.useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-56" />
        <CardSkeleton count={4} />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  const { metrics, charts, lists } = data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${greeting}, ${user?.firstName ?? 'there'}`}
        description={`Operational summary for the last 30 days · signed in as ${user?.role.name ?? ''}`}
        actions={
          <Button asChild size="sm">
            <Link to="/challans/new">
              New challan
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      {/* Headline figures. One number each — a stat tile, not a chart. */}
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric: DashboardMetric) => {
          const config = METRIC_CONFIG[metric.key];
          return (
            <StatTile
              key={metric.key}
              label={metric.label}
              value={formatMetric(metric.value, metric.format)}
              changePercent={metric.changePercent}
              changeLabel="vs previous 30 days"
              {...(config?.icon ? { icon: config.icon } : {})}
              intent={metric.intent}
              invertDelta={config?.invertDelta ?? false}
            />
          );
        })}
      </section>

      {/* Sales trend + status distributions */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle>Confirmed sales</CardTitle>
            <CardDescription>
              Daily value of confirmed challans over the last 30 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SalesTrendChart data={charts.salesTrend} />
            <ChartTableView
              caption="Daily confirmed sales value and challan count"
              rows={charts.salesTrend}
              columns={[
                { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
                {
                  key: 'challanCount',
                  label: 'Challans',
                  render: (row) => formatNumber(row.challanCount),
                },
                {
                  key: 'totalValue',
                  label: 'Value',
                  render: (row) => formatCurrency(row.totalValue),
                },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Pipeline</CardTitle>
            <CardDescription>Current distribution by status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Three or four numbers each — chips, not pie charts. */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Challans
              </p>
              <div className="space-y-1.5">
                {charts.challansByStatus.map((entry) => (
                  <StatChip
                    key={entry.status}
                    label={entry.status.charAt(0) + entry.status.slice(1).toLowerCase()}
                    value={formatNumber(entry.count)}
                    intent={statusIntent(entry.status)}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Customers
              </p>
              <div className="space-y-1.5">
                {charts.customersByStatus.map((entry) => (
                  <StatChip
                    key={entry.status}
                    label={entry.status.charAt(0) + entry.status.slice(1).toLowerCase()}
                    value={formatNumber(entry.count)}
                    intent={statusIntent(entry.status)}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Stock movement + category mix */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Stock movement</CardTitle>
            <CardDescription>Units received and dispatched per day</CardDescription>
          </CardHeader>
          <CardContent>
            <StockMovementChart data={charts.stockMovement} />
            <ChartTableView
              caption="Daily inbound and outbound stock units"
              rows={charts.stockMovement}
              columns={[
                { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
                { key: 'inbound', label: 'Received', render: (row) => formatNumber(row.inbound) },
                {
                  key: 'outbound',
                  label: 'Dispatched',
                  render: (row) => formatNumber(row.outbound),
                },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Catalogue mix</CardTitle>
            <CardDescription>Active products per category</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryBreakdownChart data={charts.productsByCategory} />
          </CardContent>
        </Card>
      </section>

      {/* Worklists */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Low stock */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle>Low stock</CardTitle>
              <CardDescription>At or below the reorder level</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/inventory">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {lists.lowStockProducts.length === 0 ? (
              <EmptyState
                title="Everything is stocked"
                description="No product is below its reorder level."
                className="py-8"
              />
            ) : (
              <ul className="divide-y divide-border">
                {lists.lowStockProducts.map((product) => (
                  <li key={product.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                    </div>
                    <Badge variant={product.quantityOnHand <= 0 ? 'soft-danger' : 'soft-warning'}>
                      {product.quantityOnHand} / {product.minimumStock}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Follow-ups due */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle>Follow-ups due</CardTitle>
              <CardDescription>Scheduled for today or earlier</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/customers?followUpDue=true">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {lists.dueFollowUps.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Nothing due"
                description="No follow-ups are outstanding."
                className="py-8"
              />
            ) : (
              <ul className="divide-y divide-border">
                {lists.dueFollowUps.map((followUp) => (
                  <li key={followUp.id} className="py-2.5">
                    <Link
                      to={`/customers/${followUp.customerId}`}
                      className="group flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                          {followUp.customerName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{followUp.subject}</p>
                      </div>
                      <Badge variant={isPast(followUp.scheduledAt) ? 'soft-warning' : 'soft-info'}>
                        {formatRelative(followUp.scheduledAt)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest audited changes</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {lists.recentActivity.length === 0 ? (
              <EmptyState icon={ScrollText} title="No activity yet" className="py-8" />
            ) : (
              <ul className="divide-y divide-border">
                {lists.recentActivity.map((entry) => (
                  <li key={entry.id} className="py-2.5">
                    <p className="text-sm text-foreground">{entry.summary}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.actor ?? 'System'} · {formatRelative(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Top customers */}
      {lists.topCustomers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Top customers</CardTitle>
            <CardDescription>By confirmed sales value over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y divide-border">
              {lists.topCustomers.map((customer, index) => (
                <li key={customer.customerId} className="flex items-center gap-3 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <Link
                    to={`/customers/${customer.customerId}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:text-primary"
                  >
                    {customer.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {customer.challanCount} challans
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {formatCurrency(customer.totalValue, { compact: true })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
