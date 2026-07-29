/**
 * Dashboard aggregation service.
 *
 * Every figure on the landing page comes from this one call. The alternative —
 * eight independent endpoints the SPA fires on mount — costs eight round-trips,
 * eight auth checks and eight connection acquisitions to render one screen.
 *
 * All queries run concurrently via `Promise.all`, so the endpoint's latency is
 * the slowest single query rather than their sum.
 *
 * The response is scoped by role: SALES sees pipeline figures, WAREHOUSE sees
 * stock health, ACCOUNTS sees receivables. Filtering server-side means a
 * salesperson never receives stock-valuation data their role should not see —
 * hiding a card in React is not access control.
 */
import type { RoleName } from '@prisma/client';

import { challanRepository } from '../repositories/challan.repository';
import { customerRepository } from '../repositories/customer.repository';
import { inventoryRepository } from '../repositories/inventory.repository';
import { productRepository } from '../repositories/product.repository';
import { prisma } from '../config/prisma';

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  /** Percentage change vs. the previous window; null when there is no baseline. */
  changePercent: number | null;
  format: 'number' | 'currency' | 'percent';
  intent: 'neutral' | 'positive' | 'warning' | 'danger';
}

export interface DashboardResponse {
  metrics: DashboardMetric[];
  charts: {
    salesTrend: Array<{ date: string; challanCount: number; totalValue: number }>;
    stockMovement: Array<{ date: string; inbound: number; outbound: number }>;
    customersByStatus: Array<{ status: string; count: number }>;
    challansByStatus: Array<{ status: string; count: number }>;
    productsByCategory: Array<{ categoryId: string; categoryName: string; productCount: number }>;
  };
  lists: {
    lowStockProducts: Array<{
      id: string;
      sku: string;
      name: string;
      quantityOnHand: number;
      minimumStock: number;
    }>;
    topCustomers: Array<{
      customerId: string;
      code: string;
      name: string;
      totalValue: number;
      challanCount: number;
    }>;
    dueFollowUps: Array<{
      id: string;
      customerId: string;
      customerName: string;
      subject: string;
      scheduledAt: string;
    }>;
    recentActivity: Array<{
      id: string;
      summary: string;
      action: string;
      actor: string | null;
      createdAt: string;
    }>;
  };
}

/** Rolling window used for every "this period" figure. */
const WINDOW_DAYS = 30;

const percentChange = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null; // undefined growth from zero
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

class DashboardService {
  async getOverview(role: RoleName): Promise<DashboardResponse> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const previousStart = new Date(now.getTime() - WINDOW_DAYS * 2 * 24 * 60 * 60 * 1000);

