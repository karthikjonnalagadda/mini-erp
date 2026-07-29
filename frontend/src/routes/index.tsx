/**
 * Route table.
 *
 * Every page except Login and Dashboard is lazy-loaded. The initial bundle then
 * contains only what a user needs to sign in and see their landing screen —
 * the challan form, with its product picker and line-item maths, is fetched
 * when someone actually opens it.
 *
 * `Suspense` sits inside the layout so a lazy page shows a loader in the content
 * area while the sidebar and navbar stay put, rather than blanking the screen.
 */
import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ErrorBoundary } from '@/components/common/error-boundary';
import { PageLoader } from '@/components/ui/states';
import { DashboardLayout } from '@/layouts/dashboard-layout';
import { RequireAuth, RequireGuest, RoleGuard } from '@/routes/guards';

/**
 * Eager: the login screen is the only route an unauthenticated visitor can
 * reach, so it is the one thing worth having in the initial bundle.
 */
import { LoginPage } from '@/pages/login-page';

/**
 * Lazy: fetched on first navigation.
 *
 * The dashboard is lazy DESPITE being the landing page. It pulls in Recharts
 * (~390 KB), and making it eager would mean every visitor downloads charting
 * code before they can type a password. The cost is one extra round-trip after
 * sign-in — paid by authenticated users on a warm connection, not by everyone
 * on the login screen.
 */
const DashboardPage = React.lazy(() =>
  import('@/pages/dashboard-page').then((m) => ({ default: m.DashboardPage })),
);
const CustomersPage = React.lazy(() =>
  import('@/pages/customers-page').then((m) => ({ default: m.CustomersPage })),
);
const CustomerDetailPage = React.lazy(() =>
  import('@/pages/customer-detail-page').then((m) => ({ default: m.CustomerDetailPage })),
);
const ProductsPage = React.lazy(() =>
  import('@/pages/products-page').then((m) => ({ default: m.ProductsPage })),
);
const InventoryPage = React.lazy(() =>
  import('@/pages/inventory-page').then((m) => ({ default: m.InventoryPage })),
);
const StockMovementsPage = React.lazy(() =>
  import('@/pages/stock-movements-page').then((m) => ({ default: m.StockMovementsPage })),
);
const ChallansPage = React.lazy(() =>
  import('@/pages/challans-page').then((m) => ({ default: m.ChallansPage })),
);
const ChallanDetailPage = React.lazy(() =>
  import('@/pages/challan-detail-page').then((m) => ({ default: m.ChallanDetailPage })),
);
const ChallanFormPage = React.lazy(() =>
  import('@/pages/challan-form-page').then((m) => ({ default: m.ChallanFormPage })),
);
const AuditLogsPage = React.lazy(() =>
  import('@/pages/audit-logs-page').then((m) => ({ default: m.AuditLogsPage })),
);
const UsersPage = React.lazy(() =>
  import('@/pages/users-page').then((m) => ({ default: m.UsersPage })),
);
const ProfilePage = React.lazy(() =>
  import('@/pages/profile-page').then((m) => ({ default: m.ProfilePage })),
);
const NotFoundPage = React.lazy(() =>
  import('@/pages/error-pages').then((m) => ({ default: m.NotFoundPage })),
);
const ForbiddenPage = React.lazy(() =>
  import('@/pages/error-pages').then((m) => ({ default: m.ForbiddenPage })),
);

/** Wraps a lazy page in its own boundary + suspense fallback. */
const LazyPage = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <ErrorBoundary>
    <React.Suspense fallback={<PageLoader />}>{children}</React.Suspense>
  </ErrorBoundary>
);

export const AppRoutes = (): React.JSX.Element => (
  <Routes>
    {/* Public */}
    <Route element={<RequireGuest />}>
      <Route path="/login" element={<LoginPage />} />
    </Route>

    {/* Authenticated */}
    <Route element={<RequireAuth />}>
      <Route element={<DashboardLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />

        <Route
          path="/dashboard"
          element={
            <LazyPage>
              <DashboardPage />
            </LazyPage>
          }
        />

        {/* CRM */}
        <Route
          path="/customers"
          element={
            <LazyPage>
              <CustomersPage />
            </LazyPage>
          }
        />
        <Route
          path="/customers/:id"
          element={
            <LazyPage>
              <CustomerDetailPage />
            </LazyPage>
          }
        />

        {/* Catalogue & inventory */}
        <Route
          path="/products"
          element={
            <LazyPage>
              <ProductsPage />
            </LazyPage>
          }
        />
        <Route
          path="/inventory"
          element={
            <LazyPage>
              <InventoryPage />
            </LazyPage>
          }
        />
        <Route
          path="/stock-movements"
          element={
            <LazyPage>
              <StockMovementsPage />
            </LazyPage>
          }
        />

        {/* Sales — `/new` is declared before `/:id` so it is not captured as an id. */}
        <Route
          path="/challans"
          element={
            <LazyPage>
              <ChallansPage />
            </LazyPage>
          }
        />
        <Route
          path="/challans/new"
          element={
            <LazyPage>
              <ChallanFormPage />
            </LazyPage>
          }
        />
        <Route
          path="/challans/:id/edit"
          element={
            <LazyPage>
              <ChallanFormPage />
            </LazyPage>
          }
        />
        <Route
          path="/challans/:id"
          element={
            <LazyPage>
              <ChallanDetailPage />
            </LazyPage>
          }
        />

        {/* Account */}
        <Route
          path="/profile"
          element={
            <LazyPage>
              <ProfilePage />
            </LazyPage>
          }
        />

        {/* Administration — guarded to match the backend's RBAC policies. */}
        <Route element={<RoleGuard allowed={['ADMIN', 'ACCOUNTS']} />}>
          <Route
            path="/audit-logs"
            element={
              <LazyPage>
                <AuditLogsPage />
              </LazyPage>
            }
          />
        </Route>

        <Route element={<RoleGuard allowed={['ADMIN']} />}>
          <Route
            path="/users"
            element={
              <LazyPage>
                <UsersPage />
              </LazyPage>
            }
          />
        </Route>

        <Route
          path="/forbidden"
          element={
            <LazyPage>
              <ForbiddenPage />
            </LazyPage>
          }
        />
      </Route>
    </Route>

    {/* Catch-all */}
    <Route
      path="*"
      element={
        <LazyPage>
          <NotFoundPage />
        </LazyPage>
      }
    />
  </Routes>
);
