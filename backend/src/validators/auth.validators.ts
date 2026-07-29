/**
 * Auth request schemas.
 *
 * Note the asymmetry between login and registration: login accepts any non-empty
 * password string, while registration enforces the full policy. Applying the
 * policy at login would tell an attacker "that password could not possibly be
 * correct" before we ever check the database — a free filter for their wordlist.
 */
import { z } from 'zod';

import { emailSchema, passwordSchema, phoneSchema, shortTextSchema } from './common.validators';

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately permissive — see the module docblock.
  password: z.string().min(1, 'Password is required').max(200),
});

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    firstName: shortTextSchema(80, 'First name'),
    lastName: shortTextSchema(80, 'Last name'),
    phone: phoneSchema.optional(),
    role: z.enum(['ADMIN', 'SALES', 'WAREHOUSE', 'ACCOUNTS'], {
      errorMap: () => ({ message: 'Select a valid role' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  // `confirmPassword` has served its purpose; strip it so it never reaches the
  // service layer or an audit payload.
  .transform(({ confirmPassword: _confirmPassword, ...rest }) => rest);

export const refreshTokenSchema = z.object({
  /** Optional in the body — the httpOnly cookie is the primary transport. */
  refreshToken: z.string().min(20).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password',
  })
  .transform(({ confirmPassword: _confirmPassword, ...rest }) => rest);

export const updateProfileSchema = z
  .object({
    firstName: shortTextSchema(80, 'First name').optional(),
    lastName: shortTextSchema(80, 'Last name').optional(),
    phone: phoneSchema.optional(),
    avatarUrl: z.string().url('Enter a valid URL').max(500).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one field to update',
  });

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(120).optional(),
  sortBy: z.enum(['createdAt', 'firstName', 'lastName', 'email', 'lastLoginAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  role: z.enum(['ADMIN', 'SALES', 'WAREHOUSE', 'ACCOUNTS']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UserListQueryInput = z.infer<typeof userListQuerySchema>;
