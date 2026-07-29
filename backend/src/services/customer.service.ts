/**
 * Customer (CRM) domain service.
 *
 * Business rules owned here:
 *  - Mobile / email / GST are unique among LIVE customers (soft-deleted rows
 *    release their keys).
 *  - Every customer gets a sequential human-readable code (CUST-000123).
 *  - A customer with issued challans is never hard-deleted — financial history
 *    must stay resolvable.
 *  - `Customer.followUpDate` is a denormalised cache of the next pending
 *    activity, kept in sync whenever a follow-up is created or completed.
 */
import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import { AUDIT_ENTITY, SEQUENCE_KEYS, SEQUENCE_PREFIX } from '../constants/app.constants';
import { ErrorCode } from '../constants/http-status';
import { CustomerMessages } from '../constants/messages';
import { customerRepository } from '../repositories/customer.repository';
import type {
  CustomerListQuery,
  FollowUpListQuery,
} from '../repositories/customer.repository';
import { sequenceRepository } from '../repositories/sequence.repository';
import { auditService } from './audit.service';
import {
  toCustomerResponse,
  toFollowUpResponse,
} from '../dto/customer.dto';
import type {
  CreateCustomerDto,
  CustomerResponseDto,
  FollowUpResponseDto,
  UpdateCustomerDto,
} from '../dto/customer.dto';
import { ConflictError, DuplicateResourceError, NotFoundError } from '../utils/errors';
import type { ActorContext } from '../types/common.types';
import type {
  CompleteFollowUpInput,
  CreateFollowUpInput,
  UpdateFollowUpInput,
} from '../validators/customer.validators';

class CustomerService {
  /**
   * Enforces "unique among non-deleted" for the three business keys.
   * Runs the three checks concurrently — they are independent reads.
   */
  private async assertUniqueFields(
    dto: { mobile?: string | null; email?: string | null; gstNumber?: string | null },
    excludeId?: string,
  ): Promise<void> {
    const checks: Array<Promise<void>> = [];

    if (dto.mobile) {
      checks.push(
        customerRepository.isFieldTaken('mobile', dto.mobile, excludeId).then((taken) => {
          if (taken) throw new DuplicateResourceError(CustomerMessages.DUPLICATE_MOBILE, 'mobile');
        }),
      );
    }
    if (dto.email) {
      checks.push(
        customerRepository.isFieldTaken('email', dto.email, excludeId).then((taken) => {
          if (taken) throw new DuplicateResourceError(CustomerMessages.DUPLICATE_EMAIL, 'email');
        }),
      );
    }
    if (dto.gstNumber) {
      checks.push(
        customerRepository.isFieldTaken('gstNumber', dto.gstNumber, excludeId).then((taken) => {
          if (taken) {
            throw new DuplicateResourceError(CustomerMessages.DUPLICATE_GST, 'gstNumber');
          }
        }),
      );
    }

    await Promise.all(checks);
  }

  async list(query: CustomerListQuery): Promise<{ items: CustomerResponseDto[]; total: number }> {
    const { items, total } = await customerRepository.findMany(query);
    return { items: items.map(toCustomerResponse), total };
  }

  async getById(id: string): Promise<CustomerResponseDto> {
    const customer = await customerRepository.findById(id);
    if (!customer) throw new NotFoundError('Customer', id);
    return toCustomerResponse(customer);
  }

