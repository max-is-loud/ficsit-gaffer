// Database access for foremen, the reusable personas a user can attach to playthroughs.

import type { PrismaClient, Foreman as ForemanRow } from '@prisma/client';

import type { Foreman } from '../types.js';

/** Initial values when creating a foreman. Owned by the authenticated user. */
export interface CreateForemanInput {
  /** Owning user (Better Auth user id). */
  userId: string;
  name: string;
  personality?: string;
}

/** Patchable foreman fields. Takes effect on the next chat message. */
export interface UpdateForemanInput {
  name?: string;
  personality?: string;
}

/**
 * Foreman lifecycle: a reusable AI-companion persona owned by a user and
 * attachable to many playthroughs (see docs/playthroughs.md). `personality` is
 * the opaque freeform string injected into the system prompt as {{PERSONALITY}}.
 */
export class ForemanService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(input: CreateForemanInput): Promise<Foreman> {
    const row = await this.prisma.foreman.create({
      data: {
        userId: input.userId,
        name: input.name,
        personality: input.personality ?? '',
      },
    });
    return rowToForeman(row);
  }

  public async get(id: string): Promise<Foreman | undefined> {
    const row = await this.prisma.foreman.findUnique({ where: { id } });
    return row === null ? undefined : rowToForeman(row);
  }

  /** All foremen owned by a user, most recently updated first. */
  public async listForUser(userId: string): Promise<Foreman[]> {
    const rows = await this.prisma.foreman.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(rowToForeman);
  }

  /**
   * Ownership of a foreman without exposing it. Returns the owning user id (null
   * for an unclaimed pre-accounts foreman), or undefined if no such foreman
   * exists. Used by the ownership middleware.
   */
  public async findOwnerId(id: string): Promise<{ userId: string | null } | undefined> {
    const row = await this.prisma.foreman.findUnique({
      where: { id },
      select: { userId: true },
    });
    return row === null ? undefined : { userId: row.userId };
  }

  public async update(id: string, patch: UpdateForemanInput): Promise<Foreman | undefined> {
    const existing = await this.prisma.foreman.findUnique({ where: { id } });
    if (existing === null) {
      return undefined;
    }
    const row = await this.prisma.foreman.update({
      where: { id },
      data: {
        name: patch.name ?? existing.name,
        personality: patch.personality ?? existing.personality,
      },
    });
    return rowToForeman(row);
  }

  /**
   * Deletes a foreman. Fails (foreign-key restrict) if any playthrough still
   * references it, so the caller surfaces a 409 rather than orphaning history.
   * Returns false if no such foreman exists.
   */
  public async delete(id: string): Promise<boolean> {
    const existing = await this.prisma.foreman.findUnique({ where: { id } });
    if (existing === null) {
      return false;
    }
    await this.prisma.foreman.delete({ where: { id } });
    return true;
  }
}

function rowToForeman(row: ForemanRow): Foreman {
  return {
    id: row.id,
    name: row.name,
    personality: row.personality,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
