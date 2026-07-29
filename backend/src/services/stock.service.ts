/**
 * Stock domain service — THE single writer for inventory quantities.
 *
 * Architectural rule, enforced by convention and code review:
 *   No other service, controller or script may update `inventory.quantityOnHand`.
 *   Every change goes through `applyMovement` (single item) or
 *   `applyMovements` (multi-item, one transaction).
 *
 * That rule buys three properties for free:
 *   1. Every quantity change produces exactly one ledger row. The ledger and
 *      the balance can never disagree, because they are written together.
 *   2. Negative stock is impossible — the check lives in one place.
 *   3. Audit coverage is total, because auditing is part of the same code path.
 *
 * All public methods here either take a transaction client or open one. Callers
 * that need stock changes to commit atomically with their own writes (the
 * challan service) pass their `tx` in.
 */
import type { MovementReason, MovementType } from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';
import { AUDIT_ENTITY, REFERENCE_TYPE } from '../constants/app.constants';
import { InventoryMessages } from '../constants/messages';
import { inventoryRepository } from '../repositories/inventory.repository';
import type { StockMovementListQuery } from '../repositories/inventory.repository';
import { productRepository } from '../repositories/product.repository';
import { auditService } from './audit.service';
import { toStockMovementResponse } from '../dto/product.dto';
import type { StockMovementResponseDto } from '../dto/product.dto';
import { BusinessRuleError, InsufficientStockError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { ActorContext } from '../types/common.types';

/** One requested change to one product's stock. */
export interface MovementRequest {
  productId: string;
  movementType: MovementType;
  reason: MovementReason;
  /** Positive magnitude. Direction is derived from `movementType`. */
  quantity: number;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceCode?: string | null;
  notes?: string | null;
}

export interface AppliedMovement {
  movementId: string;
  productId: string;
  sku: string;
  quantityBefore: number;
  quantityAfter: number;
}

/**
 * Maps a movement type to the sign of its effect on stock.
 *
 * ADJUSTMENT is special: it may go either way, so its sign comes from the
 * caller-supplied signed quantity rather than from the type. Everything else
 * has a fixed direction, which removes an entire class of "we deducted when we
 * meant to add" bugs.
 */
const directionOf = (movementType: MovementType): 1 | -1 | 0 => {
  switch (movementType) {
    case 'IN':
    case 'RETURN':
      return 1;
    case 'OUT':
    case 'DAMAGE':
      return -1;
    case 'ADJUSTMENT':
      return 0; // signed by the caller
    default: {
      // Exhaustiveness guard: adding a new MovementType without handling it
      // here becomes a compile error rather than silent zero-effect movement.
      const exhaustive: never = movementType;
      throw new Error(`Unhandled movement type: ${String(exhaustive)}`);
    }
  }
};

class StockService {
  /**
   * Applies a batch of movements atomically inside an EXISTING transaction.
   *
   * Sequence, and why the order matters:
   *   1. Lock every affected inventory row in a deterministic order (deadlock
   *      avoidance — see inventory.repository).
   *   2. Validate ALL lines against the locked values before writing anything.
   *      Validating-as-we-go would leave a half-applied challan when line 4 of
   *      6 turns out to be short.
   *   3. Apply deltas and append ledger rows.
   *
   * @param signedQuantities For ADJUSTMENT movements the caller supplies a
   *                         signed value; for all other types the sign is
   *                         implied and `quantity` must be positive.
   */
  async applyMovements(
    tx: DbClient,
    requests: MovementRequest[],
    actor: ActorContext,
    options: { signedQuantities?: boolean } = {},
  ): Promise<AppliedMovement[]> {
    if (requests.length === 0) return [];

    // Merge duplicate product lines so a single product cannot be locked and
    // validated twice with two independent "before" values.
    const merged = new Map<string, MovementRequest>();
    for (const request of requests) {
      const existing = merged.get(request.productId);
      if (existing && existing.movementType === request.movementType) {
        existing.quantity += request.quantity;
      } else if (existing) {
        throw new BusinessRuleError(
          'A single product cannot have two different movement types in one operation',
          { productId: request.productId },
        );
      } else {
        merged.set(request.productId, { ...request });
      }
    }

    const productIds = [...merged.keys()];

    // --- 1. Lock -----------------------------------------------------------
    const lockedRows = await inventoryRepository.lockManyForUpdate(productIds, tx);
    const lockedByProduct = new Map(lockedRows.map((row) => [row.productId, row]));

    // Product metadata for error messages and the ledger. Read after the lock
    // so it reflects post-lock state.
    const products = await productRepository.findSellableByIds(productIds, tx);
    const productById = new Map(products.map((product) => [product.id, product]));

    // --- 2. Validate everything before mutating anything -------------------
    const shortages: Array<{
      productId: string;
      sku: string;
      name: string;
      requested: number;
      available: number;
    }> = [];

    const plan: Array<{
      request: MovementRequest;
      delta: number;
      before: number;
      after: number;
      sku: string;
    }> = [];

    for (const [productId, request] of merged) {
      const product = productById.get(productId);
      if (!product) {
        throw new NotFoundError('Product', productId);
      }

      const locked = lockedByProduct.get(productId);
      if (!locked) {
        throw new NotFoundError('Inventory record for product', product.sku);
      }

      const direction = directionOf(request.movementType);
      const delta = options.signedQuantities && direction === 0
        ? request.quantity
        : direction * Math.abs(request.quantity);

      if (delta === 0) {
        throw new BusinessRuleError('A stock movement must change the quantity', {
          productId,
          sku: product.sku,
        });
      }

      const before = locked.quantityOnHand;
      const after = before + delta;

      if (after < 0) {
        shortages.push({
          productId,
          sku: product.sku,
          name: product.name,
          requested: Math.abs(delta),
          available: before,
        });
        continue;
      }

      plan.push({ request, delta, before, after, sku: product.sku });
    }

    if (shortages.length > 0) {
      // Throwing rolls the caller's transaction back — nothing has been written.
      throw new InsufficientStockError(shortages);
    }

    // --- 3. Apply ----------------------------------------------------------
    const applied: AppliedMovement[] = [];

    for (const entry of plan) {
      await inventoryRepository.applyDelta(entry.request.productId, entry.delta, tx);

      const movement = await inventoryRepository.recordMovement(
        {
          productId: entry.request.productId,
          movementType: entry.request.movementType,
          reason: entry.request.reason,
          quantity: Math.abs(entry.delta),
          quantityBefore: entry.before,
          quantityAfter: entry.after,
          referenceType: entry.request.referenceType ?? REFERENCE_TYPE.MANUAL,
          referenceId: entry.request.referenceId ?? null,
          referenceCode: entry.request.referenceCode ?? null,
          notes: entry.request.notes ?? null,
          createdById: actor.id,
        },
        tx,
      );

      // Transactional audit: an unauditable stock change must not commit.
      await auditService.recordInTransaction(tx, {
        action: 'STOCK_ADJUSTMENT',
        entityType: AUDIT_ENTITY.INVENTORY,
        entityId: entry.request.productId,
        summary: `${entry.request.movementType} ${Math.abs(entry.delta)} of ${entry.sku} (${entry.before} -> ${entry.after})`,
        before: { quantityOnHand: entry.before },
        after: { quantityOnHand: entry.after, reason: entry.request.reason },
        actor,
      });

      applied.push({
        movementId: movement.id,
        productId: entry.request.productId,
        sku: entry.sku,
        quantityBefore: entry.before,
        quantityAfter: entry.after,
      });
    }

    logger.debug('Applied stock movements', { count: applied.length, actor: actor.id });
    return applied;
  }

  /** Single-product convenience wrapper that opens its own transaction. */
  async applyMovement(
    request: MovementRequest,
    actor: ActorContext,
    options: { signedQuantities?: boolean } = {},
  ): Promise<AppliedMovement> {
    const [applied] = await prisma.$transaction(async (tx) =>
      this.applyMovements(tx, [request], actor, options),
    );

    if (!applied) {
      throw new BusinessRuleError(InventoryMessages.NEGATIVE_RESULT);
    }
    return applied;
  }

  /**
   * Manual stock adjustment (stock take, damage write-off, correction).
   *
   * `quantityDelta` is signed: +5 found during a count, -2 broken in transit.
   * The movement type is derived so the ledger stays semantically meaningful
   * rather than recording everything as a generic ADJUSTMENT.
   */
  async adjustStock(
    input: {
      productId: string;
      quantityDelta: number;
      reason: MovementReason;
      notes?: string | null;
    },
    actor: ActorContext,
  ): Promise<AppliedMovement> {
    const product = await productRepository.findById(input.productId);
    if (!product) throw new NotFoundError('Product', input.productId);

    const movementType: MovementType =
      input.reason === 'DAMAGE_WRITE_OFF'
        ? 'DAMAGE'
        : input.reason === 'CUSTOMER_RETURN'
          ? 'RETURN'
          : 'ADJUSTMENT';

    const applied = await prisma.$transaction(async (tx) => {
      const results = await this.applyMovements(
        tx,
        [
          {
            productId: input.productId,
            movementType,
            reason: input.reason,
            // DAMAGE/RETURN carry their own direction, so pass a magnitude;
            // ADJUSTMENT keeps the caller's sign.
            quantity: movementType === 'ADJUSTMENT' ? input.quantityDelta : Math.abs(input.quantityDelta),
            referenceType: REFERENCE_TYPE.MANUAL,
            notes: input.notes ?? null,
          },
        ],
        actor,
        { signedQuantities: true },
      );

      if (input.reason === 'STOCK_TAKE_ADJUSTMENT') {
        await inventoryRepository.markStockTake(input.productId, tx);
      }

      return results[0];
    });

    if (!applied) throw new BusinessRuleError(InventoryMessages.NEGATIVE_RESULT);
    return applied;
  }

  /**
   * Sets stock to an absolute value (physical count reconciliation).
   * Converted into a signed delta so it still produces a proper ledger entry —
   * "was 40, counted 37" must be traceable, not a silent overwrite.
   */
  async setAbsoluteStock(
    input: { productId: string; countedQuantity: number; notes?: string | null },
    actor: ActorContext,
  ): Promise<AppliedMovement | null> {
    const inventory = await inventoryRepository.findByProductId(input.productId);
    if (!inventory) throw new NotFoundError('Inventory record', input.productId);

    const delta = input.countedQuantity - inventory.quantityOnHand;
    if (delta === 0) {
      // Nothing to record: a stock take that matches the book is not an event.
      await prisma.inventory.update({
        where: { productId: input.productId },
        data: { lastStockTakeAt: new Date() },
      });
      return null;
    }

    return this.adjustStock(
      {
        productId: input.productId,
        quantityDelta: delta,
        reason: 'STOCK_TAKE_ADJUSTMENT',
        notes:
          input.notes ??
          `Stock take: system ${inventory.quantityOnHand}, counted ${input.countedQuantity}`,
      },
      actor,
    );
  }

  async listMovements(
    query: StockMovementListQuery,
  ): Promise<{ items: StockMovementResponseDto[]; total: number }> {
    const { items, total } = await inventoryRepository.findMovements(query);
    return { items: items.map(toStockMovementResponse), total };
  }

  async getMovementById(id: string): Promise<StockMovementResponseDto> {
    const movement = await inventoryRepository.findMovementById(id);
    if (!movement) throw new NotFoundError('Stock movement', id);
    return toStockMovementResponse(movement);
  }

  /** Aggregates for the inventory dashboard. */
  async getInventorySummary(): Promise<{
    totalProducts: number;
    totalUnits: number;
    outOfStockCount: number;
    lowStockCount: number;
    valuation: { atCost: number; atSelling: number };
    lowStockProducts: Array<{
      id: string;
      sku: string;
      name: string;
      quantityOnHand: number;
      minimumStock: number;
      shortfall: number;
    }>;
    movementTrend: Array<{ date: string; inbound: number; outbound: number }>;
    topMoving: Array<{ productId: string; sku: string; name: string; unitsOut: number }>;
  }> {
    const [summary, valuation, lowStock, movementTrend, topMoving] = await Promise.all([
      inventoryRepository.summary(),
      productRepository.totalStockValuation(),
      productRepository.findLowStockProducts(10),
      inventoryRepository.movementTrend(30),
      inventoryRepository.topMovingProducts(30, 5),
    ]);

    return {
      ...summary,
      valuation,
      lowStockProducts: lowStock.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        quantityOnHand: product.inventory?.quantityOnHand ?? 0,
        minimumStock: product.minimumStock,
        shortfall: Math.max(0, product.minimumStock - (product.inventory?.quantityOnHand ?? 0)),
      })),
      movementTrend,
      topMoving,
    };
  }
}

export const stockService = new StockService();
export { StockService };
