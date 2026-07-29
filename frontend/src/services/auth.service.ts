/**
 * Auth API calls.
 *
 * Services are thin, typed wrappers around HTTP. They contain no React and no
 * caching — that belongs to the hooks layer. Keeping them separate means the
 * same call can be made from a route loader, an event handler or a test without
 * dragging React Query along.
 */
import { apiGet, apiGetPaginated, apiPatch, apiPost, apiDelete } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import type {
  AuthResponse,
  BaseListParams,
  Paginated,
  Role,
  RoleName,
  User,
  UserStatus,
} from '@/types/api.types';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterUserPayload {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: RoleName;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
}

export interface UserListParams extends BaseListParams {
  role?: RoleName;
  status?: UserStatus;
}

export const authService = {
  login: (payload: LoginPayload): Promise<AuthResponse> =>
    apiPost<AuthResponse, LoginPayload>(endpoints.auth.login, payload),

  /**
   * Restores a session on page load using the httpOnly refresh cookie.
   * Returns the user and a fresh access token, or throws if the cookie is
   * missing/expired — the caller treats a throw as "not signed in".
   */
  refresh: (): Promise<AuthResponse> => apiPost<AuthResponse>(endpoints.auth.refresh, {}),

  logout: (): Promise<null> => apiPost<null>(endpoints.auth.logout, {}),

  logoutAll: (): Promise<{ revokedSessions: number }> =>
    apiPost<{ revokedSessions: number }>(endpoints.auth.logoutAll, {}),

  me: (): Promise<User> => apiGet<User>(endpoints.auth.me),

  updateProfile: (payload: UpdateProfilePayload): Promise<User> =>
    apiPatch<User, UpdateProfilePayload>(endpoints.auth.me, payload),

  changePassword: (payload: ChangePasswordPayload): Promise<{ revokedSessions: number }> =>
    apiPost<{ revokedSessions: number }, ChangePasswordPayload>(
      endpoints.auth.changePassword,
      payload,
    ),

  listRoles: (): Promise<Role[]> => apiGet<Role[]>(endpoints.auth.roles),

  listUsers: (params: UserListParams): Promise<Paginated<User>> =>
    apiGetPaginated<User>(endpoints.auth.users, params),

  createUser: (payload: RegisterUserPayload): Promise<User> =>
    apiPost<User, RegisterUserPayload>(endpoints.auth.users, payload),

  updateUserStatus: (id: string, status: UserStatus): Promise<User> =>
    apiPatch<User, { status: UserStatus }>(endpoints.auth.userStatus(id), { status }),

  deleteUser: (id: string): Promise<null> => apiDelete<null>(endpoints.auth.user(id)),
};
