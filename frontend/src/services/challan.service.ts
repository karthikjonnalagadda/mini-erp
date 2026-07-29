/**
 * Sales challan, dashboard and audit API calls.
 */
import { apiDelete, apiDownload, apiGet, apiGetPaginated, apiPost, apiPut } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import type {
  AuditListParams,
  AuditLogEntry,
  Challan,
  ChallanListParams,
  DashboardOverview,
  Paginated,
} from '@/types/api.types';

export interface ChallanItemPayload {
  productId: string;
  quantity: number;
  /** Optional negotiated override; omitted means "use the catalogue price". */
  unitPrice?: number;
  discountPercent?: number;
}

export interface ChallanPayload {
  customerId: string;
  challanDate?: string;
  dispatchDate?: string | null;
  shippingAddress?: string | null;
  transporterName?: string | null;
  vehicleNumber?: string | null;
  notes?: string | null;
  items: ChallanItemPayload[];
}

export interface ConfirmChallanPayload {
  dispatchDate?: string | null;
  transporterName?: string | null;
  vehicleNumber?: string | null;
}

export const challanService = {
  list: (params: ChallanListParams): Promise<Paginated<Challan>> =>
    apiGetPaginated<Challan>(endpoints.challans.list, params),

  getById: (id: string): Promise<Challan> => apiGet<Challan>(endpoints.challans.detail(id)),

  create: (payload: ChallanPayload): Promise<Challan> =>
    apiPost<Challan, ChallanPayload>(endpoints.challans.list, payload),

  update: (id: string, payload: Partial<ChallanPayload>): Promise<Challan> =>
    apiPut<Challan, Partial<ChallanPayload>>(endpoints.challans.detail(id), payload),

  /** Deducts stock. Rejects with INSUFFICIENT_STOCK carrying per-SKU detail. */
  confirm: (id: string, payload: ConfirmChallanPayload = {}): Promise<Challan> =>
    apiPost<Challan, ConfirmChallanPayload>(endpoints.challans.confirm(id), payload),

  cancel: (id: string, reason: string): Promise<Challan> =>
    apiPost<Challan, { reason: string }>(endpoints.challans.cancel(id), { reason }),

  remove: (id: string): Promise<null> => apiDelete<null>(endpoints.challans.detail(id)),

  downloadPdf: (id: string, challanNumber: string): Promise<void> =>
    apiDownload(endpoints.challans.pdf(id), `challan-${challanNumber}.pdf`),
};

export const dashboardService = {
  overview: (): Promise<DashboardOverview> =>
    apiGet<DashboardOverview>(endpoints.dashboard.overview),
};

export const auditService = {
  list: (params: AuditListParams): Promise<Paginated<AuditLogEntry>> =>
    apiGetPaginated<AuditLogEntry>(endpoints.audit.list, params),

  timeline: (entityType: string, entityId: string): Promise<AuditLogEntry[]> =>
    apiGet<AuditLogEntry[]>(endpoints.audit.timeline(entityType, entityId)),
};