  async create(dto: CreateCustomerDto, actor: ActorContext): Promise<CustomerResponseDto> {
    await this.assertUniqueFields(dto);

    const code = await sequenceRepository.nextEntityCode(
      SEQUENCE_KEYS.CUSTOMER,
      SEQUENCE_PREFIX.CUSTOMER,
      prisma,
    );

    const customer = await customerRepository.create({
      code,
      name: dto.name,
      businessName: dto.businessName ?? null,
      email: dto.email ?? null,
      mobile: dto.mobile,
      gstNumber: dto.gstNumber ?? null,
      customerType: dto.customerType,
      status: dto.status ?? 'LEAD',
      addressLine1: dto.addressLine1 ?? null,
      addressLine2: dto.addressLine2 ?? null,
      city: dto.city ?? null,
      state: dto.state ?? null,
      postalCode: dto.postalCode ?? null,
      country: dto.country ?? 'India',
      creditLimit: new Prisma.Decimal(dto.creditLimit ?? 0),
      followUpDate: dto.followUpDate ?? null,
      notes: dto.notes ?? null,
      // Unassigned customers become invisible in a rep's "my accounts" view, so
      // the creator owns the account by default.
      ownerId: dto.ownerId ?? actor.id,
    });

    void auditService.record({
      action: 'CREATE',
      entityType: AUDIT_ENTITY.CUSTOMER,
      entityId: customer.id,
      summary: `Created customer ${customer.code} — ${customer.name}`,
      after: { code: customer.code, name: customer.name, mobile: customer.mobile },
      actor,
    });

    return toCustomerResponse(customer);
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    actor: ActorContext,
  ): Promise<CustomerResponseDto> {
    const existing = await customerRepository.findById(id);
    if (!existing) throw new NotFoundError('Customer', id);

    await this.assertUniqueFields(dto, id);

    const data: Prisma.CustomerUncheckedUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.businessName !== undefined ? { businessName: dto.businessName } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
      ...(dto.gstNumber !== undefined ? { gstNumber: dto.gstNumber } : {}),
      ...(dto.customerType !== undefined ? { customerType: dto.customerType } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.addressLine1 !== undefined ? { addressLine1: dto.addressLine1 } : {}),
      ...(dto.addressLine2 !== undefined ? { addressLine2: dto.addressLine2 } : {}),
      ...(dto.city !== undefined ? { city: dto.city } : {}),
      ...(dto.state !== undefined ? { state: dto.state } : {}),
      ...(dto.postalCode !== undefined ? { postalCode: dto.postalCode } : {}),
      ...(dto.country !== undefined ? { country: dto.country } : {}),
      ...(dto.creditLimit !== undefined
        ? { creditLimit: new Prisma.Decimal(dto.creditLimit) }
        : {}),
      ...(dto.followUpDate !== undefined ? { followUpDate: dto.followUpDate } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
    };

    const updated = await customerRepository.update(id, data);

    const changes = auditService.diff(
      existing,
      dto,
    );
    if (changes) {
      void auditService.record({
        action: 'UPDATE',
        entityType: AUDIT_ENTITY.CUSTOMER,
        entityId: id,
        summary: `Updated customer ${existing.code} — ${Object.keys(changes.after).join(', ')}`,
        before: changes.before,
        after: changes.after,
        actor,
      });
    }

    return toCustomerResponse(updated);
  }

  /**
   * Soft delete, blocked when the customer has any challan.
   *
   * We could soft-delete regardless and simply hide the row, but a "deleted"
   * customer whose name still appears on twelve dispatch notes is confusing for
   * users and dangerous for reporting. Blocking forces the correct action:
   * mark the account INACTIVE instead.
   */
  async delete(id: string, actor: ActorContext): Promise<void> {
    const customer = await customerRepository.findById(id);
    if (!customer) throw new NotFoundError('Customer', id);

    const challanCount = await customerRepository.countChallans(id);
    if (challanCount > 0) {
      throw new ConflictError(CustomerMessages.HAS_CHALLANS, ErrorCode.BUSINESS_RULE_VIOLATION, {
        challanCount,
        suggestion: 'Set the customer status to INACTIVE instead',
      });
    }

    await customerRepository.softDelete(id);

    void auditService.record({
      action: 'DELETE',
      entityType: AUDIT_ENTITY.CUSTOMER,
      entityId: id,
      summary: `Deleted customer ${customer.code} — ${customer.name}`,
      before: { code: customer.code, name: customer.name, mobile: customer.mobile },
      actor,
    });
  }

