/**
 * API contract types.
 *
 * These mirror the backend DTOs. They are hand-maintained rather than generated
 * because the two packages deploy independently — a generated client that
 * silently changes shape on `npm install` is worse than one that changes in a
 * reviewable commit. The OpenAPI spec at `/api/v1/openapi.json` is the
 * authority; this file is the typed view of it.
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta;
  timestamp: string;
  requestId?: string;
}

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export interface ApiError {
  success: false;
  message: string;
  error: {
    code: ApiErrorCode;
    details?: FieldError[] | Record<string, unknown>;
  };
  timestamp: string;
  requestId?: string;
}

/** Stable codes the UI switches on. Never switch on `message`. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'ACCOUNT_INACTIVE'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_ROLE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_RESOURCE'
  | 'BUSINESS_RULE_VIOLATION'
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_STATE_TRANSITION'
  | 'RATE_LIMIT_EXCEEDED'
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR';

/** Result of a list endpoint after the client layer unwraps the envelope. */
export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------------

export type RoleName = 'ADMIN' | 'SALES' | 'WAREHOUSE' | 'ACCOUNTS';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export type CustomerType = 'RETAILER' | 'WHOLESALER' | 'DISTRIBUTOR' | 'CORPORATE' | 'WALK_IN';
export type CustomerStatus = 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'BLACKLISTED';

export type FollowUpType = 'CALL' | 'EMAIL' | 'MEETING' | 'SITE_VISIT' | 'WHATSAPP' | 'OTHER';
export type FollowUpStatus = 'PENDING' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED';

export type MovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'RETURN' | 'DAMAGE';
export type MovementReason =
  | 'PURCHASE_RECEIPT'
  | 'SALES_CHALLAN'
  | 'CHALLAN_CANCELLATION'
  | 'CUSTOMER_RETURN'
  | 'SUPPLIER_RETURN'
  | 'STOCK_TAKE_ADJUSTMENT'
  | 'DAMAGE_WRITE_OFF'
  | 'OPENING_BALANCE'
  | 'MANUAL_CORRECTION';

export type ChallanStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  role: { id: string; name: RoleName; description: string };
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export interface Role {
  id: string;
  name: RoleName;
  description: string;
  userCount: number;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface Customer {
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
    formatted: string;
  };
  creditLimit: number;
  outstandingAmount: number;
  availableCredit: number;
  followUpDate: string | null;
  notes: string | null;
  owner: { id: string; name: string; email: string } | null;
  stats: { challanCount: number; followUpCount: number };
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  id: string;
  customerId: string;
  type: FollowUpType;
  status: FollowUpStatus;
  subject: string;
  notes: string | null;
  outcome: string | null;
  scheduledAt: string;
  completedAt: string | null;
  isOverdue: boolean;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  kind: 'FOLLOW_UP' | 'AUDIT';
  title: string;
  description: string | null;
  actor: string | null;
  occurredAt: string;
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Catalogue & inventory
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  parent: { id: string; name: string } | null;
  stats: { productCount: number; childCount: number };
  createdAt: string;
  updatedAt: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  barcode: string | null;
  imageUrl: string | null;
  category: { id: string; name: string; slug: string };
  unitPrice: number;
  costPrice: number;
  taxRate: number;
  unit: string;
  priceWithTax: number;
  minimumStock: number;
  stock: {
    onHand: number;
    reserved: number;
    available: number;
    status: StockStatus;
    warehouseLocation: string | null;
    binLocation: string | null;
    lastMovementAt: string | null;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  product: { id: string; sku: string; name: string; unit: string };
  movementType: MovementType;
  reason: MovementReason;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  netChange: number;
  reference: { type: string | null; id: string | null; code: string | null };
  notes: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface InventorySummary {
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
}

// ---------------------------------------------------------------------------
// Sales challans
// ---------------------------------------------------------------------------

export interface ChallanItem {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  unitPrice: number;
  taxRate: number;
  quantity: number;
  discountPercent: number;
  lineSubtotal: number;
  lineTaxAmount: number;
  lineTotal: number;
}

export interface Challan {
  id: string;
  challanNumber: string;
  status: ChallanStatus;
  customer: {
    id: string;
    code: string;
    name: string;
    businessName: string | null;
    mobile: string;
    gstNumber: string | null;
    address: string;
  };
  challanDate: string;
  dispatchDate: string | null;
  shippingAddress: string | null;
  transporterName: string | null;
  vehicleNumber: string | null;
  notes: string | null;
  items: ChallanItem[];
  totals: {
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    totalAmount: number;
    itemCount: number;
    totalQuantity: number;
  };
  audit: {
    createdBy: { id: string; name: string } | null;
    createdAt: string;
    confirmedBy: { id: string; name: string } | null;
    confirmedAt: string | null;
    cancelledBy: { id: string; name: string } | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
  };
  /** Server-computed from status — the UI must not re-derive these rules. */
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
    canConfirm: boolean;
    canCancel: boolean;
  };
}

// ---------------------------------------------------------------------------
// Dashboard & audit
// ---------------------------------------------------------------------------

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  changePercent: number | null;
  format: 'number' | 'currency' | 'percent';
  intent: 'neutral' | 'positive' | 'warning' | 'danger';
}

export interface DashboardOverview {
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

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  actor: { id: string | null; email: string | null; role: string | null };
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Query parameter shapes
// ---------------------------------------------------------------------------

export interface BaseListParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CustomerListParams extends BaseListParams {
  status?: CustomerStatus;
  customerType?: CustomerType;
  ownerId?: string;
  city?: string;
  followUpDue?: 'true' | 'false';
}

export interface ProductListParams extends BaseListParams {
  categoryId?: string;
  isActive?: 'true' | 'false';
  lowStock?: 'true' | 'false';
  outOfStock?: 'true' | 'false';
  minPrice?: number;
  maxPrice?: number;
}

export interface ChallanListParams extends BaseListParams {
  status?: ChallanStatus;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface StockMovementListParams extends BaseListParams {
  productId?: string;
  movementType?: MovementType;
  reason?: MovementReason;
  dateFrom?: string;
  dateTo?: string;
}

export interface FollowUpListParams extends BaseListParams {
  customerId?: string;
  status?: FollowUpStatus;
  type?: FollowUpType;
}

export interface AuditListParams extends BaseListParams {
  action?: string;
  entityType?: string;
  entityId?: string;
}
