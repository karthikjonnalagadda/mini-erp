/**
 * Customer DTOs.
 *
 * The mappers here do two jobs beyond field selection:
 *
 *  1. Convert Prisma `Decimal` to `number`. A Decimal serialises to a JSON
 *     *object* (`{"s":1,"e":3,"d":[1234]}`), which would break every client.
 *  2. Convert `Date` to ISO strings, so the API contract does not depend on the
 *     JSON serialiser's default Date handling.
 */
import type { CustomerStatus, CustomerType, FollowUpStatus, FollowUpType } from '@prisma/client';

import type {
  CustomerWithRelations,
  FollowUpWithCreator,
} from '../repositories/customer.repository';
import { toNumber } from '../utils/money';

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

/**
 * `T | null | undefined` on optional fields is deliberate and the two values
 * mean different things:
 *   `undefined` — field absent from the payload; leave the stored value alone.
 *   `null`      — field explicitly cleared by the user; write NULL.
 * Collapsing them to `undefined` would make it impossible to erase a GST number
 * once entered.
 */
type Clearable<T> = T | null | undefined;

export interface CreateCustomerDto {
  name: string;
  businessName?: Clearable<string>;
  email?: Clearable<string>;
  mobile: string;
  gstNumber?: Clearable<string>;
  customerType: CustomerType;
  status?: CustomerStatus;
  addressLine1?: Clearable<string>;
  addressLine2?: Clearable<string>;
  city?: Clearable<string>;
  state?: Clearable<string>;
  postalCode?: Clearable<string>;
  country?: string;
  creditLimit?: number;
  followUpDate?: Clearable<Date>;
  notes?: Clearable<string>;
  ownerId?: Clearable<string>;
}

export type UpdateCustomerDto = Partial<CreateCustomerDto>;

export interface CreateFollowUpDto {
  customerId: string;
  type: FollowUpType;
  subject: string;
  notes?: string;
  scheduledAt: Date;
}

export interface UpdateFollowUpDto {
  type?: FollowUpType;
  status?: FollowUpStatus;
  subject?: string;
  notes?: string;
  outcome?: string;
  scheduledAt?: Date;
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export interface CustomerResponseDto {
  id: string;
  code: string;
  name: string;
  businessName: string | null;
  email: string | null;
  mobile: string;
  gstNumber: string | null;
  customerType: CustomerType;
  status: CustomerStatus;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string;
    /** Pre-joined single-line address — saves every client re-implementing it. */
    formatted: string;
  };
  creditLimit: number;
  outstandingAmount: number;
  /** creditLimit - outstandingAmount, floored at 0. */
  availableCredit: number;
  followUpDate: string | null;
  notes: string | null;
  owner: { id: string; name: string; email: string } | null;
  stats: { challanCount: number; followUpCount: number };
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpResponseDto {
  id: string;
  customerId: string;
  type: FollowUpType;
  status: FollowUpStatus;
  subject: string;
  notes: string | null;
  outcome: string | null;
  scheduledAt: string;
  completedAt: string | null;
  /** True when a pending item's scheduled time has passed. */
  isOverdue: boolean;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const formatAddress = (customer: CustomerWithRelations): string =>
  [
    customer.addressLine1,
    customer.addressLine2,
    customer.city,
    customer.state,
    customer.postalCode,
    customer.country,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ');

export const toCustomerResponse = (customer: CustomerWithRelations): CustomerResponseDto => {
  const creditLimit = toNumber(customer.creditLimit);
  const outstandingAmount = toNumber(customer.outstandingAmount);

  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    businessName: customer.businessName,
    email: customer.email,
    mobile: customer.mobile,
    gstNumber: customer.gstNumber,
    customerType: customer.customerType,
    status: customer.status,
    address: {
      line1: customer.addressLine1,
      line2: customer.addressLine2,
      city: customer.city,
      state: customer.state,
      postalCode: customer.postalCode,
      country: customer.country,
      formatted: formatAddress(customer),
    },
    creditLimit,
    outstandingAmount,
    availableCredit: Math.max(0, Number((creditLimit - outstandingAmount).toFixed(2))),
    followUpDate: customer.followUpDate?.toISOString() ?? null,
    notes: customer.notes,
    owner: customer.owner
      ? {
          id: customer.owner.id,
          name: `${customer.owner.firstName} ${customer.owner.lastName}`.trim(),
          email: customer.owner.email,
        }
      : null,
    stats: {
      challanCount: customer._count.challans,
      followUpCount: customer._count.followUps,
    },
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
};

export const toFollowUpResponse = (followUp: FollowUpWithCreator): FollowUpResponseDto => ({
  id: followUp.id,
  customerId: followUp.customerId,
  type: followUp.type,
  status: followUp.status,
  subject: followUp.subject,
  notes: followUp.notes,
  outcome: followUp.outcome,
  scheduledAt: followUp.scheduledAt.toISOString(),
  completedAt: followUp.completedAt?.toISOString() ?? null,
  isOverdue:
    (followUp.status === 'PENDING' || followUp.status === 'OVERDUE') &&
    followUp.scheduledAt.getTime() < Date.now(),
  createdBy: {
    id: followUp.createdBy.id,
    name: `${followUp.createdBy.firstName} ${followUp.createdBy.lastName}`.trim(),
  },
  createdAt: followUp.createdAt.toISOString(),
  updatedAt: followUp.updatedAt.toISOString(),
});
