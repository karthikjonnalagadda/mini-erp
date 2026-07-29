/**
 * Atomic document-number allocation.
 *
 * The naive implementation — `SELECT MAX(number) + 1` — is a race condition
 * waiting to happen: two concurrent challans read the same max and both try to
 * insert the same number. One fails with a unique-violation, or worse, the
 * numbers silently collide if the constraint is missing.
 *
 * Instead we use a single statement:
 *
 *   INSERT ... ON CONFLICT (key) DO UPDATE SET "currentValue" = ... + 1
 *   RETURNING "currentValue"
 *
 * Postgres takes a row-level lock for the duration of the enclosing
 * transaction, so concurrent callers serialise on that one row and each
 * receives a distinct value. This is why `tx` is a REQUIRED parameter — calling
 * it outside a transaction would release the lock immediately and reintroduce
 * the race with the caller's own insert.
 *
 * Trade-off accepted: numbers are gap-free only if transactions commit. A
 * rolled-back challan burns its number. That is standard for statutory
 * documents and preferable to blocking on a global counter.
 */
import { Prisma } from '@prisma/client';

import type { DbClient } from '../config/prisma';
import type { ISequenceRepository } from '../interfaces/repository.interface';

/** Sequences reset annually, so the year is part of the key. */
const sequenceKeyFor = (key: string, year: number): string => `${key}:${year}`;

class SequenceRepository implements ISequenceRepository {
  /**
   * Allocates and formats the next number, e.g. `CH-2026-000117`.
   *
   * @param key    Logical sequence, e.g. 'SALES_CHALLAN'
   * @param prefix Document prefix, e.g. 'CH'
   * @param tx     REQUIRED active transaction client.
   */
  async nextDocumentNumber(key: string, prefix: string, tx: DbClient): Promise<string> {
    const year = new Date().getFullYear();
    const scopedKey = sequenceKeyFor(key, year);
    const padding = 6;

    const rows = await tx.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
      INSERT INTO "document_sequences" ("id", "key", "prefix", "currentValue", "padding", "updatedAt")
      VALUES (gen_random_uuid(), ${scopedKey}, ${prefix}, 1, ${padding}, NOW())
      ON CONFLICT ("key")
      DO UPDATE SET
        "currentValue" = "document_sequences"."currentValue" + 1,
        "updatedAt"    = NOW()
      RETURNING "currentValue"
    `);

    const nextValue = rows[0]?.currentValue;
    if (nextValue === undefined) {
      // Unreachable: the statement always returns exactly one row. Guarding
      // anyway because silently producing a malformed document number would be
      // far worse to debug later.
      throw new Error(`Failed to allocate a document number for sequence '${scopedKey}'`);
    }

    return `${prefix}-${year}-${String(nextValue).padStart(padding, '0')}`;
  }

  /**
   * Non-transactional variant for entity codes (customers) where a gap or a
   * retry is harmless. Still atomic — it simply runs in its own implicit
   * transaction.
   */
  async nextEntityCode(key: string, prefix: string, db: DbClient): Promise<string> {
    const scopedKey = sequenceKeyFor(key, 0); // 0 = never resets
    const padding = 6;

    const rows = await db.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
      INSERT INTO "document_sequences" ("id", "key", "prefix", "currentValue", "padding", "updatedAt")
      VALUES (gen_random_uuid(), ${scopedKey}, ${prefix}, 1, ${padding}, NOW())
      ON CONFLICT ("key")
      DO UPDATE SET
        "currentValue" = "document_sequences"."currentValue" + 1,
        "updatedAt"    = NOW()
      RETURNING "currentValue"
    `);

    const nextValue = rows[0]?.currentValue;
    if (nextValue === undefined) {
      throw new Error(`Failed to allocate an entity code for sequence '${scopedKey}'`);
    }

    return `${prefix}-${String(nextValue).padStart(padding, '0')}`;
  }
}

export const sequenceRepository = new SequenceRepository();
export { SequenceRepository };
