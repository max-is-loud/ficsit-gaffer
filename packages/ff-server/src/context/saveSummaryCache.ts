// Builds each save's rendered summary once, via sf-mcp's get_save_summary, and keeps it in memory
// keyed by save id. A re-upload creates a new save id, so a stale summary is never served.

import { logger } from '../logger.js';
import type { McpGateway } from '../mcp/client.js';
import { renderSaveSummary } from './renderSaveSummary.js';
import { saveSummarySchema } from './saveSummarySchema.js';

/** The save a playthrough currently reads: its id, file path and upload time. */
export interface CurrentSave {
  id: string;
  path: string;
  uploadedAt: Date;
}

const DEFAULT_CAPACITY = 32;

/**
 * An LRU of rendered save summaries. Concurrent requests for one save share a single build.
 * A failed or malformed build is logged and not cached, so the next turn retries. Rendering is
 * deterministic, so a rebuild after a restart gives the same bytes and the prompt cache holds.
 */
export class SaveSummaryCache {
  private readonly entries = new Map<string, Promise<string | undefined>>();

  public constructor(
    private readonly mcp: McpGateway,
    private readonly capacity = DEFAULT_CAPACITY,
  ) {}

  /** The rendered summary for a save, or undefined when it could not be built. */
  public get(save: CurrentSave): Promise<string | undefined> {
    const cached = this.entries.get(save.id);
    if (cached !== undefined) {
      this.entries.delete(save.id);
      this.entries.set(save.id, cached);
      return cached;
    }
    const pending = this.build(save).then((text) => {
      if (text === undefined) {
        this.entries.delete(save.id);
      }
      return text;
    });
    this.entries.set(save.id, pending);
    this.trim();
    return pending;
  }

  /** Starts building in the background (after an upload), so the next turn finds it ready. */
  public warm(save: CurrentSave): void {
    void this.get(save);
  }

  public evict(saveId: string): void {
    this.entries.delete(saveId);
  }

  private trim(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }

  private async build(save: CurrentSave): Promise<string | undefined> {
    try {
      const result = await this.mcp.callTool('get_save_summary', { savePath: save.path });
      if (result.isError) {
        logger.warn(`Save summary unavailable for save '${save.id}': ${result.text}`);
        return undefined;
      }
      const parsed = saveSummarySchema.safeParse(
        (JSON.parse(result.text) as { summary?: unknown }).summary,
      );
      if (!parsed.success) {
        logger.warn(`Save summary for save '${save.id}' has an unexpected shape; skipping it.`);
        return undefined;
      }
      return renderSaveSummary(parsed.data, save.uploadedAt);
    } catch (error) {
      logger.warn(`Save summary build failed for save '${save.id}':`, error);
      return undefined;
    }
  }
}
