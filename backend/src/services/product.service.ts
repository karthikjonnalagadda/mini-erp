/**
 * Catalogue domain service (products + categories).
 *
 * Business rules owned here:
 *  - SKU and barcode are unique among live products.
 *  - Creating a product also creates its inventory row, and any opening balance
 *    is posted as a real OPENING_BALANCE stock movement rather than written
 *    directly — the ledger must explain every unit that exists.
 *  - A product that still holds stock or appears on a challan cannot be deleted.
 *  - A category with products cannot be deleted, and cannot be its own ancestor.
 */
import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import { AUDIT_ENTITY, REFERENCE_TYPE } from '../constants/app.constants';
import { ErrorCode } from '../constants/http-status';
import { CategoryMessages, ProductMessages } from '../constants/messages';
import { categoryRepository } from '../repositories/category.repository';
import type { CategoryListQuery } from '../repositories/category.repository';
import { inventoryRepository } from '../repositories/inventory.repository';
import { productRepository } from '../repositories/product.repository';
import type { ProductListQuery } from '../repositories/product.repository';
import { auditService } from './audit.service';
import { stockService } from './stock.service';
import { toCategoryResponse, toProductResponse } from '../dto/product.dto';
import type {
  CategoryResponseDto,
  CreateCategoryDto,
  CreateProductDto,
  ProductResponseDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from '../dto/product.dto';
import { BusinessRuleError, ConflictError, DuplicateResourceError, NotFoundError } from '../utils/errors';
import { slugify } from '../utils/sanitize';
import type { ActorContext } from '../types/common.types';

class ProductService {
  // =========================================================================
  // Categories
  // =========================================================================

  async listCategories(
    query: CategoryListQuery,
  ): Promise<{ items: CategoryResponseDto[]; total: number }> {
    const { items, total } = await categoryRepository.findMany(query);
    return { items: items.map(toCategoryResponse), total };
  }

  /** Unpaginated active list for form dropdowns. */
  async listCategoryOptions(): Promise<Array<{ id: string; name: string; slug: string }>> {
    return categoryRepository.findAllActive();
  }

  async getCategoryById(id: string): Promise<CategoryResponseDto> {
    const category = await categoryRepository.findById(id);
    if (!category) throw new NotFoundError('Category', id);
    return toCategoryResponse(category);
  }

  /**
   * Slug generation retries with a numeric suffix rather than failing, because
   * "Cables" and "cables" are legitimately different display names that would
   * otherwise collide on slug.
   */
  private async generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
    const base = slugify(name) || 'category';
    let candidate = base;

    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const existing = await prisma.category.findFirst({
        where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
        select: { id: true },
      });
      if (!existing) return candidate;
      candidate = `${base}-${attempt + 1}`;
    }

    // Extremely unlikely; a timestamp suffix is always unique.
    return `${base}-${Date.now()}`;
  }

  async createCategory(dto: CreateCategoryDto, actor: ActorContext): Promise<CategoryResponseDto> {
    const duplicate = await categoryRepository.findByName(dto.name);
    if (duplicate) throw new DuplicateResourceError(CategoryMessages.DUPLICATE_NAME, 'name');

    if (dto.parentId) {
      const parent = await categoryRepository.findById(dto.parentId);
      if (!parent) throw new NotFoundError('Parent category', dto.parentId);
    }

    const category = await categoryRepository.create({
      name: dto.name,
      slug: await this.generateUniqueSlug(dto.name),
      description: dto.description ?? null,
      parentId: dto.parentId ?? null,
      isActive: dto.isActive ?? true,
    });

    void auditService.record({
      action: 'CREATE',
      entityType: AUDIT_ENTITY.CATEGORY,
      entityId: category.id,
      summary: `Created category ${category.name}`,
      after: { name: category.name, parentId: category.parentId },
      actor,
    });

    return toCategoryResponse(category);
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
    actor: ActorContext,
  ): Promise<CategoryResponseDto> {
    const existing = await categoryRepository.findById(id);
    if (!existing) throw new NotFoundError('Category', id);

    if (dto.name && dto.name !== existing.name) {
      const duplicate = await categoryRepository.findByName(dto.name, id);
      if (duplicate) throw new DuplicateResourceError(CategoryMessages.DUPLICATE_NAME, 'name');
    }

    // A category that is its own ancestor produces an infinite loop in every
    // tree renderer that touches it.
    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BusinessRuleError(CategoryMessages.SELF_PARENT);
      }
      const parent = await categoryRepository.findById(dto.parentId);
      if (!parent) throw new NotFoundError('Parent category', dto.parentId);
      if (parent.parentId === id) {
        throw new BusinessRuleError('This change would create a circular category hierarchy');
      }
    }

    const updated = await categoryRepository.update(id, {
      ...(dto.name !== undefined ? { name: dto.name, slug: await this.generateUniqueSlug(dto.name, id) } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });

    void auditService.record({
      action: 'UPDATE',
      entityType: AUDIT_ENTITY.CATEGORY,
      entityId: id,
      summary: `Updated category ${existing.name}`,
      before: { name: existing.name, isActive: existing.isActive },
      after: dto,
      actor,
    });

    return toCategoryResponse(updated);
  }

  async deleteCategory(id: string, actor: ActorContext): Promise<void> {
    const category = await categoryRepository.findById(id);
    if (!category) throw new NotFoundError('Category', id);

    const productCount = await categoryRepository.countProducts(id);
    if (productCount > 0) {
      throw new ConflictError(CategoryMessages.HAS_PRODUCTS, ErrorCode.BUSINESS_RULE_VIOLATION, {
        productCount,
        suggestion: 'Reassign the products or deactivate the category instead',
      });
    }

    if (category._count.children > 0) {
      throw new ConflictError(
        'This category has sub-categories and cannot be deleted',
        ErrorCode.BUSINESS_RULE_VIOLATION,
        { childCount: category._count.children },
      );
    }

    await categoryRepository.delete(id);

    void auditService.record({
      action: 'DELETE',
      entityType: AUDIT_ENTITY.CATEGORY,
      entityId: id,
      summary: `Deleted category ${category.name}`,
      before: { name: category.name },
      actor,
    });
  }

  // =========================================================================
  // Products
  // =========================================================================

  async listProducts(
    query: ProductListQuery,
  ): Promise<{ items: ProductResponseDto[]; total: number }> {
    const { items, total } = await productRepository.findMany(query);
    return { items: items.map(toProductResponse), total };
  }

  async getProductById(id: string): Promise<ProductResponseDto> {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    return toProductResponse(product);
  }

  private async assertUniqueProductKeys(
    dto: { sku?: string; barcode?: string | null },
    excludeId?: string,
  ): Promise<void> {
    if (dto.sku) {
      const bySku = await productRepository.findBySku(dto.sku, excludeId);
      if (bySku) throw new DuplicateResourceError(ProductMessages.DUPLICATE_SKU, 'sku');
    }
    if (dto.barcode) {
      const byBarcode = await productRepository.findByBarcode(dto.barcode, excludeId);
      if (byBarcode) throw new DuplicateResourceError(ProductMessages.DUPLICATE_BARCODE, 'barcode');
    }
  }

  /**
   * Creates a product with its inventory row.
   *
   * The opening balance is NOT written straight into `quantityOnHand`. The
   * inventory row starts at zero and the opening quantity is posted through
   * StockService, so the ledger accounts for every unit in the warehouse from
   * day one. Reconciling "where did these 40 units come from?" six months later
   * is exactly the scenario this protects against.
   */
  async createProduct(dto: CreateProductDto, actor: ActorContext): Promise<ProductResponseDto> {
    await this.assertUniqueProductKeys(dto);

    const category = await categoryRepository.findById(dto.categoryId);
    if (!category) throw new NotFoundError('Category', dto.categoryId);

    const product = await productRepository.create(
      {
        sku: dto.sku,
        name: dto.name,
        description: dto.description ?? null,
        barcode: dto.barcode ?? null,
        imageUrl: dto.imageUrl ?? null,
        categoryId: dto.categoryId,
        unitPrice: new Prisma.Decimal(dto.unitPrice),
        costPrice: new Prisma.Decimal(dto.costPrice ?? 0),
        taxRate: new Prisma.Decimal(dto.taxRate ?? 0),
        unit: dto.unit ?? 'PCS',
        minimumStock: dto.minimumStock ?? 0,
        isActive: dto.isActive ?? true,
      },
      {
        quantityOnHand: 0,
        warehouseLocation: dto.warehouseLocation ?? null,
        binLocation: dto.binLocation ?? null,
      },
    );

    if (dto.openingStock && dto.openingStock > 0) {
      await stockService.applyMovement(
        {
          productId: product.id,
          movementType: 'IN',
          reason: 'OPENING_BALANCE',
          quantity: dto.openingStock,
          referenceType: REFERENCE_TYPE.OPENING,
          notes: 'Opening balance recorded at product creation',
        },
        actor,
      );
    }

    void auditService.record({
      action: 'CREATE',
      entityType: AUDIT_ENTITY.PRODUCT,
      entityId: product.id,
      summary: `Created product ${product.sku} — ${product.name}`,
      after: { sku: product.sku, name: product.name, openingStock: dto.openingStock ?? 0 },
      actor,
    });

    // Re-read so the response reflects the opening-balance movement.
    return this.getProductById(product.id);
  }

  async updateProduct(
    id: string,
    dto: UpdateProductDto,
    actor: ActorContext,
  ): Promise<ProductResponseDto> {
    const existing = await productRepository.findById(id);
    if (!existing) throw new NotFoundError('Product', id);

    await this.assertUniqueProductKeys(dto, id);

    if (dto.categoryId && dto.categoryId !== existing.categoryId) {
      const category = await categoryRepository.findById(dto.categoryId);
      if (!category) throw new NotFoundError('Category', dto.categoryId);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await productRepository.update(
        id,
        {
          ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.unitPrice !== undefined ? { unitPrice: new Prisma.Decimal(dto.unitPrice) } : {}),
          ...(dto.costPrice !== undefined ? { costPrice: new Prisma.Decimal(dto.costPrice) } : {}),
          ...(dto.taxRate !== undefined ? { taxRate: new Prisma.Decimal(dto.taxRate) } : {}),
          ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
          ...(dto.minimumStock !== undefined ? { minimumStock: dto.minimumStock } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        tx,
      );

      // Location is inventory metadata, not catalogue data — but it is edited
      // from the same form, so the service reunites the two writes.
      if (dto.warehouseLocation !== undefined || dto.binLocation !== undefined) {
        await inventoryRepository.updateLocation(
          id,
          {
            ...(dto.warehouseLocation !== undefined
              ? { warehouseLocation: dto.warehouseLocation }
              : {}),
            ...(dto.binLocation !== undefined ? { binLocation: dto.binLocation } : {}),
          },
          tx,
        );
      }

      return result;
    });

    const changes = auditService.diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    if (changes) {
      void auditService.record({
        action: 'UPDATE',
        entityType: AUDIT_ENTITY.PRODUCT,
        entityId: id,
        summary: `Updated product ${existing.sku} — ${Object.keys(changes.after).join(', ')}`,
        before: changes.before,
        after: changes.after,
        actor,
      });
    }

    return toProductResponse(updated);
  }

  /**
   * Soft delete, blocked while the product holds stock or has sales history.
   *
   * Deleting a product that still has 40 units on the shelf would make those
   * units vanish from every valuation report while physically existing. The
   * correct workflow is: write the stock off, then delete.
   */
  async deleteProduct(id: string, actor: ActorContext): Promise<void> {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError('Product', id);

    const onHand = product.inventory?.quantityOnHand ?? 0;
    if (onHand > 0) {
      throw new ConflictError(ProductMessages.HAS_STOCK, ErrorCode.BUSINESS_RULE_VIOLATION, {
        quantityOnHand: onHand,
        suggestion: 'Write the remaining stock off before deleting this product',
      });
    }

    const challanItemCount = await productRepository.countChallanItems(id);
    if (challanItemCount > 0) {
      throw new ConflictError(ProductMessages.HAS_CHALLANS, ErrorCode.BUSINESS_RULE_VIOLATION, {
        challanItemCount,
        suggestion: 'Deactivate the product instead so historical documents stay intact',
      });
    }

    await productRepository.softDelete(id);

    void auditService.record({
      action: 'DELETE',
      entityType: AUDIT_ENTITY.PRODUCT,
      entityId: id,
      summary: `Deleted product ${product.sku} — ${product.name}`,
      before: { sku: product.sku, name: product.name },
      actor,
    });
  }
}

export const productService = new ProductService();
export { ProductService };
