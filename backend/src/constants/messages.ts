/**
 * Centralised user-facing messages.
 *
 * Keeping copy out of business logic means (a) wording changes never touch a
 * service, and (b) i18n is a drop-in change later.
 */
export const AuthMessages = {
  LOGIN_SUCCESS: 'Signed in successfully',
  LOGOUT_SUCCESS: 'Signed out successfully',
  REGISTER_SUCCESS: 'User account created successfully',
  TOKEN_REFRESHED: 'Session refreshed',
  PASSWORD_CHANGED: 'Password updated successfully',
  PROFILE_UPDATED: 'Profile updated successfully',
  INVALID_CREDENTIALS: 'The email or password you entered is incorrect',
  ACCOUNT_INACTIVE: 'This account is not active. Contact your administrator.',
  MISSING_TOKEN: 'Authentication required. Please sign in.',
  INVALID_TOKEN: 'Your session is invalid. Please sign in again.',
  EXPIRED_TOKEN: 'Your session has expired. Please sign in again.',
  REUSED_REFRESH_TOKEN:
    'This session was already refreshed. For your security all sessions were signed out.',
  CURRENT_PASSWORD_INCORRECT: 'The current password you entered is incorrect',
  EMAIL_TAKEN: 'An account with this email address already exists',
} as const;

export const CustomerMessages = {
  CREATED: 'Customer created successfully',
  UPDATED: 'Customer updated successfully',
  DELETED: 'Customer deleted successfully',
  NOT_FOUND: 'Customer not found',
  DUPLICATE_MOBILE: 'A customer with this mobile number already exists',
  DUPLICATE_EMAIL: 'A customer with this email address already exists',
  DUPLICATE_GST: 'A customer with this GST number already exists',
  HAS_CHALLANS: 'This customer has issued challans and cannot be deleted',
  FOLLOW_UP_CREATED: 'Follow-up scheduled successfully',
  FOLLOW_UP_UPDATED: 'Follow-up updated successfully',
  FOLLOW_UP_DELETED: 'Follow-up removed successfully',
  FOLLOW_UP_NOT_FOUND: 'Follow-up not found',
} as const;

export const ProductMessages = {
  CREATED: 'Product created successfully',
  UPDATED: 'Product updated successfully',
  DELETED: 'Product deleted successfully',
  NOT_FOUND: 'Product not found',
  DUPLICATE_SKU: 'A product with this SKU already exists',
  DUPLICATE_BARCODE: 'A product with this barcode already exists',
  HAS_STOCK: 'This product still holds stock and cannot be deleted',
  HAS_CHALLANS: 'This product appears on existing challans and cannot be deleted',
  INACTIVE: 'This product is inactive and cannot be sold',
} as const;

export const CategoryMessages = {
  CREATED: 'Category created successfully',
  UPDATED: 'Category updated successfully',
  DELETED: 'Category deleted successfully',
  NOT_FOUND: 'Category not found',
  DUPLICATE_NAME: 'A category with this name already exists',
  HAS_PRODUCTS: 'This category still contains products and cannot be deleted',
  SELF_PARENT: 'A category cannot be its own parent',
} as const;

export const InventoryMessages = {
  NOT_FOUND: 'Inventory record not found for this product',
  ADJUSTED: 'Stock adjusted successfully',
  INSUFFICIENT: 'Insufficient stock available',
  NEGATIVE_RESULT: 'This adjustment would drive stock below zero',
} as const;

export const ChallanMessages = {
  CREATED: 'Challan created successfully',
  UPDATED: 'Challan updated successfully',
  DELETED: 'Draft challan deleted successfully',
  CONFIRMED: 'Challan confirmed and stock deducted',
  CANCELLED: 'Challan cancelled',
  NOT_FOUND: 'Challan not found',
  ONLY_DRAFT_EDITABLE: 'Only draft challans can be edited',
  ONLY_DRAFT_DELETABLE: 'Only draft challans can be deleted',
  ONLY_DRAFT_CONFIRMABLE: 'Only draft challans can be confirmed',
  ALREADY_CANCELLED: 'This challan is already cancelled',
  CANNOT_CANCEL_CANCELLED: 'A cancelled challan cannot be cancelled again',
  EMPTY_ITEMS: 'A challan must contain at least one line item',
  DUPLICATE_PRODUCT: 'Each product may appear only once on a challan',
  CUSTOMER_BLACKLISTED: 'This customer is blacklisted and cannot be issued challans',
} as const;

export const CommonMessages = {
  FETCHED: 'Request completed successfully',
  NOT_FOUND: 'The requested resource was not found',
  VALIDATION_FAILED: 'The submitted data failed validation',
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again.',
  RATE_LIMITED: 'Too many requests. Please slow down and try again shortly.',
  FORBIDDEN: 'You do not have permission to perform this action',
  ROUTE_NOT_FOUND: 'The requested endpoint does not exist',
} as const;