  // -------------------------------------------------------------------------
  // Follow-ups
  // -------------------------------------------------------------------------

  async listFollowUps(
    query: FollowUpListQuery,
  ): Promise<{ items: FollowUpResponseDto[]; total: number }> {
    // Refresh derived status before reading so the caller never sees a PENDING
    // item whose date has already passed.
    await customerRepository.markOverdueFollowUps();
    const { items, total } = await customerRepository.findFollowUps(query);
    return { items: items.map(toFollowUpResponse), total };
  }

  /**
   * Creates a follow-up and, in the same transaction, refreshes the customer's
   * cached `followUpDate`. Doing both atomically is what keeps the CRM list's
   * "due today" filter trustworthy.
   */
  async createFollowUp(
    customerId: string,
    dto: CreateFollowUpInput,
    actor: ActorContext,
  ): Promise<FollowUpResponseDto> {
    const customer = await customerRepository.findBasicById(customerId);
    if (!customer) throw new NotFoundError('Customer', customerId);

    const followUp = await prisma.$transaction(async (tx) => {
      const created = await customerRepository.createFollowUp(
        {
          customerId,
          type: dto.type,
          subject: dto.subject,
          notes: dto.notes ?? null,
          scheduledAt: dto.scheduledAt,
          status: 'PENDING',
          createdById: actor.id,
        },
        tx,
      );

      const nextPending = await customerRepository.findNextPendingFollowUp(customerId, tx);
      await customerRepository.update(
        customerId,
        { followUpDate: nextPending?.scheduledAt ?? null },
        tx,
      );

      return created;
    });

    void auditService.record({
      action: 'CREATE',
      entityType: AUDIT_ENTITY.CUSTOMER_FOLLOW_UP,
      entityId: followUp.id,
      summary: `Scheduled ${dto.type} follow-up for ${customer.code}: ${dto.subject}`,
      after: { type: dto.type, scheduledAt: dto.scheduledAt, subject: dto.subject },
      actor,
    });

    return toFollowUpResponse(followUp);
  }

  async updateFollowUp(
    id: string,
    dto: UpdateFollowUpInput,
    actor: ActorContext,
  ): Promise<FollowUpResponseDto> {
    const existing = await customerRepository.findFollowUpById(id);
    if (!existing) throw new NotFoundError('Follow-up', id);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await customerRepository.updateFollowUp(
        id,
        {
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.outcome !== undefined ? { outcome: dto.outcome } : {}),
          ...(dto.scheduledAt !== undefined ? { scheduledAt: dto.scheduledAt } : {}),
          // Completing via a plain update must still stamp the completion time.
          ...(dto.status === 'COMPLETED' && !existing.completedAt
            ? { completedAt: new Date() }
            : {}),
        },
        tx,
      );

      const nextPending = await customerRepository.findNextPendingFollowUp(
        existing.customerId,
        tx,
      );
      await customerRepository.update(
        existing.customerId,
        { followUpDate: nextPending?.scheduledAt ?? null },
        tx,
      );

