/**
 * URL registry.
 *
 * Every path the client can call is declared here exactly once. A typo in a
 * URL is otherwise a runtime 404 discovered by a user; here it is a compile
 * error or a single-line fix.
 */
export const endpoints = {
  auth: {
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    logoutAll: '/auth/logout-all',
    me: '/auth/me',
    changePassword: '/auth/change-password',
    roles: '/auth/roles',
    users: '/auth/users',
    userStatus: (id: string) => `/auth/users/${id}/status`,
    user: (id: string) => `/auth/users/${id}`,
  },

  customers: {
    list: '/customers',
    detail: (id: string) => `/customers/${id}`,
    timeline: (id: string) => `/customers/${id}/timeline`,
    followUps: (id: string) => `/customers/${id}/follow-ups`,
    allFollowUps: '/customers/follow-ups',
    followUp: (id: string) => `/customers/follow-ups/${id}`,
    completeFollowUp: (id: string) => `/customers/follow-ups/${id}/complete`,
  },

  categories: {
    list: '/categories',
    options: '/categories/options',
    detail: (id: string) => `/categories/${id}`,
  },

  products: {
    list: '/products',
    detail: (id: string) => `/products/${id}`,
    movements: (id: string) => `/products/${id}/movements`,
  },

  inventory: {
    summary: '/inventory/summary',
    adjust: (productId: string) => `/inventory/${productId}/adjust`,
    stockTake: (productId: string) => `/inventory/${productId}/stock-take`,
    location: (productId: string) => `/inventory/${productId}/location`,
  },

  stockMovements: {
    list: '/stock-movements',
    detail: (id: string) => `/stock-movements/${id}`,
  },

  challans: {
    list: '/challans',
    detail: (id: string) => `/challans/${id}`,
    confirm: (id: string) => `/challans/${id}/confirm`,
    cancel: (id: string) => `/challans/${id}/cancel`,
    pdf: (id: string) => `/challans/${id}/pdf`,
  },

  dashboard: {
    overview: '/dashboard',
  },

  audit: {
    list: '/audit-logs',
    timeline: (entityType: string, entityId: string) => `/audit-logs/${entityType}/${entityId}`,
  },
} as const;
