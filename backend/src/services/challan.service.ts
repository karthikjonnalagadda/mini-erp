/**
 * Sales challan domain service.
 *
 * ===========================================================================
 * THE STATE MACHINE
 * ===========================================================================
 *
 *                  confirm                    cancel
 *      DRAFT ──────────────────> CONFIRMED ─────────────> CANCELLED
 *        │                         (stock -N)               (stock +N)
 *        │  cancel
 *        └────────────────────────────────────────────────> CANCELLED
 *                              (no stock effect)
 *
 *   DRAFT      editable, deletable. NO stock impact — this is the whole point
 *              of a draft: build the document, verify it, then commit.
 *   CONFIRMED  immutable. Stock has been deducted and the customer's
 *              outstanding balance increased.
 *   CANCELLED  terminal. If it was CONFIRMED, the stock is returned and the
 *              balance reversed.
 *
 * Transitions not on this diagram are rejected with 422 by
 * `assertTransitionAllowed`. There is no path back to DRAFT: a confirmed
 * document is a financial record, and "un-confirming" it would let someone
 * rewrite history. Cancel and re-issue instead.
 *
 * ===========================================================================
 * ATOMICITY
 * ===========================================================================
 *
 * `confirm` performs four writes that must all succeed or all fail:
 *   1. deduct stock for every line (with row locks),
 *   2. append a stock-movement ledger row per line,
 *   3. flip the challan status,
 *   4. increase the customer's outstanding balance.
 *
 * A partial application here means physical stock and the system disagree —
 * the single worst failure mode an ERP has. Everything therefore runs inside
 * one `prisma.$transaction`, and the audit rows are written transactionally too.
 */
import { Prisma } from '@prisma/client';
import type { ChallanStatus } from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';
import { AUDIT_ENTITY, REFERENCE_TYPE, SEQUENCE_KEYS, SEQUENCE_PREFIX } from '../constants/app.constants';
import { ChallanMessages } from '../constants/messages';
import { challanRepository } from '../repositories/challan.repository';
import type { ChallanListQuery } from '../repositories/challan.repository';
import { customerRepository } from '../repositories/customer.repository';
import { productRepository } from '../repositories/product.repository';
import { sequenceRepository } from '../repositories/sequence.repository';
import { auditService } from './audit.service';
import { stockService } from './stock.service';
import type { MovementRequest } from './stock.service';
import { toChallanResponse } from '../dto/challan.dto';
import type { ChallanResponseDto } from '../dto/challan.dto';
import {
  BusinessRuleError,
  InvalidStateTransitionError,
  NotFoundError,
} from '../utils/errors';
import { logger } from '../utils/logger';
import { calculateDocumentTotals, calculateLineAmounts } from '../utils/money';
import type { ActorContext } from '../types/common.types';
import type {
  CancelChallanInput,
  ConfirmChallanInput,
  CreateChallanInput,
  UpdateChallanInput,
} from '../validators/challan.validators';

/** Line items resolved against the catalogue, with prices already snapshotted. */
type PreparedLine = Prisma.SalesChallanItemCreateManyChallanInput & { _quantity: number };

/**
 * Allowed transitions. Encoding this as data rather than nested `if`s means the
 * rule is inspectable, testable, and impossible to partially implement.
 */
const ALLOWED_TRANSITIONS: Record<ChallanStatus, ChallanStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
};

