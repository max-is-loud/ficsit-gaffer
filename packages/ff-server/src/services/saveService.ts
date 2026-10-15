// Stores each playthrough's uploaded save versions on disk and in the database, reads their
// metadata through the MCP, raises re-upload warnings, syncs collectibles and matches an upload to
// existing playthroughs.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PrismaClient, Save as SaveRow } from '@prisma/client';

import { logger } from '../logger.js';
import type { McpGateway } from '../mcp/client.js';
import type {
  CollectibleSyncSummary,
  Save,
  SaveIdentity,
  SaveMatch,
  SavePreviewResult,
  SaveUploadResult,
  SaveWarning,
} from '../types.js';
import { rowToSave } from './playthroughService.js';
import type { WorkOrderService } from './workOrderService.js';

/** An uploaded file's bytes + metadata, as handed over by the upload route. */
export interface UploadedSave {
  fileName: string;
  bytes: Buffer;
}

/** Metadata parsed from a `.sav` header (best-effort; absent if unparsable). */
type SaveMetadata = SaveIdentity & { version?: string };

/** Versions kept per playthrough. The current save is always kept, even beyond this. */
const RETENTION = 10;

/**
 * Stores a playthrough's uploaded `.sav` versions and their metadata (#76). Each
 * version is a `Save` row + a file at `<saveDataDir>/<playthroughId>/<saveId>.sav`;
 * `Playthrough.currentSaveId` points at the one that feeds the save-game MCP.
 * Re-uploading appends a version (keeping the last {@link RETENTION}); the
 * pioneer can re-activate or delete older versions. Header metadata is read via
 * the save-game MCP's `describe_save` (the same shared volume, by absolute path);
 * a missing/unreachable MCP just yields empty metadata.
 */
