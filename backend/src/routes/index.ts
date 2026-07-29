/**
 * API route aggregator.
 *
 * Single place where URL prefixes are assigned. Mounting happens here rather
 * than in `app.ts` so that adding a module means touching one file, and so the
 * complete public surface of the API is readable in twenty lines.
 */
import { Router } from 'express';

import { env } from '../config/env';
import authRoutes from './auth.routes';
import challanRoutes from './challan.routes';
import customerRoutes from './customer.routes';
import { auditRouter, dashboardRouter } from './dashboard.routes';
import {
  categoryRouter,
  inventoryRouter,
  productRouter,
  stockMovementRouter,
} from './product.routes';

const router = Router();

/** Service metadata — useful for smoke-testing a deployment. */
router.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Mini ERP + CRM API',
    data: {
      name: 'mini-erp-crm-api',
      version: '1.0.0',
      environment: env.NODE_ENV,
      documentation: `${env.API_PREFIX}/docs`,
      endpoints: [
        'auth',
        'customers',
        'categories',
        'products',
        'inventory',
        'stock-movements',
        'challans',
        'dashboard',
        'audit-logs',
      ],
    },
    timestamp: new Date().toISOString(),
  });
});

router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/categories', categoryRouter);
router.use('/products', productRouter);
router.use('/inventory', inventoryRouter);
router.use('/stock-movements', stockMovementRouter);
router.use('/challans', challanRoutes);
router.use('/dashboard', dashboardRouter);
router.use('/audit-logs', auditRouter);

export default router;