class ChallanService {
  private assertTransitionAllowed(from: ChallanStatus, to: ChallanStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new InvalidStateTransitionError('challan', from, to);
    }
  }

  /**
   * Resolves line items against the live catalogue and snapshots them.
   *
   * Security-relevant: `unitPrice` and `taxRate` are read from the DATABASE, not
   * from the request. A client may propose a discounted `unitPrice` (negotiated
   * deals are real), but tax rate, SKU, name and unit always come from the
   * catalogue — otherwise a crafted request could issue a document claiming 0%
   * GST on a taxable item.
   */
  private async prepareLines(
    items: Array<{ productId: string; quantity: number; unitPrice?: number; discountPercent?: number }>,
    tx?: DbClient,
  ): Promise<PreparedLine[]> {
    if (items.length === 0) {
      throw new BusinessRuleError(ChallanMessages.EMPTY_ITEMS);
    }

    const productIds = items.map((item) => item.productId);
    const products = await productRepository.findSellableByIds(productIds, tx);
    const productById = new Map(products.map((product) => [product.id, product]));

    const missing = productIds.filter((id) => !productById.has(id));
    if (missing.length > 0) {
      throw new BusinessRuleError(
        'One or more products are unavailable, inactive or deleted',
        { productIds: missing },
      );
    }

    return items.map((item) => {
      // Non-null: every id was verified present above.
      const product = productById.get(item.productId)!;

      const unitPrice = item.unitPrice ?? Number(product.unitPrice);
      const taxRate = Number(product.taxRate);
      const discountPercent = item.discountPercent ?? 0;

      const amounts = calculateLineAmounts({
        quantity: item.quantity,
        unitPrice,
        taxRate,
        discountPercent,
      });

      return {
        productId: product.id,
        // --- immutable snapshot ---
        productSku: product.sku,
        productName: product.name,
        unit: product.unit,
        unitPrice: new Prisma.Decimal(unitPrice),
        taxRate: new Prisma.Decimal(taxRate),
        // --------------------------
        quantity: item.quantity,
        discountPercent: new Prisma.Decimal(discountPercent),
        lineSubtotal: amounts.lineSubtotal,
        lineTaxAmount: amounts.lineTaxAmount,
        lineTotal: amounts.lineTotal,
        _quantity: item.quantity,
      };
    });
  }

  /** Recomputes document totals from prepared lines. Never trusts client totals. */
  private totalsFor(lines: PreparedLine[]): ReturnType<typeof calculateDocumentTotals> {
    return calculateDocumentTotals(
      lines.map((line) => ({
        quantity: line.quantity,
        unitPrice: line.unitPrice as Prisma.Decimal,
        taxRate: line.taxRate as Prisma.Decimal,
        discountPercent: line.discountPercent as Prisma.Decimal,
      })),
    );
  }

  /** Strips the internal `_quantity` helper before handing rows to Prisma. */
  private toPersistable(
    lines: PreparedLine[],
  ): Prisma.SalesChallanItemCreateManyChallanInput[] {
    return lines.map(({ _quantity: _ignored, ...rest }) => rest);
  }

  // =========================================================================
  // Reads
  // =========================================================================

  async list(query: ChallanListQuery): Promise<{ items: ChallanResponseDto[]; total: number }> {
    const { items, total } = await challanRepository.findMany(query);
    return { items: items.map(toChallanResponse), total };
  }

  async getById(id: string): Promise<ChallanResponseDto> {
    const challan = await challanRepository.findById(id);
    if (!challan) throw new NotFoundError('Challan', id);
    return toChallanResponse(challan);
  }

  // =========================================================================
  // Create — always DRAFT, never touches stock
  // =========================================================================

  async create(dto: CreateChallanInput, actor: ActorContext): Promise<ChallanResponseDto> {
    const customer = await customerRepository.findBasicById(dto.customerId);
    if (!customer) throw new NotFoundError('Customer', dto.customerId);

    // A blacklisted customer must not be able to receive goods, even on a draft
    // — the point is to stop the process at the earliest possible step.
    if (customer.status === 'BLACKLISTED') {
      throw new BusinessRuleError(ChallanMessages.CUSTOMER_BLACKLISTED, {
        customerId: customer.id,
        customerCode: customer.code,
      });
    }

    const lines = await this.prepareLines(dto.items);
    const totals = this.totalsFor(lines);

    const challan = await prisma.$transaction(async (tx) => {
      // Allocated inside the transaction so the row lock on the sequence is
      // held until commit — see sequence.repository.ts.
      const challanNumber = await sequenceRepository.nextDocumentNumber(
        SEQUENCE_KEYS.SALES_CHALLAN,
        SEQUENCE_PREFIX.SALES_CHALLAN,
        tx,
      );

      return challanRepository.create(
        {
          challanNumber,
          status: 'DRAFT',
          customerId: dto.customerId,
          challanDate: dto.challanDate ?? new Date(),
          dispatchDate: dto.dispatchDate ?? null,
          shippingAddress: dto.shippingAddress ?? null,
          transporterName: dto.transporterName ?? null,
          vehicleNumber: dto.vehicleNumber ?? null,
          notes: dto.notes ?? null,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          createdById: actor.id,
        },
        this.toPersistable(lines),
        tx,
      );
    });

    void auditService.record({
      action: 'CREATE',
      entityType: AUDIT_ENTITY.SALES_CHALLAN,
      entityId: challan.id,
      summary: `Created draft challan ${challan.challanNumber} for ${customer.name}`,
      after: {
        challanNumber: challan.challanNumber,
        customerId: dto.customerId,
        itemCount: lines.length,
        totalAmount: Number(totals.totalAmount),
      },
      actor,
    });

    return toChallanResponse(challan);
  }

  // =========================================================================
  // Update — DRAFT only
  // =========================================================================

  async update(
    id: string,
    dto: UpdateChallanInput,
    actor: ActorContext,
  ): Promise<ChallanResponseDto> {
    const existing = await challanRepository.findById(id);
    if (!existing) throw new NotFoundError('Challan', id);

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleError(ChallanMessages.ONLY_DRAFT_EDITABLE, {
        status: existing.status,
        challanNumber: existing.challanNumber,
      });
    }

    if (dto.customerId && dto.customerId !== existing.customerId) {
      const customer = await customerRepository.findBasicById(dto.customerId);
      if (!customer) throw new NotFoundError('Customer', dto.customerId);
      if (customer.status === 'BLACKLISTED') {
        throw new BusinessRuleError(ChallanMessages.CUSTOMER_BLACKLISTED);
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Re-lock and re-check: between the read above and this transaction the
      // document could have been confirmed by someone else.
      const locked = await challanRepository.lockForUpdate(id, tx);
      if (!locked) throw new NotFoundError('Challan', id);
      if (locked.status !== 'DRAFT') {
        throw new BusinessRuleError(ChallanMessages.ONLY_DRAFT_EDITABLE, {
          status: locked.status,
        });
      }

      let totalsUpdate: Partial<Prisma.SalesChallanUncheckedUpdateInput> = {};

      if (dto.items) {
        const lines = await this.prepareLines(dto.items, tx);
        const totals = this.totalsFor(lines);
        await challanRepository.replaceItems(id, this.toPersistable(lines), tx);
        totalsUpdate = {
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
        };
      }

      return challanRepository.update(
        id,
        {
          ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
          ...(dto.challanDate !== undefined ? { challanDate: dto.challanDate } : {}),
          ...(dto.dispatchDate !== undefined ? { dispatchDate: dto.dispatchDate } : {}),
          ...(dto.shippingAddress !== undefined ? { shippingAddress: dto.shippingAddress } : {}),
          ...(dto.transporterName !== undefined ? { transporterName: dto.transporterName } : {}),
          ...(dto.vehicleNumber !== undefined ? { vehicleNumber: dto.vehicleNumber } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...totalsUpdate,
        },
        tx,
      );
    });

    void auditService.record({
      action: 'UPDATE',
      entityType: AUDIT_ENTITY.SALES_CHALLAN,
      entityId: id,
      summary: `Updated draft challan ${existing.challanNumber}`,
      before: { totalAmount: Number(existing.totalAmount), itemCount: existing.items.length },
      after: { totalAmount: Number(updated.totalAmount), itemCount: updated.items.length },
      actor,
    });

    return toChallanResponse(updated);
  }

  // =========================================================================
  // Confirm — the critical path
  // =========================================================================

  async confirm(
    id: string,
    dto: ConfirmChallanInput,
    actor: ActorContext,
  ): Promise<ChallanResponseDto> {
    const confirmed = await prisma.$transaction(
      async (tx) => {
        // 1. Lock the document so two operators cannot confirm it concurrently.
        const locked = await challanRepository.lockForUpdate(id, tx);
        if (!locked) throw new NotFoundError('Challan', id);

        this.assertTransitionAllowed(locked.status, 'CONFIRMED');

        const challan = await challanRepository.findById(id, tx);
        if (!challan) throw new NotFoundError('Challan', id);

        if (challan.items.length === 0) {
          throw new BusinessRuleError(ChallanMessages.EMPTY_ITEMS);
        }

        // 2. Deduct stock. This locks each inventory row, validates every line
        //    up front, and throws InsufficientStockError (422) with per-SKU
        //    detail if anything is short — rolling the whole transaction back.
        const movements: MovementRequest[] = challan.items.map((item) => ({
          productId: item.productId,
          movementType: 'OUT',
          reason: 'SALES_CHALLAN',
          quantity: item.quantity,
          referenceType: REFERENCE_TYPE.SALES_CHALLAN,
          referenceId: challan.id,
          referenceCode: challan.challanNumber,
          notes: `Dispatched on challan ${challan.challanNumber}`,
        }));

        await stockService.applyMovements(tx, movements, actor);

        // 3. Flip the status and snapshot the shipping address as it stands now.
        const shippingAddress =
          challan.shippingAddress ??
          [
            challan.customer.addressLine1,
            challan.customer.addressLine2,
            challan.customer.city,
            challan.customer.state,
            challan.customer.postalCode,
          ]
            .filter((part): part is string => Boolean(part && part.trim()))
            .join(', ');

        const result = await challanRepository.update(
          id,
          {
            status: 'CONFIRMED',
            confirmedById: actor.id,
            confirmedAt: new Date(),
            dispatchDate: dto.dispatchDate ?? challan.dispatchDate ?? new Date(),
            ...(dto.transporterName !== undefined
              ? { transporterName: dto.transporterName }
              : {}),
            ...(dto.vehicleNumber !== undefined ? { vehicleNumber: dto.vehicleNumber } : {}),
            shippingAddress,
          },
          tx,
        );

        // 4. The goods are out; the customer now owes for them.
        await tx.customer.update({
          where: { id: challan.customerId },
          data: { outstandingAmount: { increment: challan.totalAmount } },
        });

        // Audited inside the transaction — an unauditable confirmation must not
        // commit.
        await auditService.recordInTransaction(tx, {
          action: 'CHALLAN_CONFIRM',
          entityType: AUDIT_ENTITY.SALES_CHALLAN,
          entityId: id,
          summary: `Confirmed challan ${challan.challanNumber}; ${challan.items.length} line(s) dispatched`,
          before: { status: 'DRAFT' },
          after: {
            status: 'CONFIRMED',
            totalAmount: Number(challan.totalAmount),
            lines: challan.items.map((item) => ({
              sku: item.productSku,
              quantity: item.quantity,
            })),
          },
          actor,
        });

        return result;
      },
      {
        // Confirming a large challan takes many row locks; the default 5s
        // timeout is too tight under contention.
        timeout: 15_000,
        maxWait: 10_000,
        // Serializable is unnecessary: the explicit FOR UPDATE locks already
        // give us the isolation we need, without the retry burden.
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    logger.info('Challan confirmed', {
      challanId: id,
      challanNumber: confirmed.challanNumber,
      actor: actor.id,
    });

    return toChallanResponse(confirmed);
  }

  // =========================================================================
  // Cancel — restores stock only if it was previously deducted
  // =========================================================================

  async cancel(
    id: string,
    dto: CancelChallanInput,
    actor: ActorContext,
  ): Promise<ChallanResponseDto> {
    const cancelled = await prisma.$transaction(
      async (tx) => {
        const locked = await challanRepository.lockForUpdate(id, tx);
        if (!locked) throw new NotFoundError('Challan', id);

        if (locked.status === 'CANCELLED') {
          throw new BusinessRuleError(ChallanMessages.CANNOT_CANCEL_CANCELLED);
        }
        this.assertTransitionAllowed(locked.status, 'CANCELLED');

        const challan = await challanRepository.findById(id, tx);
        if (!challan) throw new NotFoundError('Challan', id);

        const wasConfirmed = challan.status === 'CONFIRMED';

        // Stock is only returned if it was actually taken. Cancelling a DRAFT
        // must NOT credit stock that was never deducted — that would invent
        // inventory out of nothing.
        if (wasConfirmed) {
          const movements: MovementRequest[] = challan.items.map((item) => ({
            productId: item.productId,
            movementType: 'IN',
            reason: 'CHALLAN_CANCELLATION',
            quantity: item.quantity,
            referenceType: REFERENCE_TYPE.SALES_CHALLAN,
            referenceId: challan.id,
            referenceCode: challan.challanNumber,
            notes: `Returned to stock: challan ${challan.challanNumber} cancelled`,
          }));

          await stockService.applyMovements(tx, movements, actor);

          // Reverse the receivable too.
          await tx.customer.update({
            where: { id: challan.customerId },
            data: { outstandingAmount: { decrement: challan.totalAmount } },
          });
        }

        const result = await challanRepository.update(
          id,
          {
            status: 'CANCELLED',
            cancelledById: actor.id,
            cancelledAt: new Date(),
            cancellationReason: dto.reason,
          },
          tx,
        );

        await auditService.recordInTransaction(tx, {
          action: 'CHALLAN_CANCEL',
          entityType: AUDIT_ENTITY.SALES_CHALLAN,
          entityId: id,
          summary: `Cancelled challan ${challan.challanNumber}${wasConfirmed ? ' and returned stock' : ''}`,
          before: { status: challan.status },
          after: { status: 'CANCELLED', reason: dto.reason, stockRestored: wasConfirmed },
          actor,
        });

        return result;
      },
      { timeout: 15_000, maxWait: 10_000 },
    );

    logger.info('Challan cancelled', {
      challanId: id,
      challanNumber: cancelled.challanNumber,
      actor: actor.id,
    });

    return toChallanResponse(cancelled);
  }

  // =========================================================================
  // Delete — DRAFT only, hard delete
  // =========================================================================

  /**
   * Hard delete is correct here, and only here: a draft has no stock impact, no
   * financial impact, and no statutory significance. Keeping abandoned drafts
   * around forever would clutter the ledger view for no benefit. The audit row
   * survives the deletion and records what was removed.
   */
  async delete(id: string, actor: ActorContext): Promise<void> {
    const challan = await challanRepository.findById(id);
    if (!challan) throw new NotFoundError('Challan', id);

    if (challan.status !== 'DRAFT') {
      throw new BusinessRuleError(ChallanMessages.ONLY_DRAFT_DELETABLE, {
        status: challan.status,
        suggestion: 'Cancel the challan instead',
      });
    }

    await prisma.$transaction(async (tx) => {
      const locked = await challanRepository.lockForUpdate(id, tx);
      if (!locked) throw new NotFoundError('Challan', id);
      if (locked.status !== 'DRAFT') {
        throw new BusinessRuleError(ChallanMessages.ONLY_DRAFT_DELETABLE, {
          status: locked.status,
        });
      }
      // Line items cascade via the FK.
      await challanRepository.delete(id, tx);
    });

    void auditService.record({
      action: 'DELETE',
      entityType: AUDIT_ENTITY.SALES_CHALLAN,
      entityId: id,
      summary: `Deleted draft challan ${challan.challanNumber}`,
      before: {
        challanNumber: challan.challanNumber,
        totalAmount: Number(challan.totalAmount),
        itemCount: challan.items.length,
      },
      actor,
    });
  }

  /** Raw entity for the PDF renderer, which needs the Prisma shape. */
  async getEntityById(id: string): Promise<NonNullable<Awaited<ReturnType<typeof challanRepository.findById>>>> {
    const challan = await challanRepository.findById(id);
    if (!challan) throw new NotFoundError('Challan', id);
    return challan;
  }
}

export const challanService = new ChallanService();
export { ChallanService };
