/**
 * Auth data-transfer objects.
 *
 * DTOs are the contract between the HTTP layer and the domain. They exist
 * separately from Prisma models for one non-negotiable reason: a Prisma `User`
 * carries `passwordHash`, and returning a model directly from a controller is
 * exactly how password hashes end up in a JSON response. The mapper below is
 * an allow-list — new columns are invisible to clients until deliberately added.
 */
import type { RoleName, UserStatus } from '@prisma/client';

import type { UserWithRole } from '../repositories/user.repository';

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: RoleName;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export interface UserResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  role: {
    id: string;
    name: RoleName;
    description: string;
  };
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokensDto {
  accessToken: string;
  /** Also set as an httpOnly cookie; returned in the body for non-browser clients. */
  refreshToken: string;
  tokenType: 'Bearer';
  /** Seconds until the access token expires — drives proactive client refresh. */
  expiresIn: number;
}

export interface AuthResponseDto {
  user: UserResponseDto;
  tokens: AuthTokensDto;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/**
 * Domain model -> API representation.
 *
 * Explicit field-by-field mapping (never a spread) so that adding a sensitive
 * column to the schema cannot silently widen the API surface.
 */
export const toUserResponse = (user: UserWithRole): UserResponseDto => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: `${user.firstName} ${user.lastName}`.trim(),
  phone: user.phone,
  avatarUrl: user.avatarUrl,
  status: user.status,
  role: {
    id: user.role.id,
    name: user.role.name,
    description: user.role.description,
  },
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});