export class SaveService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly mcp: McpGateway,
    private readonly saveDataDir: string,
    private readonly workOrders: WorkOrderService,
  ) {}

  /** Per-playthrough save directory, guarded against path traversal. */
  private dirFor(playthroughId: string): string {
    const root = path.resolve(this.saveDataDir);
    const dir = path.resolve(root, playthroughId);
    if (path.dirname(dir) !== root || !dir.startsWith(root + path.sep)) {
      throw new Error(`Unsafe save dir for playthrough id '${playthroughId}'.`);
    }
    return dir;
  }

  /** Absolute on-disk path for a specific save version. */
  public savePathFor(playthroughId: string, saveId: string): string {
    const dir = this.dirFor(playthroughId);
    const resolved = path.resolve(dir, `${saveId}.sav`);
    if (path.dirname(resolved) !== dir || !resolved.startsWith(dir + path.sep)) {
      throw new Error(`Unsafe save path for save id '${saveId}'.`);
    }
    return resolved;
  }

  /** The path of the playthrough's CURRENT save, if it has one. Feeds the MCP. */
  public async getSavePath(playthroughId: string): Promise<string | undefined> {
    const pt = await this.prisma.playthrough.findUnique({
      where: { id: playthroughId },
      select: { currentSaveId: true },
    });
    if (pt?.currentSaveId == null) {
      return undefined;
    }
    return this.savePathFor(playthroughId, pt.currentSaveId);
  }

  /** The playthrough's current save row, if any. */
  private async currentSave(playthroughId: string): Promise<SaveRow | null> {
    const pt = await this.prisma.playthrough.findUnique({
      where: { id: playthroughId },
      include: { currentSave: true },
    });
    return pt?.currentSave ?? null;
  }

  /** History of a playthrough's saves, newest upload first. */
  public async listSaves(playthroughId: string): Promise<Save[]> {
    const rows = await this.prisma.save.findMany({
      where: { playthroughId },
      orderBy: { uploadedAt: 'desc' },
    });
    return rows.map(rowToSave);
  }

  /**
   * Appends a new save version, makes it current, seeds the playthrough name when
   * unset, and prunes beyond the retention window. Returns the stored save plus
   * any advisories (build mismatch, play-time regression).
   */
  public async addVersion(playthroughId: string, file: UploadedSave): Promise<SaveUploadResult> {
    const previous = await this.currentSave(playthroughId);

    const saveId = randomUUID();
    fs.mkdirSync(this.dirFor(playthroughId), { recursive: true });
    const filePath = this.savePathFor(playthroughId, saveId);
    fs.writeFileSync(filePath, file.bytes);

    const metadata = await this.describe(filePath);
    const row = await this.prisma.save.create({
      data: {
        id: saveId,
        playthroughId,
        fileName: file.fileName,
        saveName: metadata.saveName ?? null,
        version: metadata.version ?? null,
        sessionName: metadata.sessionName ?? null,
        mapName: metadata.mapName ?? null,
        buildVersion: metadata.buildVersion ?? null,
        saveVersion: metadata.saveVersion ?? null,
        playDurationSeconds: metadata.playDurationSeconds ?? null,
        sizeBytes: file.bytes.length,
      },
    });
    await this.prisma.playthrough.update({
      where: { id: playthroughId },
      data: { currentSaveId: row.id },
    });

    await this.seedName(playthroughId, metadata.saveName);
    await this.prune(playthroughId, row.id);

    // #209-B: auto-reconcile active explore orders' collectibles against the new save.
    const collectibleSync = await this.syncCollectibles(playthroughId, filePath);

    return {
      save: rowToSave(row),
      warnings: [...this.buildWarnings(metadata), ...this.regressionWarnings(previous, metadata)],
      ...(collectibleSync !== undefined && collectibleSync.synced > 0 ? { collectibleSync } : {}),
    };
  }

  /**
   * Marks explore-order collectibles collected from the just-uploaded save (#209-B). Best-
   * effort: a missing/unreachable save tool or no explore orders simply yields no sync.
   */
  private async syncCollectibles(
    playthroughId: string,
    savePath: string,
  ): Promise<CollectibleSyncSummary | undefined> {
    try {
      const res = await this.mcp.callTool('get_collected_identities', { savePath });
      if (res.isError) {
        return undefined;
      }
      const parsed = JSON.parse(res.text) as { guids?: string[]; schematics?: string[] };
      return await this.workOrders.reconcileCollectibles(
        playthroughId,
        new Set(parsed.guids ?? []),
        new Set(parsed.schematics ?? []),
      );
    } catch {
      return undefined;
    }
  }

  /** Re-activates an older version as the current save. Returns it, or undefined. */
  public async setCurrentSave(playthroughId: string, saveId: string): Promise<Save | undefined> {
    const row = await this.prisma.save.findFirst({ where: { id: saveId, playthroughId } });
    if (row === null) {
      return undefined;
    }
    await this.prisma.playthrough.update({
      where: { id: playthroughId },
      data: { currentSaveId: saveId },
    });
    return rowToSave(row);
  }

  /**
   * Deletes a save version (row + file). If it was current, the newest remaining
   * version is promoted (or the playthrough is left with no save). Returns false
   * if the save does not belong to the playthrough.
   */
  public async deleteSave(playthroughId: string, saveId: string): Promise<boolean> {
    const row = await this.prisma.save.findFirst({ where: { id: saveId, playthroughId } });
    if (row === null) {
      return false;
    }
    const pt = await this.prisma.playthrough.findUnique({
      where: { id: playthroughId },
      select: { currentSaveId: true },
    });
    if (pt?.currentSaveId === saveId) {
      const replacement = await this.prisma.save.findFirst({
        where: { playthroughId, id: { not: saveId } },
        orderBy: { uploadedAt: 'desc' },
      });
      await this.prisma.playthrough.update({
        where: { id: playthroughId },
        data: { currentSaveId: replacement?.id ?? null },
      });
    }
    await this.prisma.save.delete({ where: { id: saveId } });
    this.removeFile(playthroughId, saveId);
    return true;
  }

  /**
   * Parses a save's identity without persisting it, and finds the user's
   * playthroughs whose current save looks like the same game. Used by the
   * same-game preview before committing an upload. The bytes are written to a
   * quarantine file (so the MCP can read by path) and removed afterwards.
   */
  public async preview(userId: string, bytes: Buffer): Promise<SavePreviewResult> {
    const identity = await this.previewIdentity(bytes);
    const matches = await this.findMatches(userId, identity);
    return { identity, matches, warnings: this.buildWarnings(identity) };
  }

  /** Parses header identity from raw bytes via a short-lived quarantine file. */
  private async previewIdentity(bytes: Buffer): Promise<SaveIdentity> {
    const dir = path.join(path.resolve(this.saveDataDir), '.preview');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${randomUUID()}.sav`);
    try {
      fs.writeFileSync(filePath, bytes);
      const { version: _version, ...identity } = await this.describe(filePath);
      return identity;
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  }

  /** Playthroughs (the user's own) whose current save matches the given identity. */
  private async findMatches(userId: string, identity: SaveIdentity): Promise<SaveMatch[]> {
    if (identity.sessionName === undefined) {
      return [];
    }
    const rows = await this.prisma.playthrough.findMany({
      where: {
        userId,
        currentSave: {
          sessionName: identity.sessionName,
          ...(identity.mapName !== undefined ? { mapName: identity.mapName } : {}),
        },
      },
      include: { currentSave: true },
    });
    return rows.flatMap((pt) => {
      const cur = pt.currentSave;
      if (cur === null) {
        return [];
      }
      const regressed =
        identity.playDurationSeconds !== undefined &&
        cur.playDurationSeconds !== null &&
        identity.playDurationSeconds < cur.playDurationSeconds;
      const match: SaveMatch = {
        playthroughId: pt.id,
        playthroughName: pt.name ?? undefined,
        currentSave: {
          saveName: cur.saveName ?? undefined,
          playDurationSeconds: cur.playDurationSeconds ?? undefined,
          uploadedAt: cur.uploadedAt.toISOString(),
        },
        reason: 'session_map_match',
        playtimeRegressed: regressed,
      };
      return [match];
    });
  }

  /** Removes a playthrough's entire save directory (best-effort), on delete. */
  public removeSaveDir(playthroughId: string): void {
    try {
      // dirFor validates the id stays directly within the data dir (no
      // traversal); the legacy single-file path is derived from that safe dir
      // rather than re-interpolating the untrusted id into a fresh path.
      const dir = this.dirFor(playthroughId);
      fs.rmSync(dir, { recursive: true, force: true });
      // Also clear any pre-#76 single-file layout that predates the reconcile.
      fs.rmSync(`${dir}.sav`, { force: true });
    } catch (error) {
      logger.warn(`Could not remove save dir for playthrough '${playthroughId}':`, error);
    }
  }

  /**
   * Idempotent startup migration of the pre-#76 single-file layout
   * (`<dir>/<playthroughId>.sav`) to the per-version layout
   * (`<dir>/<playthroughId>/<currentSaveId>.sav`). Safe to run on every boot.
   */
  public async reconcileStorage(): Promise<void> {
    const root = path.resolve(this.saveDataDir);
    if (!fs.existsSync(root)) {
      return;
    }
    const playthroughs = await this.prisma.playthrough.findMany({
      where: { currentSaveId: { not: null } },
      select: { id: true, currentSaveId: true },
    });
    for (const pt of playthroughs) {
      const legacy = path.resolve(root, `${pt.id}.sav`);
      if (path.dirname(legacy) !== root || !fs.existsSync(legacy)) {
        continue;
      }
      const dest = this.savePathFor(pt.id, pt.currentSaveId as string);
      if (fs.existsSync(dest)) {
        continue;
      }
      try {
        fs.mkdirSync(this.dirFor(pt.id), { recursive: true });
        fs.renameSync(legacy, dest);
        logger.info(`Migrated save for playthrough '${pt.id}' to the per-version layout.`);
      } catch (error) {
        logger.warn(`Could not migrate save for playthrough '${pt.id}':`, error);
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Default the playthrough's name from the save's in-game name when unset. */
  private async seedName(playthroughId: string, saveName: string | undefined): Promise<void> {
    if (saveName === undefined || saveName.length === 0) {
      return;
    }
    const pt = await this.prisma.playthrough.findUnique({
      where: { id: playthroughId },
      select: { name: true },
    });
    if (pt !== null && (pt.name === null || pt.name.length === 0)) {
      await this.prisma.playthrough.update({
        where: { id: playthroughId },
        data: { name: saveName },
      });
    }
  }

  /** Drops versions beyond the retention window, never removing the current save. */
  private async prune(playthroughId: string, keepId: string): Promise<void> {
    const rows = await this.prisma.save.findMany({
      where: { playthroughId },
      orderBy: { uploadedAt: 'desc' },
      select: { id: true },
    });
    const doomed = rows.slice(RETENTION).filter((r) => r.id !== keepId);
    for (const { id } of doomed) {
      await this.prisma.save.delete({ where: { id } });
      this.removeFile(playthroughId, id);
    }
  }

  private removeFile(playthroughId: string, saveId: string): void {
    try {
      fs.rmSync(this.savePathFor(playthroughId, saveId), { force: true });
    } catch (error) {
      logger.warn(`Could not remove save file '${saveId}':`, error);
    }
  }

  /** Build-version mismatch advisory (only when both builds are known and differ). */
  private buildWarnings(metadata: SaveIdentity): SaveWarning[] {
    const saveBuild = metadata.buildVersion;
    const gameDataBuild = this.mcp.gameBuild;
    if (saveBuild === undefined || gameDataBuild === undefined || saveBuild === gameDataBuild) {
      return [];
    }
    return [
      {
        kind: 'build_mismatch',
        saveBuild,
        gameDataBuild,
        message:
          `This save is from Satisfactory build ${saveBuild}, but the foreman's game ` +
          `data is build ${gameDataBuild}. Recipes or build costs may not match — ` +
          `update the game data, or expect occasional discrepancies.`,
      },
    ];
  }

  /** Play-time regression advisory when a re-upload has less play time than the prior current. */
  private regressionWarnings(previous: SaveRow | null, metadata: SaveIdentity): SaveWarning[] {
    if (
      previous?.playDurationSeconds == null ||
      metadata.playDurationSeconds === undefined ||
      metadata.playDurationSeconds >= previous.playDurationSeconds
    ) {
      return [];
    }
    const hrs = (s: number): string => `${Math.round(s / 360) / 10}h`;
    return [
      {
        kind: 'playtime_regressed',
        message:
          `This save has less play time (${hrs(metadata.playDurationSeconds)}) than the one ` +
          `it replaces (${hrs(previous.playDurationSeconds)}). If that's unexpected, you may ` +
          `have uploaded an older save.`,
      },
    ];
  }

  /**
   * Asks the save-game MCP to read the header and return identity. Never throws —
   * a missing/unreachable save MCP just yields empty metadata.
   */
  private async describe(savePath: string): Promise<SaveMetadata> {
    try {
      const result = await this.mcp.callTool('describe_save', { savePath });
      if (result.isError) {
        return {};
      }
      const parsed = JSON.parse(result.text) as Partial<SaveMetadata>;
      const metadata: SaveMetadata = {};
      const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
      const num = (v: unknown): v is number => typeof v === 'number';
      if (str(parsed.saveName)) {
        metadata.saveName = parsed.saveName;
      }
      if (str(parsed.version)) {
        metadata.version = parsed.version;
      }
      if (str(parsed.sessionName)) {
        metadata.sessionName = parsed.sessionName;
      }
      if (str(parsed.mapName)) {
        metadata.mapName = parsed.mapName;
      }
      if (num(parsed.buildVersion)) {
        metadata.buildVersion = parsed.buildVersion;
      }
      if (num(parsed.saveVersion)) {
        metadata.saveVersion = parsed.saveVersion;
      }
      if (num(parsed.playDurationSeconds)) {
        metadata.playDurationSeconds = parsed.playDurationSeconds;
      }
      return metadata;
    } catch (error) {
      logger.warn('Could not parse save metadata via describe_save:', error);
      return {};
    }
  }
}
