// Database access for playthroughs and their chat messages, including ownership lookup, claiming
// and the running summary.

import { randomUUID } from 'node:crypto';

import type { PrismaClient, Playthrough as PlaythroughRow, Save as SaveRow } from '@prisma/client';

import type { ChatMessage, Playthrough, StoredMessage } from '../types.js';

/** Initial values when creating a playthrough. Owned by the authenticated user. */
export interface CreatePlaythroughInput {
  /** Owning user (Better Auth user id). */
  userId: string;
  /** The attached foreman (persona). Required — one foreman per playthrough. */
  foremanId: string;
  /** Client-held playthrough id. Generated if omitted. */
  id?: string;
  /** Free-text name; defaulted from the attached save's name on upload. */
  name?: string;
  pioneerProfile?: string;
}

/** Patchable playthrough fields. Takes effect on the next chat message. */
export interface UpdatePlaythroughInput {
  name?: string;
  pioneerProfile?: string;
  foremanId?: string;
}

/** Outcome of claiming a pre-accounts anonymous playthrough for a user. */
export type ClaimResult =
  { ok: true; playthrough: Playthrough } | { ok: false; reason: 'notFound' | 'owned' };

/**
 * Playthrough lifecycle and message history. A playthrough is one save's journey
 * — a chosen foreman + the pioneer's play style for this run + the conversation
 * and its work orders (see docs/playthroughs.md). Its id is a client-held UUID.
 * `pioneerProfile` is an opaque freeform string injected into the system prompt;
 * the persona text lives on the attached {@link Foreman}.
 */