    const [
      currentSales,
      previousSales,
      customerCounts,
      challanCounts,
      inventorySummary,
      valuation,
      salesTrend,
      stockTrend,
      lowStock,
      topCustomers,
      productsByCategory,
      dueFollowUps,
      recentActivity,
      totalCustomers,
      activeProducts,
      receivables,
    ] = await Promise.all([
      challanRepository.salesTotals(windowStart, now),
      challanRepository.salesTotals(previousStart, windowStart),
      customerRepository.countByStatus(),
      challanRepository.countByStatus(),
      inventoryRepository.summary(),
      productRepository.totalStockValuation(),
      challanRepository.salesTrend(WINDOW_DAYS),
      inventoryRepository.movementTrend(WINDOW_DAYS),
      productRepository.findLowStockProducts(8),
      challanRepository.topCustomers(WINDOW_DAYS, 5),
      productRepository.countByCategory(),
      prisma.customerFollowUp.findMany({
        where: { status: { in: ['PENDING', 'OVERDUE'] }, scheduledAt: { lte: now } },
        include: { customer: { select: { id: true, name: true } } },
        orderBy: { scheduledAt: 'asc' },
        take: 8,
      }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.customer.count({ where: { deletedAt: null } }),
      productRepository.countActive(),
      prisma.customer.aggregate({
        where: { deletedAt: null },
        _sum: { outstandingAmount: true },
      }),
    ]);

    const metrics: DashboardMetric[] = [
      {
        key: 'salesValue',
        label: `Sales (${WINDOW_DAYS}d)`,
        value: currentSales.totalValue,
        changePercent: percentChange(currentSales.totalValue, previousSales.totalValue),
        format: 'currency',
        intent: 'positive',
      },
      {
        key: 'challanCount',
        label: `Challans (${WINDOW_DAYS}d)`,
        value: currentSales.challanCount,
        changePercent: percentChange(currentSales.challanCount, previousSales.challanCount),
        format: 'number',
        intent: 'neutral',
      },
      {
        key: 'totalCustomers',
        label: 'Customers',
        value: totalCustomers,
        changePercent: null,
        format: 'number',
        intent: 'neutral',
      },
      {
        key: 'activeProducts',
        label: 'Active Products',
        value: activeProducts,
        changePercent: null,
        format: 'number',
        intent: 'neutral',
      },
      {
        key: 'lowStockCount',
        label: 'Low Stock Items',
        value: inventorySummary.lowStockCount,
        changePercent: null,
        format: 'number',
        intent: inventorySummary.lowStockCount > 0 ? 'warning' : 'positive',
      },
      {
        key: 'outOfStockCount',
        label: 'Out of Stock',
        value: inventorySummary.outOfStockCount,
        changePercent: null,
        format: 'number',
        intent: inventorySummary.outOfStockCount > 0 ? 'danger' : 'positive',
      },
      {
        key: 'stockValuation',
        label: 'Stock Value (cost)',
        value: valuation.atCost,
        changePercent: null,
        format: 'currency',
        intent: 'neutral',
      },
      {
        key: 'receivables',
        label: 'Outstanding',
        value: Number(receivables._sum.outstandingAmount ?? 0),
        changePercent: null,
        format: 'currency',
        intent: 'warning',
      },
    ];

    /**
     * Role scoping. ADMIN sees everything; the others see the metrics relevant
     * to their duties. Note this filters the *payload*, not just the UI.
     */
    const visibleMetricKeys: Record<RoleName, string[] | null> = {
      ADMIN: null, // all
      SALES: ['salesValue', 'challanCount', 'totalCustomers', 'activeProducts', 'outOfStockCount'],
      WAREHOUSE: [
        'challanCount',
        'activeProducts',
        'lowStockCount',
        'outOfStockCount',
        'stockValuation',
      ],
      ACCOUNTS: ['salesValue', 'challanCount', 'totalCustomers', 'receivables', 'stockValuation'],
    };

    const allowedKeys = visibleMetricKeys[role];
    const scopedMetrics =
      allowedKeys === null ? metrics : metrics.filter((metric) => allowedKeys.includes(metric.key));

    return {
      metrics: scopedMetrics,
      charts: {
        salesTrend,
        stockMovement: stockTrend,
        customersByStatus: customerCounts.map((entry) => ({
          status: entry.status,
          count: entry.count,
        })),
        challansByStatus: challanCounts.map((entry) => ({
          status: entry.status,
          count: entry.count,
        })),
        productsByCategory,
      },
      lists: {
        lowStockProducts: lowStock.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          quantityOnHand: product.inventory?.quantityOnHand ?? 0,
          minimumStock: product.minimumStock,
        })),
        topCustomers,
        dueFollowUps: dueFollowUps.map((followUp) => ({
          id: followUp.id,
          customerId: followUp.customer.id,
          customerName: followUp.customer.name,
          subject: followUp.subject,
          scheduledAt: followUp.scheduledAt.toISOString(),
        })),
        recentActivity: recentActivity.map((entry) => ({
          id: entry.id,
          summary: entry.summary,
          action: entry.action,
          actor: entry.actorEmail,
          createdAt: entry.createdAt.toISOString(),
        })),
      },
    };
  }
}

export const dashboardService = new DashboardService();
export { DashboardService };
