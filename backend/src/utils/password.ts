/**
 * Password hashing.
 *
 * Implementation note — `bcryptjs` vs `bcrypt`:
 * `bcrypt` is a native addon requiring node-gyp and a matching prebuilt binary
 * per platform/Node ABI. On Render's build image and on Windows dev machines
 * that regularly breaks the build. `bcryptjs` is the pure-JavaScript
 * implementation of the *same* algorithm, produces interchangeable `$2a$`
 * hashes, and needs no toolchain. The cost is ~30% slower hashing, which at a
 * cost factor of 12 is ~250ms vs ~180ms — irrelevant on a login path, and a
 * good trade for a reproducible build. Hashes remain portable if we ever swap
 * back to the native module.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

import { env } from '../config/env';

/** Hashes a plaintext password with a per-password random salt. */
export const hashPassword = async (plainText: string): Promise<string> => {
  const salt = await bcrypt.genSalt(env.BCRYPT_SALT_ROUNDS);
  return bcrypt.hash(plainText, salt);
};

/**
 * Constant-time comparison performed by bcrypt itself.
 * Returns false rather than throwing on a malformed stored hash.
 */
export const verifyPassword = async (plainText: string, hash: string): Promise<boolean> => {
  try {
    return await bcrypt.compare(plainText, hash);
  } catch {
    return false;
  }
};

/**
 * Burns roughly the same CPU as a real verification.
 *
 * Called on the "user not found" branch of login so that response timing does
 * not reveal whether an email is registered (user-enumeration defence).
 */
export const simulatePasswordVerification = async (): Promise<void> => {
  const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7Q9O1TfLNP0Ub0hLTKQ0BqTF0e1xVvC';
  await bcrypt.compare('timing-attack-mitigation', DUMMY_HASH);
};

/** Cryptographically random opaque token (refresh tokens, reset links). */
export const generateSecureToken = (bytes = 48): string =>
  crypto.randomBytes(bytes).toString('hex');

/**
 * SHA-256 of a token. We store only this: a database dump then contains no
 * usable credential. SHA-256 (not bcrypt) is correct here because the input is
 * already 384 bits of entropy — there is nothing to brute-force, and lookups
 * must stay fast.
 */
export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');