export class PlaythroughService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(input: CreatePlaythroughInput): Promise<Playthrough> {
    const row = await this.prisma.playthrough.create({
      data: {
        id: input.id ?? randomUUID(),
        userId: input.userId,
        foremanId: input.foremanId,
        name: input.name ?? null,
        pioneerProfile: input.pioneerProfile ?? '',
      },
    });
    return rowToPlaythrough(row);
  }

  public async get(id: string): Promise<Playthrough | undefined> {
    const row = await this.prisma.playthrough.findUnique({
      where: { id },
      include: { currentSave: true },
    });
    return row === null ? undefined : rowToPlaythrough(row);
  }

  /** All playthroughs owned by a user, most recently updated first. */
  public async listForUser(userId: string): Promise<Playthrough[]> {
    const rows = await this.prisma.playthrough.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { currentSave: true },
    });
    return rows.map(rowToPlaythrough);
  }

  /**
   * Ownership of a playthrough without exposing it. Returns the owning user id
   * (null for an unclaimed pre-accounts playthrough), or undefined if no such
   * playthrough exists. Used by the ownership middleware.
   */
  public async findOwnerId(id: string): Promise<{ userId: string | null } | undefined> {
    const row = await this.prisma.playthrough.findUnique({
      where: { id },
      select: { userId: true },
    });
    return row === null ? undefined : { userId: row.userId };
  }

  /**
   * Claims a pre-accounts anonymous playthrough (userId still null) for a user,
   * so the browser's existing local playthrough survives first sign-in.
   * Idempotent if the caller already owns it; refuses one owned by someone else.
   */
  public async claim(id: string, userId: string): Promise<ClaimResult> {
    const row = await this.prisma.playthrough.findUnique({ where: { id } });
    if (row === null) {
      return { ok: false, reason: 'notFound' };
    }
    if (row.userId !== null && row.userId !== userId) {
      return { ok: false, reason: 'owned' };
    }
    if (row.userId === userId) {
      return { ok: true, playthrough: rowToPlaythrough(row) };
    }
    const updated = await this.prisma.playthrough.update({ where: { id }, data: { userId } });
    return { ok: true, playthrough: rowToPlaythrough(updated) };
  }

  public async update(id: string, patch: UpdatePlaythroughInput): Promise<Playthrough | undefined> {
    const existing = await this.prisma.playthrough.findUnique({ where: { id } });
    if (existing === null) {
      return undefined;
    }
    const row = await this.prisma.playthrough.update({
      where: { id },
      data: {
        name: patch.name ?? existing.name,
        pioneerProfile: patch.pioneerProfile ?? existing.pioneerProfile,
        foremanId: patch.foremanId ?? existing.foremanId,
      },
    });
    return rowToPlaythrough(row);
  }

  /** Deletes a playthrough and (via cascade) its messages + work orders. */
  public async delete(id: string): Promise<boolean> {
    const existing = await this.prisma.playthrough.findUnique({ where: { id } });
    if (existing === null) {
      return false;
    }
    await this.prisma.playthrough.delete({ where: { id } });
    return true;
  }

  /**
   * The most recent `limit` messages for a playthrough, in chronological order,
   * each with its id + timestamp — for re-hydrating the chat view on load/switch.
   */
  public async listMessages(playthroughId: string, limit: number): Promise<StoredMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { playthroughId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role as ChatMessage['role'],
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Appends a conversational turn to the playthrough's history. */
  public async appendMessage(
    playthroughId: string,
    role: ChatMessage['role'],
    content: string,
  ): Promise<void> {
    await this.prisma.message.create({ data: { playthroughId, role, content } });
  }

  /**
   * The most recent `window` messages for a playthrough, in chronological order.
   * History is windowed here so the chat request never carries the full log.
   */
  public async recentMessages(playthroughId: string, window: number): Promise<ChatMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { playthroughId },
      orderBy: { createdAt: 'desc' },
      take: window,
    });
    return rows
      .reverse()
      .map((row) => ({ role: row.role as ChatMessage['role'], content: row.content }));
  }

  /** Total number of stored messages for a playthrough. */
  public async countMessages(playthroughId: string): Promise<number> {
    return this.prisma.message.count({ where: { playthroughId } });
  }

  /**
   * Messages that fall OUTSIDE the current window — everything except the most
   * recent `window`, in chronological order. This is the context the windowed
   * history can no longer see, and so the material the summary must preserve.
   */
  public async messagesBeforeWindow(playthroughId: string, window: number): Promise<ChatMessage[]> {
    const total = await this.countMessages(playthroughId);
    const olderCount = Math.max(0, total - window);
    if (olderCount === 0) {
      return [];
    }
    const rows = await this.prisma.message.findMany({
      where: { playthroughId },
      orderBy: { createdAt: 'asc' },
      take: olderCount,
    });
    return rows.map((row) => ({ role: row.role as ChatMessage['role'], content: row.content }));
  }

  /** Stores (replaces) the playthrough's running summary. */
  public async updateSummary(playthroughId: string, summary: string): Promise<void> {
    await this.prisma.playthrough.update({ where: { id: playthroughId }, data: { summary } });
  }
}

function rowToPlaythrough(row: PlaythroughRow & { currentSave?: SaveRow | null }): Playthrough {
  const playthrough: Playthrough = {
    id: row.id,
    foremanId: row.foremanId,
    pioneerProfile: row.pioneerProfile,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.name !== null && row.name.length > 0) {
    playthrough.name = row.name;
  }
  if (row.summary !== null && row.summary.length > 0) {
    playthrough.summary = row.summary;
  }
  if (row.currentSave !== undefined && row.currentSave !== null) {
    playthrough.save = rowToSave(row.currentSave);
  }
  return playthrough;
}

/** Marshals a Save row into the API shape (metadata only; no file path). */
export function rowToSave(row: SaveRow): NonNullable<Playthrough['save']> {
  return {
    id: row.id,
    fileName: row.fileName,
    saveName: row.saveName ?? undefined,
    version: row.version ?? undefined,
    sessionName: row.sessionName ?? undefined,
    mapName: row.mapName ?? undefined,
    buildVersion: row.buildVersion ?? undefined,
    saveVersion: row.saveVersion ?? undefined,
    playDurationSeconds: row.playDurationSeconds ?? undefined,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}
