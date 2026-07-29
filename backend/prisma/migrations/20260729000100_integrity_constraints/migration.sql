-- =============================================================================
-- Database-level integrity constraints
-- -----------------------------------------------------------------------------
-- Prisma's schema language cannot express CHECK constraints or partial unique
-- indexes, so they are added here by hand.
--
-- WHY BOTHER, when the service layer already validates all of this?
--
-- Because the service layer is one process among several that will eventually
-- touch this database: a migration script, a data fix run from psql at 2am, a
-- future reporting job, or simply a regression in our own code. Application
-- validation prevents mistakes; database constraints make a whole class of
-- corrupt states *unrepresentable*.
--
-- The rule of thumb applied here: any invariant whose violation would be
-- expensive to detect later (negative stock, a 300% tax rate, two live
-- customers sharing a mobile number) gets a constraint.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Inventory — the single most important invariant in the system.
-- Physical stock cannot be negative. Ever. By any code path.
-- -----------------------------------------------------------------------------
ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_quantity_on_hand_non_negative"
  CHECK ("quantityOnHand" >= 0);

ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_quantity_reserved_non_negative"
  CHECK ("quantityReserved" >= 0);

-- Reserved stock is a subset of stock on hand; reserving more than exists is
-- a promise the warehouse cannot keep.
ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_reserved_not_exceeding_on_hand"
  CHECK ("quantityReserved" <= "quantityOnHand");

-- -----------------------------------------------------------------------------
-- Stock movements — the ledger is append-only, so bad rows are permanent.
-- `quantity` is a magnitude; direction lives in `movementType`.
-- -----------------------------------------------------------------------------
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_balances_non_negative"
  CHECK ("quantityBefore" >= 0 AND "quantityAfter" >= 0);

-- -----------------------------------------------------------------------------
-- Products — money and rates.
-- -----------------------------------------------------------------------------
ALTER TABLE "products"
  ADD CONSTRAINT "products_prices_non_negative"
  CHECK ("unitPrice" >= 0 AND "costPrice" >= 0);

ALTER TABLE "products"
  ADD CONSTRAINT "products_tax_rate_valid"
  CHECK ("taxRate" >= 0 AND "taxRate" <= 100);

ALTER TABLE "products"
  ADD CONSTRAINT "products_minimum_stock_non_negative"
  CHECK ("minimumStock" >= 0);

-- -----------------------------------------------------------------------------
-- Sales challans and their line items.
-- -----------------------------------------------------------------------------
ALTER TABLE "sales_challans"
  ADD CONSTRAINT "sales_challans_amounts_non_negative"
  CHECK (
    "subtotal" >= 0 AND
    "discountAmount" >= 0 AND
    "taxAmount" >= 0 AND
    "totalAmount" >= 0
  );

ALTER TABLE "sales_challan_items"
  ADD CONSTRAINT "sales_challan_items_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "sales_challan_items"
  ADD CONSTRAINT "sales_challan_items_discount_valid"
  CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);

ALTER TABLE "sales_challan_items"
  ADD CONSTRAINT "sales_challan_items_amounts_non_negative"
  CHECK ("lineSubtotal" >= 0 AND "lineTaxAmount" >= 0 AND "lineTotal" >= 0);

-- A confirmed challan must record who confirmed it and when; a cancelled one
-- must record why. Enforcing the state machine's data requirements in SQL means
-- a half-applied transition cannot survive a commit.
ALTER TABLE "sales_challans"
  ADD CONSTRAINT "sales_challans_confirmed_metadata"
  CHECK (
    "status" <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL)
  );

ALTER TABLE "sales_challans"
  ADD CONSTRAINT "sales_challans_cancelled_metadata"
  CHECK (
    "status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL)
  );

-- -----------------------------------------------------------------------------
-- Customers — commercial terms.
-- -----------------------------------------------------------------------------
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_credit_limit_non_negative"
  CHECK ("creditLimit" >= 0);

-- -----------------------------------------------------------------------------
-- Partial unique indexes: "unique among LIVE rows".
--
-- A plain UNIQUE index would be wrong — after soft-deleting a customer their
-- mobile number must be reusable. A partial index scoped to `deletedAt IS NULL`
-- expresses exactly the rule the service layer enforces, and closes the race
-- window between the service's existence check and its INSERT.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX "customers_mobile_live_key"
  ON "customers" ("mobile")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "customers_email_live_key"
  ON "customers" ("email")
  WHERE "deletedAt" IS NULL AND "email" IS NOT NULL;

CREATE UNIQUE INDEX "customers_gst_live_key"
  ON "customers" ("gstNumber")
  WHERE "deletedAt" IS NULL AND "gstNumber" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Composite indexes for the hot list queries.
--
-- Chosen from the actual `where` clauses in the repositories rather than added
-- speculatively — every index costs write throughput.
-- -----------------------------------------------------------------------------

-- Challan list: filtered by status, ordered by date. Covers the default view.
CREATE INDEX "sales_challans_status_date_idx"
  ON "sales_challans" ("status", "challanDate" DESC);

-- Customer list: the "my accounts, by stage" view used by sales reps.
CREATE INDEX "customers_owner_status_idx"
  ON "customers" ("ownerId", "status")
  WHERE "deletedAt" IS NULL;

-- Product list: browse-by-category, active only.
CREATE INDEX "products_category_active_idx"
  ON "products" ("categoryId", "isActive")
  WHERE "deletedAt" IS NULL;

-- Stock ledger: per-product history, newest first.
CREATE INDEX "stock_movements_product_type_date_idx"
  ON "stock_movements" ("productId", "movementType", "createdAt" DESC);
