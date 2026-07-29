/**
 * Role persistence.
 *
 * Roles are effectively static reference data (seeded, never created at
 * runtime), so this repository is deliberately read-mostly. It exists rather
 * than inlining `prisma.role.findFirst` in the auth service because the service
 * must not import Prisma — see repository.interface.ts for the reasoning.
 */
import type { Role, RoleName } from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';

class RoleRepository {
  private db(tx?: DbClient): DbClient {
    return tx ?? prisma;
  }

  async findByName(name: RoleName, tx?: DbClient): Promise<Role | null> {
    return this.db(tx).role.findUnique({ where: { name } });
  }

  async findById(id: string, tx?: DbClient): Promise<Role | null> {
    return this.db(tx).role.findUnique({ where: { id } });
  }

  async findAll(tx?: DbClient): Promise<Array<Role & { _count: { users: number } }>> {
    return this.db(tx).role.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }
}

export const roleRepository = new RoleRepository();
export { RoleRepository };
