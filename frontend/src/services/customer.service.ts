/**
 * Customer + follow-up API calls.
 */
import { apiDelete, apiGet, apiGetPaginated, apiPost, apiPut } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import type {
  Customer,
  CustomerListParams,
  CustomerStatus,
  CustomerType,
  FollowUp,
  FollowUpListParams,
  FollowUpType,
  Paginated,
  TimelineEvent,
} from '@/types/api.types';

export interface CustomerPayload {
  name: string;
  businessName?: string | null;
  email?: string | null;
  mobile: string;
  gstNumber?: string | null;
  customerType: CustomerType;
  status: CustomerStatus;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string;
  creditLimit?: number;
  notes?: string | null;
  ownerId?: string | null;
}

export interface FollowUpPayload {
  type: FollowUpType;
  subject: string;
  notes?: string | null;
  /** ISO string — the backend requires a future date for new follow-ups. */
  scheduledAt: string;
}

export interface CompleteFollowUpPayload {
  outcome: string;
  nextFollowUpDate?: string | null;
}

export const customerService = {
  list: (params: CustomerListParams): Promise<Paginated<Customer>> =>
    apiGetPaginated<Customer>(endpoints.customers.list, params),

  getById: (id: string): Promise<Customer> => apiGet<Customer>(endpoints.customers.detail(id)),

  create: (payload: CustomerPayload): Promise<Customer> =>
    apiPost<Customer, CustomerPayload>(endpoints.customers.list, payload),

  update: (id: string, payload: Partial<CustomerPayload>): Promise<Customer> =>
    apiPut<Customer, Partial<CustomerPayload>>(endpoints.customers.detail(id), payload),

  remove: (id: string): Promise<null> => apiDelete<null>(endpoints.customers.detail(id)),

  getTimeline: (id: string): Promise<TimelineEvent[]> =>
    apiGet<TimelineEvent[]>(endpoints.customers.timeline(id)),

  listFollowUps: (customerId: string, params: FollowUpListParams): Promise<Paginated<FollowUp>> =>
    apiGetPaginated<FollowUp>(endpoints.customers.followUps(customerId), params),

  /** Cross-customer follow-up inbox. */
  listAllFollowUps: (params: FollowUpListParams): Promise<Paginated<FollowUp>> =>
    apiGetPaginated<FollowUp>(endpoints.customers.allFollowUps, params),

  createFollowUp: (customerId: string, payload: FollowUpPayload): Promise<FollowUp> =>
    apiPost<FollowUp, FollowUpPayload>(endpoints.customers.followUps(customerId), payload),

  updateFollowUp: (id: string, payload: Partial<FollowUpPayload>): Promise<FollowUp> =>
    apiPut<FollowUp, Partial<FollowUpPayload>>(endpoints.customers.followUp(id), payload),

  completeFollowUp: (id: string, payload: CompleteFollowUpPayload): Promise<FollowUp> =>
    apiPost<FollowUp, CompleteFollowUpPayload>(endpoints.customers.completeFollowUp(id), payload),

  deleteFollowUp: (id: string): Promise<null> => apiDelete<null>(endpoints.customers.followUp(id)),
};