      return result;
    });

    void auditService.record({
      action: 'UPDATE',
      entityType: AUDIT_ENTITY.CUSTOMER_FOLLOW_UP,
      entityId: id,
      summary: `Updated follow-up: ${existing.subject}`,
      before: { status: existing.status, scheduledAt: existing.scheduledAt },
      after: dto,
      actor,
    });

    return toFollowUpResponse(updated);
  }

  /**
   * Convenience endpoint for the timeline UI: record the outcome, close the
   * item, and optionally schedule the next one — all atomically. Without this,
   * a sales rep does three requests and any of them can fail halfway.
   */
  async completeFollowUp(
    id: string,
    dto: CompleteFollowUpInput,
    actor: ActorContext,
  ): Promise<FollowUpResponseDto> {
    const existing = await customerRepository.findFollowUpById(id);
    if (!existing) throw new NotFoundError('Follow-up', id);

    if (existing.status === 'COMPLETED') {
      throw new ConflictError('This follow-up is already completed');
    }

    const completed = await prisma.$transaction(async (tx) => {
      const result = await customerRepository.updateFollowUp(
        id,
        { status: 'COMPLETED', completedAt: new Date(), outcome: dto.outcome },
        tx,
      );

      if (dto.nextFollowUpDate) {
        await customerRepository.createFollowUp(
          {
            customerId: existing.customerId,
            type: existing.type,
            subject: `Follow-up on: ${existing.subject}`,
            scheduledAt: dto.nextFollowUpDate,
            status: 'PENDING',
            createdById: actor.id,
          },
          tx,
        );
      }

      const nextPending = await customerRepository.findNextPendingFollowUp(
        existing.customerId,
        tx,
      );
      await customerRepository.update(
        existing.customerId,
        { followUpDate: nextPending?.scheduledAt ?? null },
        tx,
      );

      return result;
    });

    void auditService.record({
      action: 'UPDATE',
      entityType: AUDIT_ENTITY.CUSTOMER_FOLLOW_UP,
      entityId: id,
      summary: `Completed follow-up: ${existing.subject}`,
      after: { outcome: dto.outcome, nextFollowUpDate: dto.nextFollowUpDate },
      actor,
    });

    return toFollowUpResponse(completed);
  }

  async deleteFollowUp(id: string, actor: ActorContext): Promise<void> {
    const existing = await customerRepository.findFollowUpById(id);
    if (!existing) throw new NotFoundError('Follow-up', id);

    await prisma.$transaction(async (tx) => {
      await customerRepository.deleteFollowUp(id, tx);
      const nextPending = await customerRepository.findNextPendingFollowUp(
        existing.customerId,
        tx,
      );
      await customerRepository.update(
        existing.customerId,
        { followUpDate: nextPending?.scheduledAt ?? null },
        tx,
      );
    });

    void auditService.record({
      action: 'DELETE',
      entityType: AUDIT_ENTITY.CUSTOMER_FOLLOW_UP,
      entityId: id,
      summary: `Deleted follow-up: ${existing.subject}`,
      before: { subject: existing.subject, scheduledAt: existing.scheduledAt },
      actor,
    });
  }

  /**
   * Merged activity feed for the customer detail page: follow-ups and audit
   * events interleaved into one chronological timeline.
   */
  async getActivityTimeline(
    customerId: string,
    limit = 30,
  ): Promise<
    Array<{
      id: string;
      kind: 'FOLLOW_UP' | 'AUDIT';
      title: string;
      description: string | null;
      actor: string | null;
      occurredAt: string;
      meta: Record<string, unknown>;
    }>
  > {
    const customer = await customerRepository.findBasicById(customerId);
    if (!customer) throw new NotFoundError('Customer', customerId);

    const [followUps, auditEntries] = await Promise.all([
      customerRepository.findFollowUps({ customerId, limit, page: 1 }),
      auditService.timelineFor(AUDIT_ENTITY.CUSTOMER, customerId, limit),
    ]);

    const followUpEvents = followUps.items.map((item) => ({
      id: item.id,
      kind: 'FOLLOW_UP' as const,
      title: `${item.type} — ${item.subject}`,
      description: item.outcome ?? item.notes,
      actor: `${item.createdBy.firstName} ${item.createdBy.lastName}`.trim(),
      occurredAt: (item.completedAt ?? item.scheduledAt).toISOString(),
      meta: { status: item.status, type: item.type },
    }));

    const auditEvents = auditEntries.map((entry) => ({
      id: entry.id,
      kind: 'AUDIT' as const,
      title: entry.summary,
      description: null,
      actor: entry.actorEmail,
      occurredAt: entry.createdAt.toISOString(),
      meta: { action: entry.action },
    }));

    return [...followUpEvents, ...auditEvents]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }
}

export const customerService = new CustomerService();
export { CustomerService };
